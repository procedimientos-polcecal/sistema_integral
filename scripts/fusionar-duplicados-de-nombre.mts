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

/**
 * El modo que invierte la regla, y que **sólo se corre cuando una persona lo
 * pidió para esos grupos**.
 *
 * Toma exactamente el caso que la regla normal manda a la mano: la ficha que
 * nombra la planilla es la que NO tiene CUIT. Ahí deja viva a la de la
 * planilla —que hereda el CUIT, la razón social y el enlace a Odoo de la
 * otra— y borra la que sí tenía CUIT. Es la única forma de que el grupo
 * termine en una sola ficha sin que la sincronización la recree.
 *
 * El enlace a Odoo no se pierde: `proveedores_odoo` sólo borra la fila
 * repetida cuando la que queda ya tiene una para esa empresa, y en este caso
 * no tiene ninguna, así que las filas se re-apuntan.
 *
 * Lo que sí se pierde es el nombre: queda «ORITI» y no «Oriti Gustavo». Si se
 * quiere el otro, el camino no es fusionar al revés —eso recrea la ficha— sino
 * cambiar la celda de la planilla y después fusionar.
 */
const laDeLaPlanilla = process.argv.includes("--la-de-la-planilla");

/**
 * `--solo "NOMBRE|OTRO"` limita la corrida a los grupos cuya ficha
 * sobreviviente se llame así.
 *
 * Existe porque **la lista se mueve mientras uno la mira**: entre que se le
 * muestran los grupos a una persona y que contesta, otra fusión hecha a mano
 * puede destrabar grupos nuevos, y correr «todo lo que da hoy» haría más de lo
 * que se aprobó. Pasó el 26/11/2026: se aprobaron 10 y el ensayo daba 12.
 */
const soloArg = process.argv.indexOf("--solo");
const solo = soloArg >= 0 ? new Set(process.argv[soloArg + 1].split("|").map((x) => x.trim())) : null;

/*
 * `--confirmado "A|B"` declara que ese grupo es la misma empresa, y apaga
 * para él —y sólo para él— el control de contención. Ver el comentario largo
 * donde se aplica.
 */
const confArg = process.argv.indexOf("--confirmado");
const confirmados = new Set(confArg >= 0 ? process.argv[confArg + 1].split("|").map((x) => x.trim()) : []);

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

/**
 * `--pares "QUEDA = SE_VA, OTRA ; QUEDA2 = SE_VA2"` fusiona exactamente esos
 * pares, nombrados a mano, y no mira los grupos.
 *
 * Existe porque **el agrupador no sabe cuándo un grupo es en realidad dos
 * empresas**. «PAPELERA M Y M», «Papelera MyM» y «Papelera Ciuffo» caen
 * juntas y Ciuffo es otra firma con su propio CUIT; «RM SEGURIDAD AMBIENTAL»
 * y «SU SEGURIDAD» también, y ahí son dos pares distintos dentro de un grupo
 * de cuatro. Decidir eso es de quien los conoce, así que el modo normal los
 * frena y éste es por donde entra esa decisión, una vez tomada.
 *
 * Los nombres van **exactos**, como están en el padrón. Si alguno no está, no
 * se hace nada: un nombre mal tipeado tiene que salir por la puerta de
 * «no existe» y no por la de «fusiono lo que encontré».
 */
const paresArg = process.argv.indexOf("--pares");
if (paresArg >= 0) {
  const porNombre = new Map(padron.map((p) => [p.nombre, p]));
  const faltan: string[] = [];
  for (const bloque of process.argv[paresArg + 1].split(";")) {
    const [izq, der] = bloque.split("=");
    if (!izq || !der) continue;
    const nombreQueda = izq.trim();
    const nombresSeVan = der.split(",").map((x) => x.trim()).filter(Boolean);
    const queda = porNombre.get(nombreQueda);
    const seVan = nombresSeVan.map((n) => porNombre.get(n));
    for (const [i, f] of seVan.entries()) if (!f) faltan.push(nombresSeVan[i]);
    if (!queda) { faltan.push(nombreQueda); continue; }
    if (seVan.some((f) => !f)) continue;

    const vivas = seVan as Prov[];
    const problema = vivas.map((f) => problemaParaFusionar(queda, f)).find(Boolean);
    if (problema) { frenados.push({ clave: nombreQueda, nombres: nombresSeVan, motivo: problema }); continue; }
    const choca = FRENAN.find(
      (t) => (cuelganPorTabla.get(t)?.get(queda.id) ?? 0) > 0 && vivas.some((f) => (cuelganPorTabla.get(t)?.get(f.id) ?? 0) > 0)
    );
    if (choca) { frenados.push({ clave: nombreQueda, nombres: nombresSeVan, motivo: `las dos tienen datos propios en ${choca}` }); continue; }

    const cambios: Record<string, unknown> = {};
    for (const f of vivas) Object.assign(cambios, camposQueSeMudan({ ...queda, ...cambios }, f));
    listos.push({
      clave: nombreQueda,
      queda,
      seVan: vivas,
      porQue: "par nombrado a mano",
      mueve: vivas.reduce((a, f) => a + cuelgaDe(f.id).total, 0),
      hereda: Object.keys(cambios),
    });
  }
  if (faltan.length) {
    console.error(`Estos nombres no están en el padrón, así que no se hace nada: ${faltan.map((n) => `«${n}»`).join(", ")}`);
    process.exit(1);
  }
}

for (const grupo of paresArg >= 0 ? [] : grupos) {
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

  /*
   * La excepción: cuando todas las fichas del grupo comparten la clave, no es
   * un parecido sino **la misma escritura** —«Prestigio» y «PRESTIGIO»,
   * «Distribuidora Pueyrredon» y «DISTRIBUIDORA "PUEYRREDÓN"»—, y ahí no hay
   * nada que juzgar: el CUIT no aporta nada a una decisión que ya está tomada
   * por los propios textos.
   *
   * Y es seguro además por donde importa: `asegurarProveedores()` busca por
   * clave, así que la que quede responde igual al texto de la planilla y el
   * sync **no** recrea la que se borró. Ésa es justamente la diferencia con
   * los grupos de nombres parecidos, donde cada ficha tiene su propia clave y
   * borrar la que la planilla nombra la hace volver vacía a la hora siguiente.
   */
  const unaSolaClave = new Set(filas.map((f) => claveDeProveedor(f.nombre))).size === 1;

  if (conCuit.length === 0 && !unaSolaClave) {
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
  /*
   * `--confirmado` apaga este control para un grupo, y sólo éste. Existe
   * porque el control acierta en general y falla cuando la misma empresa se
   * escribe pegada y separada: «PETROTANDIL» es una palabra y «Petro Tandil»
   * son dos, así que ninguna contiene a la otra y el par queda frenado para
   * siempre. Que sean la misma lo dice la razón social de la que tiene CUIT
   * —PETROTANDIL SOCIEDAD ANONIMA…—, y eso es un juicio de una persona que no
   * se deduce de los textos: por eso se nombra el par a mano en la línea de
   * comandos y queda escrito en el `motivo` de la auditoría, en vez de
   * aflojar el control para todos.
   */
  const confirmadoAMano = unaSolaClave || nombres.every((n) => confirmados.has(n));
  const cruzados = confirmadoAMano ? [] : filas.flatMap((a, i) =>
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

  const nombradas = filas.filter((f) => dice.porFila[f.id]?.laNombra);

  if (laDeLaPlanilla) {
    /*
     * Este modo atiende UN solo caso y saltea todo lo demás, para que correrlo
     * no pueda tocar nada que no sea lo que una persona aprobó mirándolo.
     */
    if (nombradas.length !== 1 || nombradas[0].id === conCuit[0]?.id) continue;
    const queda = nombradas[0];
    const seVan = filas.filter((f) => f.id !== queda.id);
    const cambios: Record<string, unknown> = {};
    for (const f of seVan) Object.assign(cambios, camposQueSeMudan({ ...queda, ...cambios }, f));
    listos.push({
      clave: grupo.clave,
      queda,
      seVan,
      porQue: "la nombra la planilla y hereda el CUIT de la otra",
      mueve: seVan.reduce((a, f) => a + cuelgaDe(f.id).total, 0),
      hereda: Object.keys(cambios),
    });
    continue;
  }

  /*
   * Con CUIT manda el CUIT. Sin ninguno —que ahora pasa, porque el grupo de
   * una sola clave entra sin él— manda de quién cuelgan más filas, y si
   * empatan la más vieja: es la que viene usándose, y la otra es la que
   * nació de una grafía nueva.
   */
  const queda =
    conCuit[0] ??
    [...filas].sort(
      (a, b) =>
        cuelgaDe(b.id).total - cuelgaDe(a.id).total ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    )[0];
  const seVan = filas.filter((f) => f.id !== queda.id);

  /*
   * Y sólo si la que queda es la que la planilla nombra. Si la celda escribe
   * el nombre de una que se va, la sincronización la recrea vacía y sin CUIT
   * en la corrida siguiente. Que la planilla no nombre a ninguna también
   * sirve: entonces no hay nada que la recree —`asegurarProveedores()` es lo
   * único que crea fichas desde una planilla y lo llama sólo Compras—.
   */
  const nombraAlgunaQueSeVa = seVan.some((f) => dice.porFila[f.id]?.laNombra);
  // Salvo con una sola clave: ahí la que queda responde al mismo texto, así
  // que no hay nada que recrear. Ver el comentario de `unaSolaClave`.
  if (!unaSolaClave && nombraAlgunaQueSeVa && !dice.porFila[queda.id]?.laNombra) {
    frenados.push({
      clave: grupo.clave,
      nombres,
      motivo: `la planilla escribe «${seVan.find((f) => dice.porFila[f.id]?.laNombra)!.nombre}», que es la que se iría: volvería vacía`,
    });
    continue;
  }
  const porQue = unaSolaClave && !conCuit.length
    ? "misma escritura (sólo cambian mayúsculas, acentos o comillas); queda la que tiene más filas"
    : dice.porFila[queda.id]?.laNombra
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

if (solo) {
  const fuera = listos.filter((p) => !solo.has(p.queda.nombre));
  const faltan = [...solo].filter((n) => !listos.some((p) => p.queda.nombre === n));
  listos.splice(0, listos.length, ...listos.filter((p) => solo.has(p.queda.nombre)));
  console.log(`--solo: quedan ${listos.length} de ${listos.length + fuera.length}.`);
  if (fuera.length) console.log(`  se dejan afuera: ${fuera.map((p) => `«${p.queda.nombre}»`).join(", ")}`);
  if (faltan.length) console.log(`  PEDIDOS QUE NO ESTÁN EN LA LISTA DE HOY: ${faltan.join(", ")}`);
}

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
      motivo:
        (laDeLaPlanilla
          ? "Fusión de duplicados del padrón: queda la ficha que nombra la planilla, que hereda el CUIT"
          : "Fusión de duplicados del padrón (tanda de nombres parecidos)") +
        // Que el control de contención no las hubiera unido solas es parte de
        // lo que pasó, y el registro es lo único que va a quedar de por qué.
        (confirmados.has(p.queda.nombre) && confirmados.has(seVa.nombre)
          ? ". El par lo confirmó una persona a mano (--confirmado): los nombres no se contienen entre sí"
          : ""),
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
