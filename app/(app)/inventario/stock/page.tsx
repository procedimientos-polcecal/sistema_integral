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

  // Cuándo se leyó la planilla por última vez, y los catálogos del alta de
  // Compras. Los tres catálogos son chicos y van acá porque el modal los
  // necesita apenas alguien aprieta Pedir — lo mismo que hace `/inventario/reponer`.
  const [sync, { data: areas }, { data: empresas }, { data: ubicaciones }] =
    await Promise.all([
      ultimaSincronizacionDe(supabase, "inventario", "articulos"),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    ]);

  return (
    <StockClient
      // Cargar un movimiento es operar el inventario; pedir un material no.
      // `puedeOperar` gobierna el botón de movimiento y nada más: el de pedir
      // lo ve cualquier usuario activo, que es como lo dejó la 018 a propósito.
      puedeOperar={nivel === "edicion" || nivel === "admin"}
      sync={sync}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
