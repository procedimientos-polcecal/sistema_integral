import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { calcularResumenAnalitico } from "@/lib/rrhh/analiticoResumen";

/**
 * Las cinco tarjetas del Analítico. El primer render no pasa por acá: la
 * pantalla las trae ya calculadas del servidor (ver
 * `app/(app)/rrhh/analitico/page.tsx`). Queda para refrescarlas sin recargar.
 */
export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  return NextResponse.json(await calcularResumenAnalitico(supabase));
}
