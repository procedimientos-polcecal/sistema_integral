import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { traerTodo } from "@/lib/core/paginado";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import TareasPreventivasClient from "./TareasPreventivasClient";

/**
 * Confirmar el catálogo de tareas preventivas.
 *
 * El paso 2 del plan de
 * `docs/superpowers/specs/2026-11-12-mantenimiento-catalogo-de-tareas-preventivas-design.md`:
 * el sistema propone con lo que ya se hizo, y acá una persona dice cuáles son
 * de verdad, cómo se llaman y cada cuánto van.
 *
 * **El catálogo se pide del lado del cliente**, no acá. Recalcularlo son dos
 * lecturas grandes —las 1.465 programadas del año y los componentes— y esta
 * pantalla no es un camino de entrada al módulo: diferirlo deja que pinte y
 * después se llene, igual que el recuadro de MTBF del tablero.
 *
 * Los equipos sí viajan desde el servidor: son pocos, no cambian mientras
 * alguien confirma, y sin ellos la tabla mostraría uuids.
 */
export default async function TareasPreventivasPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const puedeEditar = nivel === "edicion" || nivel === "admin";

  // `traerTodo` aunque hoy sean ~270: una tabla que crece no avisa cuando
  // cruza las 1.000 filas, y acá un equipo cortado es una fila que aparece
  // sin nombre.
  const equipos = await traerTodo<{ id: string; code: string | null; name: string | null }>(
    (de, a) => supabase.from("equipos").select("id, code, name").order("code").range(de, a)
  );

  return (
    <TareasPreventivasClient
      puedeEditar={puedeEditar}
      equipos={equipos.map((e) => ({
        id: e.id,
        etiqueta: [e.code, e.name].filter(Boolean).join(" – ") || e.id,
      }))}
    />
  );
}
