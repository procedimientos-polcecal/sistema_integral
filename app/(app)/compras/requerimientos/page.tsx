import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { aprobadoresDeCompras } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { leerFiltrosDeLaUrl } from "@/lib/compras/filtrosUrl";
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
    { nivel }, aprobadores,
  ] = await Promise.all([
    supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    // Ya lo calculó el layout: acá vuelve sin salir a la red.
    permisosComprasActuales(),
    // Quiénes pueden aprobar una compra. Sale de `compras_aprobadores` y no de
    // los grants del módulo: administrar Compras y estar autorizado a aprobar
    // un gasto son cosas distintas, y las hacen personas distintas.
    aprobadoresDeCompras(supabase),
  ]);

  // Los filtros de la URL se validan acá, que es donde están los catálogos: es
  // así como el tablero lleva a cada etapa. Un valor que no corresponde a nada
  // conocido se descarta antes de llegar a la pantalla.
  const params = await searchParams;
  const filtrosIniciales = leerFiltrosDeLaUrl(
    new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, Array.isArray(v) ? (v[0] ?? "") : v] as [string, string]]
      )
    ),
    {
      areas: (areas ?? []).map((a) => a.id as string),
      empresas: (empresas ?? []).map((e) => e.id as string),
      proveedores: (proveedores ?? []).map((p) => p.id as string),
      ubicaciones: (ubicaciones ?? []).map((u) => u.id as string),
    }
  );

  return (
    <RequerimientosClient
      areas={areas ?? []}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
      aprobadores={aprobadores.map((a) => ({
        id: a.id, nombre: a.nombre, apellido: a.apellido, alias: a.alias,
      }))}
      usuarioId={user.id}
      canEdit={nivel === "edicion" || nivel === "admin"}
      filtrosIniciales={filtrosIniciales}
    />
  );
}
