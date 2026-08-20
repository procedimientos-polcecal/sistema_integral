import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import { COLUMNAS_TABLERO } from "@/lib/compras/constants";
import TableroClient from "./TableroClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function TableroPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Todo lo aprobado que todavía no se recibió.
  const { data } = await supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
    .eq("estado_aprobacion", "APROBADA")
    .in("estado_compra", COLUMNAS_TABLERO)
    .order("fecha", { ascending: true });

  const [nivel, { data: aprobadores }, { data: proveedores }] = await Promise.all([
    nivelComprasDe(supabase, user.id),
    // Quiénes pueden aprobar una compra: los mismos que aprueban los RI.
    supabase
      .from("usuario_modulos")
      .select("usuarios(id, nombre, apellido)")
      .eq("modulo", "compras")
      .eq("nivel", "admin"),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  return (
    <TableroClient
      requerimientos={(data ?? []) as RequerimientoConRelaciones[]}
      aprobadores={(aprobadores ?? [])
        .map((g) => g.usuarios as unknown as { id: string; nombre: string; apellido: string } | null)
        .filter((u): u is { id: string; nombre: string; apellido: string } => Boolean(u))}
      proveedores={proveedores ?? []}
      usuarioId={user.id}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
