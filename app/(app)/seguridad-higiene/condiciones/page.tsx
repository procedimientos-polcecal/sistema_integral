import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelSyhDe } from "@/lib/seguridadHigiene/auth";
import type { FilaDeCondicion } from "@/lib/seguridadHigiene/gestion";
import CondicionesClient from "./CondicionesClient";

/**
 * La gestión de condiciones inseguras: la tabla, desde la computadora.
 *
 * Trae **todas** las condiciones, con `traerTodo` y no con un límite:
 * PostgREST corta en 1000 filas sin avisar y esta tabla sólo crece. El orden
 * (lo que falta primero) y los filtros se resuelven en el navegador, sobre las
 * funciones puras de `lib/seguridadHigiene/gestion.ts`, así al guardar una
 * ficha la fila se reubica sin volver a pedir nada.
 *
 * Los catálogos —sectores, equipos, peligros, usuarios— se piden enteros porque
 * son chicos y porque la ficha tiene que poder mostrar el valor actual de una
 * condición aunque ese sector o ese usuario ya no esté activo.
 */
export default async function CondicionesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelSyhDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [condiciones, sectores, equipos, peligros, usuarios] = await Promise.all([
    traerTodo<FilaDeCondicion>((desde, hasta) =>
      supabase
        .from("syh_condiciones")
        .select("*, sectores(nombre), equipos(name, code), syh_peligros(nombre)")
        .order("numero", { ascending: false })
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase.from("sectores").select("id, nombre, activo").order("nombre").range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("equipos")
        .select("id, name, code, sector_id, is_active")
        .order("code")
        .range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase.from("syh_peligros").select("id, nombre, activo").order("nombre").range(desde, hasta)
    ),
    traerTodo((desde, hasta) =>
      supabase
        .from("usuarios")
        .select("id, nombre, apellido, activo")
        .order("apellido")
        .range(desde, hasta)
    ),
  ]);

  return (
    <CondicionesClient
      condicionesIniciales={condiciones}
      sectores={sectores.map((s) => ({ id: s.id as string, nombre: s.nombre as string, activo: s.activo as boolean }))}
      equipos={equipos.map((e) => ({
        id: e.id as string,
        nombre: `${e.code ? `${e.code} · ` : ""}${e.name}`,
        sector_id: (e.sector_id as string | null) ?? null,
        activo: e.is_active as boolean,
      }))}
      peligros={peligros.map((p) => ({ id: p.id as string, nombre: p.nombre as string, activo: p.activo as boolean }))}
      usuarios={usuarios.map((u) => ({
        id: u.id as string,
        nombre: `${u.nombre} ${u.apellido}`.trim(),
        activo: u.activo as boolean,
      }))}
      hoy={hoyEnArgentina()}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      esAdmin={nivel === "admin"}
    />
  );
}
