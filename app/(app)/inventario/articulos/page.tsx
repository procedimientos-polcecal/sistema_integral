import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import ArticulosClient from "./ArticulosClient";

export default async function ArticulosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  // De cuándo es lo que se está mirando, y los catálogos del alta de Compras.
  // Los tres son chicos y van acá porque el modal de «Pedir» los necesita
  // apenas alguien lo aprieta — lo mismo que hacen `/inventario/stock` y
  // `/inventario/reponer`.
  const [sync, { data: areas }, { data: empresas }, { data: ubicaciones }] =
    await Promise.all([
      ultimaSincronizacionDe(supabase, "inventario", "articulos"),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("compras_ubicaciones").select("id, nombre").eq("activo", true).order("orden"),
    ]);

  return (
    <ArticulosClient
      // `esAdmin` gobierna Editar y nada más: pedir un material lo puede hacer
      // cualquier usuario activo, que es como lo dejó la 018 a propósito.
      esAdmin={nivel === "admin"}
      sync={sync}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
