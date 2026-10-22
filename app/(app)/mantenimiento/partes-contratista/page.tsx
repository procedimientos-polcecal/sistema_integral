import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { sectoresDePlanta, type SectorDePlanta } from "@/lib/mantenimiento/sectores";
import { traerTodo } from "@/lib/core/paginado";
import PartesContratistaClient, {
  type ParteCargado, type LugarConocido, type EquipoBasico, type Contratista,
} from "./PartesContratistaClient";

/**
 * Los partes diarios del contratista.
 *
 * Candia entrega quince hojas de papel cada quince días. Acá se cargan las
 * quince en un solo lugar y el sistema genera después todas las OT — una por
 * semana, actividad y sector.
 *
 * Todo se trae de una: son decenas de partes, no decenas de miles, y la
 * pantalla tiene que poder repartir horas y buscar un sector sin volver al
 * servidor en cada tecla.
 */
export default async function PartesContratistaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");
  const puedeEditar = nivel === "edicion" || nivel === "admin";

  const [sectores, contratistas, equipos] = await Promise.all([
    sectoresDePlanta<SectorDePlanta>(supabase),
    traerTodo<Contratista>((d, h) =>
      supabase
        .from("proveedores")
        .select("id, nombre")
        .eq("es_contratista", true)
        .order("nombre")
        .range(d, h)
    ),
    traerTodo<EquipoBasico>((d, h) =>
      supabase
        .from("equipos")
        .select("id, name, code, sector_id")
        .order("code")
        .range(d, h)
    ),
  ]);

  // El catálogo de equivalencias y los partes ya cargados. Las dos tablas
  // nacen el 20/10/2026, así que mientras la migración no esté corrida la
  // consulta falla: se degrada a vacío y la pantalla lo dice, en vez de tirar
  // un 500 que no explica nada.
  const lugares = await traerTodo<LugarConocido>((d, h) =>
    supabase
      .from("mant_contratista_lugares")
      .select("proveedor_id, texto, texto_original, sector_id, equipo_id")
      .range(d, h)
  ).catch(() => null);

  const partes = await traerTodo<ParteCargado>((d, h) =>
    supabase
      .from("mant_partes_contratista")
      .select("id, proveedor_id, numero, fecha, dirigido_a, hora_entrada, hora_salida, horas_declaradas, materiales, mant_partes_contratista_renglones(id, orden, actividad, lugar_raw, sector_id, equipo_id, horas, orden_trabajo_id)")
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false })
      .range(d, h)
  ).catch(() => null);

  return (
    <PartesContratistaClient
      puedeEditar={puedeEditar}
      sectores={sectores}
      equipos={equipos}
      contratistas={contratistas}
      lugares={lugares ?? []}
      partes={partes ?? []}
      faltaLaMigracion={lugares === null || partes === null}
    />
  );
}
