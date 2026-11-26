/**
 * Los proveedores que están cargados dos veces en el padrón, con lo que cuelga
 * de cada fila.
 *
 *   npx tsx scripts/proveedores-duplicados.mts [salida.csv]
 *
 * **No escribe en la base.** Imprime el informe y, si se le da una ruta, deja
 * un CSV con una fila por proveedor para que una persona marque cuál queda.
 *
 * ## Qué cuenta como duplicado acá
 *
 * Dos cosas distintas, y la diferencia decide qué hacer con cada una:
 *
 * 1. **Mismo CUIT en dos filas.** Es la prueba dura: son la misma empresa.
 *    `cruzarProveedores()` no enlaza ningún CUIT repetido, así que mientras el
 *    par exista **ninguna de las dos** se conecta con Odoo.
 * 2. **El CUIT lo tiene una sola y la otra es la que usa la planilla.** No se
 *    ve como repetido porque la segunda tiene el CUIT en null, y es el caso que
 *    destapó el archivo que completó administración el 26/11/2026: 111 de los
 *    166 CUITs que trajo ya los tenía otra fila.
 *
 * ## Por qué esto no fusiona nada
 *
 * Porque cuál queda no lo puede decidir un script. La regla no es «la que
 * tiene más actividad»: es **la que nombra la planilla de Compras**, porque
 * `asegurarProveedores()` crea la fila que no encuentra por nombre, y borrar
 * esa la hace volver vacía en la corrida siguiente. Y a veces ninguna de las
 * dos lo es —«SINGLA, FASE 3» es una celda que nombró a dos proveedores—. Eso
 * lo sabe quien conoce la planilla, no el que lee la base.
 *
 * Por eso el CSV trae `claveProveedor` de cada fila: dos filas con la misma
 * clave son un duplicado **inerte** —la sincronización ya las unifica y le da
 * los datos a la que tiene CUIT—, y dos con claves distintas son dos
 * proveedores vivos que reciben datos por separado.
 */

import { readFileSync, writeFileSync } from "node:fs";

for (const linea of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const { claveProveedor } = await import("@/lib/compras/sheets");
const { normalizarCuit } = await import("@/lib/core/cuit");
const { nombresParecidos } = await import("@/lib/core/proveedores");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CABECERA = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };
const salida = process.argv.slice(2).find((a) => !a.startsWith("--"));

/** PostgREST corta en 1000 y no avisa. */
async function traerTodas<T>(consulta: string): Promise<T[]> {
  const todas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${consulta}`, {
      headers: { ...CABECERA, Range: `${desde}-${desde + 999}` },
    });
    const lote = await r.json();
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

/**
 * Las tablas que apuntan a un proveedor, de `node scripts/que-cuelga-de.mjs
 * proveedores`. Son las que habría que re-apuntar en una fusión, así que la
 * cuenta de acá es también el tamaño del trabajo.
 */
const TABLAS = [
  "calidad_carbonilleros", "calidad_envases_movimientos", "calidad_envases_proveedores",
  "calidad_movimientos", "cantera_contratistas", "compras_cotizaciones",
  "compras_requerimiento_proveedores", "compras_requerimientos", "despacho_recepcion_proveedores",
  "despacho_recepciones", "facturas_proveedor", "inventario_movimientos",
  "mant_contratista_lugares", "mant_cuadernos", "mant_partes_contratista",
  "ordenes_servicio", "ordenes_trabajo", "os_comparativas", "proveedores_odoo",
] as const;

const proveedores = await traerTodas<{ id: string; nombre: string; cuit: string | null; activo: boolean }>(
  "proveedores?select=id,nombre,cuit,activo"
);

const uso = new Map<string, Record<string, number>>();
for (const tabla of TABLAS) {
  const filas = await traerTodas<{ proveedor_id: string }>(`${tabla}?select=proveedor_id&proveedor_id=not.is.null`);
  for (const f of filas) {
    const r = uso.get(f.proveedor_id) ?? {};
    r[tabla] = (r[tabla] ?? 0) + 1;
    uso.set(f.proveedor_id, r);
  }
}
const cuantas = (id: string) => Object.values(uso.get(id) ?? {}).reduce((a, b) => a + b, 0);
const enlazado = (id: string) => (uso.get(id)?.["proveedores_odoo"] ?? 0) > 0;

/** Los grupos: por CUIT cuando los dos lo tienen, y por nombre parecido si no. */
const porCuit = new Map<string, typeof proveedores>();
for (const p of proveedores) {
  const c = normalizarCuit(p.cuit);
  if (!c) continue;
  porCuit.set(c, [...(porCuit.get(c) ?? []), p]);
}

const grupos: { motivo: string; clave: string; filas: typeof proveedores }[] = [];
const yaAgrupado = new Set<string>();

for (const [cuit, filas] of porCuit) {
  if (filas.length < 2) continue;
  grupos.push({ motivo: "mismo CUIT", clave: cuit, filas });
  for (const f of filas) yaAgrupado.add(f.id);
}

/*
 * Los parecidos por nombre van después y sólo con los que no quedaron ya
 * agrupados: un par que comparte CUIT es un hecho, y uno que comparte nombre
 * es una sospecha. Mezclarlos haría que la lista no se pueda leer de arriba
 * hacia abajo por grado de certeza.
 */
const sueltos = proveedores.filter((p) => !yaAgrupado.has(p.id));
for (const nombres of nombresParecidos(sueltos.map((p) => p.nombre))) {
  const filas = sueltos.filter((p) => nombres.includes(p.nombre));
  // Sólo interesa si al menos una tiene CUIT: si no, no hay nada que el par
  // le esté robando al cruce con Odoo.
  if (filas.length < 2 || !filas.some((f) => f.cuit)) continue;
  grupos.push({ motivo: "nombre parecido", clave: nombres[0], filas });
}

const deCuit = grupos.filter((g) => g.motivo === "mismo CUIT");
const deNombre = grupos.filter((g) => g.motivo === "nombre parecido");

console.log(`padrón: ${proveedores.length} proveedores · ${proveedores.filter((p) => p.cuit).length} con CUIT\n`);
console.log(`Mismo CUIT en dos o más filas: ${deCuit.length} grupos, ${deCuit.reduce((a, g) => a + g.filas.length, 0)} filas.`);
console.log(`   Mientras el par exista, el cruce con Odoo no enlaza a ninguna de las dos.\n`);
console.log(`Nombre parecido y sólo una con CUIT: ${deNombre.length} grupos, ${deNombre.reduce((a, g) => a + g.filas.length, 0)} filas.`);
console.log(`   Son sospechas, no hechos: confirmarlas es de quien conoce al proveedor.\n`);

for (const g of [...deCuit, ...deNombre].sort((a, b) => sumaDelGrupo(b) - sumaDelGrupo(a))) {
  const claves = new Set(g.filas.map((f) => claveProveedor(f.nombre)));
  const inerte = claves.size === 1;
  console.log(`${g.motivo}  ${g.clave}${inerte ? "   (la sincronización ya las unifica)" : ""}`);
  for (const f of g.filas) {
    console.log(
      `   ${String(cuantas(f.id)).padStart(5)} filas  ${enlazado(f.id) ? "enlazado" : "        "}  ` +
        `${f.cuit ? "con CUIT" : "sin CUIT"}  ${f.activo ? "" : "(inactivo) "}"${f.nombre}"`
    );
  }
}

function sumaDelGrupo(g: { filas: typeof proveedores }) {
  return g.filas.reduce((a, f) => a + cuantas(f.id), 0);
}

if (salida) {
  const campo = (v: unknown) => {
    const s = String(v ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [
    [
      "grupo", "motivo", "QUE QUEDA (marcar una por grupo)", "id", "nombre",
      "clave de la planilla", "cuit", "enlazado a odoo", "activo", "filas que cuelgan",
      ...TABLAS,
    ].join(";"),
  ];
  let n = 0;
  for (const g of [...deCuit, ...deNombre].sort((a, b) => sumaDelGrupo(b) - sumaDelGrupo(a))) {
    n++;
    for (const f of g.filas) {
      lineas.push(
        [
          n, g.motivo, "", f.id, f.nombre, claveProveedor(f.nombre), f.cuit ?? "",
          enlazado(f.id) ? "si" : "", f.activo ? "si" : "no", cuantas(f.id),
          ...TABLAS.map((t) => uso.get(f.id)?.[t] ?? 0),
        ].map(campo).join(";")
      );
    }
  }
  // BOM: sin él Excel en castellano abre los acentos rotos.
  writeFileSync(salida, "﻿" + lineas.join("\r\n") + "\r\n", "utf8");
  console.log(`\n${salida}: ${n} grupos.`);
}
