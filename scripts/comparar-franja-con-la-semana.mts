// Contrasta la franja del mes contra el ciclo de la pestaña «Semana», sobre el
// padrón y la referencia de producción. No escribe nada.
//
// ── CONTRA QUÉ SE COMPARA, QUE ES TODO EL PUNTO ───────────────────────────
//
// Contra **el ciclo** que calcula la semana (`turnoDeLaPersona` sobre el mismo
// padrón y la misma referencia), y **no** contra su grilla final, que lleva las
// pisadas encima. La franja habla de una semana y una pisada mueve a alguien un
// día: ubicar a alguien en la franja por su pisada diría de los siete días algo
// que vale uno solo. Comparar contra la grilla haría «fallar» a la franja justo
// donde está haciendo lo correcto.
//
//   npx tsx scripts/comparar-franja-con-la-semana.mts
//   npx tsx scripts/comparar-franja-con-la-semana.mts 2026-11-16   (otro arranque)

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { franjaDeLaSemana } = await import("../lib/mantenimiento/rotacionDeLaSemana.ts");
const { comoReferencia, laQueRige, turnoDeLaPersona } =
  await import("../lib/mantenimiento/referenciaDelTaller.ts");
const { estaVigente } = await import("../lib/mantenimiento/disponibilidad.ts");
const { semanaDe, sumarDias, hoyEnArgentina } = await import("../lib/core/fechas.ts");

type Turno = "4-12" | "8-16" | "12-20";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

const leer = async <T>(ruta: string): Promise<T[]> => {
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`${ruta}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
};

const soloElDia = (v: unknown) => String(v ?? "").slice(0, 10);

const arranque = semanaDe(process.argv[2] ?? hoyEnArgentina())[0];
const SEMANAS = 4;
const lunes = Array.from({ length: SEMANAS }, (_, i) => sumarDias(arranque, i * 7));
const primerDia = lunes[0];
const ultimoDia = semanaDe(lunes[SEMANAS - 1])[6];

const filasPadron = await leer<{
  empleado_id: string; oficio: string; grupo: string | null;
  desde: string; hasta: string | null;
  empleados: { nombre: string; apellido: string } | null;
}>(
  `mant_personal_taller?select=empleado_id,oficio,grupo,desde,hasta,empleados(nombre,apellido)` +
  `&desde=lte.${ultimoDia}&or=(hasta.is.null,hasta.gte.${primerDia})&order=desde`
);

const padron = filasPadron.map((f) => ({
  empleadoId: f.empleado_id,
  oficio: f.oficio as never,
  grupo: f.grupo as never,
  desde: soloElDia(f.desde),
  hasta: f.hasta === null ? null : soloElDia(f.hasta),
}));

const nombres = new Map<string, string>();
for (const f of filasPadron) {
  nombres.set(f.empleado_id, f.empleados ? `${f.empleados.nombre} ${f.empleados.apellido}` : "(sin nombre)");
}

const filasRef = await leer<{
  lunes: string; grupo_en_4a12: string;
  electricista_4a12_id: string; electricista_8a16_id: string; electricista_12a20_id: string;
}>(
  `mant_programacion_referencia?select=lunes,grupo_en_4a12,electricista_4a12_id,` +
  `electricista_8a16_id,electricista_12a20_id&order=lunes`
);
const referencias = filasRef.map((f) => ({ ...f, lunes: soloElDia(f.lunes) }));

const ausencias = (
  await leer<{ empleado_id: string; fecha_desde: string; fecha_hasta: string; tipo: string }>(
    `ausencias?select=empleado_id,fecha_desde,fecha_hasta,tipo` +
    `&fecha_desde=lte.${ultimoDia}&fecha_hasta=gte.${primerDia}`
  )
).map((a) => ({ ...a, fecha_desde: soloElDia(a.fecha_desde), fecha_hasta: soloElDia(a.fecha_hasta) }));

const francos = (
  await leer<{ empleado_id: string; estado: string; fecha_descanso: string | null }>(
    `francos?select=empleado_id,estado,fecha_descanso&estado=eq.TOMADO` +
    `&fecha_descanso=gte.${primerDia}&fecha_descanso=lte.${ultimoDia}`
  )
).map((f) => ({ ...f, fecha_descanso: f.fecha_descanso ? soloElDia(f.fecha_descanso) : null }));

const pisadas = (
  await leer<{ empleado_id: string; dia: string; turno: string }>(
    `mant_programacion_pisadas?select=empleado_id,dia,turno&dia=gte.${primerDia}&dia=lte.${ultimoDia}`
  )
).map((p) => ({ empleado_id: p.empleado_id, dia: soloElDia(p.dia), turno: p.turno as Turno }));

console.log(
  `${padron.length} filas de padrón · ${referencias.length} referencias · ` +
  `${ausencias.length} ausencias · ${francos.length} francos · ${pisadas.length} pisadas\n`
);

let diferencias = 0;

for (const l of lunes) {
  const franja = franjaDeLaSemana(
    l, padron as never, nombres, referencias as never,
    ausencias as never, francos as never,
    pisadas.map((p) => ({ empleado_id: p.empleado_id, dia: p.dia }))
  );

  // El ciclo de la semana, calculado como lo hace `/api/mantenimiento/programacion`.
  const fila = laQueRige(referencias as never, l);
  const ref = fila ? comoReferencia(fila) : null;

  const delCiclo = new Map<string, Turno | null>();
  const vistos = new Set<string>();
  for (const dia of semanaDe(l)) {
    for (const p of padron) {
      if (!estaVigente(p as never, dia)) continue;
      if (vistos.has(p.empleadoId)) continue;
      vistos.add(p.empleadoId);
      delCiclo.set(p.empleadoId, ref ? (turnoDeLaPersona(ref, l, p as never) as Turno | null) : null);
    }
  }

  const deLaFranja = new Map<string, Turno | null>();
  for (const t of ["4-12", "8-16", "12-20"] as Turno[]) {
    for (const q of franja.porTurno?.[t] ?? []) deLaFranja.set(q.empleadoId, t);
  }
  for (const q of franja.sinTurno) deLaFranja.set(q.empleadoId, null);

  const enLaFranja = franja.porTurno
    ? Object.values(franja.porTurno).reduce((n, g) => n + g.length, 0) + franja.sinTurno.length
    : franja.sinTurno.length;

  console.log(
    `${l}  ${franja.porTurno ? "con ciclo" : "SIN CICLO"} · ` +
    `${enLaFranja} en la franja, ${delCiclo.size} en el ciclo · ` +
    `${franja.diasConPisada} día(s) con pisada`
  );

  for (const [id, turno] of delCiclo) {
    if (!deLaFranja.has(id)) {
      diferencias++;
      console.log(`    FALTA en la franja: ${nombres.get(id)} (ciclo: ${turno ?? "sin turno"})`);
      continue;
    }
    if (deLaFranja.get(id) !== turno) {
      diferencias++;
      console.log(
        `    DISTINTO: ${nombres.get(id)} · franja ${deLaFranja.get(id) ?? "sin turno"} ` +
        `· ciclo ${turno ?? "sin turno"}`
      );
    }
  }
  for (const id of deLaFranja.keys()) {
    if (!delCiclo.has(id)) {
      diferencias++;
      console.log(`    DE MÁS en la franja: ${nombres.get(id)}`);
    }
  }
}

console.log(`\n${diferencias === 0 ? "✓ cero diferencias" : `✗ ${diferencias} diferencia(s)`}`);
process.exit(diferencias === 0 ? 0 : 1);
