import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { efectoEnElSaldo } from "@/lib/calidad/movimientos";
import { exportarMovimiento } from "@/lib/calidad/espejo";
import type { CarbonReal, TipoDeMovimiento } from "@/lib/calidad/types";

/**
 * Cargar un movimiento: el consumo del día, un ajuste, o una entrada a mano.
 *
 * TODA RUTA QUE TOQUE UN CAMPO QUE SE EXPORTA TIENE QUE EXPORTAR, y si no
 * puede, dejar el pendiente anotado. Cambiar un saldo sin escribirlo en la
 * planilla es una divergencia que no avisa.
 *
 * Spec: docs/superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md
 */

interface CuerpoDelAlta {
  fecha: string;
  tipo: TipoDeMovimiento;
  carbon: CarbonReal;
  toneladas: number;
  motivo?: string | null;
  carbonillero_id?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar movimientos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<CuerpoDelAlta>(request);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha ?? "")) {
    return NextResponse.json({ error: "Falta la fecha del movimiento." }, { status: 400 });
  }
  if (cuerpo.carbon !== "vegetal" && cuerpo.carbon !== "residual") {
    return NextResponse.json({ error: "Falta el tipo de carbón." }, { status: 400 });
  }

  // El signo lo decide la función pura, no la pantalla ni la ruta. Los CHECK de
  // la base dicen lo mismo, así que si esto se salteara el insert fallaría igual.
  const efecto = efectoEnElSaldo(cuerpo.tipo, Number(cuerpo.toneladas));
  if (efecto.problema) return NextResponse.json({ error: efecto.problema }, { status: 400 });

  const motivo = (cuerpo.motivo ?? "").trim();
  if (cuerpo.tipo === "ajuste" && !motivo) {
    return NextResponse.json(
      { error: "Un ajuste lleva el motivo escrito. Sin eso no se distingue de un error de carga." },
      { status: 400 }
    );
  }
  if (cuerpo.tipo === "entrada" && !cuerpo.carbonillero_id) {
    return NextResponse.json({ error: "Una entrada necesita su carbonillero." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("calidad_movimientos")
    .insert({
      fecha: cuerpo.fecha,
      tipo: cuerpo.tipo,
      carbon: cuerpo.carbon,
      toneladas: efecto.toneladas,
      motivo: cuerpo.tipo === "ajuste" ? motivo : null,
      carbonillero_id: cuerpo.tipo === "entrada" ? cuerpo.carbonillero_id : null,
      origen: "manual",
      cargado_por: user.id,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // El dato ya está guardado: de acá en más nada puede fallar el alta.
  const { aviso } = await exportarMovimiento(supabase, data.id);
  return NextResponse.json({ id: data.id, aviso });
}
