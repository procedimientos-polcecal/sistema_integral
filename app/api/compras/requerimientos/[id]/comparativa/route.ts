import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import {
  leerComparativa, escribirCelda, urlDePlanilla, carpetaConfigurada,
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

  const { propias, ajenas } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri);

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

    // La columna A es el vínculo: si la fila estaba libre, queda reclamada.
    if (String(fila[mapeo.idx.nro_ri] ?? "").trim() === "") {
      try {
        await escribirCelda(
          driveId, planilla.pestana, mapeo.idx.nro_ri, numeroFila, String(ri.nro_ri)
        );
      } catch {
        // No es motivo para abortar: el presupuesto ya se va a guardar acá.
      }
    }
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

  const { error: errorRi } = await admin
    .from("compras_requerimientos")
    .update({
      comparativa_drive_id: driveId,
      comparativa_nombre: nombre || null,
      comparativa_url: urlDePlanilla(driveId),
      estado_compra: ri.estado_compra === "SIN_INICIAR" ? "EN_COMPARATIVA" : ri.estado_compra,
    })
    .eq("id", id);

  if (errorRi) return NextResponse.json({ error: errorRi.message }, { status: 400 });

  return NextResponse.json({
    traidas: nuevas.length,
    ajenas,
    sin_precio: sinPrecio,
    proveedores_nuevos: proveedoresNuevos,
    rechazadas,
  });
}
