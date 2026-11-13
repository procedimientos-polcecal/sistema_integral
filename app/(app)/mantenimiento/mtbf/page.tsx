import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { indicadoresDeLaPlanta } from "@/lib/mantenimiento/mtbfDatos";
import {
  sectoresDePlanta,
  empresaDelSector,
  CAMPOS_SECTOR,
  type SectorDePlanta,
} from "@/lib/mantenimiento/sectores";
import type { EquipoDeLaVista } from "@/lib/mantenimiento/mtbfVista";
import MtbfClient from "./MtbfClient";

/**
 * Cada cuánto falla cada máquina, el peor arriba.
 *
 * Las cuentas se hacen en el servidor (`indicadoresDeLaPlanta`, una sola lectura
 * para los dos números) y el cliente sólo ordena
 * y filtra lo que ya viene hecho. El nivel de acceso lo resuelve el layout del
 * módulo: alcanza con lectura.
 *
 * Los equipos se leen con `traerTodo()` aunque hoy sean ~240: una tabla que
 * crece no avisa cuando cruza las 1.000 filas, y acá un equipo cortado es una
 * fila que desaparece del listado sin error.
 */
export default async function MtbfPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ mtbf, mttr }, equiposDb, sectores] = await Promise.all([
    indicadoresDeLaPlanta(supabase, hoyEnArgentina()),
    traerTodo<{ id: string; code: string; name: string; sector_id: string | null }>((de, a) =>
      supabase
        .from("equipos")
        .select("id, code, name, sector_id")
        .eq("is_active", true)
        .order("code")
        .range(de, a)
    ),
    sectoresDePlanta<SectorDePlanta>(supabase, CAMPOS_SECTOR),
  ]);

  const nombreDeSector = new Map(sectores.map((s) => [s.id, s.nombre]));

  const equipos: EquipoDeLaVista[] = equiposDb.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    sectorId: e.sector_id ?? "",
    sectorNombre: (e.sector_id && nombreDeSector.get(e.sector_id)) || "Sin sector",
  }));

  return (
    <MtbfClient
      mtbf={mtbf}
      mttr={mttr}
      equipos={equipos}
      // La empresa viaja resuelta: el embed de PostgREST llega como objeto o
      // como arreglo según cómo esté declarada la relación, y eso no tiene por
      // qué saberlo el cliente.
      sectores={sectores.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        empresa: empresaDelSector(s.empresas),
      }))}
    />
  );
}
