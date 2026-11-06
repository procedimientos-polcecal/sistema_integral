import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Los equipos y los sectores, para los desplegables.
 *
 * Van juntos porque siempre se piden juntos: elegir una máquina completa su
 * sector, y elegir un sector acota las máquinas. Dos llamadas para lo mismo
 * sólo agregan una espera.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const [equipos, sectores] = await Promise.all([
    traerTodo<{ id: string; code: string | null; name: string; sector_id: string | null }>(
      (desde, hasta) =>
        supabase
          .from("equipos")
          .select("id, code, name, sector_id")
          .eq("is_active", true)
          .order("code")
          .range(desde, hasta)
    ),
    // `empresa_id` y `transversal` van porque el alta de un requerimiento
    // sugiere con ellos quién paga: el sector dice de qué empresa es, y los que
    // sirven a las dos están marcados transversales. Ver
    // `lib/compras/sectorDelPedido.ts`. Son dos columnas más en una lista de 29
    // filas, así que no vale la pena un endpoint aparte para Compras.
    sectoresDePlanta<{
      id: string;
      nombre: string;
      codigo: string | null;
      empresa_id: string | null;
      transversal: boolean | null;
    }>(supabase, "id, nombre, codigo, empresa_id, transversal"),
  ]);

  return NextResponse.json({ equipos, sectores });
}
