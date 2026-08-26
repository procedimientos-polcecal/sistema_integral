import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ProduccionClient from "./ProduccionClient";
import { sectoresDePlanta, empresaDelSector } from "@/lib/mantenimiento/sectores";

/**
 * La planificación de producción de la semana.
 *
 * Trae, además del plan, lo que está pendiente de mantenimiento en cada sector:
 * la grilla sirve justamente para cruzar las dos cosas y meter las reparaciones
 * donde el sector ya está parado.
 */

export default async function ProduccionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const puedeEditar = nivel === "edicion" || nivel === "admin";

  const [sectores, { data: ot }, { data: os }] = await Promise.all([
    sectoresDePlanta(supabase),
    supabase
      .from("ordenes_trabajo")
      .select("id, ot_number, descripcion, equipo_raw, prioridad, estado, sector_id, requiere_parada_sector")
      .in("estado", ["POR_HACER", "EN_PROCESO", "ATRASADO"])
      .not("sector_id", "is", null),
    // Las OS todavía no se cargan desde ningún lado: la tabla existe y la
    // consulta ya queda hecha para cuando esa feature llegue.
    supabase
      .from("ordenes_servicio")
      .select("id, os_number, descripcion, estado, sector_id")
      .not("sector_id", "is", null),
  ]);

  // La empresa del sector se aplana acá: PostgREST devuelve el embed como
  // arreglo o como objeto según la relación, y la pantalla sólo quiere el
  // nombre para agrupar.
  const conEmpresa = (sectores).map((s) => ({
    id: s.id as string,
    nombre: s.nombre as string,
    empresa: empresaDelSector(s.empresas),
  }));

  return (
    <ProduccionClient
      puedeEditar={puedeEditar}
      sectores={conEmpresa}
      pendientesOT={ot ?? []}
      pendientesOS={os ?? []}
    />
  );
}
