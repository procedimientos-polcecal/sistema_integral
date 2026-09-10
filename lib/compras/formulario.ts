/**
 * El alta de un requerimiento, escrita donde la planilla la puede recibir.
 *
 * Está aparte de `sheets.ts` porque es **otra planilla**: la de respuestas del
 * formulario de Google (`FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`), con otro
 * id, otra hoja y otro encabezado. `sheets.ts` espeja PEDIDOS DE COMPRA y ya
 * tiene 1.100 líneas haciendo eso.
 *
 * POR QUÉ ACÁ Y NO EN EL MASTER
 *
 * En el master las columnas del alta no son datos: `A2` es un
 * `QUERY(IMPORTRANGE(...))` de esta hoja de respuestas, y su salida ocupa A:J.
 * Las pestañas por área son a su vez un `FILTER` del master. O sea que el alta
 * no se puede escribir ni en el master ni en la pestaña del área: se escribe
 * una planilla más arriba y baja sola.
 *
 * Ver `docs/COMPRAS-SINCRONIZACION.md` y el spec del 09/09/2026.
 */

import { norm } from "@/lib/compras/texto";
import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";
import { empresaParaPlanilla, indexarColumnas } from "@/lib/compras/sheets";

/**
 * Cómo se llama cada columna en la hoja. La primera que exista gana.
 *
 * Sólo entran alias que `clave()` distingue entre sí. `"N° RI"` (grado),
 * `"AREA"` sin tilde, `"CÓDIGO"` con tilde y `"DESCRIPCION"` sin tilde no
 * están: `clave()` ya les saca el acento y el `°`/`º`, así que quedan idénticas
 * a la anterior de su misma lista y nunca se pueden alcanzar. Tenerlas no
 * cambiaba qué columna se encuentra — sólo ensuciaba los motivos con un alias que
 * la comparación real ya había descartado (`"area (ÁREA o AREA)"`, que se
 * contradice solo).
 */
const ALIAS = {
  nro_ri: ["Nº RI", "NRO RI"],
  marca: ["Marca temporal", "Timestamp"],
  nombre: ["Nombre"],
  apellido: ["Apellido"],
  area: ["ÁREA"],
  descripcion: ["DESCRIPCIÓN DEL PEDIDO", "DESCRIPCIÓN"],
  codigo: ["CODIGO"],
  cantidad: ["CANTIDAD A PEDIR", "CANTIDAD", "CAN"],
  ubicacion: ["PARA DONDE SE NECESITA", "DONDE SE NECESITA"],
  fecha_necesidad: ["PARA CUANDO SE NECESITA", "FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLES EXTRA", "DETALLE EXTRA"],
  imagen: ["ARCHIVO COMPLEMENTARIO", "IMAGEN COMPLEMENTARIA", "IMAGEN"],
} as const;

type Clave = keyof typeof ALIAS;

/**
 * Sin qué columnas no se escribe.
 *
 * Son las que hacen que el pedido exista y aparezca donde tiene que aparecer:
 * el número —que lo calcula la fórmula—, la marca temporal —de la que depende
 * esa fórmula—, el área —con la que el `FILTER` de cada pestaña compara letra
 * por letra— y la descripción, que es el pedido. Sin una de ésas, escribir
 * sería dejar una fila que nadie va a poder leer.
 */
const IMPRESCINDIBLES: Clave[] = ["nro_ri", "marca", "area", "descripcion"];

/**
 * Con qué queda encolado un requerimiento recién insertado.
 *
 * El registro **nace en la cola** y la ruta la limpia después, en vez de
 * encolarlo si la escritura falló. Es la única variante que sobrevive a que la
 * plataforma mate la función en el medio: el camino del alta hace ocho llamadas
 * seguidas a Google, y si el corte cae entre el `insert` y el `update` del
 * pendiente, con el orden viejo el pedido quedaba con `sheets_pendiente` nulo
 * —el reintento no lo veía nunca, Configuración decía que no había nada
 * pendiente, y el pedido no llegaba nunca a la planilla—. Encolando antes, lo
 * peor que pasa es que quede en la cola un pedido que sí se escribió, y de eso
 * lo saca el primer reintento, que es idempotente.
 *
 * Es lo que se muestra en /compras/configuracion mientras el alta no se
 * escribió, así que dice el hecho y no promete nada: quién lo reintenta lo
 * decide `reintentarPendientes` por `hoja_origen`, no por este texto.
 */
export const ALTA_SIN_ESCRIBIR = "el alta todavía no se escribió en la planilla";

export interface DatosDelAlta {
  nro_ri: number;
  nombre: string;
  apellido: string;
  area: string;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  ubicacion: string | null;
  /** ISO `2026-09-10`, o null si no la pidieron para una fecha. */
  fecha_necesidad: string | null;
  detalle_extra: string | null;
  imagen_url: string | null;
  creado: Date;
}

export interface Celda {
  /** Desde cero, como la espera `escribirCeldas` del núcleo. */
  columna: number;
  valor: string;
}

export type ResultadoCeldas =
  | { ok: true; fila: number; celdas: Celda[] }
  /**
   * `motivos` y no `faltan`: casi siempre es una columna que no está, pero
   * también puede ser una fecha de creación inválida. Un campo con ese nombre
   * obliga a quien lo muestra a mentir —"falta la columna: la marca temporal no
   * es una fecha válida"—, y ese texto va a parar a `sheets_pendiente`, que es
   * lo que alguien lee para saber qué ir a arreglar.
   */
  | { ok: false; motivos: string[] };

/**
 * Compara nombres de columna sin distinguir acentos, mayúsculas ni el signo de
 * grado/ordinal: `norm` ya saca acentos y colapsa `°`/`º`/`.`, y este filtro de
 * más saca lo que le sobreviva (comas, dos puntos) para que sólo queden letras,
 * números y espacios en ambos lados de la comparación.
 */
const clave = (s: string) => norm(s).replace(/[^A-Z0-9 ]/g, "");

/**
 * La primera columna que un alta no puede tocar: donde empieza lo que el
 * `QUERY` del master ignora.
 *
 * No es un conteo (`Object.keys(ALIAS).length`, "las 12 de ALIAS"): eso tenía
 * dos dueños que no se hablaban entre sí. Agregar una pregunta al formulario
 * corre las columnas reales pero no ese número, así que lo que quedaba después
 * de la pregunta nueva caía fuera de la ventana y se omitía sin aviso —medido:
 * una pregunta antes de `ARCHIVO COMPLEMENTARIO` pierde la imagen; cuatro
 * antes de `DESCRIPCIÓN DEL PEDIDO` pierden ubicación, fecha, detalle e
 * imagen, con `ok: true` los dos casos—. Y al revés, agregar un campo a
 * `ALIAS` por una razón sin relación con el ancho de la hoja ensanchaba la
 * ventana y metía en alcance la `M`, que es de Google y no se toca.
 *
 * El borde real es el encabezado mismo: `DIRECCIÓN EMAIL ENVIADA` es la
 * primera columna ajena al `QUERY`, se llame donde se llame. Con un formulario
 * que sólo agrega preguntas, esa columna se corre pero sigue estando, así que
 * el borde se corre con ella y nada de lo anterior se pierde.
 *
 * La comparación es sensible a acentos y mayúsculas —a propósito, sin pasar
 * por `clave()`—: es la misma razón por la que el bug original existía. Si se
 * comparara sin acento, `ÁREA` (columna `E`, la que hay que llenar) y `Area`
 * (columna `O`, la que hay que ignorar) serían el mismo texto, que es
 * exactamente el "enlazar al que se le parece" que el repo prohíbe.
 *
 * Riesgo asumido: si el día de mañana renombran esa columna (o la borran),
 * este borde no aparece y `celdasDelAlta` se niega a escribir en vez de
 * adivinar un ancho. Es la respuesta correcta —negarse deja el problema a la
 * vista—, pero significa que un alta se cae hasta que alguien actualice esta
 * constante o la hoja vuelva a tener la columna con este nombre exacto.
 */
const COLUMNA_BORDE = "DIRECCIÓN EMAIL ENVIADA";

function indiceBorde(encabezado: string[]): number {
  return encabezado.findIndex((h) => h.trim() === COLUMNA_BORDE);
}

/** En qué columna está cada cosa, por nombre y no por posición. */
function indexar(encabezado: string[], borde: number): Record<Clave, number> {
  const normalizado = encabezado.slice(0, borde).map(clave);
  const idx = {} as Record<Clave, number>;

  for (const [c, alias] of Object.entries(ALIAS) as [Clave, readonly string[]][]) {
    idx[c] = -1;
    for (const a of alias) {
      const i = normalizado.indexOf(clave(a));
      if (i >= 0) { idx[c] = i; break; }
    }
  }
  return idx;
}

/**
 * Qué escribir en la fila `fila` de la hoja de respuestas.
 *
 * El N° de RI va como **valor**, no como fórmula, y esto costó un pedido
 * perdido en producción.
 *
 * La primera versión escribía la misma fórmula que tienen las demás filas
 * —`=IF(B{fila}:B<>"",A{fila-1}+1,"")`— para que el que numerara siguiera
 * siendo uno solo: la planilla. Verificado en el momento de escribir, daba el
 * número correcto. Lo que no sobrevive es lo que pasa después: **Google Forms
 * inserta una fila por cada respuesta, y la inserta justo después de su propia
 * última respuesta**, no después de la última fila con datos. Medido el
 * 09/09/2026: la fila del alta se escribió en la 1957 y dos respuestas la
 * empujaron a la 1959. Su referencia `B` bajó con ella; la referencia `A1956`
 * —que quería decir "la fila de arriba"— se quedó apuntando a la misma celda de
 * siempre. Volvió a calcular `A1956+1` y quedaron **dos RI 1954**: el `upsert`
 * por `nro_ri` de la sincronización los colapsó y el pedido que había entrado
 * por el formulario desapareció del sistema.
 *
 * Una referencia absoluta no puede significar "la de arriba" en una hoja donde
 * alguien inserta filas. Así que el número lo pone el sistema —que ya lo tiene,
 * y con su propio control de que no esté tomado— y **la planilla deja de
 * numerar con una fórmula**: lo hace su Apps Script en cada envío del
 * formulario, con `max(A)+1`, contando también las filas que escribió el
 * sistema. Es lo que mantiene la serie única sin que ninguno de los dos tenga
 * que adivinar dónde va a insertar el otro. Ver
 * `docs/compras-formulario-apps-script.gs`.
 *
 * `fila` vuelve igual en el resultado: ya no hay nada horneado que dependa de
 * ella, pero quien escribe tiene que usar la misma que se verificó libre.
 *
 * Las columnas que el `QUERY` del master ignora no se tocan: `DIRECCIÓN EMAIL
 * ENVIADA` la escribe el Apps Script de los avisos, y ponerle algo sería decir
 * que se avisó cuando no se avisó.
 */
export function celdasDelAlta(
  encabezado: string[],
  datos: DatosDelAlta,
  fila: number
): ResultadoCeldas {
  const borde = indiceBorde(encabezado);
  if (borde < 0) {
    return {
      ok: false,
      motivos: [
        `el borde del alta ("${COLUMNA_BORDE}", que separa lo que un alta puede ` +
          `llenar de lo que escribe Google) no está en el encabezado`,
      ],
    };
  }

  const idx = indexar(encabezado, borde);

  const sinColumna = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map(
    (c) => `${c} (${ALIAS[c].join(" o ")})`
  );
  if (sinColumna.length > 0) return { ok: false, motivos: sinColumna };

  // `serialDelInstante` no valida —lo dice su propio docstring, la
  // responsabilidad es de quien llama—: un `creado` inválido da `NaN`, que
  // como texto es "NaN", no vacío para la fórmula del RI (`=IF(B<>"",...)`) y
  // numeraría un pedido con una marca basura, escrita para siempre.
  const serialMarca = serialDelInstante(datos.creado);
  if (!Number.isFinite(serialMarca)) {
    return {
      ok: false,
      motivos: [`marca temporal (datos.creado no es una fecha válida: ${String(datos.creado)})`],
    };
  }

  const serialNecesidad = datos.fecha_necesidad ? serialDelDia(datos.fecha_necesidad) : null;

  const valores: Partial<Record<Clave, string>> = {
    nro_ri: String(datos.nro_ri),
    marca: String(serialMarca),
    nombre: datos.nombre,
    apellido: datos.apellido,
    area: datos.area,
    descripcion: datos.descripcion,
    codigo: datos.codigo ?? "",
    cantidad: datos.cantidad !== null ? String(datos.cantidad) : "",
    ubicacion: datos.ubicacion ?? "",
    fecha_necesidad: serialNecesidad !== null ? String(serialNecesidad) : "",
    detalle_extra: datos.detalle_extra ?? "",
    imagen: datos.imagen_url ?? "",
  };

  const celdas: Celda[] = [];
  for (const [c, valor] of Object.entries(valores) as [Clave, string][]) {
    const columna = idx[c];
    // Una columna que esta hoja no tiene y no es imprescindible: se omite en
    // silencio. No se escribe en una posición inventada.
    if (columna < 0) continue;
    celdas.push({ columna, valor });
  }
  return { ok: true, fila, celdas };
}

/**
 * A qué fila del master corresponde una fila de la hoja de respuestas.
 *
 * El `QUERY` del master lee `A4:L10000` y su salida arranca en la fila 2, así
 * que son dos menos. Es una cuenta y no una búsqueda porque la fórmula conserva
 * el orden de las respuestas y sólo agrega al final; pero la fila del master
 * puede no existir todavía —`IMPORTRANGE` tarda en refrescar—, y por eso quien
 * escribe **verifica antes de escribir** en vez de confiar en la cuenta.
 *
 * Por la misma razón la cuenta **no se guarda en la base**: `sheets_fila` lleva
 * la fila de la hoja de respuestas, que es un número que se leyó de vuelta. Un
 * dato guardado ya no tiene a la vista que es una suposición, y el que lo lea
 * después va a escribir en esa fila sin comprobar nada.
 */
export function filaDelMaster(filaDeRespuestas: number): number | null {
  const fila = filaDeRespuestas - 2;
  return fila >= 2 ? fila : null;
}

/**
 * Qué escribir de prioridad y empresa según lo que el master tenga.
 *
 * Aparte y pura porque acá vivía el defecto: el chequeo devolvía motivo sólo si
 * faltaban **las dos** columnas, así que con una sola —hay empresa para
 * escribir y el master no tiene esa columna— se escribía la otra y la función
 * informaba que todo había salido bien. Eso va contra la regla del módulo: toda
 * ruta que toque un campo que se exporta tiene que exportar, y si no puede,
 * dejar el pendiente anotado.
 *
 * Los faltantes se acumulan, como hace `exportarRequerimiento` con sus
 * `bloqueadas`, en vez de cortar en el primero.
 *
 * Una celda sin valor no se toca **ni se anota**: no se pisa con vacío —el
 * mismo criterio que la celda de comparativa, que borraba el link de la
 * planilla— y si no hay nada que exportar tampoco hay nada pendiente.
 */
export function celdasDePrioridadYEmpresa(
  columnas: { prioridad: number; empresa: number },
  valores: { prioridad: string; empresa: string }
): { celdas: Celda[]; bloqueadas: string[] } {
  const celdas: Celda[] = [];
  const bloqueadas: string[] = [];

  const cuales = [
    ["prioridad", columnas.prioridad, valores.prioridad, "PRIORIDAD"],
    ["empresa", columnas.empresa, valores.empresa, "EMPRESA o PAGA"],
  ] as const;

  for (const [que, columna, valor, comoSeLlama] of cuales) {
    if (!valor) continue;
    if (columna < 0) {
      bloqueadas.push(
        `hay ${que} para escribir y el master no tiene esa columna (${comoSeLlama})`
      );
      continue;
    }
    celdas.push({ columna, valor });
  }

  return { celdas, bloqueadas };
}

const HOJA_RESPUESTAS = "Respuestas de formulario 1";
const HOJA_MASTER = "Requerimientos internos";

const idFormulario = () => process.env.GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID ?? "";

/**
 * Desde qué fila hay respuestas en la hoja del formulario.
 *
 * La 1 es el encabezado y la 2 y la 3 no son datos: la primera respuesta está
 * en la 4. `filaSiguienteSegunLaColumna` no lo sabe, y si la columna de la
 * marca temporal vuelve vacía o truncada devuelve 2 — ahí la fórmula del N° de
 * RI, que lleva `A{fila-1}+1` horneada adentro, se hornearía contra `A1`, el
 * encabezado. Con 1.955 respuestas cargadas eso no puede pasar por los datos:
 * pasa cuando se leyó la hoja equivocada o la lectura volvió corta, que es
 * justo cuando conviene negarse en vez de escribir.
 */
const PRIMERA_FILA_DE_DATOS = 4;

/**
 * Cuánto puede diferir un serial leído de vuelta del que se escribió.
 *
 * Se escribe como texto decimal, Google lo parsea a un `double` y lo devuelve
 * como número: el ida y vuelta puede mover el último bit. 1e-6 de un día son
 * ocho centésimas de segundo — más fino que cualquier diferencia real entre dos
 * respuestas, y más grueso que el error de redondeo.
 */
const TOLERANCIA_DEL_SERIAL = 1e-6;

/**
 * Si este pedido ya tiene su fila en la hoja de respuestas, cuál es.
 *
 * Existe para que llamar dos veces al alta no pueda escribir dos filas para el
 * mismo pedido. El agujero era éste: la fila se escribe en la planilla y
 * **después** se guarda en la base en qué fila quedó; si ese `update` falla —o
 * el proceso se corta en el medio—, la fila ya está en la planilla y la base no
 * lo sabe, así que un reintento escribía otra. Es la doble numeración que la
 * lectura de control quiere evitar, y no la detectaba porque cada fila, por
 * separado, estaba bien numerada.
 *
 * **No alcanza con que el número coincida**, y por eso también entra la marca
 * temporal. El N° de RI lo asigna la base y el de la planilla lo calcula una
 * fórmula: si alguien manda el formulario de Google entre el alta y esta
 * escritura, hay una fila con nuestro número que **no es la nuestra**. Adoptarla
 * sería enlazar al que se le parece —el pedido quedaría apuntando a la fila de
 * otro y sin fila propia—, que es justo lo que el módulo prohíbe. La marca la
 * escribe el alta con el `created_at` del pedido, así que identifica la fila sin
 * ambigüedad, y se lee en la misma llamada que el número: no cuesta nada.
 *
 * Se busca desde `PRIMERA_FILA_DE_DATOS`: la 1 es el encabezado y la 2 y la 3 no
 * son datos, así que un número que aparezca ahí no es una respuesta.
 *
 * Se comparan los valores crudos y no el texto formateado, por lo mismo que
 * explica `nroDeControl`: `"1.954,00"` limpiado a mano da 195400.
 *
 * `filas` son las columnas `A` (el N°) y `B` (la marca) leídas juntas. Que sean
 * esas dos es la misma suposición que ya hacían la búsqueda de la fila libre
 * (`B:B`) y la lectura de control (`A{fila}`).
 */
export function filaConEsteRi(
  filas: string[][],
  nroRi: number,
  serialDeLaMarca: number
): { fila: number; esNuestra: boolean } | null {
  // Un `nroRi` que no es un número positivo no puede "estar": sin esta guarda,
  // `Number("")` da 0 y un cero coincidiría con la primera fila vacía.
  if (!Number.isFinite(nroRi) || nroRi <= 0) return null;

  for (let i = PRIMERA_FILA_DE_DATOS - 1; i < filas.length; i++) {
    if (Number(String(filas[i]?.[0] ?? "").trim()) !== nroRi) continue;

    const marca = Number(String(filas[i]?.[1] ?? "").trim());
    const esNuestra =
      Number.isFinite(serialDeLaMarca) &&
      Number.isFinite(marca) &&
      Math.abs(marca - serialDeLaMarca) < TOLERANCIA_DEL_SERIAL;

    return { fila: i + 1, esNuestra };
  }
  return null;
}

/**
 * Cómo se nombra cada planilla en un motivo, con el id que hay que ir a mirar.
 *
 * El mensaje de Google no alcanza solo: un 404 dice "conviene revisar el ID
 * configurado" sin decir cuál de los dos, y un 403 no dice a qué planilla hay
 * que darle permiso de editor. Son dos archivos distintos y esto es lo que se
 * muestra en `/compras/configuracion`, así que el paso y la variable van
 * adelante de lo que dijo Google, que se deja sin traducir.
 */
const PLANILLA = {
  respuestas: "la hoja de respuestas (GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID)",
  master: "el master (GOOGLE_SHEETS_COMPRAS_ID)",
} as const;

/**
 * Corre un paso contra Google diciendo cuál era.
 *
 * Un solo `catch` para cinco operaciones sobre dos planillas distintas dejaba
 * motivos que no se podían accionar. Ver `PLANILLA`.
 *
 * El original viaja en `cause`: el `Error` nuevo se queda con el mensaje, y sin
 * eso se perdían el stack y el tipo del que de verdad falló —que es lo único que
 * sirve cuando lo que se rompió está dos capas más abajo, en `fetch`—.
 */
async function paso<T>(cual: string, hacer: () => Promise<T>): Promise<T> {
  try {
    return await hacer();
  } catch (e) {
    throw new Error(`${cual}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

export interface ResultadoAlta {
  /** En qué fila de la hoja de respuestas quedó. */
  fila: number | null;
  /**
   * Qué anotar en `sheets_pendiente`. Es la cola del reintento de cada
   * sincronización, así que lo esperable también va acá: es lo que hace que
   * prioridad y empresa se acomoden solas.
   */
  pendiente: string | null;
  /**
   * Qué decirle a quien cargó el pedido, o `null` si no hay nada que le
   * importe. Que la planilla tarde en refrescar no es noticia para él: un
   * cartel que aparece siempre y se arregla solo enseña a ignorar los carteles.
   */
  avisar: string | null;
}

/** Lo que dejó una escritura: qué encolar y qué mostrar. Ver `ResultadoAlta`. */
type Aviso = Omit<ResultadoAlta, "fila">;

/** Nada que encolar y nada que decir. */
const listo: Aviso = { pendiente: null, avisar: null };

/**
 * Un fallo de verdad: se encola para el reintento y se le dice a quien hizo la
 * acción, que es la regla del módulo para cualquier fallo de escritura.
 */
const falla = (motivo: string): Aviso => ({ pendiente: motivo, avisar: motivo });

/**
 * Lo esperable: se encola —el reintento es lo que lo va a resolver— y no se
 * muestra.
 */
const enLaCola = (motivo: string): Aviso => ({ pendiente: motivo, avisar: null });

/**
 * Lo que dice una celda de control, y qué N° de RI es.
 *
 * Se lee con `sinFormato` y no el texto que se ve. Limpiar el texto formateado
 * con `replace(/[^0-9]/g, "")` andaba de casualidad con separador de miles
 * (`"1.954"` → `1954`) y mentía con un formato de decimales (`"1.954,00"` →
 * `195400`): el pendiente decía "la planilla numeró esa fila como 195400" y
 * mandaba a revisar a mano una numeración que estaba perfecta. El valor crudo
 * es lo que el módulo ya decidió para cualquier comparación de valores.
 *
 * Vuelve también el texto tal cual porque **vacío y raro no son lo mismo**: una
 * celda vacía es que la fórmula todavía no bajó, y cualquier otra cosa que no
 * sea este RI es un problema que alguien tiene que mirar.
 */
function nroDeControl(valores: string[][]): { texto: string; nro: number } {
  const texto = String(valores[0]?.[0] ?? "").trim();
  const nro = Number(texto);
  return { texto, nro: Number.isFinite(nro) ? nro : 0 };
}

/**
 * Escribe el alta de un requerimiento en la hoja de respuestas del formulario.
 *
 * Sin la variable de entorno no hace nada y **no es un error**: se omite, igual
 * que la sincronización sin `GOOGLE_SHEETS_COMPRAS_ID`. Mientras la planilla no
 * esté configurada, el sistema funciona solo.
 *
 * Lo que puede fallar queda en `pendiente` en vez de lanzar: el pedido ya está
 * guardado y perderlo por no poder escribir la planilla sería peor. Por eso las
 * consultas a la base van **adentro** del `try` y no antes: `supabase-js` no
 * lanza por un error de consulta, pero sí rechaza por un fallo de red, y con el
 * `try` empezando más abajo esta función sí podía lanzar aunque el docstring
 * prometiera que no.
 *
 * **Llamarla dos veces no duplica nada.** Antes de escribir busca este N° de RI
 * en la columna del N° de la hoja de respuestas; si ya está, no escribe otra
 * fila y sigue con la verificación y con el master, que son los pasos que
 * podrían haber quedado a medias. Ver `filaConEsteRi`.
 *
 * RIESGO ASUMIDO
 *
 * Prioridad y empresa son las dos columnas del master que no salen de la
 * fórmula, y el master está una planilla más abajo de la que se escribe acá:
 * entre las dos hay un `IMPORTRANGE` que Google refresca por su cuenta y que no
 * se puede forzar desde la API. Así que en el alta casi siempre **no se
 * escriben**: las escribe el reintento de la próxima sincronización, hasta 15
 * minutos después —que es cada cuánto pega el workflow de GitHub Actions—. En
 * esa ventana, quien mire la planilla ve el pedido sin prioridad y sin empresa.
 */
export async function exportarAltaAlFormulario(
  requerimientoId: string
): Promise<ResultadoAlta> {
  if (!idFormulario() || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    // Sin la planilla configurada esto NO es "salió bien": el pedido no llegó a
    // ninguna parte. Y como la ruta escribe siempre lo que devolvemos, un
    // `listo` acá **limpiaba la cola** en la que el pedido acababa de entrar:
    // cada alta se salteaba la planilla en silencio, sin pendiente y sin log,
    // y el día que alguien rote mal la variable en Vercel nadie se enteraría.
    // Es el patrón que este módulo ya pagó dos veces.
    //
    // Va a la cola y no a la pantalla: quien carga un pedido no puede hacer
    // nada con una variable de entorno, y el pendiente lo ve Compras en
    // /compras/configuracion, que es quien sí puede. Se resuelve solo en el
    // primer reintento después de que la variable vuelva.
    //
    // Riesgo asumido: en un despliegue que a propósito no espeje el formulario,
    // cada alta queda con este pendiente puesto. Es el precio de no poder
    // distinguir "no lo configuraron" de "se configuró mal", y de los dos lados
    // el que no avisa es peor.
    return {
      fila: null,
      ...enLaCola(
        "la planilla del formulario no está configurada (falta " +
          "GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID o GOOGLE_SERVICE_ACCOUNT_JSON): " +
          "el pedido no se escribió en ninguna planilla"
      ),
    };
  }

  // Fuera del `try` para que el `catch` la pueda devolver. Si falla la lectura
  // de vuelta, el alta YA está en la planilla y contestar `fila: null` haría
  // pensar que no se escribió.
  //
  // Que un reintento no duplique la fila ya no depende de esto: lo garantiza
  // `filaConEsteRi`, que busca el N° de RI en la columna A antes de escribir.
  // Devolverla igual sigue sirviendo para saber dónde quedó sin ir a mirar.
  let filaEscrita: number | null = null;

  try {
    const admin = createAdminClient();

    // `maybeSingle` y no `single`: con `single`, "no existe" también viene como
    // error, y acá los dos casos se contestan distinto.
    const { data: r, error } = await admin
      .from("compras_requerimientos")
      .select("id, nro_ri, descripcion, codigo, cantidad, fecha_necesidad, detalle_extra, imagen_url, created_at, solicitante_id, solicitante_nombre, compras_areas(nombre), compras_ubicaciones(nombre)")
      .eq("id", requerimientoId)
      .maybeSingle();

    // Un error de consulta NO es "todo bien, se omitió". Antes se descartaba, y
    // con eso el día que se renombre una columna del `select` o falle el
    // service-role, PostgREST contesta 400 con `data: null` y **cada alta se
    // saltearía la planilla en silencio**: sin pendiente, sin log y sin nada
    // que mirar. Sólo el pedido que de verdad no existe se omite sin pendiente.
    if (error) {
      return {
        fila: null,
        ...falla(`no se pudo leer el pedido para exportarlo: ${error.message}`),
      };
    }
    if (!r) return { fila: null, ...listo };

    const area = (r.compras_areas as unknown as { nombre: string } | null)?.nombre;
    if (!area) {
      // El área es con lo que el FILTER de cada pestaña compara: sin ella el
      // pedido aparecería en el master y en ninguna pestaña.
      return {
        fila: null,
        ...falla("el pedido no tiene área, y la planilla la necesita"),
      };
    }

    // El nombre y el apellido van en columnas separadas. `solicitante_nombre`
    // los trae pegados, así que se prefiere el usuario.
    let nombre = "";
    let apellido = "";
    if (r.solicitante_id) {
      const { data: u, error: errorUsuario } = await admin
        .from("usuarios")
        .select("nombre, apellido")
        .eq("id", r.solicitante_id as string)
        .maybeSingle();
      // El `error` no se descarta, igual que en los otros dos `select`. Acá la
      // consecuencia es más leve —se cae al split de `solicitante_nombre`, que
      // parte "Juan Perez" en dos y suele quedar bien— pero justamente por eso
      // un fallo de red era indistinguible de "el usuario no tiene nombre
      // cargado", y el alta se escribía con el nombre partido a mano sin que
      // nada lo dijera.
      if (errorUsuario) {
        return {
          fila: null,
          ...falla(
            `no se pudo leer el nombre de quien pidió: ${errorUsuario.message}`
          ),
        };
      }
      nombre = (u?.nombre as string) ?? "";
      apellido = (u?.apellido as string) ?? "";
    }
    if (!nombre && r.solicitante_nombre) {
      const partes = String(r.solicitante_nombre).trim().split(/\s+/);
      nombre = partes[0] ?? "";
      apellido = partes.slice(1).join(" ");
    }

    const encabezado =
      (
        await paso(`al leer el encabezado de ${PLANILLA.respuestas}`, () =>
          leerValores(idFormulario(), `${HOJA_RESPUESTAS}!1:1`)
        )
      )[0] ?? [];

    // Se leen las dos primeras columnas de una sola vez, porque hacen falta las
    // dos y por cosas distintas: la `A` es el N° de RI —para no escribir dos
    // veces el mismo pedido, ver `filaConEsteRi`— y la `B` es la marca temporal,
    // que es la que dice dónde termina lo cargado.
    //
    // La fila libre se busca por la marca temporal y NO por la columna del N°
    // de RI: esa columna tiene una fórmula en todas las filas de la grilla, y
    // aunque hoy devuelva vacío para las filas sin marca, depender de eso es
    // depender de que la fórmula siga escrita igual.
    //
    // `sinFormato: true` acá y no en el encabezado: a `filaSiguienteSegunLaColumna`
    // sólo le importa si la celda tiene algo, no qué dice. Con el texto formateado
    // se corre el mismo riesgo que ya pasó en Despacho con una columna de fecha:
    // un formato particular puede mostrar vacía una celda que sí tiene serial, y
    // ahí la cuenta de la fila libre se corre y una respuesta nueva pisa a otra. El
    // valor crudo no tiene ese problema y no cuesta nada pedirlo así. Y para
    // comparar el N° de RI hace falta igual.
    const columnas = await paso(`al buscar la fila libre en ${PLANILLA.respuestas}`, () =>
      leerValores(idFormulario(), `${HOJA_RESPUESTAS}!A:B`, { sinFormato: true })
    );

    // Si este pedido ya tiene su fila, no se escribe otra: se sigue con la
    // verificación y con el master, que son los pasos que pueden haber quedado a
    // medias. Con esto, llamar dos veces a esta función no puede duplicar nada.
    //
    // Y si hay una fila con este número que **no** es la nuestra, no se escribe
    // ni se adopta: el número ya está tomado —lo más probable es que alguien
    // haya mandado el formulario de Google en el medio—, así que una fila nueva
    // saldría numerada distinto de lo que dice la base y adoptar la ajena
    // dejaría el pedido apuntando a la fila de otro. Se dice y se corrige a
    // mano; escribir de nuevo sólo agregaría una fila para tirar. Ver
    // `filaConEsteRi`.
    //
    // El serial se calcula igual que en `celdasDelAlta` y con el mismo
    // `created_at`, que es lo que hace que reconozca su propia fila. Si algún
    // día dejaran de coincidir, esto no la reconocería y el alta se caería con
    // el mensaje de abajo: ruidoso, pero nunca duplicando ni enlazando mal, que
    // es de qué lado conviene errar.
    const serialMarca = serialDelInstante(new Date((r.created_at as string) ?? Date.now()));
    const yaEstaba = filaConEsteRi(columnas, r.nro_ri as number, serialMarca);

    if (yaEstaba && !yaEstaba.esNuestra) {
      return {
        fila: null,
        ...falla(
          `la fila ${yaEstaba.fila} de la hoja de respuestas ya tiene el RI ${r.nro_ri} y no es ` +
            `la de este pedido: no se escribió nada para no quedar enlazado a la fila de otro, ` +
            `y hay que revisar la numeración a mano`
        ),
      };
    }

    let filaDelAlta: number;

    if (yaEstaba) {
      filaDelAlta = yaEstaba.fila;
    } else {
      const libre = filaSiguienteSegunLaColumna(
        // Sólo la `B`: `filaSiguienteSegunLaColumna` mira la primera celda de
        // cada fila que se le pasa.
        columnas.map((f) => [String(f?.[1] ?? "")])
      );
      if (libre < PRIMERA_FILA_DE_DATOS) {
        return {
          fila: null,
          ...falla(
            `la columna de la marca temporal volvió con muy poco y la fila libre daría la ` +
              `${libre}, cuando los datos empiezan en la ${PRIMERA_FILA_DE_DATOS}: no se ` +
              `escribió nada, hay que revisar que se esté leyendo la hoja ` +
              `"${HOJA_RESPUESTAS}" y que la lectura no haya vuelto corta`
          ),
        };
      }

      const armado = celdasDelAlta(
        encabezado,
        {
          nro_ri: r.nro_ri as number,
          nombre,
          apellido,
          area,
          descripcion: r.descripcion as string,
          codigo: (r.codigo as string | null) ?? null,
          cantidad: (r.cantidad as number | null) ?? null,
          ubicacion: (r.compras_ubicaciones as unknown as { nombre: string } | null)?.nombre ?? null,
          fecha_necesidad: (r.fecha_necesidad as string | null) ?? null,
          detalle_extra: (r.detalle_extra as string | null) ?? null,
          imagen_url: (r.imagen_url as string | null) ?? null,
          creado: new Date((r.created_at as string) ?? Date.now()),
        },
        libre
      );

      if (!armado.ok) {
        return {
          fila: null,
          ...falla("no se pudo armar la fila del alta: " + armado.motivos.join("; ")),
        };
      }

      // Se escribe en la fila que devolvió `celdasDelAlta`, no en la de acá: la
      // fórmula del N° de RI la lleva horneada adentro.
      await paso(`al escribir ${PLANILLA.respuestas}`, () =>
        escribirCeldas(
          idFormulario(),
          armado.celdas.map((c) => ({
            pestana: HOJA_RESPUESTAS,
            columna: c.columna,
            fila: armado.fila,
            valor: c.valor,
          }))
        )
      );
      filaDelAlta = armado.fila;
    }
    filaEscrita = filaDelAlta;

    // Qué número calculó la planilla. Si no es el que asignó el sistema, hay un
    // hueco o una fila de más: se dice, en vez de dejar dos números para el
    // mismo pedido.
    const escrito = await paso(
      `al leer de vuelta el número que calculó ${PLANILLA.respuestas}`,
      () =>
        leerValores(idFormulario(), `${HOJA_RESPUESTAS}!A${filaDelAlta}`, { sinFormato: true })
    );
    const numerada = nroDeControl(escrito);
    if (numerada.nro !== r.nro_ri) {
      return {
        fila: filaDelAlta,
        ...falla(
          `la planilla numeró esa fila como ${numerada.texto || "(vacío)"} y el sistema ` +
            `la había dado de alta como ${r.nro_ri}: hay que revisar la numeración a mano`
        ),
      };
    }

    // Se guarda **el hecho y no la cuenta**: la hoja de respuestas y la fila que
    // se escribió ahí, que es un número que se leyó de vuelta. Antes se guardaba
    // el master con `fila − 2`, que es una suposición sobre qué va a hacer el
    // `QUERY`; y el atajo de `exportarRequerimiento` —`hoja_origen` es el master,
    // así que `sheets_fila` sirve— la tomaba sin verificar la columna A. O sea
    // que el reintento le escribía prioridad y empresa a una fila del master que
    // nadie comprobó, que es justo lo que `escribirPrioridadYEmpresa` se niega a
    // hacer acá abajo: escribir a ciegas es ponerle la prioridad de este pedido
    // a otro.
    //
    // Con la hoja de respuestas guardada, ese atajo no aplica y
    // `exportarRequerimiento` resuelve la fila con `filaEnMaster`, que la busca
    // por la columna A. La importación después sobreescribe las dos columnas con
    // la pestaña de área, como hace con todos los RI, y eso es lo que
    // corresponde: es donde se escriben las columnas de compra.
    await admin
      .from("compras_requerimientos")
      .update({
        hoja_origen: HOJA_RESPUESTAS,
        sheets_fila: filaDelAlta,
        sheets_sincronizado_en: new Date().toISOString(),
      })
      .eq("id", requerimientoId);

    return {
      fila: filaDelAlta,
      ...(await escribirPrioridadYEmpresa(admin, r.id as string, filaDelAlta)),
    };
  } catch (e) {
    return { fila: filaEscrita, ...falla(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Prioridad y empresa, en las columnas a mano del master.
 *
 * Las elige quien pide, en el alta, y en la planilla son dos columnas que no
 * salen de ninguna fórmula. Si no se escriben, quien mira la planilla no las ve.
 *
 * **Se verifica la fila antes de escribir**, y casi siempre la verificación
 * dice que todavía no: la cuenta `fila − 2` vale mientras el `QUERY` conserve
 * el orden, pero entre las dos planillas hay un `IMPORTRANGE` que Google
 * refresca por su cuenta y puede tardar minutos —no se puede forzar desde la
 * API—, y esto corre milisegundos después de escribir la hoja de respuestas.
 * Escribir a ciegas sería ponerle la prioridad de este pedido a otro.
 *
 * Por eso los dos resultados de la verificación se cuentan distinto:
 *
 *   - **la fila del master vacía es lo normal** —la planilla no refrescó
 *     todavía—, así que queda en la cola del reintento y no se le muestra a
 *     quien cargó el pedido: un cartel que aparece siempre y se arregla solo
 *     enseña a ignorar los carteles;
 *   - **que diga otro RI** es un problema de verdad —el `QUERY` no conservó el
 *     orden, o hay una fila de más— y se avisa.
 *
 * Las dos dejan pendiente, porque el pendiente **es** la cola del reintento:
 * quien termina escribiéndolas es `exportarRequerimiento` en la próxima
 * sincronización, cuando `IMPORTRANGE` ya refrescó.
 */
async function escribirPrioridadYEmpresa(
  admin: ReturnType<typeof createAdminClient>,
  requerimientoId: string,
  filaDeRespuestas: number
): Promise<Aviso> {
  const idMaster = process.env.GOOGLE_SHEETS_COMPRAS_ID;
  const fila = filaDelMaster(filaDeRespuestas);
  if (!idMaster || fila === null) return listo;

  const { data: r, error } = await admin
    .from("compras_requerimientos")
    .select("nro_ri, prioridad, paga_ambas, empresas!empresa_id(nombre)")
    .eq("id", requerimientoId)
    .maybeSingle();

  // Igual que arriba: un error de consulta no se puede contestar como "no había
  // nada que escribir".
  if (error) {
    return falla(`no se pudo leer prioridad y empresa del pedido: ${error.message}`);
  }
  if (!r) return listo;

  const valores = {
    prioridad: (r.prioridad as string | null) ?? "",
    empresa: empresaParaPlanilla(
      (r.empresas as unknown as { nombre: string } | null)?.nombre,
      r.paga_ambas === true
    ),
  };
  if (!valores.prioridad && !valores.empresa) return listo;

  const encabezado =
    (
      await paso(`al leer el encabezado de ${PLANILLA.master}`, () =>
        leerValores(idMaster, `${HOJA_MASTER}!1:1`)
      )
    )[0] ?? [];
  // El indexador es el de `sheets.ts` y no una tabla de alias propia: son las
  // mismas dos columnas de la misma hoja, y tenerla duplicada acá significaba
  // que el día que alguien sume un alias allá, esto no se entera.
  const idx = indexarColumnas(encabezado);

  const { celdas, bloqueadas } = celdasDePrioridadYEmpresa(
    { prioridad: idx.prioridad, empresa: idx.empresa },
    valores
  );
  if (celdas.length === 0) return falla(bloqueadas.join("; "));

  const enElMaster = await paso(`al verificar la fila del RI en ${PLANILLA.master}`, () =>
    leerValores(idMaster, `${HOJA_MASTER}!A${fila}`, { sinFormato: true })
  );
  const enLaFila = nroDeControl(enElMaster);
  if (enLaFila.texto === "") {
    return enLaCola(
      `la fila ${fila} del master todavía no dice el RI ${r.nro_ri}: el IMPORTRANGE no ` +
        `refrescó, así que prioridad y empresa las escribe el próximo reintento`
    );
  }
  if (enLaFila.nro !== r.nro_ri) {
    return falla(
      `la fila ${fila} del master dice ${enLaFila.texto} y no el RI ${r.nro_ri}: no se ` +
        `escribieron prioridad ni empresa, y hay que revisar el orden del master a mano`
    );
  }

  await paso(`al escribir prioridad y empresa en ${PLANILLA.master}`, () =>
    escribirCeldas(
      idMaster,
      celdas.map((c) => ({ pestana: HOJA_MASTER, columna: c.columna, fila, valor: c.valor }))
    )
  );

  return bloqueadas.length > 0 ? falla(bloqueadas.join("; ")) : listo;
}
