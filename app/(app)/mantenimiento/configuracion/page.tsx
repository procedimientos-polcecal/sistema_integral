import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminMantenimiento, nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ConfiguracionClient from "./ConfiguracionClient";
import { empresaDelSector } from "@/lib/mantenimiento/sectores";

/**
 * Las listas de las que come el módulo.
 *
 * Nada de esto se carga en el momento de usarlo: quien registra una orden de
 * trabajo a las siete de la mañana elige de una lista, no escribe nombres. Acá
 * se arma esa lista.
 */
export default async function ConfiguracionMantenimientoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const esAdmin = await esAdminMantenimiento(supabase, user.id);

  const [
    { data: operarios }, { data: contratistas }, { data: tipos }, { data: sectores },
    { data: tarifas }, { data: razones },
  ] = await Promise.all([
      supabase.from("operarios").select("id, slot, nombre").order("slot").order("nombre"),
      supabase
        .from("proveedores")
        .select("id, nombre, cuit, activo")
        .eq("es_contratista", true)
        .order("nombre"),
      supabase
        .from("equipos_tipos")
        .select("tipo_id, categoria, nombre_tipo, lubricante_tipo, frecuencia_lubricacion")
        .order("categoria")
        .order("nombre_tipo"),
      supabase
        .from("sectores")
        .select("id, codigo, nombre, empresas(nombre)")
        .eq("es_de_planta", true)
        .order("codigo"),
      // De la más nueva a la más vieja: la primera cuya fecha ya pasó es la que
      // rige hoy.
      supabase
        .from("mantenimiento_tarifas_hora")
        .select("id, valor, vigente_desde")
        .order("vigente_desde", { ascending: false }),
      // Cuántos días corre una OT según por qué se posterga. El código de cada
      // razón es vocabulario cerrado del servidor; acá se calibran los días.
      supabase
        .from("mant_razones_de_postergacion")
        .select("codigo, etiqueta, dias, activa, orden")
        .order("orden")
        .order("etiqueta"),
    ]);

  return (
    <ConfiguracionClient
      esAdmin={esAdmin}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      operarios={operarios ?? []}
      contratistas={contratistas ?? []}
      tipos={tipos ?? []}
      tarifas={tarifas ?? []}
      razones={razones ?? []}
      sectores={(sectores ?? []).map((s) => ({
        id: s.id as string,
        codigo: s.codigo as string | null,
        nombre: s.nombre as string,
        empresa: empresaDelSector(s.empresas),
      }))}
    />
  );
}

