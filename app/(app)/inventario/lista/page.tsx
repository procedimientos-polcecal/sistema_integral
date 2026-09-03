import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import ListaClient from "./ListaClient";

/**
 * La lista del pañol: quién puede retirar y a dónde va el material.
 *
 * Es la validación que la planilla tiene en las columnas F y J, mantenida acá.
 * Ver `lib/inventario/catalogos.ts` para por qué no son `empleados` y
 * `sectores`.
 */
export default async function ListaPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [solicitantes, destinos, sectores] = await Promise.all([
    traerTodo<{
      id: string; nombre: string; destino_id: string | null;
      empleado_id: string | null; activo: boolean;
    }>((desde, hasta) =>
      supabase.from("inventario_solicitantes")
        .select("id, nombre, destino_id, empleado_id, activo")
        .order("nombre").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string; sector_id: string | null; activo: boolean }>(
      (desde, hasta) =>
        supabase.from("inventario_destinos")
          .select("id, nombre, sector_id, activo").order("nombre").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre").range(desde, hasta)
    ),
  ]);

  // De cuándo es lo que se está mirando. Va en todas las pantallas del
  // módulo porque el botón de traer también.
  const sync = await ultimaSincronizacionDe(supabase, "inventario", "articulos");

  return (
    <ListaClient
      sync={sync}
      solicitantes={solicitantes}
      destinos={destinos}
      sectores={sectores}
      puedeEditar={nivel !== "lectura"}
    />
  );
}
