import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esAdminDespacho } from "@/lib/despacho/auth";
import { traerProveedoresDeRecepcion } from "@/lib/despacho/consultas";
import { leerCatalogoComprable } from "@/lib/odoo/catalogo";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import ProveedoresDeRecepcionClient from "./ProveedoresClient";

/**
 * Qué producto de Odoo y qué nombre de planilla le corresponde a cada
 * carbonillero.
 *
 * Es lo que el módulo **no puede deducir**: elegir el producto equivocado manda
 * el material a la cuenta que no es, y el nombre de planilla es lo que evita que
 * el libro vuelva a tener 51 formas de escribir diez proveedores.
 *
 * El catálogo comprable se lee de Odoo en el servidor —378 productos en una
 * llamada— porque esta pantalla se abre una vez por proveedor y no con un camión
 * esperando.
 */
export default async function ProveedoresDeRecepcionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminDespacho(supabase, user.id))) redirect("/despacho/recepciones");

  const [config, proveedores] = await Promise.all([
    traerProveedoresDeRecepcion(supabase),
    supabase
      .from("proveedores")
      .select("id, nombre, rubro, cuit")
      .eq("activo", true)
      .order("nombre"),
  ]);

  // Sin credenciales de Odoo la pantalla igual sirve para ver lo cargado: lo que
  // no va a poder es ofrecer productos. Decirlo es mejor que una lista vacía.
  let productos: { id: number; nombre: string }[] = [];
  let errorOdoo: string | null = null;
  if (hayCredencialesOdoo()) {
    try {
      productos = (await leerCatalogoComprable()).map((p) => ({ id: p.id, nombre: p.nombre }));
    } catch (e) {
      errorOdoo = e instanceof Error ? e.message : String(e);
    }
  } else {
    errorOdoo = "No hay credenciales de Odoo configuradas.";
  }

  const todos = (proveedores.data ?? []) as {
    id: string;
    nombre: string;
    rubro: string | null;
    cuit: string | null;
  }[];
  const configurados = new Set(config.map((c) => c.proveedor_id));

  return (
    <ProveedoresDeRecepcionClient
      proveedores={todos.filter((p) => configurados.has(p.id) || p.rubro === "CARBONILLA")}
      config={config}
      productos={productos}
      errorOdoo={errorOdoo}
    />
  );
}
