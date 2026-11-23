// Qué dicen hoy los indicadores por sector del tablero de Mantenimiento.
// **No escribe nada.**
//
// Existe porque las cuentas son puras y tienen tests, pero lo que las alimenta
// son tres lecturas de la base: leer el modelo no alcanza para saber si las
// columnas que se piden son las que hay. Esto corre **las mismas funciones que
// la ruta**, con los datos de verdad, y dice qué va a dibujar la pantalla —que
// está detrás del login y no se puede abrir en un navegador.
//
//   npx tsx scripts/indicadores-por-sector.mts
//   npx tsx scripts/indicadores-por-sector.mts --hasta=2026-11-19   ← la foto del spec
//
// `--hasta` sirve para reproducir una medición vieja: la del spec es del
// 19/11/2026 y los números se mueven con cada orden que se carga.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { indicadoresPorSectorDeLaPlanta } from "../lib/mantenimiento/porSectorDatos.ts";
import { resumirLaSemana, hoyISO, type DeLaSemana } from "../lib/mantenimiento/alertas.ts";
import { duracionLegible } from "../lib/mantenimiento/historialDeSectores.ts";
import {
  conComa, diasCorridos, porcentajeDeConfiabilidad,
} from "../lib/mantenimiento/mtbfVista.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const hasta = process.argv.find((a) => a.startsWith("--hasta="))?.slice(8) ?? hoyISO();
console.log(`\nIndicadores por sector al ${hasta}\n${"=".repeat(60)}`);

const d = await indicadoresPorSectorDeLaPlanta(sb, hasta);

console.log("\n── Fiabilidad por sector ──────────────────────────────────");
console.log(
  "sector".padEnd(26) + "empresa".padEnd(13) +
  "fallas".padStart(7) + "obs".padStart(6) + "MTBF".padStart(9) +
  "rep".padStart(5) + "MTTR".padStart(9) + "MTTF".padStart(9) + "R(7)".padStart(8)
);
for (const f of d.filas) {
  console.log(
    f.sector.padEnd(26) + f.empresa.padEnd(13) +
    String(f.fallas).padStart(7) + String(f.diasObservados).padStart(6) +
    diasCorridos(f.mtbf).padStart(9) + String(f.reparaciones).padStart(5) +
    (f.mttr === null ? "—" : `${conComa(f.mttr, 1)} h`).padStart(9) +
    diasCorridos(f.mttf).padStart(9) +
    porcentajeDeConfiabilidad(f.confiabilidad).padStart(8)
  );
}
console.log(`\n  ${d.filas.length} sectores con fallas · ${d.sectores.length} de planta en el catálogo`);
console.log(`  sin MTTR: ${d.filas.filter((f) => f.mttr === null).length} · sin MTBF: ${d.filas.filter((f) => f.mtbf === null).length}`);
console.log(`  correctivas del año sin sector: ${d.sinSector}`);

console.log("\n── Confiabilidad mes a mes (los 6 que más fallan) ─────────");
const meses = d.filas[0]?.porMes.map((m) => m.etiqueta) ?? [];
console.log("sector".padEnd(26) + meses.map((m) => m.padStart(7)).join(""));
for (const f of d.filas.slice(0, 6)) {
  console.log(
    f.sector.padEnd(26) +
    f.porMes.map((p) => porcentajeDeConfiabilidad(p.confiabilidad).padStart(7)).join("")
  );
}
const huecos = d.filas.slice(0, 6).reduce(
  (a, f) => a + f.porMes.filter((p) => p.confiabilidad === null).length, 0
);
console.log(`\n  huecos en esos 6 × ${meses.length} puntos: ${huecos}` +
  (huecos === 0 ? "  ← la ventana móvil no deja ninguno" : "  ← mirar cuáles y por qué"));

console.log("\n── Órdenes por mes y por sector ───────────────────────────");
for (const mes of d.ordenesPorMes) {
  const total = Object.values(mes.porSector).reduce((a, b) => a + b, 0);
  console.log(`  ${mes.etiqueta.padEnd(8)} ${String(total).padStart(4)} órdenes en ${Object.keys(mes.porSector).length} sectores`);
}

console.log("\n── Paradas de sector ──────────────────────────────────────");
console.log(`  se registra desde: ${d.paradas.desde ?? "nunca cambió ninguno"}`);
for (const s of d.paradas.sectores) {
  console.log(
    `  ${s.sector.padEnd(26)} ${String(s.veces).padStart(2)} parada(s) · ` +
    `${duracionLegible(s.fueraDeServicioMs).padEnd(16)}` +
    (s.paradoDesde ? ` · PARADO AHORA desde ${s.paradoDesde.slice(0, 10)}` : "")
  );
}

console.log("\n── Atrasadas de esta semana ───────────────────────────────");
// La misma lectura que `page.tsx`, con las mismas columnas y el mismo `.or`.
const { data: candidatas } = await sb
  .from("ordenes_trabajo")
  .select("ot_number, estado, proxima_fecha, fecha_ejecucion, sector_id, sector_raw, equipment_id, descripcion, equipo_raw")
  .or(`estado.eq.ATRASADO,proxima_fecha.lt.${hasta}`)
  .limit(500);

const semana = resumirLaSemana((candidatas ?? []) as DeLaSemana[], hasta);
console.log(`  ${semana.total} de ${semana.deTodas} atrasadas vencían entre el ${semana.desde} y el ${hasta}`);
for (const o of semana.ordenes as any[]) {
  console.log(`    #${o.ot_number}  ${o.fecha_ejecucion}  ${String(o.sector_raw ?? "—").padEnd(24)} ${o.equipo_raw ?? "—"}`);
}
console.log(`  por equipo: ${semana.porEquipo.length} grupos · por sector: ${semana.porSector.length} grupos`);
for (const g of semana.porEquipo) {
  console.log(`    ${String(g.cuantas).padStart(2)} ${g.nombre}${g.id ? "" : "   (sin id: no enlaza)"}`);
}

console.log();
