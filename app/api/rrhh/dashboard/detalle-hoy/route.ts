import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { calcularHoy } from "@/lib/rrhh/resumenHoy";

/**
 * Las personas detrás de cada una de las cuatro tarjetas.
 *
 * Sale de `calcularHoy`, la misma lectura y la misma clasificación que arma los
 * números: así la lista que abre una tarjeta tiene exactamente tantas filas como
 * dice la tarjeta. Antes esta ruta hacía su propia cuenta (con la fecha en UTC y
 * `presentes` como "todos los que no están ausentes"), y apenas la tarjeta
 * cambió de criterio las dos habrían dejado de coincidir.
 *
 * Los ausentes son los del día de referencia, no los de hoy — el título del
 * modal lo dice, a partir del resumen de la pantalla.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const { empleados, clasificacion } = await calcularHoy(supabase, {
    empresaId: url.searchParams.get("empresaId"),
    sectorId: url.searchParams.get("sectorId"),
  });

  const info = (e: (typeof empleados)[number]) => ({
    employeeId: e.id,
    legajo: e.legajo,
    nombre: `${e.apellido}, ${e.nombre}`,
    sector: e.sectores?.nombre ?? null,
  });
  const de = (ids: Set<string> | null) => (ids ? empleados.filter((e) => ids.has(e.id)).map(info) : []);

  return NextResponse.json({
    presentes: de(clasificacion.presentes),
    ausentes: de(clasificacion.ausentes),
    tardes: de(clasificacion.tardes),
    vacaciones: de(clasificacion.vacaciones),
  });
}
