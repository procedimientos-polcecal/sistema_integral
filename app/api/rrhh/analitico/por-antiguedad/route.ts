import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";

const MS_POR_ANIO = 365.25 * 86_400_000;
function edadEnAnios(desde: Date, hasta: Date): number {
  return (hasta.getTime() - desde.getTime()) / MS_POR_ANIO;
}

const BUCKETS_ANTIGUEDAD = [
  { label: "0-2 años", min: 0, max: 2 },
  { label: "2-5 años", min: 2, max: 5 },
  { label: "5-10 años", min: 5, max: 10 },
  { label: "10-20 años", min: 10, max: 20 },
  { label: "20+ años", min: 20, max: Infinity },
] as const;

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data: empleados } = await supabase.from("empleados").select("fecha_ingreso").eq("activo", true);
  const hoy = utcDateOnlyFrom(new Date());
  const conteo = new Map(BUCKETS_ANTIGUEDAD.map((b) => [b.label, 0]));
  for (const e of empleados ?? []) {
    const anios = edadEnAnios(new Date(e.fecha_ingreso), hoy);
    const bucket = BUCKETS_ANTIGUEDAD.find((b) => anios >= b.min && anios < b.max) ?? BUCKETS_ANTIGUEDAD[BUCKETS_ANTIGUEDAD.length - 1];
    conteo.set(bucket.label, (conteo.get(bucket.label) ?? 0) + 1);
  }

  return NextResponse.json(BUCKETS_ANTIGUEDAD.map((b) => ({ rango: b.label, cantidad: conteo.get(b.label) ?? 0 })));
}
