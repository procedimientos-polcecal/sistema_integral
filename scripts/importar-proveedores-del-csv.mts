/**
 * Mete en el padrón el CUIT y la razón social del CSV que completó una persona.
 *
 *   npx tsx scripts/importar-proveedores-del-csv.mts <archivo.csv>            # ensayo
 *   npx tsx scripts/importar-proveedores-del-csv.mts <archivo.csv> --aplicar
 *
 * Es la vuelta del listado que se exportó el 26/11/2026: 311 proveedores sin
 * CUIT, con dos columnas en blanco para completar. **Sólo escribe `cuit` y
 * `razon_social`**, nunca el nombre.
 *
 * La decisión de qué se escribe vive en `lib/odoo/padronDesdeElArchivo.ts`, que
 * es pura y está testeada, y el porqué de cada rechazo está ahí. Acá va el
 * viaje, el ensayo y la escritura.
 *
 * **Por defecto no escribe nada.** El informe es el producto principal: lo que
 * no se puede escribir —un CUIT que ya tiene otra fila— no es un fallo del
 * archivo sino el padrón diciendo que tiene a la misma empresa dos veces, y eso
 * se resuelve fusionando, no escribiendo.
 *
 * Las columnas se buscan **por el nombre del encabezado y no por la posición**:
 * el archivo pasa por Excel y por una persona, y una columna insertada en el
 * medio haría que el CUIT se lea de la de al lado sin ningún error.
 */

import { readFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const { filasDelCsv, loQueCambiaElArchivo } = await import("@/lib/odoo/padronDesdeElArchivo");
type FilaDelArchivo = import("@/lib/odoo/padronDesdeElArchivo").FilaDelArchivo;

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CABECERA = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes("--aplicar");
const archivo = argumentos.find((a) => !a.startsWith("--"));

if (!archivo) {
  console.error("Falta el archivo: npx tsx scripts/importar-proveedores-del-csv.mts <archivo.csv>");
  process.exit(1);
}

/** PostgREST corta en 1000 y no avisa. */
async function traerTodas<T>(consulta: string): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${consulta}`, {
      headers: { ...CABECERA, Range: `${desde}-${desde + 999}` },
    });
    const lote = await r.json();
    // Un objeto con `message` es un error —una columna que no existe, por
    // ejemplo—, y tratarlo como lista vacía diría «padrón: 0 proveedores», que
    // es indistinguible de un padrón vacío.
    if (!Array.isArray(lote)) {
      throw new Error(
        `La base contestó: ${(lote as { message?: string })?.message ?? JSON.stringify(lote).slice(0, 200)}`
      );
    }
    if (!lote.length) break;
    todas.push(...(lote as T[]));
    if (lote.length < 1000) break;
  }
  return todas;
}

const crudas = filasDelCsv(readFileSync(archivo, "utf8"));
if (!crudas.length) throw new Error(`${archivo} no tiene ni una fila.`);

const encabezado = crudas[0].map((c) => c.trim().toLowerCase());
const columna = (...nombres: string[]) => {
  const i = encabezado.findIndex((c) => nombres.includes(c));
  if (i < 0) throw new Error(`El archivo no tiene la columna «${nombres[0]}». Trae: ${encabezado.join(", ")}`);
  return i;
};
const iId = columna("id");
const iNombre = columna("nombre");
const iCuit = columna("cuit");
const iRazon = columna("razon social", "razón social");

const filas: FilaDelArchivo[] = crudas.slice(1).map((f, i) => ({
  linea: i + 2,
  id: (f[iId] ?? "").trim(),
  nombre: (f[iNombre] ?? "").trim(),
  cuit: (f[iCuit] ?? "").trim() || null,
  razonSocial: (f[iRazon] ?? "").trim() || null,
}));

const padron = await traerTodas<{ id: string; nombre: string; cuit: string | null; razon_social: string | null }>(
  "proveedores?select=id,nombre,cuit,razon_social"
);

const informe = loQueCambiaElArchivo(
  filas,
  padron.map((p) => ({ id: p.id, nombre: p.nombre, cuit: p.cuit, razonSocial: p.razon_social }))
);

console.log(`archivo: ${filas.length} filas · padrón: ${padron.length} proveedores, ${padron.filter((p) => p.cuit).length} con CUIT\n`);
console.log(`A GUARDAR: ${informe.aGuardar.length}`);
for (const g of informe.aGuardar) {
  console.log(`   ${g.cuit}  ${g.nombre}${g.razonSocial ? `  →  ${g.razonSocial}` : "  (sin razón social)"}`);
}

if (informe.cuitDeOtro.length) {
  console.log(
    `\nNO se escriben ${informe.cuitDeOtro.length}: ese CUIT ya lo tiene otra fila.\n` +
      `Es la misma empresa cargada dos veces. Escribirlo dejaría a las dos fuera del cruce\n` +
      `con Odoo, que no enlaza ningún CUIT repetido: hay que fusionar el par.`
  );
  for (const c of informe.cuitDeOtro) {
    console.log(`   ${c.cuit}  "${c.nombre}" (línea ${c.linea})  ←→  ${c.otras.map((o) => `"${o.nombre}"`).join(" | ")}`);
  }
}

const listar = (titulo: string, lineas: string[]) => {
  if (!lineas.length) return;
  console.log(`\n${titulo}`);
  for (const l of lineas) console.log(`   ${l}`);
};

listar(
  `CUIT con el dígito verificador mal (${informe.cuitInvalido.length}): casi siempre es un dígito tipeado de más o de menos.`,
  informe.cuitInvalido.map((c) => `${c.cuit}  "${c.nombre}" (línea ${c.linea})`)
);
listar(
  `Ya lo tenían (${informe.yaLoTenia.length}): nada que hacer.`,
  informe.yaLoTenia.map((c) => `${c.cuit}  "${c.nombre}"`)
);
listar(
  `Filas sin id (${informe.sinId.length}): no se enlazan por nombre. Si son proveedores nuevos, hay que darlos de alta.`,
  informe.sinId.map((c) => `"${c.nombre}"  CUIT ${c.cuit ?? "—"} (línea ${c.linea})`)
);
listar(
  `Ids que ya no están en el padrón (${informe.noEstaEnElPadron.length}).`,
  informe.noEstaEnElPadron.map((c) => `${c.id}  "${c.nombre}" (línea ${c.linea})`)
);
listar(
  `Nombres distintos a los de la base (${informe.nombreCambiado.length}): NO se escriben. ` +
    `El nombre es con lo que la sincronización de Compras reconoce al proveedor.`,
  informe.nombreCambiado.map((c) => `"${c.enLaBase}"  →  "${c.enElArchivo}" (línea ${c.linea})`)
);

if (!aplicar) {
  console.log("\nEnsayo: no se escribió nada. Con --aplicar se guardan.");
  process.exit(0);
}

let guardados = 0;
const fallaron: string[] = [];

for (const g of informe.aGuardar) {
  // La razón social viaja con el CUIT y sólo si el archivo la trajo: un `null`
  // explícito borraría la que ya estuviera guardada.
  const cambios: Record<string, string> = { cuit: g.cuit };
  if (g.razonSocial) cambios.razon_social = g.razonSocial;

  const r = await fetch(`${URL_BASE}/rest/v1/proveedores?id=eq.${g.proveedorId}`, {
    method: "PATCH",
    headers: { ...CABECERA, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(cambios),
  });
  if (r.ok) guardados++;
  else fallaron.push(`${g.nombre}: HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
}

console.log(`\nguardados: ${guardados} de ${informe.aGuardar.length}`);
for (const f of fallaron) console.log(`  FALLÓ ${f}`);
