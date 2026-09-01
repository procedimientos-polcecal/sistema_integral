import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularVentanaEnSegundoPlano } from "@/lib/rrhh/recalculoProgramado";
import { cuerpoJson } from "@/lib/core/cuerpo";

function toApi(row: Record<string, unknown>) {
  return {
    horasNormalesPorDia: Number(row.horas_normales_por_dia),
    horaCorteSabado: row.hora_corte_sabado,
    multiplicadorExtra50: Number(row.multiplicador_extra_50),
    multiplicadorExtra100: Number(row.multiplicador_extra_100),
    horasFrancoCompensatorio: Number(row.horas_franco_compensatorio),
    feriadoComoDomingo: row.feriado_como_domingo,
    escalaVacaciones: row.escala_vacaciones,
  };
}

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase.from("config_liquidacion").select("*").eq("id", 1).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "No encontrada" }, { status: 500 });
  return NextResponse.json(toApi(data));
}

const HORA_REGEX = /^\d{2}:\d{2}$/;

export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const data: Record<string, unknown> = {};
  if (body.horasNormalesPorDia !== undefined) {
    if (!(Number(body.horasNormalesPorDia) > 0)) return NextResponse.json({ error: "horasNormalesPorDia inválido" }, { status: 400 });
    data.horas_normales_por_dia = body.horasNormalesPorDia;
  }
  if (body.horaCorteSabado !== undefined) {
    if (!HORA_REGEX.test(body.horaCorteSabado)) return NextResponse.json({ error: "horaCorteSabado inválido" }, { status: 400 });
    data.hora_corte_sabado = body.horaCorteSabado;
  }
  if (body.multiplicadorExtra50 !== undefined) {
    if (!(Number(body.multiplicadorExtra50) > 0)) return NextResponse.json({ error: "multiplicadorExtra50 inválido" }, { status: 400 });
    data.multiplicador_extra_50 = body.multiplicadorExtra50;
  }
  if (body.multiplicadorExtra100 !== undefined) {
    if (!(Number(body.multiplicadorExtra100) > 0)) return NextResponse.json({ error: "multiplicadorExtra100 inválido" }, { status: 400 });
    data.multiplicador_extra_100 = body.multiplicadorExtra100;
  }
  if (body.horasFrancoCompensatorio !== undefined) {
    if (!(Number(body.horasFrancoCompensatorio) > 0)) return NextResponse.json({ error: "horasFrancoCompensatorio inválido" }, { status: 400 });
    data.horas_franco_compensatorio = body.horasFrancoCompensatorio;
  }
  if (body.feriadoComoDomingo !== undefined) data.feriado_como_domingo = body.feriadoComoDomingo;
  if (body.escalaVacaciones !== undefined) data.escala_vacaciones = body.escalaVacaciones;

  const { data: row, error } = await supabase.from("config_liquidacion").update(data).eq("id", 1).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Los multiplicadores, la hora de corte del sábado y las horas normales por
  // día entran en el cálculo de todos los días de todos los empleados.
  recalcularVentanaEnSegundoPlano(supabase);
  return NextResponse.json(toApi(row));
}
