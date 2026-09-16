// Escribe `lib/asistente/catalogo.generado.json` leyendo el esquema real.
//
//   npm run catalogo
//
// Se genera y no se escribe a mano porque el esquema está nombrado en tres
// épocas: `empleados` tiene nombre/apellido/activo y `equipos` tiene
// name/code/is_active, que viene del sistema en inglés que renombró la 029.
// Escrito a mano, una columna se copia mal una vez y el error queda escondido
// — y un SQL con la columna equivocada no falla: devuelve filas, sólo que las
// que no son.
//
// Al final reporta las tablas que `lib/asistente/modulos.ts` no mapeó. Esas no
// se le muestran a nadie: el mapa cierra por defecto. El reporte existe para
// que la tabla nueva de la semana que viene no quede invisible para siempre.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { MODULO_DE_TABLA } from "../lib/asistente/modulos.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Corre una consulta por la misma puerta que usa el asistente. */
async function consultar<T>(consulta: string): Promise<T[]> {
  const { data, error } = await db.rpc("asistente_consulta", { consulta, tope: 1000 }, { get: true });
  if (error) {
    console.error("No se pudo leer el esquema:", error.message);
    process.exit(1);
  }
  return (data ?? []) as T[];
}

interface ColumnaCruda {
  columna: string;
  tipo: string;
  nuleable: string;
}

interface FilaTabla {
  tabla: string;
  columnas: ColumnaCruda[];
}

// `asistente_consulta` corta en 1000 filas (mismo límite que PostgREST) y hay
// 1.184 columnas en 102 tablas: pedidas una por fila, la cola se corta y
// tablas enteras desaparecen sin aviso — pasó al escribir este script. Se
// agrega con `json_agg` para que cada tabla sea una sola fila: 102 filas, muy
// por debajo del tope.
const filas = await consultar<FilaTabla>(`
  select
    c.table_name as tabla,
    json_agg(
      json_build_object(
        'columna', c.column_name,
        'tipo', c.udt_name,
        'nuleable', c.is_nullable
      )
      order by c.ordinal_position
    ) as columnas
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  group by c.table_name
  order by c.table_name
`);

const tablas: Record<string, { columna: string; tipo: string; nuleable: boolean }[]> = {};
for (const f of filas) {
  tablas[f.tabla] = f.columnas.map((c) => ({
    columna: c.columna,
    // Un tipo array viene como `_text`; se muestra como `text[]`, que es como
    // se escribe en una consulta.
    tipo: c.tipo.startsWith("_") ? `${c.tipo.slice(1)}[]` : c.tipo,
    nuleable: c.nuleable === "YES",
  }));
}

// Los valores de cada enum: sin esto el modelo inventa estados, y un estado
// inventado no da error — da cero filas.
const enums = await consultar<{ nombre: string; valor: string }>(`
  select t.typname as nombre, e.enumlabel as valor
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   order by t.typname, e.enumsortorder
`);

const valoresDeEnum: Record<string, string[]> = {};
for (const e of enums) (valoresDeEnum[e.nombre] ??= []).push(e.valor);

const destino = new URL("../lib/asistente/catalogo.generado.json", import.meta.url);
writeFileSync(destino, JSON.stringify({ tablas, enums: valoresDeEnum }, null, 2) + "\n", "utf8");

console.log(`Escrito: ${Object.keys(tablas).length} tablas, ${Object.keys(valoresDeEnum).length} enums.`);

const sinMapear = Object.keys(tablas).filter((t) => !MODULO_DE_TABLA[t]);
if (sinMapear.length) {
  console.log(`\nSin mapear en lib/asistente/modulos.ts (${sinMapear.length}) — no se le muestran a nadie:`);
  for (const t of sinMapear) console.log(`  ${t}`);
}

const fantasma = Object.keys(MODULO_DE_TABLA).filter((t) => !tablas[t]);
if (fantasma.length) {
  console.log(`\nEn el mapa pero ya no en la base (${fantasma.length}) — sobran:`);
  for (const t of fantasma) console.log(`  ${t}`);
}
