import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminCantera, finanzasDeCantera } from "@/lib/cantera/auth";
import { contratistasDeCantera } from "@/lib/cantera/contratistas";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import ConfiguracionClient from "./ConfiguracionClient";

/**
 * Quién concilia facturas (`cantera_finanzas`) y quiénes son los contratistas
 * (`cantera_contratistas`) — sólo el admin del módulo. Sin esta pantalla, sumar
 * a la primera persona a finanzas requeriría un `insert` a mano en Supabase: es
 * el motivo por el que existe, no un catálogo más.
 */
export default async function ConfiguracionCanteraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminCantera(supabase, user.id))) redirect("/cantera");

  const [finanzas, contratistas, { data: usuarios }, { data: proveedores }] = await Promise.all([
    finanzasDeCantera(supabase),
    contratistasDeCantera(supabase),
    supabase.from("usuarios").select("id, nombre, apellido, email").eq("activo", true).order("nombre"),
    supabase.from("proveedores").select("id, nombre, cuit").eq("activo", true).order("nombre"),
  ]);

  return (
    <ConfiguracionClient
      finanzas={finanzas}
      contratistas={contratistas}
      usuarios={usuarios ?? []}
      proveedores={proveedores ?? []}
      hayOdoo={hayCredencialesOdoo()}
    />
  );
}
