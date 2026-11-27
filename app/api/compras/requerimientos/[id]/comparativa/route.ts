import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportarRequerimiento } from "@/lib/compras/sheets";
import { puedeEditarCompras } from "@/lib/compras/auth";
import {
  leerComparativa, urlDePlanilla, carpetaConfigurada,
} from "@/lib/compras/drive";
import {
  mapearEncabezados, filasParaEsteRi, parsearFila, indiceDeLaColumnaDelId,
} from "@/lib/compras/comparativa";
import {
  esEcoAlReleer, ubicarLoDelSistema, type CotizacionDelSistema,
} from "@/lib/compras/ecoDelSistema";
import { claveProveedor } from "@/lib/compras/sheets";
import { indicePorClave } from "@/lib/core/proveedores";

/** Estados en los que la comparativa ya es el respaldo de una decisión tomada. */
import { comparativaCongelada, tienePresupuestoElegido } from "@/lib/compras/congelada";

/**
 * Adjunta una planilla de la carpeta a un requerimiento y trae sus filas.
 *
 * Es idempotente: se puede volver a llamar para releer la planilla. Al hacerlo
 * se borran los presupuestos que habían venido de Drive —sobre esos manda la
 * planilla— y se dejan intactos los que se cargaron en el sistema, y las filas
 * de la planilla que son copia de ésos no entran de nuevo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }
  if (!carpetaConfigurada()) {
    return NextResponse.json(
      { error: "La carpeta de comparativas no está configurada en este entorno." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const driveId = String(body?.drive_id ?? "").trim();
  const nombre = String(body?.nombre ?? "").trim();
  if (!driveId) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const admin = createAdminClient();
  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select("id, nro_ri, estado_compra, estado_aprobacion, proveedor_id")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de armar la comparativa" },
      { status: 409 }
    );
  }
  // Una vez decidida la compra la comparativa es el respaldo de por qué se
  // eligió ese precio: no se toca más. "Decidida" no es lo mismo que el estado:
  // ver `comparativaCongelada`.
  if (
    comparativaCongelada({
      estadoCompra: ri.estado_compra as string,
      proveedorId: (ri.proveedor_id ?? null) as string | null,
      hayPresupuestoElegido: await tienePresupuestoElegido(admin, ri.id as string),
    })
  ) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  let planilla;
  try {
    planilla = await leerComparativa(driveId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const mapeo = mapearEncabezados(planilla.encabezado);
  if (!mapeo.ok) {
    return NextResponse.json(
      {
        error:
          "Esa planilla no tiene la forma de una comparativa. Falta: " +
          mapeo.faltan.join("; ") +
          ". Los encabezados que tiene son: " +
          (mapeo.encontrados.length > 0 ? mapeo.encontrados.join(", ") : "ninguno") +
          ".",
      },
      { status: 409 }
    );
  }

  const { propias, ajenas, sinRi } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri);

  // Proveedores por nombre normalizado, para resolver cada fila.
  // `cuit` y `created_at` deciden a cuál se apunta cuando el padrón tiene la
  // misma clave dos veces: ver `indicePorClave`.
  const { data: proveedores } = await admin
    .from("proveedores")
    .select("id, nombre, cuit, created_at");
  const porNombre = indicePorClave(proveedores ?? [], claveProveedor);

  // Qué presupuesto estaba elegido, para no perderlo al reemplazar.
  //
  // Elegir un presupuesto ES aprobar la compra, así que borrarlo y volver a
  // insertarlo sin la marca deja la compra aprobada sin decir sobre qué. La
  // fila de la planilla es lo que identifica al presupuesto entre una lectura y
  // la siguiente.
  const { data: previas } = await admin
    .from("compras_cotizaciones")
    .select("id, drive_fila, elegida, origen")
    .eq("requerimiento_id", id)
    .not("drive_fila", "is", null);

  // La herencia sale sólo de las de origen "drive", que son las que se borran
  // y se reinsertan. Una "app" sobrevive con su propia marca: heredarla a una
  // fila nueva sería elegir dos presupuestos para la misma compra.
  const filasElegidas = new Set(
    (previas ?? [])
      .filter((p) => p.elegida && p.origen === "drive")
      .map((p) => p.drive_fila as number)
  );

  // Lo que el sistema escribió él mismo: su id y su fila. Las filas de la
  // planilla que lo repiten no son presupuestos nuevos: ver `esEcoAlReleer`.
  const idxId = indiceDeLaColumnaDelId(planilla.encabezado);
  // Los ids salen de TODAS las 'app' del RI, tengan o no `drive_fila`: una
  // cuya copia ya está en la planilla pero quedó sin fila anotada también es eco.
  const { data: delSistema } = await admin
    .from("compras_cotizaciones")
    .select("id, drive_fila")
    .eq("requerimiento_id", id)
    .eq("origen", "app");

  const { idsDelSistema, filasSinId, correcciones } = ubicarLoDelSistema(
    propias, idxId, (delSistema ?? []) as CotizacionDelSistema[]
  );

  // Dónde está hoy cada copia, según la planilla.
  //
  // Antes esto no hacía falta: la fila 'app' se borraba y se reinsertaba en cada
  // relectura, así que su `drive_fila` se corregía solo. Ahora sobrevive con el
  // número que tenía el día que se escribió, y en estas planillas se insertan
  // filas en el medio. Un número viejo vacía la fila de otro al borrar el
  // presupuesto, así que la relectura es el momento de corregirlo.
  for (const c of correcciones) {
    const { error: errorDeFila } = await admin
      .from("compras_cotizaciones")
      .update({ drive_fila: c.drive_fila })
      .eq("id", c.id);
    // No se le dice a quien apretó: no hay nada que pueda hacer, y la próxima
    // relectura lo vuelve a intentar con la planilla ya leída.
    if (errorDeFila) {
      console.error(
        `No se pudo corregir la fila de la cotización ${c.id} a ${c.drive_fila}:`,
        errorDeFila.message
      );
    }
  }

  const nuevas: Record<string, unknown>[] = [];
  const proveedoresNuevos: string[] = [];
  let sinPrecio = 0;

  for (const { fila, numeroFila } of propias) {
    // Es la copia de algo que cargó el sistema: ya está, no se vuelve a traer.
    if (esEcoAlReleer(fila, idxId, idsDelSistema, numeroFila, filasSinId)) continue;

    const leida = parsearFila(fila, mapeo.idx);
    if (!leida) { sinPrecio += 1; continue; }

    let proveedorId = porNombre.get(claveProveedor(leida.proveedor_nombre));
    if (!proveedorId) {
      const { data: creado } = await admin
        .from("proveedores")
        .insert({ nombre: leida.proveedor_nombre })
        .select("id")
        .single();
      if (!creado) continue;
      proveedorId = creado.id as string;
      porNombre.set(claveProveedor(leida.proveedor_nombre), proveedorId);
      proveedoresNuevos.push(leida.proveedor_nombre);
    }

    const { proveedor_nombre: _nombre, ...campos } = leida;
    nuevas.push({
      ...campos,
      requerimiento_id: id,
      proveedor_id: proveedorId,
      origen: "drive",
      drive_fila: numeroFila,
      elegida: filasElegidas.has(numeroFila),
      created_by: user.id,
    });

  }

  // Sobre las filas que vinieron de la planilla manda la planilla: se reemplazan.
  //
  // Se borran las de origen "drive" y NO las que cargó el sistema (`origen =
  // 'app'`). Antes se borraba todo lo que tuviera `drive_fila`, porque una
  // cotización cargada a mano se escribe en la planilla y, al releer, esa misma
  // fila volvía a entrar como nueva: el presupuesto quedaba duplicado, uno "app"
  // y otro "drive" (le pasó al RI 1865). Ese argumento ya no aplica: la copia
  // lleva su id en la columna `ID SISTEMA` y la lectura de arriba la saltea
  // (`esEcoAlReleer`), así que ya no hace falta borrar lo del sistema para
  // evitar el duplicado —y borrarlo perdía la cotización con su marca de
  // elegida y sus datos—. Las cotizaciones anteriores a la columna no traen id y
  // se reconocen por su número de fila: es la cláusula de transición.
  //
  // Las cargadas a mano sin planilla vinculada tienen `drive_fila` nulo y
  // también se conservan.
  await admin
    .from("compras_cotizaciones")
    .delete()
    .eq("requerimiento_id", id)
    .neq("origen", "app")
    .not("drive_fila", "is", null);

  // Primero de una, que es lo normal y lo rápido. Si algo de una fila no entra
  // —un decimal en una columna entera, un porcentaje escrito como monto— se
  // reintenta fila por fila para que una celda rara no se lleve puesta la
  // comparativa entera, y se dice cuál es: quien la tiene que corregir necesita
  // el número de fila, no el mensaje de Postgres.
  const rechazadas: string[] = [];

  if (nuevas.length > 0) {
    const { error } = await admin.from("compras_cotizaciones").insert(nuevas);

    if (error) {
      const entraron: Record<string, unknown>[] = [];
      for (const fila of nuevas) {
        const { error: suyo } = await admin.from("compras_cotizaciones").insert(fila);
        if (suyo) rechazadas.push(`fila ${fila.drive_fila}: ${suyo.message}`);
        else entraron.push(fila);
      }
      if (entraron.length === 0) {
        return NextResponse.json(
          { error: "Ninguna fila de esa planilla se pudo cargar. " + rechazadas.join(" · ") },
          { status: 400 }
        );
      }
      nuevas.length = 0;
      nuevas.push(...entraron);
    }
  }

  const avanza = ri.estado_compra === "SIN_INICIAR";

  const { error: errorRi } = await admin
    .from("compras_requerimientos")
    .update({
      comparativa_drive_id: driveId,
      // El nombre del archivo si no vino en el pedido: al releer una planilla
      // que enlazó la sincronización no hay nombre que mandar —esa enlaza por
      // el link de la celda, sin abrir el archivo—, y sin esto la ficha se
      // quedaba sin poder nombrar la planilla que acababa de leer.
      comparativa_nombre: nombre || planilla.nombre || null,
      comparativa_url: urlDePlanilla(driveId),
      estado_compra: avanza ? "EN_COMPARATIVA" : ri.estado_compra,
    })
    .eq("id", id);

  if (errorRi) return NextResponse.json({ error: errorRi.message }, { status: 400 });

  // La planilla tiene que enterarse de que el RI avanzó.
  //
  // Esto faltaba, y era una divergencia silenciosa: la app pasaba el RI a
  // comparativa y la planilla seguía diciendo lo de antes. Nadie se daba
  // cuenta porque no quedaba nada pendiente —no es que la escritura fallara,
  // es que no se intentaba—, y el trigger marcaba el RI como editado acá, así
  // que la importación tampoco lo volvía a mirar. Cinco RI quedaron así.
  let avisoSheets: string | null = null;
  if (avanza) {
    try {
      // Sólo `bloqueadas`: es lo que la planilla rechazó y alguien tiene que ir
      // a arreglar. `enEspera` —la fila del master que el IMPORTRANGE todavía no
      // bajó— queda anotada en `sheets_pendiente` y se acomoda sola en el
      // próximo reintento, así que mostrarla sería un cartel que aparece siempre
      // y manda a corregir a mano algo que no hay que tocar.
      const { bloqueadas } = await exportarRequerimiento(id);
      if (bloqueadas.length > 0) {
        avisoSheets =
          "La comparativa se vinculó, pero la planilla no dejó actualizar: " +
          bloqueadas.join(", ") + ". Hay que corregirlo a mano ahí.";
      }
    } catch (e) {
      avisoSheets = e instanceof Error ? e.message : String(e);
      console.error(`No se pudo escribir el RI ${id} en la planilla:`, avisoSheets);
    }
  }

  return NextResponse.json({
    traidas: nuevas.length,
    ajenas,
    sin_precio: sinPrecio,
    sin_ri: sinRi,
    proveedores_nuevos: proveedoresNuevos,
    rechazadas,
    ...(avisoSheets ? { aviso_sheets: avisoSheets } : {}),
  });
}
