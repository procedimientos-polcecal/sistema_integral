import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { leerComparativa, agregarFilas, asegurarLaColumnaDelId } from "@/lib/compras/drive";
import { cotizacionDeHoy } from "@/lib/compras/dolar";
import {
  mapearEncabezados, filaParaPlanilla, filasParaEsteRi, indiceDeLaColumnaDelId,
} from "@/lib/compras/comparativa";
import { ubicarLoDelSistema, type CotizacionDelSistema } from "@/lib/compras/ecoDelSistema";
import { comparativaCongelada, tienePresupuestoElegido } from "@/lib/compras/congelada";
import { loQueFaltaSubir, faltaLaConversion } from "@/lib/compras/subirALaPlanilla";

/** Leer la planilla, ensanchar la hoja y escribir el bloque cuesta tiempo. */
export const maxDuration = 120;

/**
 * Sube a la planilla del artículo los presupuestos que quedaron sólo en el
 * sistema.
 *
 * Existe porque las dos rutas de carga escriben **únicamente la fila que están
 * creando**: si en ese momento el pedido no tenía comparativa vinculada, el
 * presupuesto se guarda y no vuelve nadie por él. Vincular la planilla después
 * tampoco lo sube —las dos rutas que vinculan leen la planilla hacia la base—,
 * así que hasta hoy la única salida era borrar el presupuesto y volver a
 * cargarlo. El porqué, y cuántos había, están en `lib/compras/subirALaPlanilla.ts`.
 *
 * **No escribe dos veces lo que ya está escrito.** Antes de agregar nada cruza
 * los ids contra la columna `ID SISTEMA` de la planilla con `ubicarLoDelSistema`,
 * el mismo cruce que hace la relectura. Lo que aparece allá ya se escribió: se
 * le anota el número de fila y no se vuelve a escribir. Eso cubre los dos casos
 * en que la fila existe y la base no lo sabe: el doble envío —dos pestañas, el
 * teléfono y la computadora— y la carga que escribió la fila pero no pudo
 * guardar su número, que es un aviso que la ruta de carga ya contempla.
 *
 * Lo que **no** cubre: dos llamadas de verdad simultáneas, donde la segunda lee
 * la planilla antes de que la primera haya escrito. La pantalla deshabilita el
 * botón mientras corre, que es la misma defensa que tiene la carga desde la
 * ficha.
 *
 * Es `pantalla` en `revisar-exportaciones`, igual que las dos rutas de carga:
 * `compras_cotizaciones` no tiene columna de pendiente —el `sheets_pendiente`
 * del pedido es del master— así que un fallo de Google vuelve en el cuerpo, sin
 * traducir, y lo que falte sigue a mano de este mismo botón.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: ri } = await admin
    .from("compras_requerimientos")
    // El select va en un solo literal: partido en dos, Supabase no lo puede analizar.
    .select("id, nro_ri, descripcion, estado_compra, estado_aprobacion, comparativa_drive_id, proveedor_id, compras_areas(nombre)")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de cargar presupuestos" },
      { status: 409 }
    );
  }
  // La comparativa de una compra decidida es el respaldo de por qué se eligió
  // ese precio: agregarle filas después cambiaría lo que ese respaldo dice.
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
  const planillaId = (ri.comparativa_drive_id ?? null) as string | null;
  if (!planillaId) {
    return NextResponse.json(
      { error: "Este pedido no tiene una comparativa vinculada: primero hay que elegir la planilla." },
      { status: 409 }
    );
  }

  const { data: cotizaciones, error: errorDeCotizaciones } = await admin
    .from("compras_cotizaciones")
    .select("*, proveedores(nombre)")
    .eq("requerimiento_id", id);

  // Una consulta caída no es "no hay nada que subir": contestar 0 mandaría a
  // buscar el problema donde no está.
  if (errorDeCotizaciones) {
    return NextResponse.json(
      { error: "No se pudieron leer los presupuestos: " + errorDeCotizaciones.message },
      { status: 500 }
    );
  }

  const pendientes = loQueFaltaSubir(cotizaciones ?? []);
  if (pendientes.length === 0) {
    return NextResponse.json({ subidas: 0, ya_estaban: 0, sin_dolar: 0, avisos: [] });
  }

  let planilla;
  try {
    planilla = await leerComparativa(planillaId);
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
          "Esa planilla no tiene la forma de una comparativa, así que no se escribió nada. Falta: " +
          mapeo.faltan.join("; ") + ".",
      },
      { status: 409 }
    );
  }

  const avisos: string[] = [];

  // ── Las que ya están escritas y la base no lo sabe ────────────────────────
  //
  // `ubicarLoDelSistema` devuelve una corrección por cada cotización cuyo id
  // aparece en la planilla en una fila distinta de la guardada. Para éstas la
  // guardada es `null`, así que una corrección quiere decir "ya está escrita".
  const { propias } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri as number);
  const { correcciones } = ubicarLoDelSistema(
    propias,
    indiceDeLaColumnaDelId(planilla.encabezado),
    pendientes as unknown as CotizacionDelSistema[]
  );
  const yaEscritas = new Map(correcciones.map((c) => [c.id, c.drive_fila]));

  for (const c of correcciones) {
    const { error } = await admin
      .from("compras_cotizaciones")
      .update({ drive_fila: c.drive_fila })
      .eq("id", c.id);
    if (error) {
      avisos.push(
        `El presupuesto ${c.id} ya estaba en la fila ${c.drive_fila} pero no se pudo ` +
        `guardar ese número: ${error.message}`
      );
    }
  }

  // ── El dólar, una sola vez y sólo si hace falta ───────────────────────────
  const porEscribir = pendientes.filter((c) => !yaEscritas.has(String(c.id)));
  let dolarDelDia: number | null = null;
  if (porEscribir.some((c) => c.moneda === "USD" && !c.cotizacion)) {
    try {
      dolarDelDia = (await cotizacionDeHoy())?.venta ?? null;
    } catch (e) {
      avisos.push(
        "No se pudo obtener el dólar del día: " + (e instanceof Error ? e.message : String(e))
      );
    }
  }

  const escribibles = porEscribir.filter((c) => !faltaLaConversion(c, dolarDelDia));
  const sinDolar = porEscribir.length - escribibles.length;
  if (sinDolar > 0) {
    avisos.push(
      `${sinDolar} presupuesto(s) en dólares no se escribieron porque no hay cotización ` +
      "con la que pasarlos a pesos: la planilla es toda en pesos."
    );
  }

  if (escribibles.length === 0) {
    return NextResponse.json({
      subidas: 0,
      ya_estaban: correcciones.length,
      sin_dolar: sinDolar,
      avisos,
    });
  }

  // ── Escribir el bloque: un solo agregarFilas ──────────────────────────────
  const area = ri.compras_areas as unknown as { nombre: string } | null;
  let primera: number;
  try {
    // La columna del id tiene que existir ANTES de escribir las filas, y su
    // índice puede ser uno recién creado: por eso no sale del mapeo.
    const idxIdSistema = await asegurarLaColumnaDelId(
      planillaId, planilla.pestana, planilla.encabezado, planilla.filas
    );

    // La fila inicial la decide `agregarFilas` y las fórmulas del total se
    // arman con ese mismo número: calculados por separado no coinciden.
    primera = await agregarFilas(planillaId, planilla.pestana, (filaInicial) =>
      escribibles.map((c, i) =>
        filaParaPlanilla({
          idx: mapeo.idx,
          numeroFila: filaInicial + i,
          nroRi: ri.nro_ri as number,
          // La fecha de la respuesta del proveedor, nunca la del pedido. Sin
          // ella, la de hoy: es cuando se está escribiendo.
          fecha: (c.fecha_respuesta as string | null) ?? hoyEnArgentina(),
          // Tal cual, sin adornos: al releer, `esEcoDelSistema` lo compara
          // contra `String(cotizacion.id)` y si no coincide se duplica.
          idCotizacion: String(c.id),
          idxIdSistema,
          area: area?.nombre ?? null,
          descripcion: ri.descripcion as string | null,
          moneda: c.moneda,
          dolar: c.moneda === "USD" ? (c.cotizacion ?? dolarDelDia) : null,
          cotizacion: {
            proveedor_nombre: c.proveedores?.nombre ?? "",
            marca: c.marca,
            unidad_medida: c.unidad_medida,
            precio_unitario: c.precio_unitario,
            cantidad: c.cantidad,
            costo_envio: c.costo_envio,
            descuento: c.descuento,
            iva: c.iva,
            precio_hasta: c.precio_hasta,
            plazos_pago_dias: c.plazos_pago_dias ?? [],
            condiciones_pago: c.condiciones_pago,
            disponibilidad: c.disponibilidad,
            comentario: c.comentario,
          },
        })
      )
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "No se pudo escribir en la planilla: " + (e instanceof Error ? e.message : String(e)),
        ya_estaban: correcciones.length,
        avisos,
      },
      { status: 502 }
    );
  }

  // Dónde quedó cada una. Supabase no lanza: devuelve `{ error }`. Si el número
  // no se guarda, la fila queda escrita y ni borrar ni corregir el presupuesto
  // la podrían vaciar después, y por eso se dice cuál.
  await Promise.all(escribibles.map(async (c, i) => {
    const { error } = await admin
      .from("compras_cotizaciones")
      .update({ drive_fila: primera + i })
      .eq("id", c.id);
    if (error) {
      avisos.push(
        `El presupuesto de ${c.proveedores?.nombre ?? "ese proveedor"} se escribió en la ` +
        `fila ${primera + i} pero no se pudo guardar ese número: ${error.message}`
      );
    }
  }));

  return NextResponse.json({
    subidas: escribibles.length,
    ya_estaban: correcciones.length,
    sin_dolar: sinDolar,
    avisos,
  });
}
