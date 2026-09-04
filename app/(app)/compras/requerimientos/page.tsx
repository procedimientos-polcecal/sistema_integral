import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { aprobadoresDeCompras } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { leerFiltrosDeLaUrl } from "@/lib/compras/filtrosUrl";
import { paginaDeArranque } from "@/lib/core/filtrosUrl";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { opcionesConUbicacion, type UbicacionEnlazada } from "@/lib/compras/ubicaciones";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import RequerimientosClient from "./RequerimientosClient";

export default async function RequerimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  // Todo junto: ninguna de estas depende de otra, y en serie serían dos esperas
  // donde alcanza con una.
  const [
    { data: areas }, { data: proveedores }, { data: empresas }, { data: ubicaciones },
    { data: equipos }, sectoresPlanta,
    { nivel }, aprobadores, sync,
  ] = await Promise.all([
    supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    // El enlace a la máquina y al sector viene con el catálogo: filtrar por
    // equipo es filtrar por sus ubicaciones, porque el enlace vive acá desde la
    // 019 y no en cada requerimiento.
    supabase
      .from("compras_ubicaciones")
      .select("id, nombre, equipo_id, sector_id")
      .eq("activo", true)
      .order("orden"),
    supabase
      .from("equipos")
      .select("id, name, code, marca, modelo")
      .eq("is_active", true)
      .order("code"),
    sectoresDePlanta<{ id: string; nombre: string; codigo: string | null }>(
      supabase,
      "id, nombre, codigo"
    ),
    // Ya lo calculó el layout: acá vuelve sin salir a la red.
    permisosComprasActuales(),
    // Quiénes pueden aprobar una compra. Sale de `compras_aprobadores` y no de
    // los grants del módulo: administrar Compras y estar autorizado a aprobar
    // un gasto son cosas distintas, y las hacen personas distintas.
    aprobadoresDeCompras(supabase),
    // Esta tabla es el espejo de la planilla: cuándo se actualizó es parte de
    // lo que hay que saber para leerla.
    ultimaSincronizacionDe(supabase, "compras", "planilla"),
  ]);

  // Los filtros de la URL se validan acá, que es donde están los catálogos: es
  // así como el tablero lleva a cada etapa. Un valor que no corresponde a nada
  // conocido se descarta antes de llegar a la pantalla.
  // Sólo se ofrecen los que pueden devolver algo. Ofrecer las 239 máquinas
  // cuando 15 tienen una ubicación enlazada es prometer un filtro que da vacío,
  // y quien lo usa concluye que no se le compró nada a esa máquina.
  const catalogo = (ubicaciones ?? []) as UbicacionEnlazada[];
  const equiposConCompras = opcionesConUbicacion(equipos ?? [], catalogo, "equipo_id");
  const sectoresConCompras = opcionesConUbicacion(sectoresPlanta, catalogo, "sector_id");

  // Un parámetro repetido —`?prioridad=ALTA&prioridad=URGENTE`— llega acá como
  // arreglo, y hasta ahora se quedaba con el primero. Ahora los filtros son
  // listas, así que se pasan todos: descartar el resto era perder justamente el
  // filtro múltiple que la URL estaba pidiendo.
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const valor of Array.isArray(v) ? v : [v]) query.append(k, valor);
  }

  const filtrosIniciales = leerFiltrosDeLaUrl(
    query,
    {
      areas: (areas ?? []).map((a) => a.id as string),
      empresas: (empresas ?? []).map((e) => e.id as string),
      proveedores: (proveedores ?? []).map((p) => p.id as string),
      ubicaciones: (ubicaciones ?? []).map((u) => u.id as string),
      equipos: equiposConCompras.map((e) => e.id),
      sectores: sectoresConCompras.map((s) => s.id),
    }
  );

  return (
    <RequerimientosClient
      areas={areas ?? []}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      ubicaciones={catalogo}
      equipos={equiposConCompras}
      sectores={sectoresConCompras}
      aprobadores={aprobadores.map((a) => ({
        id: a.id, nombre: a.nombre, apellido: a.apellido, alias: a.alias,
      }))}
      usuarioId={user.id}
      canEdit={nivel === "edicion" || nivel === "admin"}
      filtrosIniciales={filtrosIniciales}
      paginaInicial={paginaDeArranque(query)}
      sync={sync}
    />
  );
}
