import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import EquipoDetalle from "./EquipoDetalle";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import { traerTodo } from "@/lib/core/paginado";
import {
  costoDelEquipo,
  type OrdenDeServicio,
  type OrdenDeTrabajo,
  type TarifaHora,
} from "@/lib/mantenimiento/costoEquipo";
import type { RequerimientoDelEquipo } from "./CostoDelEquipo";

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

  const costo = await costoDeLaMaquina(supabase, id, equipo.sector_id);

  return (
    <EquipoDetalle
      equipo={equipo}
      sectores={sectores}
      historial={historial ?? []}
      canEdit={canEdit}
      costo={costo}
    />
  );
}

/**
 * Lo que cuesta tener esta máquina: materiales, terceros y trabajo propio.
 *
 * Los materiales llegan por el catálogo de ubicaciones y no por el
 * requerimiento —la 019 movió el enlace ahí—, así que son dos consultas:
 * primero qué ubicaciones son esta máquina, después qué se pidió para ellas.
 * Las otras dos fuentes apuntan al equipo directamente.
 *
 * `compras_requerimientos` se lee con `select` abierto a cualquier autenticado
 * (policy `compras_req_select`), así que esto anda para alguien que sólo tenga
 * Mantenimiento.
 */
async function costoDeLaMaquina(
  supabase: Awaited<ReturnType<typeof createClient>>,
  equipoId: string,
  sectorId: string | null
) {
  const [{ data: ubicaciones }, { data: tarifas }, sectorConCompras] = await Promise.all([
    supabase.from("compras_ubicaciones").select("id").eq("equipo_id", equipoId),
    supabase
      .from("mantenimiento_tarifas_hora")
      .select("valor, vigente_desde")
      .order("vigente_desde", { ascending: false }),
    sectorId ? sectorTieneCompras(supabase, sectorId) : Promise.resolve(null),
  ]);

  const ids = (ubicaciones ?? []).map((u) => u.id as string);

  // Paginado porque PostgREST corta en 1000 sin avisar. Acá son decenas, pero
  // la regla del repo es no confiar en que una tabla es chica.
  const requerimientos = ids.length
    ? await traerTodo<RequerimientoDelEquipo>((desde, hasta) =>
        supabase
          .from("compras_requerimientos")
          .select("id, nro_ri, descripcion, costo_iva, fecha_pedido, fecha")
          .in("ubicacion_id", ids)
          .order("nro_ri", { ascending: false })
          .range(desde, hasta)
      )
    : [];

  const [{ data: ordenesServicio }, { data: ordenesTrabajo }] = await Promise.all([
    supabase
      .from("ordenes_servicio")
      .select("costo, fecha")
      .eq("equipment_id", equipoId),
    supabase
      .from("ordenes_trabajo")
      .select("horas, operario_1, operario_2, operario_3, contratista, fecha_ejecucion, fecha_cierre, fecha")
      .eq("equipment_id", equipoId),
  ]);

  const tarifasCargadas = (tarifas ?? []) as TarifaHora[];

  return {
    costo: costoDelEquipo(
      requerimientos,
      (ordenesServicio ?? []) as OrdenDeServicio[],
      (ordenesTrabajo ?? []) as OrdenDeTrabajo[],
      tarifasCargadas
    ),
    ultimos: requerimientos.slice(0, 5),
    ubicaciones: ids,
    hayTarifa: tarifasCargadas.length > 0,
    sectorConCompras,
  };
}

/** Si el sector tiene alguna ubicación de Compras, y cuál es. */
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
