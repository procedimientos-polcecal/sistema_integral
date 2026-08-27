import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leerValores } from "@/lib/core/sheets";
import { normalizar } from "@/lib/mantenimiento/planilla";
import {
  mapearInventario, filaDeInsumo, buscarEnInventario, type Insumo,
} from "@/lib/mantenimiento/stock";

/**
 * Qué hay en el pañol.
 *
 * Se lee en vivo de su planilla y no se guarda: el stock cambia cada vez que
 * alguien retira algo, y una copia estaría desactualizada justo cuando importa.
 *
 * El inventario no lo maneja Mantenimiento. Si la planilla no está configurada
 * o no se puede leer, la respuesta lo dice y la pantalla sigue andando sin
 * disponibilidad: cargar los repuestos que hacen falta no depende de saber si
 * los hay.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_INVENTARIO_ID ?? "";
const PESTANA = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB ?? "";

/** Todo el inventario, leído de la planilla. */
async function leerInventario(): Promise<Insumo[]> {
  const filas = await leerValores(PLANILLA(), PESTANA(), { sinFormato: true });
  if (filas.length < 2) return [];

  const idx = mapearInventario(filas[0]);
  return filas.slice(1)
    .map((f) => filaDeInsumo(f, idx))
    .filter((i): i is Insumo => i !== null);
}

/** GET ?q= — buscar en el inventario, para el autocompletado. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!PLANILLA()) return NextResponse.json({ configurado: false, data: [] });

  const q = normalizar(new URL(request.url).searchParams.get("q"));

  try {
    const inventario = await leerInventario();
    const encontrados = q
      ? inventario.filter(
          (i) => normalizar(i.codigo).includes(q) || normalizar(i.descripcion).includes(q)
        )
      : inventario;

    return NextResponse.json({ configurado: true, data: encontrados.slice(0, 30) });
  } catch (e) {
    return NextResponse.json({
      configurado: true,
      data: [],
      error: `No se pudo leer el inventario: ${e instanceof Error ? e.message : e}`,
    });
  }
}

/** POST — qué hay de cada repuesto de una lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const b = await request.json().catch(() => null);
  const repuestos = Array.isArray(b?.repuestos) ? b.repuestos : [];

  if (!PLANILLA()) return NextResponse.json({ configurado: false, disponibilidad: [] });

  try {
    return NextResponse.json({
      configurado: true,
      disponibilidad: buscarEnInventario(repuestos, await leerInventario()),
    });
  } catch (e) {
    return NextResponse.json({
      configurado: true,
      disponibilidad: [],
      error: `No se pudo leer el inventario: ${e instanceof Error ? e.message : e}`,
    });
  }
}
