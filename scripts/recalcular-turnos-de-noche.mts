// Recalcula los días de octubre de 2026 de quienes tienen algún turno que
// cruza medianoche, con la regla nueva: **el turno va entero al día en que
// arrancó** (30/10/2026, ver `intervalsParaDia`).
//
// Hasta ese día el motor partía la fichada en la medianoche, así que un 20 a 4
// daba 4 horas al día del turno y 4 al siguiente — y al siguiente, además, lo
// marcaba ausente teniendo horas. Quien liquida lo venía deshaciendo a mano:
// 73 de los 85 turnos de octubre que cruzan medianoche ya tenían las horas
// corregidas.
//
// Los días con `horas_manual` NO se tocan: `recalcularEmpleadoPeriodo` los
// preserva, que es lo correcto —alguien ya escribió ahí el número bueno— y es
// lo que hace que esta corrida sea chica y no una reescritura del mes.
//
// Uso:
//   npx tsx scripts/recalcular-turnos-de-noche.mts            (sólo informa)
//   npx tsx scripts/recalcular-turnos-de-noche.mts --aplicar
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recalcularEmpleadoPeriodo } from "../lib/rrhh/engine/recalcular.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const aplicar = process.argv.includes("--aplicar");
const DESDE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-10-01";
const HASTA = process.argv.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))[1] ?? "2026-10-31";

const diaArt = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });

interface Calculo {
  empleado_id: string;
  fecha: string;
  ausente: boolean;
  horas_normales: number | string;
  horas_extra_50: number | string;
  horas_extra_100: number | string;
  horas_manual: boolean;
}

const total = (c: Calculo | undefined) =>
  c ? Number(c.horas_normales) + Number(c.horas_extra_50) + Number(c.horas_extra_100) : 0;

async function paginado<T>(tabla: string, select: string, filtro: (q: ReturnType<typeof sb.from>) => unknown) {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from(tabla).select(select) as never;
    q = filtro(q as never) as never;
    const { data, error } = await (q as never as { range: (a: number, b: number) => Promise<{ data: T[] | null; error: { message: string } | null }> }).range(desde, desde + 999);
    if (error) throw new Error(error.message);
    filas.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return filas;
  }
}

async function main() {
  const { data: emps } = await sb.from("empleados").select("id, legajo, nombre, apellido").limit(2000);
  const nombre = new Map((emps ?? []).map((e) => [e.id as string, `${e.legajo} ${e.apellido}, ${e.nombre}`]));

  const fichadas = await paginado<{ empleado_id: string; fecha: string; hora_salida: string | null }>(
    "fichadas",
    "empleado_id, fecha, hora_salida",
    (q) => (q as never as { gte: (a: string, b: string) => { lte: (a: string, b: string) => { order: (a: string) => { order: (b: string) => unknown } } } }).gte("fecha", DESDE).lte("fecha", HASTA).order("id")
  );
  const cruzan = fichadas.filter((f) => f.hora_salida && diaArt(f.hora_salida) > f.fecha);
  const afectados = [...new Set(cruzan.map((f) => f.empleado_id))];
  console.log(`Turnos que cruzan medianoche entre ${DESDE} y ${HASTA}: ${cruzan.length}, en ${afectados.length} empleados.`);

  const antes = await paginado<Calculo>(
    "calculos_diarios",
    "empleado_id, fecha, ausente, horas_normales, horas_extra_50, horas_extra_100, horas_manual",
    (q) => (q as never as { gte: (a: string, b: string) => { lte: (a: string, b: string) => { order: (a: string) => { order: (b: string) => unknown } } } }).gte("fecha", DESDE).lte("fecha", HASTA).order("empleado_id").order("fecha")
  );
  const antesPorClave = new Map(antes.map((c) => [`${c.empleado_id}|${c.fecha}`, c]));
  const manuales = antes.filter((c) => c.horas_manual && afectados.includes(c.empleado_id)).length;
  console.log(`Días de esos empleados con horas fijadas a mano (no se tocan): ${manuales}`);

  if (!aplicar) {
    const absurdos = antes.filter((c) => c.ausente && total(c) > 0);
    console.log(`Días que hoy dicen AUSENTE y tienen horas: ${absurdos.length}`);
    for (const c of absurdos) console.log(`   ${nombre.get(c.empleado_id)} ${c.fecha} ${total(c)}h`);
    console.log("\n(sólo informe) Correr con --aplicar para recalcular.");
    return;
  }

  let ok = 0;
  for (const empleadoId of afectados) {
    try {
      await recalcularEmpleadoPeriodo(sb, empleadoId, new Date(DESDE), new Date(HASTA));
      ok++;
    } catch (e) {
      console.error(`  falló ${nombre.get(empleadoId)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Empleados recalculados: ${ok} de ${afectados.length}`);

  const despues = await paginado<Calculo>(
    "calculos_diarios",
    "empleado_id, fecha, ausente, horas_normales, horas_extra_50, horas_extra_100, horas_manual",
    (q) => (q as never as { gte: (a: string, b: string) => { lte: (a: string, b: string) => { order: (a: string) => { order: (b: string) => unknown } } } }).gte("fecha", DESDE).lte("fecha", HASTA).order("empleado_id").order("fecha")
  );
  let cambiados = 0;
  const porEmpleado = new Map<string, number>();
  for (const c of despues) {
    const a = antesPorClave.get(`${c.empleado_id}|${c.fecha}`);
    const d = total(c) - total(a);
    if (Math.abs(d) > 0.001) {
      cambiados++;
      porEmpleado.set(c.empleado_id, (porEmpleado.get(c.empleado_id) ?? 0) + d);
      console.log(`   ${nombre.get(c.empleado_id)} ${c.fecha}: ${total(a).toFixed(1)}h -> ${total(c).toFixed(1)}h`);
    }
  }
  console.log(`\nDías con cambio: ${cambiados}`);
  for (const [id, d] of porEmpleado) console.log(`   ${nombre.get(id)}: ${d >= 0 ? "+" : ""}${d.toFixed(1)} h en el período`);
  console.log(`Días que dicen AUSENTE teniendo horas: ${despues.filter((c) => c.ausente && total(c) > 0).length}`);
}

await main();
