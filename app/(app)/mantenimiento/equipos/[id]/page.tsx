import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import EquipoDetalle from "./EquipoDetalle";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import { traerTodo } from "@/lib/core/paginado";
import { gastoPorAnio } from "@/lib/compras/gastoPorEquipo";
import type { RequerimientoDelEquipo } from "./ComprasDelEquipo";

export default async function EquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: equipo }, sectores, { data: historial }] = await Promise.all([
    supabase
      .from("equipos")
      .select("*, sectores(id, nombre, empresas(id, nombre))")
      .eq("id", id)
      .single(),
    sectoresDePlanta(supabase, "id, nombre, codigo, empresas(id, nombre)"),
    supabase
      .from("equipos_status_log")
      .select("*, changed_by_user:changed_by(nombre, apellido)")
      .eq("equipment_id", id)
      .order("changed_at", { ascending: false })
      .limit(10),
  ]);

  if (!equipo) notFound();

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  const compras = await comprasDelEquipo(supabase, id, equipo.sector_id);

  return (
    <EquipoDetalle
      equipo={equipo}
      sectores={sectores}
      historial={historial ?? []}
      canEdit={canEdit}
      compras={compras}
    />
  );
}

/**
 * Lo que Compras gastó en esta máquina.
 *
 * El enlace vive en `compras_ubicaciones` y no en el requerimiento —la 019 lo
 * movió ahí para mapear 38 filas en vez de 1.825—, así que son dos consultas:
 * primero qué ubicaciones son esta máquina, después qué se pidió para ellas.
 *
 * `compras_requerimientos` se lee con `select` abierto a cualquier autenticado
 * (policy `compras_req_select`), así que esto anda para alguien que sólo tenga
 * Mantenimiento.
 */
async function comprasDelEquipo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  equipoId: string,
  sectorId: string | null
) {
  const { data: ubicaciones } = await supabase
    .from("compras_ubicaciones")
    .select("id")
    .eq("equipo_id", equipoId);

  const ids = (ubicaciones ?? []).map((u) => u.id as string);

  // Del sector se muestra sólo si tiene compras propias, para poder mandar ahí
  // en vez de repartirlas entre sus máquinas.
  const sectorConCompras = sectorId ? await sectorTieneCompras(supabase, sectorId) : null;

  if (ids.length === 0) {
    return {
      gasto: gastoPorAnio([]),
      ultimos: [] as RequerimientoDelEquipo[],
      ubicaciones: ids,
      sectorConCompras,
    };
  }

  // Paginado porque PostgREST corta en 1000 sin avisar. Acá son decenas, pero
  // la regla del repo es no confiar en que una tabla es chica.
  const requerimientos = await traerTodo<RequerimientoDelEquipo>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("id, nro_ri, descripcion, costo_iva, fecha_pedido, fecha")
      .in("ubicacion_id", ids)
      .order("nro_ri", { ascending: false })
      .range(desde, hasta)
  );

  return {
    gasto: gastoPorAnio(requerimientos),
    ultimos: requerimientos.slice(0, 5),
    ubicaciones: ids,
    sectorConCompras,
  };
}

/** Si el sector tiene alguna ubicación con requerimientos, y cuál es. */
async function sectorTieneCompras(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectorId: string
) {
  const { data } = await supabase
    .from("compras_ubicaciones")
    .select("id, sectores(id, nombre, codigo)")
    .eq("sector_id", sectorId)
    .limit(1);

  const fila = data?.[0] as { sectores?: { id: string; nombre: string; codigo: string | null } } | undefined;
  return fila?.sectores ?? null;
}
