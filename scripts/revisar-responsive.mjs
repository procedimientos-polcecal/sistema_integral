/*
 * ¿Hay en el código algo que no entra en un teléfono de 375 px?
 *
 *   node scripts/revisar-responsive.mjs
 *
 * Existe por la misma razón que la regla del `<select>` nativo: **escribir una
 * pantalla nueva con una grilla apretada no rompe nada, y ése es el problema.**
 * No hay error, no hay test que lo note, `tsc` y el build pasan; esa pantalla
 * simplemente queda inusable en el teléfono y nadie se entera hasta que alguien
 * la abre desde la cantera.
 *
 * Costó encontrarlo una vez: el 16/10/2026, cuando el SdG pasó a poder
 * instalarse y usarse desde el teléfono, hubo que escanear a mano las 313
 * pantallas, y salieron 30 lugares que no entraban. Este script es ese escaneo
 * convertido en código, para que la próxima vez lo encuentre una máquina.
 *
 * Mira el **texto** de los archivos, no el DOM renderizado: casi todo está
 * detrás del login, así que no hay forma de abrir las pantallas. Eso lo hace
 * rápido y sin dependencias, y también lo hace aproximado: busca patrones, no
 * mide. Por eso las tres severidades:
 *
 *   ROMPE     seguro que no entra: una grilla donde cada columna queda por
 *             debajo de ~40 px, o un ancho fijo —`w-[Npx]` o `min-w-[Npx]`—
 *             mayor que el ancho útil.
 *   APRETADO  entra, pero justo: 3 columnas o más sin breakpoint (<115 px cada
 *             una). Se mira y se decide; muchas veces es un número corto y está
 *             bien, y a veces es un nombre que se corta.
 *   MIRAR     una `<table>` sin un contenedor con scroll horizontal arriba. Una
 *             tabla con pocas columnas puede entrar sola; con muchas, no.
 *
 * El ancho útil de referencia es **343 px**: los 375 del teléfono menos los 32
 * de padding del layout.
 *
 * **Sale 1 si hay algún ROMPE, y todavía NO está en el CI.** Hasta que la lista
 * de excepciones de abajo esté estable, un CI rojo por falsos positivos no lo
 * mira nadie — la misma razón por la que el lint tampoco está. Cuando APRETADO y
 * MIRAR estén resueltos o anotados, se agrega el paso.
 *
 * No chequea `<select>`, imágenes ni texto largo sin cortar: sólo grillas,
 * anchos fijos y tablas, que fueron los tres tipos de lo que se encontró.
 *
 * **Un límite que conviene tener presente: la sintaxis arbitraria es invisible.**
 * La regex de las grillas exige un número (`grid-cols-3`), así que una grilla
 * escrita `grid-cols-[auto_1fr]`, `grid-cols-[repeat(12,1fr)]` o cualquier otra
 * con corchetes **no la ve**, tenga las columnas que tenga. Hay una apoyada en
 * eso a propósito: `cantera/cubicacion/CubicacionClient.tsx`, una lista de
 * definición (`<dl>`) etiqueta/valor donde `auto 1fr` es mejor que una o dos
 * columnas. Pero es una puerta abierta: quien escriba una grilla nueva con esa
 * sintaxis **tiene que medirla a mano**, porque el script no lo va a hacer por
 * él, y pasa el chequeo sin que nada avise —la misma trampa del `<select>`
 * nativo: no rompe nada, y ése es el problema—.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** 375 px del teléfono menos los 32 del padding del layout. */
export const ANCHO_UTIL = 343;

/** Por debajo de esto, una columna ya no muestra ni un número de dos cifras. */
const COLUMNA_MINIMA = 40;

/** Cuántas líneas hacia arriba se busca el contenedor con scroll de una tabla. */
const LINEAS_HASTA_EL_CONTENEDOR = 12;

/**
 * **Falsos positivos conocidos, y no se tocan nunca.**
 *
 * Son los calendarios del mes: siete columnas porque la semana tiene siete días.
 * 49 px por celda es exactamente lo que mide un día en el calendario de
 * cualquier teléfono, así que no están apretados; y ponerles un breakpoint
 * (`grid-cols-2 sm:grid-cols-7`) los rompería, porque un calendario con dos
 * columnas deja de ser un calendario.
 *
 * Sin esta lista el script diría «APRETADO» para siempre sobre código correcto,
 * y un script que siempre está rojo no lo mira nadie.
 *
 * `cantidad` cuenta las grillas de 7 que hay en el archivo —la de los nombres de
 * los días y la de las celdas, en los que tienen las dos—: la excepción es para
 * esas, no para el archivo entero. Un `grid-cols-7` de más en la misma pantalla
 * no es el calendario y no hereda el permiso.
 */
export const CALENDARIOS = [
  { ruta: "app/(app)/remises/semana/SemanaClient.tsx", cantidad: 1 },
  { ruta: "app/(app)/cantera/destape/DestapeClient.tsx", cantidad: 2 },
  { ruta: "app/(app)/trituracion/partes/PartesClient.tsx", cantidad: 2 },
];

/**
 * Falsos positivos de tablas, y tampoco se tocan.
 *
 * Son las tres tablas de `/produccion/resumenes`. Están dentro de `Envoltorio`,
 * un componente del mismo archivo que pone `<div className="overflow-x-auto">`
 * alrededor de sus `children`: tienen scroll horizontal de verdad. El script no
 * lo ve porque sólo mira 12 líneas hacia arriba y el contenedor está más arriba
 * que eso. Es el límite declarado del script, no un defecto suyo: seguir el
 * árbol de componentes lo convertiría en un compilador.
 *
 * Si aparece otro envoltorio así, la salida es sumarlo a esta lista, no enseñarle
 * al script qué es `Envoltorio`: atar el script a un nombre de componente lo
 * rompe el día que alguien lo renombra, y no generaliza.
 *
 * `cantidad` cuenta las tablas sin contenedor que se perdonan en ese archivo, y
 * se gastan en orden de línea. Es la misma estrategia que los calendarios: la
 * excepción es para esas tres, no para el archivo entero. Una cuarta tabla sin
 * contenedor agregada **fuera** de `Envoltorio` tiene que salir. Si queda antes
 * que las otras, el hallazgo aparece en la línea de la última: lo que se cuenta
 * es la cantidad, no el lugar.
 */
export const TABLAS_CON_SCROLL_HEREDADO = [
  { ruta: "app/(app)/produccion/resumenes/ResumenesClient.tsx", cantidad: 3 },
];

/** Las rutas siempre con `/`, también en Windows. */
const normalizar = (ruta) => ruta.replaceAll("\\", "/");

/**
 * Lo que se imprime en A4 no tiene por qué entrar en un teléfono: se abre para
 * mandarlo a la impresora, con otro ancho.
 */
const esPantallaDeImprimir = (ruta) => normalizar(ruta).includes("/imprimir/");

const esComentario = (linea) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(linea);

/**
 * Un token de clase **sin** prefijo de breakpoint: no lo precede nada que no sea
 * comilla, espacio o backtick. `sm:grid-cols-3` y `max-w-[400px]` no cuentan,
 * porque el `:` y el `-` que los preceden delatan que son otra cosa.
 */
const SIN_PREFIJO = String.raw`(?<![\w:\-\[])`;
const GRILLA = new RegExp(`${SIN_PREFIJO}grid-cols-(\\d+)(?![\\w\\-\\[])`, "g");
const ANCHO_FIJO = new RegExp(`${SIN_PREFIJO}w-\\[(\\d+(?:\\.\\d+)?)px\\](?![\\w\\-])`, "g");
/**
 * `min-w-[Npx]`: el cuarto patrón, y necesita su propia regex.
 *
 * No alcanza con la de `ANCHO_FIJO`: el lookbehind de `SIN_PREFIJO` descarta
 * todo lo que venga precedido por un `-`, que es justo lo que le pasa a la `w`
 * de `min-w-`. Por eso la clase quedó invisible hasta el 16/10/2026, cuando la
 * revisión de la rama lo encontró leyendo la regex y no la salida: **los cinco
 * `min-w-[Npx]` del árbol van de 130 a 220 px, así que no cambiaba ni un
 * resultado**. El día que alguien escriba `min-w-[480px]` sí cambia, y hasta
 * entonces el script decía verde sobre un patrón que no estaba mirando.
 *
 * Un `min-width` mayor que el ancho útil es peor que un `width`: no hay forma de
 * que la caja se achique, así que estira la página entera sí o sí.
 *
 * Los valores en `rem` —`min-w-[16rem]`, que hay dos— no entran a propósito: la
 * conversión depende del tamaño de fuente de la raíz y el script no mide, mira
 * texto. 16rem son 256 px y entran; si aparece uno que no, lo va a encontrar la
 * pasada visual, no esta regex.
 */
const MIN_ANCHO_FIJO = new RegExp(
  `${SIN_PREFIJO}min-w-\\[(\\d+(?:\\.\\d+)?)px\\](?![\\w\\-])`,
  "g"
);
const CONTENEDOR_CON_SCROLL = /overflow-(?:x-)?(?:auto|scroll)/;

/**
 * Busca en los archivos lo que no entra en 375 px.
 *
 * Es pura: recibe el texto y devuelve los hallazgos, sin tocar el disco, que es
 * lo que permite probarla con textos armados a mano.
 *
 * @param {{ruta: string, texto: string}[]} archivos
 * @returns {{ruta: string, linea: number, severidad: "ROMPE" | "APRETADO" | "MIRAR", que: string}[]}
 */
export function revisarResponsive(archivos) {
  const hallazgos = [];

  for (const { ruta, texto } of archivos) {
    if (esPantallaDeImprimir(ruta)) continue;

    const rutaNormal = normalizar(ruta);
    // Cuántos `grid-cols-7` de calendario le quedan por perdonar a este archivo.
    let calendariosPorPerdonar =
      CALENDARIOS.find((c) => c.ruta === rutaNormal)?.cantidad ?? 0;
    // Cuántas tablas sin contenedor le quedan por perdonar a este archivo.
    let tablasPorPerdonar =
      TABLAS_CON_SCROLL_HEREDADO.find((t) => t.ruta === rutaNormal)?.cantidad ?? 0;

    const lineas = texto.split("\n");

    lineas.forEach((contenido, indice) => {
      if (esComentario(contenido)) return;
      const linea = indice + 1;

      for (const m of contenido.matchAll(GRILLA)) {
        const columnas = Number(m[1]);
        if (columnas < 3) continue;

        if (columnas === 7 && calendariosPorPerdonar > 0) {
          calendariosPorPerdonar--;
          continue;
        }

        const porColumna = Math.floor(ANCHO_UTIL / columnas);
        hallazgos.push({
          ruta: rutaNormal,
          linea,
          severidad: porColumna < COLUMNA_MINIMA ? "ROMPE" : "APRETADO",
          que: `grid-cols-${columnas} sin breakpoint: ~${porColumna} px por columna`,
        });
      }

      for (const [clase, regex] of [
        ["w", ANCHO_FIJO],
        ["min-w", MIN_ANCHO_FIJO],
      ]) {
        for (const m of contenido.matchAll(regex)) {
          const ancho = Number(m[1]);
          if (ancho <= ANCHO_UTIL) continue;
          hallazgos.push({
            ruta: rutaNormal,
            linea,
            severidad: "ROMPE",
            que: `${clase}-[${m[1]}px] sin breakpoint: más que los ${ANCHO_UTIL} px útiles`,
          });
        }
      }

      if (/<table[\s>]/.test(contenido)) {
        const desde = Math.max(0, indice - LINEAS_HASTA_EL_CONTENEDOR);
        const arriba = lineas.slice(desde, indice + 1).join("\n");
        if (!CONTENEDOR_CON_SCROLL.test(arriba)) {
          if (tablasPorPerdonar > 0) {
            tablasPorPerdonar--;
          } else {
            hallazgos.push({
              ruta: rutaNormal,
              linea,
              severidad: "MIRAR",
              que: "<table> sin overflow-x-auto en las líneas de arriba",
            });
          }
        }
      }
    });
  }

  return hallazgos;
}

/** Los .tsx de una carpeta, recursivo. */
function archivosTsx(carpeta) {
  const salida = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const completa = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules") continue;
      salida.push(...archivosTsx(completa));
    } else if (entrada.name.endsWith(".tsx")) {
      salida.push(completa);
    }
  }
  return salida;
}

function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const archivos = ["app", "components"]
    .flatMap((c) => archivosTsx(path.join(raiz, c)))
    .map((completa) => ({
      ruta: normalizar(path.relative(raiz, completa)),
      texto: readFileSync(completa, "utf8"),
    }));

  const hallazgos = revisarResponsive(archivos);
  console.log(`${archivos.length} archivos revisados (app/ y components/)`);

  const orden = ["ROMPE", "APRETADO", "MIRAR"];
  for (const severidad of orden) {
    const deEsta = hallazgos.filter((h) => h.severidad === severidad);
    if (deEsta.length === 0) continue;
    console.log(`\n${severidad} (${deEsta.length})\n`);
    for (const h of deEsta) console.log(`  ${h.ruta}:${h.linea}\n      → ${h.que}`);
  }

  const cuenta = (s) => hallazgos.filter((h) => h.severidad === s).length;
  console.log(
    `\nROMPE ${cuenta("ROMPE")} · APRETADO ${cuenta("APRETADO")} · MIRAR ${cuenta("MIRAR")}`
  );

  if (cuenta("ROMPE") > 0) process.exit(1);
}

// Sólo corre al invocarlo directo: el test lo importa y no debe recorrer el árbol.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
