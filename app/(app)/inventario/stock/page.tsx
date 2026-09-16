import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import StockClient from "./StockClient";

export default async function StockPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  // Cuándo se leyó la planilla por última vez. Es parte de lo que hay que saber
  // para leer el stock: el número puede tener horas.
  const sync = await ultimaSincronizacionDe(supabase, "inventario", "articulos");

  return (
    <StockClient
      puedeOperar={nivel === "edicion" || nivel === "admin"}
      sync={sync}
    />
  );
}
