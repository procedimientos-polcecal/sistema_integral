import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoInventario } from "@/lib/inventario/auth";

/**
 * La cola de repuestos que Taller Vial reservó y todavía nadie confirmó.
 *
 * No usa `inventario_articulos!articulo_id(...)` embebido junto con los
 * embeds de `taller_vial_services`/`taller_vial_reparaciones` en una sola
 * consulta: son tres FKs de tablas distintas y mezclar sus filtros
 * `.eq("estado","reservado")` con embeds anidados es justo el terreno donde
 * PostgREST tira PGRST201 por rutas ambiguas. Se resuelve en pasos, con los
 * ids ya conocidos.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoInventario(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Inventario" }, { status: 403 });
  }

  const { data: reservas, error } = await supabase
    .from("taller_vial_repuestos_asignados")
    .select("id, service_id, reparacion_id, articulo_id, cantidad, cargado_por, cargado_en")
    .eq("estado", "reservado")
    .order("cargado_en", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!reservas || reservas.length === 0) return NextResponse.json({ data: [] });

  const articuloIds = [...new Set(reservas.map((r) => r.articulo_id))];
  const serviceIds = [...new Set(reservas.map((r) => r.service_id).filter((v): v is string => v !== null))];
  const reparacionIds = [...new Set(reservas.map((r) => r.reparacion_id).filter((v): v is string => v !== null))];

  const [{ data: articulos }, { data: services }, { data: reparaciones }] = await Promise.all([
    supabase.from("inventario_articulos").select("id, codigo, descripcion, stock_actual").in("id", articuloIds),
    serviceIds.length
      ? supabase.from("taller_vial_services").select("id, equipo_id, tier").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; equipo_id: string; tier: number }[] }),
    reparacionIds.length
      ? supabase.from("taller_vial_reparaciones").select("id, equipo_id, descripcion").in("id", reparacionIds)
      : Promise.resolve({ data: [] as { id: string; equipo_id: string; descripcion: string }[] }),
  ]);

  const equipoIds = [
    ...new Set([...(services ?? []).map((s) => s.equipo_id), ...(reparaciones ?? []).map((r) => r.equipo_id)]),
  ];
  const { data: equipos } = equipoIds.length
    ? await supabase.from("equipos").select("id, code, name").in("id", equipoIds)
    : { data: [] as { id: string; code: string; name: string }[] };

  const articuloPorId = new Map((articulos ?? []).map((a) => [a.id, a]));
  const servicePorId = new Map((services ?? []).map((s) => [s.id, s]));
  const reparacionPorId = new Map((reparaciones ?? []).map((r) => [r.id, r]));
  const equipoPorId = new Map((equipos ?? []).map((e) => [e.id, e]));

  const data = reservas.map((r) => {
    const articulo = articuloPorId.get(r.articulo_id);
    const service = r.service_id ? servicePorId.get(r.service_id) : null;
    const reparacion = r.reparacion_id ? reparacionPorId.get(r.reparacion_id) : null;
    const equipoId = service?.equipo_id ?? reparacion?.equipo_id ?? null;
    const equipo = equipoId ? equipoPorId.get(equipoId) : null;

    return {
      id: r.id,
      articulo_codigo: articulo?.codigo ?? "",
      articulo_descripcion: articulo?.descripcion ?? "",
      stock_actual: articulo?.stock_actual ?? 0,
      cantidad: r.cantidad,
      cargado_en: r.cargado_en,
      equipo: equipo ? `${equipo.code} - ${equipo.name}` : "—",
      origen: service ? `Service ${service.tier} hs` : reparacion ? reparacion.descripcion : "—",
    };
  });

  return NextResponse.json({ data });
}
