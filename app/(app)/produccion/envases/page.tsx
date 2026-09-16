import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import StockClient, { type ArticuloEnPantalla } from "./StockClient";

/**
 * El stock de envases.
 *
 * Sin ruta de API para leer: son 28 artículos y los trae el Server Component.
 * Inventario tiene `/api/inventario/articulos` porque allá son ~2.800 y la
 * búsqueda va contra la base; acá la lista entra entera en la pantalla y una
 * ruta más sería plomería sin trabajo que hacer.
 */
export default async function EnvasesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  // La cadena del select va literal y no armada en una variable: con una
  // variable, Supabase pierde la inferencia y todo lo que sale queda como error
  // de string.
  const { data } = await supabase
    .from("produccion_envases_articulos")
    .select("id, codigo, descripcion, grupo, stock_actual, stock_seguridad, faltante")
    .eq("activo", true)
    .order("faltante", { ascending: false })
    .order("codigo");

  // Cuándo se leyó la planilla. Es parte de lo que hay que saber para leer el
  // stock: el número puede tener horas.
  const sync = await ultimaSincronizacionDe(supabase, "produccion", "envases_articulos");

  return (
    <StockClient
      articulos={(data ?? []) as ArticuloEnPantalla[]}
      puedeOperar={nivel === "edicion" || nivel === "admin"}
      sync={sync}
    />
  );
}
