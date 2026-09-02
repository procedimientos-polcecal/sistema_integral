import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { traerTodo } from "@/lib/core/paginado";
import MovimientosClient from "./MovimientosClient";

export default async function MovimientosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  const sectores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre").range(desde, hasta)
  );

  // Los que no llegaron a la planilla van arriba y aparte: su stock se va a
  // revertir en la próxima sincronización, así que no son un detalle.
  const { data: pendientes } = await supabase
    .from("inventario_movimientos")
    .select("id, codigo, tipo, cantidad, fecha, sheets_pendiente, sheets_pendiente_en")
    .not("sheets_pendiente", "is", null)
    .order("sheets_pendiente_en", { ascending: false })
    .limit(50);

  return (
    <MovimientosClient
      sectores={sectores}
      pendientes={pendientes ?? []}
    />
  );
}
