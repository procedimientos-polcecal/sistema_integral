import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import ReservasTallerVialClient from "./ReservasTallerVialClient";

/**
 * Lo que Taller Vial reservó del pañol y todavía nadie confirmó. Confirmar
 * es la única acción que baja stock de verdad (usa
 * `inventario_registrar_movimiento`, la misma función que cualquier otro
 * movimiento de Inventario); cancelar no mueve nada porque reservar tampoco
 * había movido nada.
 */
export default async function ReservasTallerVialPage() {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  return <ReservasTallerVialClient puedeEditar={nivel === "edicion" || nivel === "admin"} />;
}
