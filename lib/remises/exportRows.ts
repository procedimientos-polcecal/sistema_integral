import type { SupabaseClient } from "@supabase/supabase-js";

export const EXPORT_HEADERS = ["Fecha", "Turno", "Búsqueda", "Tipo", "Remis", "Conductor", "#", "Empleado", "Dirección"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Filas exportables (una por empleado-parada) para las hojas de ruta de las fechas dadas. */
export async function filasParaFechas(supabase: SupabaseClient, fechas: string[]): Promise<unknown[][]> {
  if (!fechas.length) return [];
  const { data: hojas } = await supabase
    .from("hojas_ruta")
    .select(
      "fecha, tipo, hora_salida, remises_turnos(nombre), vehiculos(nombre), choferes(nombre), asientos(orden, empleados(nombre, apellido, remises_empleados_datos(direccion)))"
    )
    .in("fecha", fechas)
    .order("fecha")
    .order("turno_id")
    .order("tipo");

  const rows: unknown[][] = [];
  for (const h of (hojas ?? []) as any[]) {
    const asientos = [...(h.asientos ?? [])].sort((a: any, b: any) => a.orden - b.orden);
    asientos.forEach((a: any, si: number) => {
      rows.push([
        fmtFecha(h.fecha),
        h.remises_turnos?.nombre ?? "",
        h.hora_salida ?? "",
        h.tipo === "ida" ? "IDA" : "VUELTA",
        h.vehiculos?.nombre ?? "",
        h.choferes?.nombre ?? "",
        si + 1,
        `${a.empleados?.apellido ?? ""}, ${a.empleados?.nombre ?? ""}`,
        a.empleados?.remises_empleados_datos?.direccion ?? "",
      ]);
    });
  }
  return rows;
}

/** Lunes a domingo de la semana actual (fechas ISO). */
export function fechasSemanaActual(): string[] {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function nombreDia(iso: string): string {
  const dow = new Date(iso + "T12:00:00").getDay();
  return DAY_NAMES[dow];
}
