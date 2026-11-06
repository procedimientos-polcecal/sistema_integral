// ¿Qué borrarían las tres sincronizaciones de Mantenimiento si corrieran hoy?
// **Sólo lee.** No toca la planilla ni la base.
//
// POR QUÉ EXISTE
//
// El borrado de lo que la planilla dejó de tener corre **cada quince minutos**
// desde `.github/workflows/mantenimiento-sync.yml`, sin que nadie apriete
// nada. Esto contesta antes la única pregunta que importa: cuántas filas de la
// base no están hoy en la planilla, y cuáles.
//
// La primera corrida puede destapar un acumulado —filas que alguien sacó hace
// meses y que el sistema nunca notó—, que es justamente lo que el borrado
// viene a arreglar. Mejor verlo acá que en la auditoría al día siguiente.
//
// Parsea con **las mismas funciones que usan las sincronizaciones**
// (`filaDeOrden`, `filaDeAviso`, `filaDeOS`). Un parseo propio daría un número
// parecido y equivocado, que para esto es peor que no tenerlo.
//
// Uso:
//   npx tsx scripts/ensayo-borrado-mantenimiento.mts
//
// Necesita en `.env.local` (o en el entorno) los ids de las tres planillas:
//   GOOGLE_SHEETS_OT_ID, GOOGLE_SHEETS_AVISOS_ID, GOOGLE_SHEETS_OS_ID
// y `GOOGLE_SERVICE_ACCOUNT_JSON`, que ya está. Las pestañas se pueden
// cambiar con GOOGLE_SHEETS_OT_TAB y GOOGLE_SHEETS_AVISOS_TAB, igual que en
// producción.
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { leerValores } = await import("../lib/core/sheets.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { queSeBorra, comoSeCuenta } = await import("../lib/core/borradoDeEspejo.ts");
const { filaDeOrden } = await import("../lib/mantenimiento/ordenes.ts");
const { filaDeAviso } = await import("../lib/mantenimiento/avisos.ts");
const { OS_PESTANAS, mapearEncabezados, filaDeOS } = await import("../lib/mantenimiento/os.ts");

const sb = createAdminClient();

/** Una fila de la base, con lo poco que hace falta para decidir. */
type Fila = {
  id: string;
  app_created: boolean | null;
  sheets_row: number | null;
  [clave: string]: unknown;
};

/**
 * El ensayo de un espejo: qué hay en la planilla, qué hay en la base, y qué
 * pasaría. Devuelve cuántas se borrarían, o `null` si no se pudo mirar.
 */
async function ensayar(opciones: {
  titulo: string;
  tabla: string;
  numero: string;
  creada: string;
  /** Los números que la planilla trae hoy, ya parseados como los parsea el sync. */
  enLaPlanilla: Set<string | number>;
  /** Pestañas que no se pudieron leer: con una sola, no se borra nada. */
  sinLeer?: string[];
}) {
  const { titulo, tabla, numero, creada, enLaPlanilla, sinLeer = [] } = opciones;

  const enLaBase = await traerTodo<Fila>((desde, hasta) =>
    sb.from(tabla).select(`id, ${numero}, ${creada}, sheets_row, app_created`)
      .range(desde, hasta).returns<Fila[]>()
  );

  const sobran = enLaBase.filter((f) => !enLaPlanilla.has(f[numero] as string | number));

  const veredicto = queSeBorra({
    candidatas: sobran.map((f) => ({
      id: f.id,
      numero: (f[numero] ?? null) as string | number | null,
      nuncaEstuvoEnLaPlanilla: f.app_created === true && f.sheets_row === null,
      editadaEnLaApp: false,
      creadaEn: (f[creada] ?? null) as string | null,
    })),
    totalEnLaBase: enLaBase.length,
    // Un arranque en el futuro: nada se salva por haber nacido tarde, así que
    // lo que sale es el peor caso.
    inicioDeLaCorrida: new Date(Date.now() + 60_000).toISOString(),
    fuentesSinLeer: sinLeer,
  });

  console.log(`\n### ${titulo}`);
  console.log(`  En la planilla: ${enLaPlanilla.size} · en la base: ${enLaBase.length}`);
  console.log(`  En la base y no en la planilla: ${sobran.length}`);
  for (const p of veredicto.protegidas.slice(0, 5)) {
    console.log(`     protegida ${p.fila.numero}: ${p.motivo}`);
  }
  console.log(`  → ${comoSeCuenta(veredicto) ?? "No habría nada que borrar."}`);
  if (veredicto.borrar.length > 0 && veredicto.borrar.length <= 40) {
    console.log(`     ${veredicto.borrar.map((f) => f.numero).join(", ")}`);
  }
  return veredicto.borrar.length;
}

/* ── Órdenes de trabajo ─────────────────────────────────────────────────── */

if (!process.env.GOOGLE_SHEETS_OT_ID) {
  console.log("\n### Órdenes de trabajo: falta GOOGLE_SHEETS_OT_ID, no se puede ensayar");
} else {
  const filas = await leerValores(
    process.env.GOOGLE_SHEETS_OT_ID,
    process.env.GOOGLE_SHEETS_OT_TAB ?? "OT",
    { sinFormato: true }
  );
  const nros = new Set<string | number>();
  for (let i = 1; i < filas.length; i++) {
    const orden = filaDeOrden(filas[i], i + 1);
    if (orden) nros.add(orden.ot_number);
  }
  await ensayar({
    titulo: "Órdenes de trabajo", tabla: "ordenes_trabajo",
    numero: "ot_number", creada: "created_at_app", enLaPlanilla: nros,
  });
}

/* ── Avisos ─────────────────────────────────────────────────────────────── */

if (!process.env.GOOGLE_SHEETS_AVISOS_ID) {
  console.log("\n### Avisos: falta GOOGLE_SHEETS_AVISOS_ID, no se puede ensayar");
} else {
  const filas = await leerValores(
    process.env.GOOGLE_SHEETS_AVISOS_ID,
    process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS",
    { sinFormato: true }
  );
  const nros = new Set<string | number>();
  for (let i = 1; i < filas.length; i++) {
    const aviso = filaDeAviso(filas[i], i + 1);
    if (aviso) nros.add(aviso.oa_number);
  }
  await ensayar({
    titulo: "Avisos", tabla: "avisos",
    numero: "oa_number", creada: "created_at", enLaPlanilla: nros,
  });
}

/* ── Órdenes de servicio ────────────────────────────────────────────────── */

if (!process.env.GOOGLE_SHEETS_OS_ID) {
  console.log("\n### Órdenes de servicio: falta GOOGLE_SHEETS_OS_ID, no se puede ensayar");
} else {
  const nros = new Set<string | number>();
  const sinLeer: string[] = [];
  for (const pestana of OS_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(process.env.GOOGLE_SHEETS_OS_ID, pestana, { sinFormato: true });
    } catch {
      sinLeer.push(pestana);
      continue;
    }
    if (filas.length < 2) continue;
    const idx = mapearEncabezados(filas[0]);
    for (let i = 1; i < filas.length; i++) {
      const os = filaDeOS(filas[i], idx, pestana, i + 1);
      if (os) nros.add(os.os_number);
    }
  }
  await ensayar({
    titulo: "Órdenes de servicio", tabla: "ordenes_servicio",
    numero: "os_number", creada: "created_at", enLaPlanilla: nros, sinLeer,
  });
}

console.log("\nNo se escribió nada: esto sólo lee la planilla y la base.");
