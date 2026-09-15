import { agregarFila, escribirCeldas, leerValores } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { filaBochon, filaPerforacion, filaVoladura, type RenglonPlano } from "./planilla";
import type { Bochon, Voladura, Yacimiento } from "./types";

/**
 * Escribir en la planilla la voladura o el bochón que se acaba de cargar.
 *
 * Acá manda el sistema, no la planilla — misma dirección que Producción y
 * Despacho, y la que el usuario pidió explícitamente para Cantera: cargar acá
 * y dejar de cargar allá, pero que la planilla se siga viendo actualizada
 * para quien no entra al sistema.
 *
 * **No lanza: devuelve qué pasó.** Quien lo llama anota `sheets_pendiente` con
 * lo que dijo Google sin traducir, y se lo dice a quien guardó — un fallo de
 * escritura no es un `console.warn`, eso ya costó una tarde entera en Compras.
 *
 * Cada voladura escribe DOS pestañas (PERFORACIÓN y VOLADURAS: son dos etapas,
 * dos filas). Los consumos (pestaña CONSUMOS) todavía no se espejan — hace
 * falta poder borrar filas de Sheets para reemplazarlos enteros al editar, y
 * `lib/core/sheets.ts` hoy no tiene esa operación.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_CANTERA_ID ?? "";
const TAB_PERFORACION = () => process.env.GOOGLE_SHEETS_CANTERA_TAB_PERF || "PERFORACIÓN";
const TAB_VOLADURAS = () => process.env.GOOGLE_SHEETS_CANTERA_TAB_VOL || "VOLADURAS";
const TAB_BOCHONES = () => process.env.GOOGLE_SHEETS_CANTERA_TAB_BOCH || "BOCHONES";

export interface ResultadoEspejo {
  ok: boolean;
  /** Qué dijo Google, sin traducir. Un diagnóstico que no se distingue de otro no sirve. */
  error?: string;
}

/** Si el espejo puede intentar escribir. Sin esto la voladura queda pendiente, no falla. */
export function hayEspejoDeCantera(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * La fila (1-based) cuya columna A es exactamente `codigo`, o `null` si no
 * está. Hasta la 5000: la planilla hoy tiene un par de cientos de voladuras
 * por pestaña, y a ese ritmo faltan años para llegar.
 */
async function buscarFilaPorCodigo(planilla: string, pestana: string, codigo: string): Promise<number | null> {
  const columnaA = await leerValores(planilla, `${pestana}!A2:A5000`);
  for (let i = 0; i < columnaA.length; i++) {
    if (String(columnaA[i]?.[0] ?? "").trim() === codigo) return i + 2;
  }
  return null;
}

/**
 * Agrega la fila si el código es nuevo, o reescribe la que ya tiene.
 *
 * Reescribir es lo que hace que corregir una voladura en el sistema no deje la
 * planilla diciendo lo de antes. Se busca por columna A en vez de guardar el
 * número de fila (como sí hace Despacho): acá no hace falta la migración —el
 * código YA es la clave, así que buscarlo de nuevo en cada guardado sale una
 * lectura de más y ningún riesgo de escribir en la fila de otro código.
 */
async function upsertFila(planilla: string, pestana: string, codigo: string, valores: string[]): Promise<void> {
  const fila = await buscarFilaPorCodigo(planilla, pestana, codigo);
  if (fila !== null) {
    await escribirCeldas(planilla, valores.map((valor, columna) => ({ pestana, columna, fila, valor })));
  } else {
    await agregarFila(planilla, pestana, valores);
  }
}

export async function espejarVoladura(
  voladura: Voladura,
  yacimiento: Yacimiento | null,
  consumos: RenglonPlano[]
): Promise<ResultadoEspejo> {
  if (!hayEspejoDeCantera()) {
    return {
      ok: false,
      error: "Falta GOOGLE_SHEETS_CANTERA_ID o la credencial de Google: la voladura quedó sin escribir en la planilla.",
    };
  }

  const planilla = PLANILLA();
  try {
    await upsertFila(planilla, TAB_PERFORACION(), voladura.codigo, filaPerforacion(voladura, yacimiento));
    await upsertFila(planilla, TAB_VOLADURAS(), voladura.codigo, filaVoladura(voladura, yacimiento, consumos));
    return { ok: true };
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código de Google, la
    // cuenta de servicio y qué se estaba haciendo. No se lo vuelve a envolver.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function espejarBochon(bochon: Bochon, yacimiento: Yacimiento | null): Promise<ResultadoEspejo> {
  if (!hayEspejoDeCantera()) {
    return {
      ok: false,
      error: "Falta GOOGLE_SHEETS_CANTERA_ID o la credencial de Google: el bochón quedó sin escribir en la planilla.",
    };
  }

  try {
    await upsertFila(PLANILLA(), TAB_BOCHONES(), bochon.codigo, filaBochon(bochon, yacimiento));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Vacía (no borra la fila, no corre las de abajo) la fila de una pestaña
 * cuya columna A es `codigo`, si existe. `ancho` es la cantidad de columnas
 * que escribe `filaPerforacion`/`filaVoladura` para ese código (13 y 19: "A a
 * M" y "A a S", ver sus comentarios) — hay que limpiar las mismas que se
 * llegaron a escribir alguna vez, no más ni menos.
 */
async function limpiarFilaSiExiste(planilla: string, pestana: string, codigo: string, ancho: number): Promise<void> {
  const fila = await buscarFilaPorCodigo(planilla, pestana, codigo);
  if (fila === null) return;
  await escribirCeldas(
    planilla,
    Array.from({ length: ancho }, (_, columna) => ({ pestana, columna, fila, valor: "" }))
  );
}

/**
 * Al borrar una voladura del sistema, vaciar su fila en PERFORACIÓN y en
 * VOLADURAS — a pedido, para que la planilla no siga mostrando algo que ya no
 * existe. Se vacía en vez de borrar la fila entera: borrar una fila corre
 * todas las de abajo, y eso puede romper una fórmula de otra fila que sume un
 * rango fijo — vaciar dentro es más chico pero seguro.
 *
 * Si no hay espejo configurado no hay nada que vaciar: a diferencia de
 * `espejarVoladura`, acá no es un fallo — nunca se llegó a escribir nada.
 */
export async function desespejarVoladura(codigo: string): Promise<ResultadoEspejo> {
  if (!hayEspejoDeCantera()) return { ok: true };

  const planilla = PLANILLA();
  try {
    await limpiarFilaSiExiste(planilla, TAB_PERFORACION(), codigo, 13);
    await limpiarFilaSiExiste(planilla, TAB_VOLADURAS(), codigo, 19);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
