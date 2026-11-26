/**
 * Fusionar en tanda los grupos de «nombre parecido» del padrón de proveedores.
 *
 *   npx tsx scripts/fusionar-duplicados-de-nombre.mts             # ensayo
 *   npx tsx scripts/fusionar-duplicados-de-nombre.mts --aplicar
 *
 * Es la pantalla `/compras/proveedores/duplicados` corrida de una vez, para
 * los 101 grupos donde una fila tiene CUIT y la otra no. Hace exactamente lo
 * mismo que `POST /api/compras/proveedores/fusionar`: audita, mueve las 19
 * tablas, borra, y recién después le escribe a la que queda lo que le faltaba.
 *
 * ── LA REGLA, Y POR QUÉ ES TAN ANGOSTA ──────────────────────────
 *
 * **Sólo borra fichas que no tienen CUIT, y sólo cuando la que queda es la
 * que nombra la planilla (o la planilla no nombra a ninguna).** Todo lo demás
 * se lista para que una persona lo decida en la pantalla.
 *
 * Las dos mitades de esa regla responden a dos cosas distintas:
 *
 * 1. **«Nombre parecido» es una sospecha, no un hecho.** El grupo de «mismo
 *    CUIT» está probado; éste lo arma un comparador de cadenas. Una ficha con
 *    CUIT es una empresa identificada, y borrar una identificada por parecido
 *    de nombre es justo la clase de error que no se nota: el dato aparece
 *    bajo la empresa que no es. Por eso, si la que se iría tiene CUIT, el
 *    grupo queda para confirmar — sean dos CUIT distintos o no.
 * 2. **El nombre decide si la ficha borrada vuelve.** `asegurarProveedores()`
 *    crea la que no encuentra por nombre, vacía y sin CUIT, en la corrida
 *    siguiente, y los pedidos nuevos caen otra vez ahí. Si la celda de la
 *    planilla escribe el nombre de la que se va, borrarla no resuelve nada.
 *
 * Se podría evitar ese segundo caso dejando viva a la de la planilla, que
 * **hereda** el CUIT de la otra —el único campo que nunca se copia es el
 * `nombre`—. Termina igual: una sola ficha, con su CUIT. Pero para eso hay
 * que borrar una ficha que **sí** tiene CUIT, que es exactamente lo que la
 * regla 1 no hace sin que alguien mire. Al 26/11/2026 son 10 y van a la mano.
 *
 * ── LO QUE TAMPOCO TOCA ─────────────────────────────────────────
 *
 * - **Los grupos con dos o más nombres en la planilla**: hay que unificar la
 *   columna PROVEEDOR de allá primero.
 * - **Los grupos de «mismo CUIT»**, que son otra cosa: ahí las dos fichas ya
 *   están desconectadas de Odoo y conviene mirarlas de a una.
 * - **Los choques que frenan** (`cantera_contratistas`,
 *   `despacho_recepcion_proveedores`), donde `proveedor_id` es la clave entera
 *   y borrar la fila pierde datos propios.
 *
 * Y si no se puede leer la planilla, **no hace nada**: sin esa columna la
 * segunda mitad de la regla no se puede evaluar.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const RUTA_ENV = process.env.ENV_PATH ?? ".env.local";
for (const linea of readFileSync(RUTA_ENV, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

// El id está documentado en docs/VARIABLES-VERCEL.md: en Vercel existe, en
// `.env.local` no siempre.
process.env.GOOGLE_SHEETS_COMPRAS_ID ??= "1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80";

const { gruposDeDuplicados } = await import("../lib/core/duplicadosDeProveedor.ts");
const { TABLAS_QUE_APUNTAN, camposQueSeMudan, problemaParaFusionar } = await import(
  "../lib/core/fusionDeProveedores.ts"
);
const { contarNombresDeLaPlanilla, loQueDiceLaPlanilla } = await import(
  "../lib/compras/proveedoresDeLaPlanilla.ts"
);
const { cuitEsValido, normalizarCuit } = await import("../lib/odoo/proveedores.ts");
const { claveDeProveedor } = await import("../lib/core/proveedores.ts");
const { leerVariosRangos, listarPestanas, letraDeColumna } = await import("../lib/core/sheets.ts");
const { esPestanaDeArea, indexarColumnas } = await import("../lib/compras/sheets.ts");

const aplicar = process.argv.includes("--aplicar");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** Paginado a mano: PostgREST corta en 1000 y no avisa. */
async function todo<T>(tabla: string, columnas: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from(tabla).select(columnas).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...((data ?? []) as T[]));
    if ((data?.length ?? 0) < 1000) return filas;
  }
}

interface Prov {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string | null;
  activo: boolean;
  [k: string]: unknown;
}

console.log(aplicar ? "APLICANDO\n" : "ENSAYO — no escribe nada. Con --aplicar, sí.\n");

const padron = await todo<Prov>("proveedores", "*");
console.log(`Padrón: ${padron.length} proveedores.`);

// ── La planilla ────────────────────────────────────────────────
const libro = process.env.GOOGLE_SHEETS_COMPRAS_ID!;
const pestanas = (await listarPestanas(libro)).filter(esPestanaDeArea);
const encabezados = await leerVariosRangos(libro, pestanas.map((p) => `${p}!A1:Z1`));
const rangos: string[] = [];
const deQuePestana: string[] = [];
encabezados.forEach((filas, i) => {
  const col = indexarColumnas(filas[0] ?? []).proveedor;
  if (col < 0) return;
  const letra = letraDeColumna(col);
  rangos.push(`${pestanas[i]}!A2:A`, `${pestanas[i]}!${letra}2:${letra}`);
  deQuePestana.push(pestanas[i]);
});
const columnas = await leerVariosRangos(libro, rangos);
const celdas: { nombre: string; nroRi: string }[] = [];
for (let i = 0; i < deQuePestana.length; i++) {
  const ris = columnas[i * 2] ?? [];
  const nombres = columnas[i * 2 + 1] ?? [];
  for (let f = 0; f < nombres.length; f++) {
    celdas.push({ nombre: nombres[f]?.[0] ?? "", nroRi: ris[f]?.[0] ?? "" });
  }
}
const planilla = contarNombresDeLaPlanilla(celdas);
console.log(`Planilla: ${pestanas.length} pestañas, ${celdas.length} celdas, ${planilla.size} nombres distintos.\n`);

// ── Lo que cuelga de cada ficha ────────────────────────────────
const grupos = gruposDeDuplicados(padron).filter((g) => g.motivo === "nombre parecido");
const enGrupos = new Set(grupos.flatMap((g) => g.ids));

const cuelganPorTabla = new Map<string, Map<string, number>>();
for (const { tabla } of TABLAS_QUE_APUNTAN) {
  const filas = await todo<{ proveedor_id: string | null }>(tabla, "proveedor_id");
  const m = new Map<string, number>();
  for (const f of filas) {
    if (!f.proveedor_id || !enGrupos.has(f.proveedor_id)) continue;
    m.set(f.proveedor_id, (m.get(f.proveedor_id) ?? 0) + 1);
  }
  cuelganPorTabla.set(tabla, m);
}
const cuelgaDe = (id: string) => {
  const d: Record<string, number> = {};
  let total = 0;
  for (const [tabla, m] of cuelganPorTabla) {
    const n = m.get(id) ?? 0;
    if (n > 0) { d[tabla] = n; total += n; }
  }
  return { detalle: d, total };
};
const FRENAN = TABLAS_QUE_APUNTAN.filter((t) => t.choque?.que === "frenar").map((t) => t.tabla);

// ── Clasificar ─────────────────────────────────────────────────
interface Plan {
  clave: string;
  queda: Prov;
  seVan: Prov[];
  porQue: string;
  mueve: number;
  hereda: string[];
}
const porId = new Map(padron.map((p) => [p.id, p]));
const listos: Plan[] = [];
const frenados: { clave: string; nombres: string[]; motivo: string }[] = [];

for (const grupo of grupos) {
  const filas = grupo.ids.map((id) => porId.get(id)!).filter(Boolean);
  const nombres = filas.map((f) => f.nombre);
  const dice = loQueDiceLaPlanilla(filas, planilla);

  if (dice.nombresDistintos > 1) {
    frenados.push({ clave: grupo.clave, nombres, motivo: `la planilla escribe ${dice.nombresDistintos} nombres` });
    continue;
  }

  /*
   * La tanda sólo borra fichas SIN CUIT. Con dos CUIT no hay un duplicado
   * probado —«nombre parecido» es una sospecha, no un hecho como el CUIT
   * repetido— y con ninguno no hay nada que conectar. Las dos van a la mano.
   */
  const conCuit = filas.filter((f) => f.cuit && cuitEsValido(normalizarCuit(f.cuit)));
  if (conCuit.length === 0) {
    frenados.push({ clave: grupo.clave, nombres, motivo: "ninguna tiene CUIT válido: fusionar no conecta nada" });
    continue;
  }
  if (conCuit.length > 1) {
    frenados.push({
      clave: grupo.clave,
      nombres,
      motivo: `${conCuit.length} fichas con CUIT: la tanda no borra ninguna que tenga uno`,
    });
    continue;
  }

  /*
   * Y no si dos nombres del grupo aportan cada uno una palabra propia que el
   * otro no tiene.
   *
   * Un duplicado de verdad es el nombre corto adentro del largo: «Cortadi»
   * dentro de «Cortadi Domingo Oscar». Pero `nombresParecidos` arma el grupo
   * encadenando desde un ancla, así que dos nombres que **no** se contienen
   * entre sí pueden terminar juntos por un tercero. Es lo que pasa con
   * «Ravioli Rodamientos», «Mr Rodamientos» y «Rodamientos Tandil»: los tres
   * comparten el rubro y cada uno agrega lo suyo —«ravioli», «tandil»—, y son
   * tres negocios distintos. Medirlo así es mejor que agrandar a ojo la lista
   * de palabras del rubro: «rodamientos» no la usa ningún proveedor de afuera
   * del grupo, o sea que por frecuencia no se distingue de un apellido.
   */
  const propiasDe = (n: string) =>
    new Set(claveDeProveedor(n).split(" ").filter((p) => p.length >= 4));
  const cruzados = filas.flatMap((a, i) =>
    filas.slice(i + 1).map((b) => {
      const [A, B] = [propiasDe(a.nombre), propiasDe(b.nombre)];
      const unoEnElOtro = [...A].every((p) => B.has(p)) || [...B].every((p) => A.has(p));
      return unoEnElOtro ? null : [a.nombre, b.nombre];
    })
  ).filter(Boolean) as string[][];
  if (cruzados.length) {
    frenados.push({
      clave: grupo.clave,
      nombres,
      motivo: `«${cruzados[0][0]}» y «${cruzados[0][1]}» no se contienen: cada uno aporta una palabra propia`,
    });
    continue;
  }

  const queda = conCuit[0];
  const seVan = filas.filter((f) => f.id !== queda.id);

  /*
   * Y sólo si la que queda es la que la planilla nombra. Si la celda escribe
   * el nombre de una que se va, la sincronización la recrea vacía y sin CUIT
   * en la corrida siguiente. Que la planilla no nombre a ninguna también
   * sirve: entonces no hay nada que la recree —`asegurarProveedores()` es lo
   * único que crea fichas desde una planilla y lo llama sólo Compras—.
   */
  const nombraAlgunaQueSeVa = seVan.some((f) => dice.porFila[f.id]?.laNombra);
  if (nombraAlgunaQueSeVa && !dice.porFila[queda.id]?.laNombra) {
    frenados.push({
      clave: grupo.clave,
      nombres,
      motivo: `la planilla escribe «${seVan.find((f) => dice.porFila[f.id]?.laNombra)!.nombre}», que es la que se iría: volvería vacía`,
    });
    continue;
  }
  const porQue = dice.porFila[queda.id]?.laNombra
    ? "tiene el CUIT y es la que nombra la planilla"
    : "tiene el CUIT, y la planilla no nombra a ninguna";
  const problema = seVan.map((f) => problemaParaFusionar(queda, f)).find(Boolean);
  if (problema) {
    frenados.push({ clave: grupo.clave, nombres, motivo: problema });
    continue;
  }

  // Choque que frena: datos propios de las dos en una tabla con PK = proveedor_id.
  const choca = FRENAN.find(
    (t) => (cuelganPorTabla.get(t)?.get(queda.id) ?? 0) > 0 && seVan.some((f) => (cuelganPorTabla.get(t)?.get(f.id) ?? 0) > 0)
  );
  if (choca) {
    frenados.push({ clave: grupo.clave, nombres, motivo: `las dos tienen datos propios en ${choca}` });
    continue;
  }

  const cambios: Record<string, unknown> = {};
  for (const f of seVan) Object.assign(cambios, camposQueSeMudan({ ...queda, ...cambios } as never, f as never));

  listos.push({
    clave: grupo.clave,
    queda,
    seVan,
    porQue,
    mueve: seVan.reduce((a, f) => a + cuelgaDe(f.id).total, 0),
    hereda: Object.keys(cambios),
  });
}

// ── Informe ────────────────────────────────────────────────────
const heredanCuit = listos.filter((p) => p.hereda.includes("cuit"));
console.log(`GRUPOS DE NOMBRE PARECIDO: ${grupos.length}`);
console.log(`  se fusionan ahora: ${listos.length}  (${listos.reduce((a, p) => a + p.seVan.length, 0)} fichas se borran, ${listos.reduce((a, p) => a + p.mueve, 0)} filas se mueven)`);
console.log(`  de ésos, la que queda HEREDA el CUIT de la que se va: ${heredanCuit.length}`);
console.log(`  frenados: ${frenados.length}\n`);

console.log("SE FUSIONAN");
for (const p of listos) {
  console.log(
    `  queda «${p.queda.nombre}»${p.queda.cuit ? ` [${p.queda.cuit}]` : ""} ← ` +
      p.seVan.map((f) => `«${f.nombre}»${f.cuit ? ` [${f.cuit}]` : ""}`).join(", ") +
      `  · ${p.mueve} filas · ${p.porQue}` +
      (p.hereda.length ? ` · hereda ${p.hereda.join(", ")}` : "")
  );
}

console.log("\nFRENADOS");
for (const f of frenados) console.log(`  ${f.nombres.map((n) => `«${n}»`).join(" / ")} — ${f.motivo}`);

if (!aplicar) {
  console.log("\nEnsayo: no se escribió nada.");
  process.exit(0);
}

// ── Aplicar ────────────────────────────────────────────────────
const { data: quien } = await db
  .from("usuarios")
  .select("id, nombre, apellido, email")
  .eq("email", process.env.USUARIO_DE_LA_TANDA ?? "claude@polcecal.com")
  .maybeSingle();
if (!quien) {
  console.error("No se encontró el usuario que firma la tanda. Pasá USUARIO_DE_LA_TANDA=<email>.");
  process.exit(1);
}
const firma = [quien.nombre, quien.apellido].filter(Boolean).join(" ") || quien.email;

let fusionados = 0;
let movidasTotal = 0;
for (const p of listos) {
  for (const seVa of p.seVan) {
    const { detalle } = cuelgaDe(seVa.id);

    // 1. auditar ANTES: si no entra, no se fusiona.
    const { error: errorAuditoria } = await db.from("auditoria").insert({
      modulo: "compras",
      entidad: "proveedores",
      entidad_id: seVa.id,
      accion: "borrar",
      usuario_id: quien.id,
      usuario_nombre: firma,
      actor: "persona",
      valor_anterior: `${seVa.nombre}${seVa.cuit ? ` (${seVa.cuit})` : ""}`,
      valor_nuevo: `${p.queda.nombre}${p.queda.cuit ? ` (${p.queda.cuit})` : ""}`,
      motivo: "Fusión de duplicados del padrón (tanda de nombres parecidos)",
      contexto: {
        fusionada_en: p.queda.id,
        nombre: seVa.nombre,
        cuit: seVa.cuit ?? null,
        razon_social: seVa.razon_social ?? null,
        filas_movidas: detalle,
      },
    });
    if (errorAuditoria) {
      console.error(`  ✗ «${seVa.nombre}»: no se pudo auditar, no se fusiona — ${errorAuditoria.message}`);
      continue;
    }

    // 2. mover las 19 tablas, resolviendo antes los choques conocidos.
    let corto = false;
    for (const { tabla, choque } of TABLAS_QUE_APUNTAN) {
      if (choque?.que === "borrar" && choque.columna) {
        const columna = choque.columna;
        const [{ data: suyas }, { data: delQueQueda }] = await Promise.all([
          db.from(tabla).select(columna).eq("proveedor_id", seVa.id),
          db.from(tabla).select(columna).eq("proveedor_id", p.queda.id),
        ]);
        const valorDe = (f: unknown) => (f as Record<string, unknown>)[columna];
        const ocupadas = new Set((delQueQueda ?? []).map(valorDe));
        for (const v of (suyas ?? []).map(valorDe).filter((v) => ocupadas.has(v))) {
          await db.from(tabla).delete().eq("proveedor_id", seVa.id).eq(columna, v as string);
        }
      }
      const { error, count } = await db
        .from(tabla)
        .update({ proveedor_id: p.queda.id }, { count: "exact" })
        .eq("proveedor_id", seVa.id);
      if (error) {
        console.error(`  ✗ «${seVa.nombre}»: se cortó moviendo ${tabla} — ${error.message}. NO se borró.`);
        corto = true;
        break;
      }
      movidasTotal += count ?? 0;
    }
    if (corto) continue;

    // 3. borrar.
    const { error: errorDeBorrado } = await db.from("proveedores").delete().eq("id", seVa.id);
    if (errorDeBorrado) {
      console.error(`  ✗ «${seVa.nombre}»: movida pero no borrada — ${errorDeBorrado.message}. Quedó vacía.`);
      continue;
    }
    fusionados++;
    console.log(`  ✓ «${seVa.nombre}» → «${p.queda.nombre}»`);
  }

  // 4. Y al final, lo que la que queda no tenía. Último a propósito: al revés,
  // un fallo en el borrado deja dos filas con el mismo CUIT y desconecta a las dos.
  if (p.hereda.length) {
    const cambios: Record<string, unknown> = {};
    for (const f of p.seVan) Object.assign(cambios, camposQueSeMudan({ ...p.queda, ...cambios } as never, f as never));
    const { error } = await db.from("proveedores").update(cambios).eq("id", p.queda.id);
    if (error) console.error(`  ✗ «${p.queda.nombre}»: no se pudo escribir ${p.hereda.join(", ")} — ${error.message}`);
    else console.log(`    «${p.queda.nombre}» quedó con ${p.hereda.join(", ")}`);
  }
}

console.log(`\nListo: ${fusionados} fichas borradas, ${movidasTotal} filas re-apuntadas.`);
