// ¿Qué borraría la sincronización de Compras si corriera hoy? **Sólo lee.**
//
// POR QUÉ EXISTE
//
// Desde el 18/10/2026 las sincronizaciones borran lo que la planilla dejó de
// tener, y un borrado no se deshace. Esto contesta la única pregunta que
// importa antes de encender eso en producción: cuántos RI de la base no están
// hoy en la planilla, y cuáles.
//
// `compras_requerimientos` es la peor de las cuatro para equivocarse —2.159
// filas, la lectura más enredada, y 714 de cada 1.000 con cambios hechos desde
// el sistema—, así que es la que se ensaya.
//
// Uso:
//   npx tsx scripts/ensayo-borrado-compras.mts
//
// No escribe en la planilla ni en la base. Necesita `GOOGLE_SERVICE_ACCOUNT_JSON`
// en `.env.local`; el id de la planilla sale de ahí o del valor documentado en
// docs/VARIABLES-VERCEL.md.
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
// El de producción, documentado en docs/VARIABLES-VERCEL.md. Sólo se lee.
process.env.GOOGLE_SHEETS_COMPRAS_ID ??= "1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80";

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { obtenerToken, SCOPE_SHEETS_LECTURA } = await import("../lib/core/google.ts");
const { indexarColumnas, esPestanaDeArea } = await import("../lib/compras/sheets.ts");
const { esFilaPlantilla } = await import("../lib/compras/constants.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { queSeBorra, comoSeCuenta } = await import("../lib/core/borradoDeEspejo.ts");

const ID = process.env.GOOGLE_SHEETS_COMPRAS_ID;
const HOJA_MASTER = "Requerimientos internos";

async function pedir(ruta: string) {
  const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${ID}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── 1. Qué RI tiene hoy la planilla ────────────────────────────────────── */

const props = await pedir("?fields=sheets.properties.title");
const pestanas: string[] = (props.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
const aLeer = [
  ...(pestanas.includes(HOJA_MASTER) ? [HOJA_MASTER] : []),
  ...pestanas.filter(esPestanaDeArea),
];
console.log(`Pestañas que la importación leería: ${aLeer.join(", ")}`);

const enLaPlanilla = new Set<number>();
for (const pestana of aLeer) {
  const json = await pedir(`/values/${encodeURIComponent(pestana)}`);
  const filas = (json.values ?? []) as string[][];
  if (filas.length < 2) {
    console.log(`  ${pestana}: vacía`);
    continue;
  }
  const idx = indexarColumnas(filas[0]);
  let cuantos = 0;
  for (let f = 1; f < filas.length; f++) {
    const bruto = idx.nro_ri >= 0 ? filas[f][idx.nro_ri] : undefined;
    const nro = Number(String(bruto ?? "").replace(/[^0-9]/g, ""));
    if (!nro || isNaN(nro) || esFilaPlantilla(nro)) continue;
    enLaPlanilla.add(nro);
    cuantos++;
  }
  console.log(`  ${pestana}: ${cuantos} filas con RI`);
}
console.log(`\nRI distintos en la planilla: ${enLaPlanilla.size}`);

/* ── 2. Qué tiene la base ───────────────────────────────────────────────── */

const sb = createAdminClient();
type Fila = {
  id: string; nro_ri: number; origen: string | null;
  sheets_fila: number | null; editado_en_app: boolean | null; created_at: string | null;
};
const enLaBase = await traerTodo<Fila>((desde, hasta) =>
  sb.from("compras_requerimientos")
    .select("id, nro_ri, origen, sheets_fila, editado_en_app, created_at")
    .range(desde, hasta)
);
console.log(`RI en la base: ${enLaBase.length}`);

/* ── 3. Qué pasaría ─────────────────────────────────────────────────────── */

const sobran = enLaBase.filter((r) => !enLaPlanilla.has(r.nro_ri));
const veredicto = queSeBorra({
  candidatas: sobran.map((r) => ({
    id: r.id,
    numero: r.nro_ri,
    nuncaEstuvoEnLaPlanilla: r.origen === "app" && r.sheets_fila === null,
    editadaEnLaApp: r.editado_en_app === true,
    creadaEn: r.created_at,
  })),
  totalEnLaBase: enLaBase.length,
  // Un arranque en el futuro: nada queda protegido por haber nacido tarde, así
  // que el número que sale es el peor caso.
  inicioDeLaCorrida: new Date(Date.now() + 60_000).toISOString(),
});

console.log(`\nEn la base y no en la planilla: ${sobran.length}`);
console.log(`Protegidas: ${veredicto.protegidas.length}`);
for (const p of veredicto.protegidas.slice(0, 10)) console.log(`   RI ${p.fila.numero}: ${p.motivo}`);
console.log(`\n${comoSeCuenta(veredicto) ?? "No habría nada que borrar."}`);
if (veredicto.borrar.length > 0 && veredicto.borrar.length <= 40) {
  console.log("Los RI:", veredicto.borrar.map((f) => f.numero).sort((a, b) => Number(a) - Number(b)).join(", "));
}
