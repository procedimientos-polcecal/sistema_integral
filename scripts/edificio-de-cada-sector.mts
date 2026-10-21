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
// EL CÓDIGO ES EL DEL SECTOR, Y ESO NO ES CASUAL
//
// `equipos.code` es NOT NULL y UNIQUE, así que hay que elegir uno. El de los
// trece sectores que tienen código es **el código del sector**: `PO-A3`. Con
// eso, lo que el sistema escribe en la planilla —`"<code> – <name>"`— queda
// `"PO-A3 – Edificio"`, que es **palabra por palabra lo que la planilla ya
// dice**. Dos consecuencias, las dos buscadas:
//
//   1. La planilla no termina con dos formas de nombrar lo mismo. Es la misma
//      razón por la que la generación de los partes de contratista escribe
//      `"<código del sector> - Edificio"` y no un texto nuevo.
//   2. **Las que ya existen se enlazan solas.** `buscarCodigo` busca códigos
//      de equipo dentro del texto libre, así que en la próxima sincronización
//      esas filas pasan a colgar del edificio de su sector, que es donde el
//      trabajo pasó. Hoy están sin equipo. Medido: **183 OT, 10 avisos y 23
//      requerimientos**.
//
// Y no se lleva a nadie puesto: el borde de `buscarCodigo` son los caracteres
// que no son letra, número ni guión, así que `PO-A1` **no** matchea dentro de
// `"PO-A1-24 - Cinta transportadora 16"`. Medido sobre las 2.224 OT, los 183
// avisos, los 2.167 requerimientos y las 264 OS: las 216 filas que cambian
// dicen todas «Edificio», y ninguna otra se mueve. El script lo vuelve a medir
// cada vez que corre y lo grita si alguna no dice «Edificio».
//
// LO QUE SIGUE SIN ENLAZAR, Y POR QUÉ NO SE FUERZA
//
// De las 314 OT que dicen «Edificio», 131 quedan sin equipo igual:
//
//   - **70** dicen «Edificios» o «Edificio» pelado, sin código: son de los tres
//     sectores que no tienen código de planta (abajo).
//   - **56** dicen `PY-A2 - Edificio` o `PY-B2 - Edificio`, y **esos sectores no
//     existen en el catálogo**: los filler son PY-A1, PY-B1 y PY-D1. La lista
//     del formulario nombra dos plantas que el libro BD Equipos no tiene, y eso
//     es un desajuste del catálogo de sectores que este script no decide.
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
// `"PO-A1 - Edificio"` y las 105 órdenes de los trece sectores irían a parar
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

/** Los sectores que no tienen código de planta, y el que lleva su edificio. */
const SIN_CODIGO_DE_SECTOR: Record<string, string> = {
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
  return s.codigo?.trim() || SIN_CODIGO_DE_SECTOR[s.nombre] || null;
}

/* ── Qué haría ──────────────────────────────────────────────────────────── */

const planeados = (sectores as Sector[])
  .map((s) => ({ sector: s, code: codigoDelEdificio(s) }))
  .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));

const aCrear = planeados.filter((p) => p.code && !porCodigo.has(p.code.toUpperCase()));
const yaEstaban = planeados.filter((p) => p.code && porCodigo.has(p.code.toUpperCase()));
const sinCodigo = planeados.filter((p) => !p.code);

console.log(`Sectores de planta: ${sectores.length} · equipos hoy: ${equipos.length}\n`);
for (const { sector, code } of aCrear) console.log(`  crear      ${code!.padEnd(12)} ${NOMBRE} · ${sector.nombre}`);
for (const { sector, code } of yaEstaban) {
  const e = porCodigo.get(code!.toUpperCase())!;
  console.log(`  ya estaba  ${code!.padEnd(12)} ${e.name} · ${sector.nombre}`);
}
for (const { sector } of sinCodigo) {
  console.log(`  SIN CÓDIGO "${sector.nombre}" no tiene código de sector ni entrada en SIN_CODIGO_DE_SECTOR`);
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
const codigosDespues = [...porCodigo.keys(), ...aCrear.map((p) => p.code!)];
const nuevos = new Set(aCrear.map((p) => p.code!.toUpperCase()));

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
  console.log(`\nNo se escribió nada. Con --aplicar: ${aCrear.length} altas.`);
  process.exit(sinCodigo.length ? 1 : 0);
}

/* ── Aplicar ────────────────────────────────────────────────────────────── */

if (aCrear.length === 0) {
  console.log("\nNo hay nada que crear.");
  process.exit(0);
}

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
  "Las órdenes que ya decían \"<sector> - Edificio\" se enlazan solas en la\n" +
  "próxima sincronización, que corre cada quince minutos."
);
