import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportarRequerimiento } from "@/lib/compras/sheets";
import { puedeEditarCompras } from "@/lib/compras/auth";
import {
  leerComparativa, urlDePlanilla, carpetaConfigurada,
} from "@/lib/compras/drive";
import { mapearEncabezados, filasParaEsteRi, parsearFila } from "@/lib/compras/comparativa";
import { claveProveedor } from "@/lib/compras/sheets";

/** Estados en los que la comparativa ya es el respaldo de una decisión tomada. */
const CONGELADOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

/**
 * Adjunta una planilla de la carpeta a un requerimiento y trae sus filas.
 *
 * Es idempotente: se puede volver a llamar para releer la planilla. Al hacerlo
 * se borran los presupuestos que habían venido de Drive —sobre esos manda la
 * planilla— y se dejan intactos los que se cargaron en el sistema.
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
    .select("id, nro_ri, estado_compra, estado_aprobacion")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de armar la comparativa" },
      { status: 409 }
    );
  }
  // Una vez aprobada la compra la comparativa es el respaldo de por qué se
  // eligió ese precio: no se toca más.
  if (CONGELADOS.includes(ri.estado_compra)) {
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
  const { data: proveedores } = await admin.from("proveedores").select("id, nombre");
  const porNombre = new Map(
    (proveedores ?? []).map((p) => [claveProveedor(p.nombre), p.id as string])
  );

  const nuevas: Record<string, unknown>[] = [];
  const proveedoresNuevos: string[] = [];
  let sinPrecio = 0;

  for (const { fila, numeroFila } of propias) {
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
      created_by: user.id,
    });

  }

  // Sobre las filas de la planilla manda la planilla: se reemplazan.
  await admin
    .from("compras_cotizaciones")
    .delete()
    .eq("requerimiento_id", id)
    .eq("origen", "drive");

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
      comparativa_nombre: nombre || null,
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
