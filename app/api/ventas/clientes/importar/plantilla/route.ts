import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, tieneAccesoVentas } from "@/lib/ventas/auth";
import { xlsxResponse } from "@/lib/core/xlsxExport";
import { COLUMNAS } from "@/lib/ventas/crm/importarClientes";

/**
 * La plantilla del Excel de clientes, para bajar y llenar.
 *
 * Existe por una razón concreta: **el formato se describe en un solo lugar**.
 * Los encabezados salen de `COLUMNAS`, el mismo arreglo contra el que el
 * importador reconoce las columnas, así que la plantilla no puede quedar
 * diciendo una cosa y el lector aceptando otra. Un documento con la lista de
 * columnas escrita a mano se desactualiza y entonces pasa lo peor: alguien la
 * lee y le cree.
 *
 * Lleva **una fila de ejemplo** con datos inventados y evidentes. Sin ella, una
 * planilla con sólo el encabezado deja dudas que el documento no contesta —si
 * el CUIT va con guiones, qué se escribe en Estado— y quien la llena inventa.
 * Que sea obviamente falsa es a propósito: hay que poder borrarla sin dudar si
 * era un dato de verdad.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Bajar la plantilla no escribe nada, así que alcanza con tener el módulo.
  const permiso = await tieneAccesoVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) return NextResponse.json({ error: "No tenés acceso a Ventas" }, { status: 403 });

  const ejemplo: Record<string, string> = {
    razon_social: "Cal del Valle SRL",
    nombre_fantasia: "Cal del Valle",
    cuit: "30-71044963-1",
    estado: "Prospecto",
    localidad: "Olavarría",
    provincia: "Buenos Aires",
    rubro: "Construcción",
    telefono: "2284-445566",
    email: "compras@ejemplo.com",
    sitio_web: "www.ejemplo.com",
    origen: "Referido",
    vendedor: "",
    notas: "Esta fila es un ejemplo: borrala antes de importar.",
  };

  return xlsxResponse(
    "clientes-plantilla.xlsx",
    "Clientes",
    [COLUMNAS.map((c) => c.nombre), COLUMNAS.map((c) => ejemplo[c.campo] ?? "")]
  );
}
