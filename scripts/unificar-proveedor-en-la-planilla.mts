/**
 * Deja una sola forma escrita por empresa en la columna PROVEEDOR de la
 * planilla de Compras.
 *
 *   npx tsx scripts/unificar-proveedor-en-la-planilla.mts             # ensayo
 *   npx tsx scripts/unificar-proveedor-en-la-planilla.mts --aplicar
 *
 * ── POR QUÉ HAY QUE TOCAR LA PLANILLA Y NO EL PADRÓN ────────────
 *
 * `asegurarProveedores()` resuelve al proveedor por el texto de esa celda y
 * **crea la ficha que no encuentra**. Mientras la columna escriba «RANDAZZO»
 * en unas filas y «FERRETERÍA RANDAZZO» en otras, el padrón va a tener dos
 * fichas para la misma empresa, y fusionarlas desde el SdG no dura: la
 * sincronización relee el libro entero y vuelve a crear la que se borró,
 * vacía y sin CUIT. Unificar la celda es lo único que hace que la fusión
 * quede firme.
 *
 * ── LA TRAMPA DE ESTA PLANILLA, QUE ES LA RAZÓN DEL FRENO ───────
 *
 * En cada pestaña por área, **las columnas A a M son el derrame de un
 * `FILTER`** sobre `'Requerimientos internos'` y la P está tipeada a mano al
 * lado. O sea que **qué pedido es cada fila lo decide una fórmula**: si entre
 * la lectura y la escritura alguien aprueba un RI, el derrame se corre y la
 * fila 40 deja de ser el RI que era. Escribir «RANDAZZO» ahí le cambiaría el
 * proveedor a otro pedido, y eso no avisa.
 *
 * Por eso cada celda se escribe **de a una y con dos comprobaciones hechas en
 * el momento**: que la columna A siga trayendo el mismo N° de RI y que la P
 * siga diciendo exactamente el texto viejo. Si alguna de las dos cambió, esa
 * celda se saltea y se informa. Es la misma familia de error que el 13/10/2026
 * puso una OT nueva encima de la 623.
 *
 * Y antes de todo, `estaCalculando()`: una planilla recalculando devuelve unas
 * celdas con «Cargando…» y **las demás vacías**, que es indistinguible de una
 * columna sin datos.
 *
 * ── CÓMO SE DESHACE ─────────────────────────────────────────────
 *
 * La corrida imprime, celda por celda, qué decía antes. Para volver atrás se
 * invierte el par en `UNIFICAR` y se corre de nuevo — pero ojo: si entre medio
 * la sincronización ya importó, el padrón habrá cambiado también.
 */

import { readFileSync } from "node:fs";

const RUTA_ENV = process.env.ENV_PATH ?? ".env.local";
for (const linea of readFileSync(RUTA_ENV, "utf8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
process.env.GOOGLE_SHEETS_COMPRAS_ID ??= "1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80";

const { leerVariosRangos, listarPestanas, letraDeColumna, escribirCeldas, estaCalculando, textoParaLaCelda } =
  await import("../lib/core/sheets.ts");
const { esPestanaDeArea, indexarColumnas } = await import("../lib/compras/sheets.ts");

const aplicar = process.argv.includes("--aplicar");
const LIBRO = process.env.GOOGLE_SHEETS_COMPRAS_ID!;

/**
 * Qué texto se reemplaza por cuál.
 *
 * Las claves se comparan exactas (sin espacios de los bordes): una
 * coincidencia parcial convertiría «REPUESTOS GRASSO» en «REPUESTOS REPUESTOS
 * GRASSO».
 *
 * No van acá los pares que se distinguen sólo por una tilde —«OLAVARRIA» y
 * «OLAVARRÍA GOMA»—, porque `claveProveedor()` ya los une: ésos eran un bug
 * del importador y no un problema de la planilla.
 *
 * ── POR QUÉ LA QUE QUEDA ES LA MINORITARIA ──────────────────────
 *
 * Lo intuitivo sería dejar la forma que la planilla ya escribe más veces,
 * para que el cambio sea el menor posible. Acá es al revés a propósito, y el
 * caso es exactamente el inverso del que arregla `--la-de-la-planilla`:
 * **la planilla escribe el nombre de la ficha que NO tiene CUIT**.
 *
 * En los cuatro, la ficha con el CUIT, la razón social y el enlace a Odoo se
 * llama de la otra forma, la que la planilla no nombra nunca. Fusionar sin
 * tocar la planilla obliga a elegir entre dos males: dejar viva la de la
 * planilla —que hereda el CUIT pero deja el padrón diciendo «RANDAZZO»— o
 * dejar viva la del CUIT, que la sincronización recrea vacía en la corrida
 * siguiente. Cambiar estas 70 celdas evita los dos: el nombre bueno queda, el
 * CUIT queda, y la ficha vacía se puede borrar sin que vuelva.
 *
 * Decidido por el usuario el 27/11/2026, sabiendo que escribe sobre la
 * planilla de producción. Las otras once formas viejas que esta tabla supo
 * tener —«GRASSO», «FERRETERIA MARFRA», «ALERTA 2DA OFERTA», «ECHEVARNE»…—
 * salieron porque esa dirección ya no hacía falta: medido ese día, la planilla
 * no las escribe en ninguna celda, así que sus fusiones se hicieron derecho.
 */
const UNIFICAR: Record<string, string> = {
  "RANDAZZO": "Ferretería Randazzo",
  "FIPH SA": "FiphSA",
  "RIGO": "Gustavo Rigo",
  "HOFFER": "Jose Hoffer",
};

console.log(aplicar ? "APLICANDO sobre la planilla de PRODUCCIÓN\n" : "ENSAYO — no escribe nada. Con --aplicar, sí.\n");

const pestanas = (await listarPestanas(LIBRO)).filter(esPestanaDeArea);
const encabezados = await leerVariosRangos(LIBRO, pestanas.map((p) => `${p}!A1:Z1`));

interface Celda { pestana: string; columna: number; fila: number; ri: string; viejo: string; nuevo: string }
const aCambiar: Celda[] = [];

for (let i = 0; i < pestanas.length; i++) {
  const pestana = pestanas[i];
  const columna = indexarColumnas(encabezados[i]?.[0] ?? []).proveedor;
  if (columna < 0) { console.log(`  ${pestana}: sin columna PROVEEDOR, se saltea.`); continue; }
  const L = letraDeColumna(columna);

  const [ris, nombres] = await leerVariosRangos(LIBRO, [`${pestana}!A2:A`, `${pestana}!${L}2:${L}`]);
  if (estaCalculando(ris) || estaCalculando(nombres)) {
    console.error(`  ${pestana}: la planilla está recalculando. No se toca nada.`);
    process.exit(1);
  }

  for (let f = 0; f < nombres.length; f++) {
    const viejo = (nombres[f]?.[0] ?? "").trim();
    const nuevo = UNIFICAR[viejo];
    if (!nuevo) continue;
    aCambiar.push({ pestana, columna, fila: f + 2, ri: (ris[f]?.[0] ?? "").trim(), viejo, nuevo });
  }
}

console.log(`\nCeldas a cambiar: ${aCambiar.length}`);
const porCambio = new Map<string, number>();
for (const c of aCambiar) {
  const k = `«${c.viejo}» → «${c.nuevo}»`;
  porCambio.set(k, (porCambio.get(k) ?? 0) + 1);
}
for (const [k, n] of [...porCambio].sort((a, b) => b[1] - a[1])) console.log(`  ${k}  ×${n}`);

console.log("\nDetalle (y esto es el deshacer: qué decía cada celda antes)");
for (const c of aCambiar) {
  console.log(`  ${c.pestana}!${letraDeColumna(c.columna)}${c.fila}  RI ${c.ri || "—"}  "${c.viejo}" → "${c.nuevo}"`);
}

if (!aplicar) {
  console.log("\nEnsayo: no se escribió nada.");
  process.exit(0);
}

/*
 * De a una, releyendo justo antes. Lento a propósito: lo que se protege es que
 * la fila siga siendo el pedido que era cuando se leyó — las columnas A a M son
 * el derrame de un FILTER y se corren solas.
 *
 * ── LA CUOTA DE SHEETS, QUE ES LO QUE PARTE LA CORRIDA AL MEDIO ──
 *
 * Google permite **60 lecturas por minuto por usuario** y contesta 429 cuando
 * se pasa. Una celda cuesta una lectura (A y P van en un solo batchGet) más
 * una escritura, así que sin freno 70 celdas se pasan de largo: el 27/11/2026
 * la primera corrida murió en la tercera celda, con dos ya escritas, porque
 * los ensayos previos ya habían gastado el minuto.
 *
 * Eso no corrompe nada —cada celda se escribe sola y las ya hechas dejan de
 * coincidir con `UNIFICAR`, así que volver a correr es seguro y retoma donde
 * quedó—, pero deja la columna a medio unificar sin que el error lo diga.
 * De ahí las dos defensas: una pausa fija que mantiene el ritmo por debajo de
 * la cuota, y un reintento que espera el minuto entero cuando igual llega un
 * 429. Un error que no sea 429 sigue cortando la corrida.
 */
const PAUSA_MS = 1200;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function conReintento<T>(que: string, hacer: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await hacer();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("429") || intento > 5) throw e;
      const espera = 60_000;
      console.log(`  … cuota de Google agotada en ${que}; espero ${espera / 1000}s (intento ${intento})`);
      await dormir(espera);
    }
  }
}

let escritas = 0;
const salteadas: string[] = [];
for (const c of aCambiar) {
  await dormir(PAUSA_MS);
  const L = letraDeColumna(c.columna);
  const [ahoraRi, ahoraNombre] = await conReintento(`leer ${c.pestana}!${L}${c.fila}`, () =>
    leerVariosRangos(LIBRO, [`${c.pestana}!A${c.fila}`, `${c.pestana}!${L}${c.fila}`])
  );
  const riAhora = (ahoraRi[0]?.[0] ?? "").trim();
  const nombreAhora = (ahoraNombre[0]?.[0] ?? "").trim();

  if (riAhora !== c.ri || nombreAhora !== c.viejo) {
    salteadas.push(
      `${c.pestana}!${L}${c.fila}: esperaba RI ${c.ri || "—"} con "${c.viejo}" y encontró RI ${riAhora || "—"} con "${nombreAhora}"`
    );
    continue;
  }

  await conReintento(`escribir ${c.pestana}!${L}${c.fila}`, () =>
    escribirCeldas(LIBRO, [
      { pestana: c.pestana, columna: c.columna, fila: c.fila, valor: textoParaLaCelda(c.nuevo) },
    ])
  );
  escritas++;
  console.log(`  ✓ ${c.pestana}!${L}${c.fila}  RI ${c.ri}  "${c.viejo}" → "${c.nuevo}"`);
}

console.log(`\nEscritas: ${escritas} de ${aCambiar.length}.`);
if (salteadas.length) {
  console.log(`Salteadas por no coincidir (la fila se movió o alguien la editó): ${salteadas.length}`);
  for (const s of salteadas) console.log(`  · ${s}`);
}
