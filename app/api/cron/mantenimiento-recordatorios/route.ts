import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { avisarDeLasOT } from "@/lib/mantenimiento/recordatorioDeOT";

export const maxDuration = 300;

/**
 * El recordatorio de las órdenes de trabajo: un push con las que se atrasaron
 * ayer y otro con las que arrancan en dos días.
 *
 * ── POR QUÉ DIARIO Y NO CADA QUINCE MINUTOS ──────────────────────────────────
 *
 * Los dos avisos son por fecha de inicio, un dato que cambia una vez por día:
 * correr más seguido nombraría las mismas órdenes en cada pasada. No lleva
 * tabla de «ya avisado» porque la idempotencia sale de la forma del problema:
 * una orden cruza su día una sola vez.
 *
 * ── POR QUÉ DE LUNES A SÁBADO ────────────────────────────────────────────────
 *
 * El domingo no se manda (pedido). Eso mueve los días que se miran el lunes
 * (recoge sábado y domingo) y el sábado (adelanta el martes): el porqué y la
 * prueba de que ningún día queda huérfano están en
 * `lib/mantenimiento/recordatorioDeOT.ts`.
 *
 * Corre a las 11:00 UTC, las 8:00 de Argentina, dentro de la ventana
 * 7:00–21:00. El reloj es `vercel.json`, y no GitHub Actions.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const resultado = await avisarDeLasOT(createAdminClient(), hoyEnArgentina());
  // Un fallo es un 503 y no un 200: el llamador es un cron, donde el código de
  // estado es la única señal, y este recurso no escribe en `sincronizaciones`.
  // Sin esto fallaría todos los días y el único síntoma sería que no llegan pushes.
  if (resultado.error) return NextResponse.json(resultado, { status: 503 });
  return NextResponse.json(resultado);
}
