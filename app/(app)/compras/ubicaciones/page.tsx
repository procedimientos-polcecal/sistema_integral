import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import UbicacionesClient from "./UbicacionesClient";
import type { UbicacionCompras } from "@/lib/compras/types";

export default async function UbicacionesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const [{ data: ubicaciones }, sectores, { data: equipos }] =
    await Promise.all([
      supabase.from("compras_ubicaciones").select("*").order("orden").order("nombre"),
      // Sólo los sectores de planta: acá se elige dónde está una máquina, y
      // "Calidad" o "Tesorería" no son lugares donde haya una. Es el sexto
      // lugar donde faltaba el filtro que este helper existe para poner.
      sectoresDePlanta<{ id: string; nombre: string; codigo: string | null }>(
        supabase,
        "id, nombre, codigo"
      ),
      // La marca y el modelo viajan porque sin ellos el desplegable es
      // indecidible: Compras nombra "Doosan 225 n°1" y acá dice
      // "EM3 — Retroexcavadora 3". Lo que las une está en la ficha técnica.
      supabase
        .from("equipos")
        .select("id, name, code, marca, modelo")
        .eq("is_active", true)
        .order("code"),
    ]);

  // Cuántos requerimientos usa cada ubicación: decide si se puede borrar y cuál
  // conviene conservar al fusionar. Va paginado porque sobre 1000 RI daba mal.
  const usos = await traerTodo<{ ubicacion_id: string }>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("ubicacion_id")
      .not("ubicacion_id", "is", null)
      .range(desde, hasta)
  );

  const conteo: Record<string, number> = {};
  for (const r of usos) {
    const id = r.ubicacion_id as string;
    conteo[id] = (conteo[id] ?? 0) + 1;
  }

  const { nivel } = await permisosComprasActuales();

  return (
    <UbicacionesClient
      ubicaciones={(ubicaciones ?? []) as UbicacionCompras[]}
      conteo={conteo}
      sectores={sectores}
      equipos={equipos ?? []}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
