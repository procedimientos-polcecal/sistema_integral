/*
 * ¿Hay en el código una capa que tapa la pantalla y no pasa por `components/Modal.tsx`?
 *
 *   node scripts/revisar-modales.mjs
 *
 * Existe por la misma razón que sus hermanas, `revisar-responsive` y
 * `revisar-exportaciones`: **escribir un modal a mano no rompe nada, y ése es el
 * problema.** Compila, se ve bien, y recién cuando alguien carga un formulario
 * largo y toca fuera por error se descubre que ese modal no pide confirmar, no
 * recuerda lo cargado y no cierra con Escape como los demás.
 *
 * Medido: entre el 11/11 y el 13/11/2026 aparecieron **tres modales nuevos
 * escritos a mano —de 45 a 48— y un módulo nuevo sin proveedor de confirmación**.
 * Dos días. Sin esto, la inconsistencia que se acaba de ordenar vuelve sola.
 *
 * Qué hace: recorre `app/` y `components/` buscando una capa a pantalla completa,
 * en sus dos escrituras —`fixed inset-0` en un `className`, y
 * `position: "fixed", inset: 0` en un `style`— y marca la que no venga de
 * `components/Modal.tsx` ni esté en la lista de excepciones de abajo.
 *
 * Mira el **texto** de los archivos, como `revisar-responsive`: casi todo está
 * detrás del login y no hay DOM que abrir. Por eso es aproximado: busca un patrón,
 * no entiende qué es un modal.
 *
 * Severidades:
 *
 *   ROMPE   una capa a pantalla completa que no es `components/Modal.tsx` ni una
 *           excepción declarada. Es un modal escrito a mano, o una capa nueva
 *           que hay que decidir: o pasa por `Modal`, o se declara abajo con su
 *           porqué.
 *   MIRAR   la lista de excepciones y el árbol no coinciden: una excepción que ya
 *           no aparece (el código cambió y la entrada quedó mintiendo), o
 *           `components/Modal.tsx` sin ninguna capa (el patrón dejó de verlo y el
 *           chequeo estaría diciendo verde sin mirar nada).
 *
 * Son dos y no tres como en `revisar-responsive` porque acá no hay un término
 * medio entre «es una capa que no pasa por Modal» y «no lo es»: no existe el
 * «apretado».
 *
 * **Sale 1 si hay algún ROMPE, y NO está en el CI**, por lo mismo que las otras
 * dos: hasta que la lista de excepciones aguante unas semanas, un CI rojo por
 * falsos positivos no lo mira nadie.
 *
 * **Lo que NO ve, y conviene tenerlo presente:**
 *
 *   - Una capa escrita con otras clases que den el mismo efecto
 *     (`fixed top-0 left-0 right-0 bottom-0`, `fixed inset-x-0 inset-y-0`,
 *     `fixed w-screen h-screen`) o con `inset` partido en dos líneas del `style`.
 *     Sólo reconoce `inset-0` y `inset: 0`.
 *   - Un `className` armado en pedazos o en una variable: si `fixed` y `inset-0`
 *     no están en la misma línea (o el `position` y el `inset` del `style` a más
 *     de tres líneas), no lo junta.
 *   - Un modal que no tapa la pantalla: un panel `fixed right-0 w-96`, una hoja
 *     anclada abajo, un `<dialog>`. Tampoco los ve.
 *   - Qué hay adentro de la capa. Una excepción declarada abajo está perdonada
 *     para siempre aunque alguien le meta un formulario después: la defensa es el
 *     porqué escrito al lado, que dice «acá no se escribe nada».
 *   - Que un modal que sí pasa por `Modal` lo use bien (`alCerrar`, el borrador).
 *     Eso lo cubren los tests de la capa de borradores, no esto.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** El único archivo cuya capa a pantalla completa es la buena. */
export const EL_MODAL = "components/Modal.tsx";

/**
 * **Capas a pantalla completa que no son un formulario, y por eso no pasan por
 * `Modal`.** Se perdonan por archivo y por cantidad, como los calendarios de
 * `revisar-responsive`: la excepción es para esas capas, no para el archivo
 * entero. Una capa más en el mismo archivo tiene que salir.
 *
 * Lo que decide si algo va acá es una sola pregunta: **¿se puede perder algo
 * cargado al cerrarla?** `Modal` existe para que cerrar por accidente no cueste
 * lo escrito; donde no hay nada escrito que perder, pedir confirmación sería una
 * molestia diaria sin ganancia.
 */
export const EXCEPCIONES = [
  {
    ruta: "components/Sidebar.tsx",
    cantidad: 1,
    porque:
      "El fondo oscuro del cajón de navegación del teléfono (`md:hidden`). Tocarlo " +
      "cierra el menú, que es lo que espera cualquiera. No es un formulario: no se " +
      "escribe nada ahí, así que no hay nada que perder, y pedir confirmación al " +
      "cerrar un menú sería una molestia de todos los días.",
  },
  {
    ruta: "components/Asistente.tsx",
    cantidad: 1,
    porque:
      "El panel lateral del asistente (Ctrl+K). Tiene un campo de texto, así que no " +
      "es que no se escriba nada: es que **no se pierde al cerrarlo**. `texto` y la " +
      "conversación (`useChat`) viven en `Asistente`, que sigue montado; sólo el " +
      "panel es condicional (`abierto &&`), así que al reabrirlo la pregunta a medias " +
      "y los mensajes siguen ahí. Si alguna vez ese estado pasa adentro del panel, " +
      "esta excepción deja de valer.",
  },
  {
    ruta: "app/(app)/mantenimiento/partes-contratista/CuadernoClient.tsx",
    cantidad: 1,
    porque:
      "`Ampliada`: la foto de una página del cuaderno a pantalla completa, con " +
      "alejar/acercar. Es un visor: no hay campo ni estado de formulario, y cerrarlo " +
      "(por el botón) no pierde nada.",
  },
  // Las dos que siguen NO estaban en la lista de la tarea: aparecieron al buscar la
  // escritura en `style`, que el `fixed inset-0` de las clases no ve.
  {
    ruta: "components/ConfirmProvider.tsx",
    cantidad: 1,
    porque:
      "El diálogo de confirmación, que es **lo que `Modal` y los borradores usan para " +
      "preguntar** antes de tirar algo. No puede pasar por `Modal`: sería una " +
      "pregunta de confirmar adentro de otra, y cerrarlo (tocar fuera = «no») no " +
      "tiene qué perder, porque sólo contiene el texto de la pregunta.",
  },
  {
    ruta: "components/InfoTip.tsx",
    cantidad: 1,
    porque:
      "La capa **transparente** que atrapa el toque fuera del globito de ayuda para " +
      "cerrarlo (`zIndex: 49`, sin fondo). No es un modal: no tapa nada a la vista " +
      "ni contiene nada, es un cerrador de tooltip.",
  },
];

/** Las rutas siempre con `/`, también en Windows. */
const normalizar = (ruta) => ruta.replaceAll("\\", "/");

const esComentario = (linea) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(linea);

/** Un token de clase sin prefijo de breakpoint ni de variante. */
const SIN_PREFIJO = String.raw`(?<![\w:\-\[])`;
const FIXED = new RegExp(`${SIN_PREFIJO}fixed(?![\\w\\-])`);
const INSET_0 = new RegExp(`${SIN_PREFIJO}inset-0(?![\\w\\-])`);
const POSITION_FIXED = /position:\s*["']fixed["']/;
const INSET_STYLE = /inset:\s*0\b/;

/** Cuántas líneas hacia adelante se busca el `inset: 0` de un `position: "fixed"`. */
const LINEAS_DEL_STYLE = 3;

/**
 * Las capas a pantalla completa de un archivo, como números de línea.
 * Cuenta una por `fixed inset-0` y una por `position: "fixed"` con su `inset: 0`
 * a pocas líneas.
 */
function capasDe(texto) {
  const lineas = texto.split("\n");
  const capas = [];
  lineas.forEach((contenido, indice) => {
    if (esComentario(contenido)) return;
    if (FIXED.test(contenido) && INSET_0.test(contenido)) capas.push(indice + 1);
    if (POSITION_FIXED.test(contenido)) {
      const ventana = lineas.slice(indice, indice + 1 + LINEAS_DEL_STYLE).join("\n");
      if (INSET_STYLE.test(ventana)) capas.push(indice + 1);
    }
  });
  return capas;
}

/**
 * Busca capas a pantalla completa que no pasan por `Modal`.
 *
 * Es pura, como la de `revisar-responsive`: recibe el texto y devuelve los
 * hallazgos, sin tocar el disco.
 *
 * @param {{ruta: string, texto: string}[]} archivos
 * @returns {{ruta: string, linea: number, severidad: "ROMPE" | "MIRAR", que: string}[]}
 */
export function revisarModales(archivos) {
  const hallazgos = [];
  const vistos = new Set();

  for (const { ruta, texto } of archivos) {
    const rutaNormal = normalizar(ruta);
    vistos.add(rutaNormal);
    const capas = capasDe(texto);

    if (rutaNormal === EL_MODAL) {
      if (capas.length === 0) {
        hallazgos.push({
          ruta: rutaNormal,
          linea: 1,
          severidad: "MIRAR",
          que: "el Modal no tiene ninguna capa a pantalla completa: el patrón dejó de verlo y este chequeo no está mirando nada",
        });
      }
      continue;
    }

    const perdonadas = EXCEPCIONES.find((e) => e.ruta === rutaNormal)?.cantidad ?? 0;
    capas.forEach((linea, i) => {
      if (i < perdonadas) return;
      hallazgos.push({
        ruta: rutaNormal,
        linea,
        severidad: "ROMPE",
        que: "capa a pantalla completa que no pasa por components/Modal.tsx: usar <Modal>, o declararla en EXCEPCIONES con su porqué",
      });
    });

    if (perdonadas > capas.length) {
      hallazgos.push({
        ruta: rutaNormal,
        linea: 1,
        severidad: "MIRAR",
        que: `la excepción declara ${perdonadas} capa(s) y el archivo tiene ${capas.length}: la entrada de EXCEPCIONES quedó desactualizada`,
      });
    }
  }

  for (const e of EXCEPCIONES) {
    if (!vistos.has(e.ruta)) {
      hallazgos.push({
        ruta: e.ruta,
        linea: 1,
        severidad: "MIRAR",
        que: "la excepción apunta a un archivo que ya no existe: sacarla de EXCEPCIONES",
      });
    }
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

  const hallazgos = revisarModales(archivos);
  console.log(`${archivos.length} archivos revisados (app/ y components/)`);

  console.log(`\nExcepciones declaradas (${EXCEPCIONES.length}), capas que no son un formulario:\n`);
  for (const e of EXCEPCIONES) console.log(`  ${e.ruta}  (${e.cantidad})`);

  for (const severidad of ["ROMPE", "MIRAR"]) {
    const deEsta = hallazgos.filter((h) => h.severidad === severidad);
    if (deEsta.length === 0) continue;
    console.log(`\n${severidad} (${deEsta.length})\n`);
    for (const h of deEsta) console.log(`  ${h.ruta}:${h.linea}\n      → ${h.que}`);
  }

  const cuenta = (s) => hallazgos.filter((h) => h.severidad === s).length;
  console.log(`\nROMPE ${cuenta("ROMPE")} · MIRAR ${cuenta("MIRAR")}`);

  if (cuenta("ROMPE") > 0) process.exit(1);
}

// Sólo corre al invocarlo directo: un test lo puede importar sin recorrer el árbol.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
