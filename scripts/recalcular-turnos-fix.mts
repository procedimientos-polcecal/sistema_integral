// Recalcula calculos_diarios con el fix de ajustarFichadasPorTurno (ya no
// recorta la entrada cuando llegó mucho antes del turno detectado — ver
// lib/rrhh/engine/recalcular-puro.ts). Los días con horas_manual=true nunca
// se tocan (los preserva recalcularEmpleadoPeriodo tal cual). Idempotente:
// se puede volver a correr sin riesgo.
//
// Uso: npx tsx scripts/recalcular-turnos-fix.mts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo } from "../lib/rrhh/engine/recalcular.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data: primeraFicha } = await sb.from("fichadas").select("fecha").order("fecha", { ascending: true }).limit(1);
  const { data: ultimaFicha } = await sb.from("fichadas").select("fecha").order("fecha", { ascending: false }).limit(1);
  if (!primeraFicha?.length || !ultimaFicha?.length) {
    console.log("No hay fichadas cargadas, nada para recalcular.");
    return;
  }
  const desdeStr = primeraFicha[0].fecha as string;
  const hastaStr = ultimaFicha[0].fecha as string;
  const desde = new Date(desdeStr);
  const hasta = new Date(hastaStr);
  console.log(`Rango de fichadas: ${desdeStr} a ${hastaStr}`);

  const { data: antes } = await sb
    .from("calculos_diarios")
    .select("empleado_id, fecha, horas_normales, horas_extra_50, horas_extra_100, horas_manual")
    .gte("fecha", desdeStr)
    .lte("fecha", hastaStr);
  const antesPorClave = new Map((antes ?? []).map((r) => [`${r.empleado_id}|${r.fecha}`, r]));
  console.log(`Filas existentes en el rango: ${antes?.length ?? 0} (${(antes ?? []).filter((r) => r.horas_manual).length} manuales, protegidas)`);

  const empleados = await recalcularSectorPeriodo(sb, null, desde, hasta);
  console.log(`Empleados recalculados: ${empleados}`);

  const { data: despues } = await sb
    .from("calculos_diarios")
    .select("empleado_id, fecha, horas_normales, horas_extra_50, horas_extra_100, horas_manual")
    .gte("fecha", desdeStr)
    .lte("fecha", hastaStr);

  let diasCambiados = 0;
  const empleadosCambiados = new Set<string>();
  let deltaHoras = 0;
  const detalle: string[] = [];
  for (const r of despues ?? []) {
    const clave = `${r.empleado_id}|${r.fecha}`;
    const prev = antesPorClave.get(clave);
    if (!prev) continue;
    const totalPrev = Number(prev.horas_normales) + Number(prev.horas_extra_50) + Number(prev.horas_extra_100);
    const totalNuevo = Number(r.horas_normales) + Number(r.horas_extra_50) + Number(r.horas_extra_100);
    if (Math.abs(totalPrev - totalNuevo) > 0.01) {
      diasCambiados++;
      empleadosCambiados.add(r.empleado_id);
      deltaHoras += totalNuevo - totalPrev;
      detalle.push(`  ${r.fecha} empleado ${r.empleado_id}: ${totalPrev.toFixed(1)}hs -> ${totalNuevo.toFixed(1)}hs (manual=${r.horas_manual})`);
    }
  }
  console.log("---------------------------------------------------------------");
  console.log(detalle.slice(0, 30).join("\n"));
  if (detalle.length > 30) console.log(`  ... y ${detalle.length - 30} más`);
  console.log("---------------------------------------------------------------");
  console.log(`Días con cambio de horas: ${diasCambiados} (${empleadosCambiados.size} empleados)`);
  console.log(`Delta total de horas acreditadas: ${deltaHoras >= 0 ? "+" : ""}${deltaHoras.toFixed(1)}hs`);
}

main().then(() => process.exit(0));
