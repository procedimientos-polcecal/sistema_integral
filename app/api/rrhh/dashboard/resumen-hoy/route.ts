import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { calcularResumenHoy } from "@/lib/rrhh/resumenHoy";

/**
 * Los cuatro indicadores de hoy, para cuando cambian los filtros de empresa o
 * sector sin recargar la página. El primer render no pasa por acá: la pantalla
 * los trae ya calculados desde el servidor (ver `app/(app)/rrhh/page.tsx`).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  return NextResponse.json(
    await calcularResumenHoy(supabase, {
      empresaId: url.searchParams.get("empresaId"),
      sectorId: url.searchParams.get("sectorId"),
    })
  );
}
