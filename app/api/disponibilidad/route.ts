import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { rangoPedido } from "@/lib/rrhh/ausentismo/disponibilidadPublica";
import { leerDisponibilidad } from "@/lib/rrhh/ausentismo/lecturas";

/**
 * Quién no viene y qué día. Abierta a cualquiera que entre al sistema.
 *
 * `GET ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` (sin parámetros, la semana de hoy)
 * → `{ dias, ausentes: { empleadoId, nombre, sector, dia }[] }`.
 *
 * **EL MOTIVO NO SALE DE ACÁ, NUNCA.** `ausencias` está cerrada con
 * `tiene_acceso_rrhh()` —la leen 6 de 14 usuarios— porque guarda el tipo
 * (enfermedad, ART, suspensión: dato médico y disciplinario) y un texto libre
 * de RRHH. Esta ruta es la excepción a propósito: lee con el cliente admin
 * —sin abrirle ninguna policy a la tabla— y entrega sólo lo que puede ser
 * público. La proyección está en `ausentesPublicos`, que arma la respuesta
 * campo por campo y no borrando los prohibidos; el `tipo` se usa ahí sólo para
 * dejar afuera la tardanza y se descarta.
 *
 * Como el permiso de esta ruta es "estar logueado" y el cliente admin se salta
 * RLS, **nada de lo que lea puede devolverse sin pasar por la proyección**.
 * Ver docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const rango = rangoPedido(params.get("desde"), params.get("hasta"), hoyEnArgentina());
  if ("error" in rango) return NextResponse.json({ error: rango.error }, { status: 400 });

  try {
    return NextResponse.json(await leerDisponibilidad(createAdminClient(), rango.dias));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
