// El "Edificio" de cada sector de planta, como un equipo más del catálogo.
//
// POR QUÉ
//
// **«Toda OT lleva equipo» rige desde el 19/10/2026** —`loQueFaltaParaCrear`
// no deja crear una sin `equipment_id`— y un trabajo sobre el edificio no es
// sobre ninguna máquina: arreglar un techo, una pared, un piso, un portón.
// Medido el 21/10/2026, eso no es un caso raro: **314 órdenes, 12 avisos y 26
// requerimientos** dicen «Edificio» en la columna EQUIPO y no tienen equipo
// enlazado, porque `"PO-A3 - Edificio"` es una opción de la lista del
// formulario de Google y no un equipo del catálogo. Desde el sistema esas
// órdenes **no se podían cargar**, porque el desplegable de equipo no tiene
// ninguna opción que sirva.
//
// Así que el catálogo gana una fila por sector de planta. No es inventar un
// dato: es escribir en el catálogo algo que la planilla viene diciendo desde
// siempre.
//
// EL CÓDIGO ES EL QUE LA PLANILLA YA USA, QUE CASI SIEMPRE ES EL DEL SECTOR
//
// `equipos.code` es NOT NULL y UNIQUE, así que hay que elegir uno, y el que va
// es **el que la planilla ya escribe para ese edificio**: `PO-A3`. Con eso, lo
// que el sistema escribe en la planilla —`"<code> – <name>"`— queda
// `"PO-A3 – Edificio"`, que es **palabra por palabra lo que la planilla ya
// dice**. Dos consecuencias, las dos buscadas:
//
//   1. La planilla no termina con dos formas de nombrar lo mismo. Es la misma
//      razón por la que la generación de los partes de contratista escribe
//      `"<código del sector> - Edificio"` y no un texto nuevo.
//   2. **Las que ya existen se enlazan solas.** `buscarCodigo` busca códigos
//      de equipo dentro del texto libre, así que en la próxima sincronización
//      esas filas pasan a colgar del edificio de su sector, que es donde el
//      trabajo pasó. Hoy están sin equipo. Medido: **239 OT, 12 avisos y 19
//      requerimientos**.
//
// Y no se lleva a nadie puesto: el borde de `buscarCodigo` son los caracteres
// que no son letra, número ni guión, así que `PO-A1` **no** matchea dentro de
// `"PO-A1-24 - Cinta transportadora 16"`. Medido sobre las 2.224 OT, los 183
// avisos, los 2.167 requerimientos y las 264 OS: las 270 filas que cambian
// dicen todas «Edificio», y ninguna otra se mueve. El script lo vuelve a medir
// cada vez que corre y lo grita si alguna no dice «Edificio».
//
// DOS EDIFICIOS NO LLEVAN EL CÓDIGO DE SU SECTOR
//
// **El del filler 1 es `PY-A2` y el del filler 2 es `PY-B2`**; `PY-A1` y `PY-B1`
// son las plantas. La primera corrida los creó con el código del sector —deducir
// el código en vez de leerlo— y fue el único error de esta tarea: dejaba sin
// enlazar **56 OT**, más que las de cualquier otro sector. Por eso el script
// busca el edificio **por su sector** y no por su código, y puede corregirlo sin
// crear un segundo edificio para el mismo lugar.
//
// La moraleja para el próximo sector: **el código del edificio se pregunta o se
// lee de la planilla, no se deduce del sector**. El del filler 3 quedó en
// `PY-D1` porque ninguna fila lo nombra todavía; si la planilla dice `PY-D2`,
// es una línea en `CODIGO_PROPIO` y el script lo recodifica solo.
//
// LO QUE SIGUE SIN ENLAZAR, Y POR QUÉ NO SE FUERZA
//
// De las 314 OT que dicen «Edificio», 75 quedan sin equipo igual:
//
//   - **70** dicen «Edificios» o «Edificio» pelado, sin código: son de los tres
//     sectores que no tienen código de planta (abajo).
//   - 5 son textos de una sola vez: «C - Edificio», «Edificio oficinas».
//
// LOS TRES SIN CÓDIGO DE SECTOR
//
// Cantera, Servicios auxiliares y Taller no están en el libro BD Equipos y por
// eso no tienen código —`scripts/sectores-de-la-ot.mts` decidió no inventarles
// uno—. Para el edificio hay que inventarlo igual, porque la columna es NOT
// NULL, y acá sí hay una trampa: **la palabra «Edificio» no puede ser el
// código**. `buscarCodigo` se queda con el más largo que encuentre, así que un
// equipo con código `EDIFICIO` ganaría contra `PO-A1` en el texto
// `"PO-A1 - Edificio"` y las órdenes de los otros doce sectores irían a parar
// todas al mismo edificio. Por eso llevan un código propio y delimitado.
//
// En la planilla, esos tres sectores escriben «Edificios» o «Edificio» pelado,
// sin código. Una OT que alguien cargue por el formulario de Google para
// Servicios auxiliares va a seguir quedando sin equipo, como hoy; una cargada
// desde el sistema trae el código y vuelve a enlazar sola.
//
// Uso:
//   npx tsx scripts/edificio-de-cada-sector.mts            ← dice qué haría
//   npx tsx scripts/edificio-de-cada-sector.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { buscarCodigo } = await import("../lib/mantenimiento/inventario.ts");

const APLICAR = process.argv.includes("--aplicar");
const sb = createAdminClient();

/** Cómo se llama en el catálogo. Singular, como la lista del formulario. */
const NOMBRE = "Edificio";

/**
 * El código del edificio cuando **no** es el del sector.
 *
 * Los dos primeros son la razón por la que este script busca el edificio por su
 * sector y no por su código: **el edificio del filler 1 es `PY-A2` y el del
 * filler 2 es `PY-B2`**, no `PY-A1` y `PY-B1`, que son las plantas. Lo dijo
 * quien los nombra, y la planilla lo venía diciendo sola —56 OT dicen
 * `"PY-A2 - Edificio"` o `"PY-B2 - Edificio"`, más que cualquier otro sector—.
 * Deducirlo del código del sector daba mal justo donde había más filas.
 *
 * Los tres de abajo son los sectores sin código de planta, que necesitan uno
 * igual porque `equipos.code` es NOT NULL.
 */
const CODIGO_PROPIO: Record<string, string> = {
  "Planta filler 1": "PY-A2",
  "Planta filler 2": "PY-B2",
  "Cantera": "CANTERA-ED",
  "Servicios auxiliares": "SERV-AUX-ED",
  "Taller": "TALLER-ED",
};

const QUE_ES =
  "La obra civil del sector: edificios, techos, paredes, pisos, portones y " +
  "estructuras. Existe para que un trabajo que no es sobre ninguna máquina " +
  "tenga dónde ir.";

type Sector = { id: string; nombre: string; codigo: string | null };
type Equipo = { id: string; code: string; name: string; sector_id: string | null };

const { data: sectores, error: errSectores } = await sb
  .from("sectores").select("id, nombre, codigo").eq("es_de_planta", true);
if (errSectores) throw new Error(errSectores.message);

const equipos = await traerTodo<Equipo>((desde, hasta) =>
  sb.from("equipos").select("id, code, name, sector_id").range(desde, hasta)
);
const porCodigo = new Map(equipos.map((e) => [e.code.toUpperCase(), e]));

/** El código que le toca al edificio de ese sector. */
function codigoDelEdificio(s: Sector): string | null {
  return CODIGO_PROPIO[s.nombre] || s.codigo?.trim() || null;
}

/**
 * El edificio de ese sector, si ya está.
 *
 * **Se lo busca por su sector y no por su código**, que es lo que permite
 * corregirle el código sin crear un segundo edificio para el mismo lugar. Pasó:
 * los dos filler nacieron con el código de su planta y hubo que moverlos a
 * PY-A2 y PY-B2.
 */
function edificioDe(s: Sector): Equipo | undefined {
  return equipos.find((e) => e.sector_id === s.id && e.name === NOMBRE);
}

/* ── Qué haría ──────────────────────────────────────────────────────────── */

const planeados = (sectores as Sector[])
  .map((s) => ({ sector: s, code: codigoDelEdificio(s), actual: edificioDe(s) }))
  .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));

const aCrear = planeados.filter((p) => p.code && !p.actual);
const aRecodificar = planeados.filter(
  (p) => p.code && p.actual && p.actual.code.toUpperCase() !== p.code.toUpperCase()
);
const yaEstaban = planeados.filter(
  (p) => p.code && p.actual && p.actual.code.toUpperCase() === p.code.toUpperCase()
);
const sinCodigo = planeados.filter((p) => !p.code);

console.log(`Sectores de planta: ${sectores.length} · equipos hoy: ${equipos.length}\n`);
for (const { sector, code } of aCrear) console.log(`  crear      ${code!.padEnd(12)} ${NOMBRE} · ${sector.nombre}`);
for (const { sector, code, actual } of aRecodificar) {
  console.log(`  recodificar ${actual!.code} → ${code!.padEnd(12)} ${NOMBRE} · ${sector.nombre}`);
}
for (const { sector, code } of yaEstaban) console.log(`  ya estaba  ${code!.padEnd(12)} ${NOMBRE} · ${sector.nombre}`);
for (const { sector } of sinCodigo) {
  console.log(`  SIN CÓDIGO "${sector.nombre}" no tiene código de sector ni entrada en CODIGO_PROPIO`);
}

// Un código que ya es de otro equipo no se pisa: `equipos.code` es UNIQUE, así
// que el insert fallaría igual, pero el que se ve acá dice cuál y de quién es.
const ocupados = [...aCrear, ...aRecodificar].filter(({ code, actual }) => {
  const duenio = porCodigo.get(code!.toUpperCase());
  return duenio && duenio.id !== actual?.id;
});
for (const { sector, code } of ocupados) {
  const duenio = porCodigo.get(code!.toUpperCase())!;
  console.log(`\n  OCUPADO el código ${code} ya es de "${duenio.name}" — el edificio de ${sector.nombre} no se toca.`);
}

/* ── A cuántas filas ya escritas les cambiaría el enlace ─────────────────── */

// El mismo `buscarCodigo` que usa la sincronización, contra los códigos que
// habría después de esta corrida. Es la única manera de saber qué se mueve: el
// enlace se recalcula en cada corrida sobre el texto de la planilla.
//
// Compras no usa `buscarCodigo` sino `reconocerEquipo`, que parte el texto en
// el primer `" - "` en vez de buscar el código adentro. Para
// `"PO-A1 - Edificio"` las dos dan lo mismo, así que para contar sirve igual;
// un texto que dijera el código en el medio lo contaría de más.
const aMover = [...aCrear, ...aRecodificar].filter((p) => !ocupados.includes(p));
const nuevos = new Set(aMover.map((p) => p.code!.toUpperCase()));
const codigosDespues = [
  ...[...porCodigo.keys()].filter((c) => !aRecodificar.some((p) => p.actual!.code.toUpperCase() === c)),
  ...aMover.map((p) => p.code!),
];

for (const [tabla, campoEquipo] of [
  ["ordenes_trabajo", "equipment_id"],
  ["avisos", "equipment_id"],
  ["compras_requerimientos", "equipo_id"],
  ["ordenes_servicio", "equipment_id"],
] as const) {
  const filas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
    sb.from(tabla).select(`equipo_raw, ${campoEquipo}`).range(desde, hasta)
  );

  const cambian = filas.filter((f) => {
    if (f[campoEquipo]) return false;
    const code = buscarCodigo(f.equipo_raw as string | null, codigosDespues);
    return code ? nuevos.has(code.toUpperCase()) : false;
  });

  const dicenOtraCosa = cambian.filter((f) => !/edificio/i.test(String(f.equipo_raw ?? "")));
  console.log(
    `\n  ${tabla}: ${filas.length} filas · pasarían a colgar de un edificio: ${cambian.length}` +
    (dicenOtraCosa.length ? ` · ¡${dicenOtraCosa.length} no dicen "Edificio"!` : "")
  );
  for (const f of dicenOtraCosa.slice(0, 10)) console.log(`      ${f.equipo_raw}`);
}

if (!APLICAR) {
  console.log(
    `\nNo se escribió nada. Con --aplicar: ${aCrear.length} altas` +
    `${aRecodificar.length ? ` y ${aRecodificar.length} códigos corregidos` : ""}.`
  );
  process.exit(sinCodigo.length || ocupados.length ? 1 : 0);
}

/* ── Aplicar ────────────────────────────────────────────────────────────── */

if (aCrear.length === 0 && aRecodificar.length === 0) {
  console.log("\nNo hay nada que hacer.");
  process.exit(0);
}

// Primero los códigos, porque un alta puede estar esperando el código que un
// edificio mal codificado todavía ocupa.
for (const p of aRecodificar) {
  if (ocupados.includes(p)) continue;
  const { error } = await sb.from("equipos").update({ code: p.code }).eq("id", p.actual!.id);
  if (error) throw new Error(`recodificando el edificio de ${p.sector.nombre}: ${error.message}`);
  console.log(`  ✓ ${p.actual!.code} → ${p.code} · ${p.sector.nombre}`);
}

if (aCrear.length === 0) process.exit(0);

const { error } = await sb.from("equipos").insert(
  aCrear.map(({ sector, code }) => ({
    sector_id: sector.id,
    code,
    name: NOMBRE,
    // No es una máquina: no se le mide MTBF ni se le programa un service, y
    // dejarlo en MEDIA —el default de la columna— lo pondría a competir con
    // los equipos de verdad en cualquier listado por criticidad.
    criticality: "BAJA",
    descripcion_proceso: QUE_ES,
  }))
);
if (error) throw new Error(`creando los edificios: ${error.message}`);

for (const { sector, code } of aCrear) console.log(`  ✓ ${code} · ${sector.nombre}`);

console.log(
  `\n${aCrear.length} edificios creados.\n` +
  "Ya aparecen en el desplegable de equipo de la OT y del aviso.\n" +
  "Las órdenes que ya decían \"<código> - Edificio\" se enlazan solas en la\n" +
  "próxima sincronización, que corre cada quince minutos."
);
