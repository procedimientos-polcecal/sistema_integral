/**
 * La falla que tuvo el equipo: el vocabulario con el que se anota y el ranking
 * de qué se repite más.
 *
 * POR QUÉ EXISTE
 *
 * Una OT cuenta **qué se hizo** y nunca **por qué falló la máquina**. "Cambio
 * de eje" no dice si el eje se rompió por fricción, por un golpe o porque nunca
 * se lubricó, y esas tres cosas se arreglan distinto. Desde el 26/10/2026, al
 * dar una orden por realizada se puede anotar la falla, y la ficha del equipo
 * muestra cuál se repite.
 *
 * POR QUÉ DOS LISTAS Y NO UN CAMPO DE TEXTO
 *
 * Contar "cuál se repite" exige que la misma falla se escriba igual dos veces,
 * y el texto libre no lo logra. Medido sobre las 976 correctivas del
 * 26/10/2026, tomando la descripción como lo más parecido a una falla que había
 * hasta entonces: de 178 equipos, sólo **18** tenían dos veces el mismo texto
 * exacto. Y lo que sí se repetía, se repetía escrito de tres formas —
 *
 *     8×  SE ROTAN MARTILLOS
 *     8×  ROTACION DE MARTILLOS
 *     7×  CAMBIO DE MARTILLOS
 *
 * veintitrés órdenes del mismo evento en el mismo equipo, que para cualquier
 * conteo son tres fallas distintas.
 *
 * Son **dos** listas y no una sola con las frases ya armadas porque ocho por
 * ocho son 64 renglones, que ya no es una lista corta.
 *
 * TRES COSAS QUE NO SE VEN EN LAS LISTAS
 *
 * - **No hay "Otro".** El día que exista, la mitad cae ahí y se termina el
 *   conteo. Si la falla no entra en ninguna, el campo queda vacío y se escribe
 *   el detalle: una falla con sólo detalle igual cuenta, como «Sin clasificar».
 * - **Las claves van sin ñ** —`MATERIAL_EXTRANO`—, como todas las del sistema:
 *   `norm()` descompone la ñ y le saca la tilde, así que una clave con ñ no
 *   matchea contra su propia forma normalizada. Ya mordió dos veces en el repo.
 * - **Cada entrada tiene dos textos.** `etiqueta` es lo que muestra el
 *   desplegable —"Rotura / quebradura"— y `corta` es con lo que se arma el
 *   título del ranking, que si no quedaría "Rotura / quebradura por fricción o
 *   roce" en vez de "Rotura por fricción".
 */

import { z } from "zod";

export interface OpcionDeFalla {
  /** Lo que se guarda en la base. En mayúsculas, sin acentos y sin ñ. */
  clave: string;
  /** Lo que muestra el desplegable. */
  etiqueta: string;
  /** Con lo que se arma el título del ranking. */
  corta: string;
}

/** Qué le pasó a la pieza. */
export const MODOS_DE_FALLA: readonly OpcionDeFalla[] = [
  { clave: "ROTURA",        etiqueta: "Rotura / quebradura",      corta: "Rotura" },
  { clave: "DESGASTE",      etiqueta: "Desgaste",                 corta: "Desgaste" },
  { clave: "FUGA",          etiqueta: "Fuga / pérdida",           corta: "Fuga" },
  { clave: "ATASCAMIENTO",  etiqueta: "Atascamiento / traba",     corta: "Atascamiento" },
  { clave: "FLOJEDAD",      etiqueta: "Flojedad / desajuste",     corta: "Flojedad" },
  { clave: "DESALINEACION", etiqueta: "Desalineación",            corta: "Desalineación" },
  { clave: "QUEMADO",       etiqueta: "Quemado / falla eléctrica", corta: "Quemado" },
  { clave: "VIBRACION",     etiqueta: "Ruido / vibración",        corta: "Ruido o vibración" },
] as const;

/** Por qué le pasó. */
export const CAUSAS_DE_FALLA: readonly OpcionDeFalla[] = [
  { clave: "FRICCION",         etiqueta: "Fricción o roce",            corta: "fricción" },
  { clave: "LUBRICACION",      etiqueta: "Falta de lubricación",       corta: "falta de lubricación" },
  { clave: "FATIGA",           etiqueta: "Fatiga por uso",             corta: "fatiga" },
  { clave: "SOBRECARGA",       etiqueta: "Sobrecarga",                 corta: "sobrecarga" },
  { clave: "MATERIAL_EXTRANO", etiqueta: "Material extraño",           corta: "material extraño" },
  { clave: "GOLPE",            etiqueta: "Golpe",                      corta: "golpe" },
  { clave: "CORROSION",        etiqueta: "Corrosión o humedad",        corta: "corrosión" },
  { clave: "MONTAJE",          etiqueta: "Mala instalación o montaje", corta: "mal montaje" },
] as const;

const buscar = (lista: readonly OpcionDeFalla[], clave: unknown) =>
  typeof clave === "string" ? lista.find((o) => o.clave === clave) ?? null : null;

/** Si ese texto es una de las claves de la lista. La clave es la clave: no se normaliza. */
export const esModoDeFalla = (valor: unknown): boolean => buscar(MODOS_DE_FALLA, valor) !== null;
export const esCausaDeFalla = (valor: unknown): boolean => buscar(CAUSAS_DE_FALLA, valor) !== null;

/** Lo que se lee en pantalla, o `null` si la clave no existe. */
export const etiquetaDeModo = (clave: string | null | undefined): string | null =>
  buscar(MODOS_DE_FALLA, clave)?.etiqueta ?? null;
export const etiquetaDeCausa = (clave: string | null | undefined): string | null =>
  buscar(CAUSAS_DE_FALLA, clave)?.etiqueta ?? null;

/**
 * Lo que una ruta acepta como falla.
 *
 * Los tres campos pueden faltar —no toda OT tiene falla— y pueden venir en
 * `null`, que es como se borra lo que había. Lo que **no** se acepta es un modo
 * o una causa fuera de la lista: sin eso vuelve el texto libre por la ventana y
 * el conteo se muere en silencio, que es justo lo que estas dos listas existen
 * para evitar.
 */
const claveDe = (lista: readonly OpcionDeFalla[], que: string) =>
  z.union([
    z.literal(""), z.null(),
    z.string().refine((v) => buscar(lista, v) !== null, `No es ${que} de la lista`),
  ]).optional().transform((v) => (v ? v : null));

export const esquemaFalla = z.object({
  falla_modo: claveDe(MODOS_DE_FALLA, "un modo de falla"),
  falla_causa: claveDe(CAUSAS_DE_FALLA, "una causa de falla"),
  falla_detalle: z.union([z.string(), z.null()]).optional()
    .transform((v) => (typeof v === "string" ? v.trim() || null : null)),
});

/**
 * Las opciones de un desplegable, contando la que la orden ya tiene.
 *
 * El vocabulario se va a tocar —por eso la columna no lleva `check`—, y el día
 * que una clave se retire van a quedar OT que la tienen escrita. Sin esto el
 * desplegable se ve **vacío** con el valor viejo todavía en el estado: al
 * guardar sale un 400 por un campo que en pantalla parecía no tener nada, y
 * encima la ejecución ya se registró. Mostrarla, aunque sea marcada, deja ver
 * qué hay que cambiar.
 *
 * Quien retire una clave igual tiene que mover las filas que la usan: esto es
 * la red, no el plan.
 */
export function opcionesConLaActual(
  lista: readonly OpcionDeFalla[],
  actual: string | null | undefined
): OpcionDeFalla[] {
  const clave = actual?.trim();
  if (!clave || buscar(lista, clave)) return [...lista];
  return [...lista, { clave, etiqueta: `${clave} (ya no está en la lista)`, corta: clave }];
}

/** Lo que el ranking necesita de una orden. */
export interface OtConFalla {
  ot_number: number;
  /** La fecha de la falla es cuándo se ejecutó, no cuándo se cargó la fila. */
  fecha_ejecucion: string | null;
  falla_modo: string | null;
  falla_causa: string | null;
  falla_detalle: string | null;
}

export interface FallaContada {
  modo: string | null;
  causa: string | null;
  /** "Rotura por fricción", "Rotura", "Sin clasificar". */
  titulo: string;
  veces: number;
  ultimaFecha: string | null;
  ots: { numero: number; detalle: string | null; fecha: string | null }[];
}

/** Cómo se lee una falla: el modo, el modo con su causa, o «Sin clasificar». */
function tituloDe(modo: string | null, causa: string | null): string {
  const m = buscar(MODOS_DE_FALLA, modo);
  const c = buscar(CAUSAS_DE_FALLA, causa);
  if (m && c) return `${m.corta} por ${c.corta}`;
  // La misma forma corta que cuando tiene causa. Con la etiqueta entera, el
  // mismo modo aparecería con dos nombres —"Rotura / quebradura" solo y
  // "Rotura por fricción" acompañado— en la lista que existe justo para ver
  // qué se repite.
  if (m) return m.corta;
  if (c) return `Por ${c.corta}`;
  return "Sin clasificar";
}

/**
 * Qué falla se repite más en ese equipo.
 *
 * La clave de "la misma falla" es **modo + causa**. Una con modo y sin causa
 * —o al revés, o con sólo el detalle— cuenta igual: exigir las dos tiraría a la
 * basura justo lo que alguien se tomó el trabajo de anotar. La que no tiene
 * ninguna de las tres cosas no es una falla y no entra.
 *
 * Ordena por veces y, a igual cantidad, por la más reciente. Las fechas son
 * texto `YYYY-MM-DD` y se comparan como texto: pasar por `Date` corre el día en
 * un servidor en UTC. Una fecha nula nunca gana la comparación.
 */
export function rankingDeFallas(ots: readonly OtConFalla[]): FallaContada[] {
  const porClave = new Map<string, FallaContada>();

  for (const ot of ots) {
    const modo = ot.falla_modo?.trim() || null;
    const causa = ot.falla_causa?.trim() || null;
    const detalle = ot.falla_detalle?.trim() || null;
    if (!modo && !causa && !detalle) continue;

    const clave = `${modo ?? ""}|${causa ?? ""}`;
    const ya = porClave.get(clave);
    const falla = ya ?? {
      modo, causa, titulo: tituloDe(modo, causa), veces: 0, ultimaFecha: null,
      ots: [] as FallaContada["ots"],
    };

    falla.veces += 1;
    falla.ots.push({ numero: ot.ot_number, detalle, fecha: ot.fecha_ejecucion });
    if (ot.fecha_ejecucion && (!falla.ultimaFecha || ot.fecha_ejecucion > falla.ultimaFecha)) {
      falla.ultimaFecha = ot.fecha_ejecucion;
    }
    if (!ya) porClave.set(clave, falla);
  }

  return [...porClave.values()].sort(
    (a, b) => b.veces - a.veces || (b.ultimaFecha ?? "").localeCompare(a.ultimaFecha ?? "")
  );
}
