// Qué haría la próxima corrida con cada ciclo encadenado. **No escribe nada.**
//
// Existe porque la decisión es pura y tiene tests, pero lo que la alimenta son
// cuatro consultas a la base: leer el modelo no alcanza para saber si las
// columnas que se piden son las que hay. Esto corre las mismas funciones que el
// cron, con los datos de verdad, y dice qué pasaría.
//
//   npx tsx scripts/que-haria-el-ciclo.mts
//   npx tsx scripts/que-haria-el-ciclo.mts --desde=2026-11-01   ← «¿y si ya hubiera pasado?»
//
// `--desde` corre el piso del arranque hacia atrás **sólo en esta simulación**,
// para poder ver que el arranque agarra sin tener que esperar a que alguien
// cambie unos martillos. La corrida de verdad usa siempre la fecha en que se
// configuró el ciclo.

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { queSigueEnElCiclo, elCorteQueSigue, descripcionDeLaOT } =
  await import("../lib/mantenimiento/cicloDeOT.ts");
const { elArranqueDeUnCambio } = await import("../lib/mantenimiento/sospechaDeCambio.ts");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

const PISO_SIMULADO = process.argv
  .find((a) => a.startsWith("--desde="))?.slice("--desde=".length) ?? null;

const pedir = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T;
};

type Ciclo = {
  id: string; equipment_id: string; repeticiones: number; desde: string | null;
  vuelta_desde: number | null; creado_en: string;
  equipos: { code: string | null; is_active: boolean | null } | null;
  madre: { nombre: string; componente: string } | null;
  hija: { nombre: string; componente: string; periodo_dias: number | null } | null;
};

const ciclos = await pedir<Ciclo[]>(
  "mant_ciclos_de_ot?select=id,equipment_id,repeticiones,desde,vuelta_desde,creado_en," +
  "equipos:equipment_id(code,is_active),madre:tarea_madre_id(nombre,componente)," +
  "hija:tarea_hija_id(nombre,componente,periodo_dias)&activo=is.true"
);

const mias = await pedir<
  { ot_number: number; ciclo_id: string; ciclo_vuelta: number; estado: string | null;
    fecha_cierre: string | null; fecha_ejecucion: string | null; created_at_app: string | null }[]
>("ordenes_trabajo?select=ot_number,ciclo_id,ciclo_vuelta,estado,fecha_cierre,fecha_ejecucion,created_at_app&ciclo_id=not.is.null&limit=1000");

const sinArrancar = ciclos.filter((c) => !c.desde);
const piso = PISO_SIMULADO ?? sinArrancar.map((c) => c.creado_en.slice(0, 10)).sort()[0];
const cerradas = sinArrancar.length === 0 ? [] : await pedir<
  { ot_number: number; equipment_id: string | null; descripcion: string | null;
    fecha_cierre: string | null; ciclo_id: string | null }[]
>(`ordenes_trabajo?select=ot_number,equipment_id,descripcion,fecha_cierre,ciclo_id&equipment_id=in.(${sinArrancar.map((c) => c.equipment_id).join(",")})&fecha_cierre=gte.${piso}&limit=1000`);

console.log(`${ciclos.length} ciclo(s) activo(s) · ${mias.length} OT suyas · ${cerradas.length} cierre(s) desde ${piso ?? "—"}\n`);

for (const c of ciclos) {
  const code = c.equipos?.code ?? "(sin código)";
  console.log(`══ ${code} ══`);

  if (c.equipos?.is_active === false) { console.log("   el equipo está inactivo: no genera\n"); continue; }
  if (!c.madre || !c.hija) { console.log("   le falta la tarea madre o la hija\n"); continue; }

  const paraDecidir = {
    id: c.id, repeticiones: c.repeticiones,
    periodo_dias: c.hija.periodo_dias ?? null,
    desde: c.desde, vuelta_desde: c.vuelta_desde,
  };

  if (!paraDecidir.desde) {
    const arranque = elArranqueDeUnCambio(
      { id: c.id, equipment_id: c.equipment_id, componente: c.hija.componente,
        desdeCuandoMirar: PISO_SIMULADO ?? c.creado_en.slice(0, 10) },
      cerradas.filter((x) => x.equipment_id === c.equipment_id)
    );
    if (!arranque) {
      console.log(`   sin arrancar · espera un «${c.madre.nombre}» cerrado desde el ${c.creado_en.slice(0, 10)}\n`);
      continue;
    }
    console.log(`   ARRANCARÍA con la OT ${arranque.ot_number}, cerrada el ${arranque.desde}`);
    paraDecidir.desde = arranque.desde;
    paraDecidir.vuelta_desde = 0;
  }

  const suyas = mias.filter((o) => o.ciclo_id === c.id);
  const corte = elCorteQueSigue(paraDecidir, suyas);
  if (corte) {
    console.log(`   movería el corte a ${corte.desde} (vuelta ${corte.vuelta_desde})`);
    paraDecidir.desde = corte.desde;
    paraDecidir.vuelta_desde = corte.vuelta_desde;
  }

  const d = queSigueEnElCiclo(paraDecidir, suyas);
  if (d.que === "crear") {
    const esLaMadre = d.vuelta === 0;
    const tarea = esLaMadre ? c.madre : c.hija;
    console.log(`   CREARÍA una OT para el ${d.fecha_ejecucion}:`);
    console.log(`     «${descripcionDeLaOT({
      tarea: tarea.nombre, componente: tarea.componente, vuelta: d.vuelta,
      repeticiones: c.repeticiones,
      ultimoCambio: esLaMadre ? null : (paraDecidir.vuelta_desde === 0 ? paraDecidir.desde : null),
    })}»`);
  } else if (d.que === "esperar") console.log(`   espera a que se cierre la OT ${d.ot}`);
  else if (d.que === "trabado") console.log(`   TRABADO: ${d.porque}`);
  else console.log("   sin arrancar");

  console.log();
}
