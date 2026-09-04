import { createClient } from "@/lib/supabase/server";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import OrdenesClient from "./OrdenesClient";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";

export default async function OrdenesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  // Los contratistas son proveedores del núcleo desde la 032, y las 427
  // órdenes contratadas tienen el enlace puesto: se filtra por `proveedor_id` y
  // no por el texto de la columna `contratista`, que la planilla escribe a mano.
  // Los tres últimos son de Compras y están acá para que, cuando el pañol no
  // tenga un repuesto, se pueda pedir sin salir de la orden. Un requerimiento
  // lo genera cualquier usuario del SdG, así que no hace falta permiso de
  // Compras para leerlos — es lo mismo que hace `mis-pedidos`.
  //
  // `compras_ubicaciones` viene con su enlace al equipo: es lo que permite que
  // el pedido nazca atribuido a la máquina, que es de lo que después sale el
  // gasto por equipo.
  const [
    sectores, { data: equipos }, { data: contratistas },
    { data: areas }, { data: empresas }, { data: ubicaciones },
  ] = await Promise.all([
    sectoresDePlanta(supabase),
    supabase.from("equipos").select("id, name, code, sector_id, status").eq("is_active", true).order("code"),
    supabase.from("proveedores").select("id, nombre").eq("es_contratista", true).eq("activo", true).order("nombre"),
    supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("compras_ubicaciones").select("id, nombre, equipo_id, sector_id").eq("activo", true).order("orden"),
  ]);

  // Esta pantalla espeja una planilla: cuándo se trajo es parte del dato.
  const sync = await ultimaSincronizacionDe(supabase, "mantenimiento", "ordenes");

  return (
    <OrdenesClient
      sync={sync}
      canEdit={canEdit}
      sectores={sectores}
      equipos={equipos ?? []}
      contratistas={contratistas ?? []}
      areas={areas ?? []}
      empresas={empresas ?? []}
      ubicaciones={ubicaciones ?? []}
    />
  );
}
