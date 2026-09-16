/**
 * Escribir en la planilla de envases el movimiento que se cargó en el SdG.
 *
 * La planilla manda, así que un movimiento que no llega allá **no existe**: la
 * próxima sincronización lee el stock de la fórmula —que no lo incluye— y
 * revierte el número. Por eso esto no es decorativo, no corre en segundo plano,
 * y cuando falla queda anotado en vez de perderse en un log.
 */

import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";
import { serialDelDia } from "@/lib/core/fechaDeSheets";

/**
 * Las columnas del kardex `Entradas  Salidas`, en base 0.
 *
 * **Faltan tres, y las tres faltan a propósito:**
 *
 * - **B (1)** es la descripción, un `VLOOKUP` contra el listado.
 * - **G (6)** es el saldo corriente. Escribirla rompe el stock de todo lo que
 *   viene abajo.
 * - **K (10)** es el grupo de envase, una `ARRAYFORMULA` puesta en `K2` que
 *   cubre la columna entera.
 *
 * Están arrastradas hasta la fila 3296 —verificado celda por celda—, así que
 * una fila nueva se completa sola y hay ~1.890 libres antes de tener que
 * estirar nada.
 */
export const COL = {
  codigo: 0,      // A  ← la que dice si la fila tiene datos
  // B = descripción, fórmula. No se toca.
  entrada: 2,     // C
  salida: 3,      // D
  rotura: 4,      // E
  despacho: 5,    // F
  // G = saldo, fórmula. No se toca.
  fecha: 7,       // H
  observacion: 8, // I
  proveedor: 9,   // J
  // K = grupo, ARRAYFORMULA. No se toca.
} as const;

export interface MovimientoAEspejar {
  codigo: string;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
  /** ISO corto. Se escribe como serial de Sheets — ver `fechaParaLaPlanilla`. */
  fecha: string | null;
  observacion: string | null;
  proveedor: string | null;
}

export interface Celda {
  pestana: string;
  columna: number;
  fila: number;
  valor: string;
}

/**
 * Una fecha para la planilla: **el ISO tal cual**, ni el serial ni "d/m/aaaa".
 *
 * Las tres se midieron escribiéndolas de verdad el 16/09/2026, porque las dos
 * primeras parecían razonables y las dos estaban mal:
 *
 * | lo que se escribe | cómo queda |
 * |---|---|
 * | `46281` (el serial) | valor 46281, **formato borrado**, se ve `46281` |
 * | `16/9/2026` (texto d/m) | valor 46281, `DATE:d/m/yyyy`, se ve bien — **pero lo parsea según el locale** |
 * | `2026-09-16` (ISO) | valor 46281, `DATE:d/m/yyyy`, se ve `16/9/2026` |
 *
 * **El serial no sirve aunque la columna tenga formato de fecha.** Ese era el
 * razonamiento —la H está en `DATE:d/M/yyyy` hasta la fila 3296— y es falso:
 * `escribirCeldas` manda `valueInputOption: USER_ENTERED`, y con eso Google
 * **reemplaza el formato de la celda** por el que infiere de lo que entró. Un
 * número entra como número y la celda queda sin formato: la fila escrita mostró
 * `46281` mientras la de al lado, intacta, seguía mostrando `13/9/2026`.
 *
 * **El ISO gana porque no se interpreta.** Google lo parsea igual en cualquier
 * locale y le deja a la celda el formato de fecha que corresponde, así que se ve
 * en el d/m de la planilla sin depender de que la planilla siga en `es_AR`.
 * Probado con `2026-09-05` —un día ≤ 12, que es donde un locale al revés mentiría
 * en silencio—: quedó 5 de septiembre. Leer al revés d/m y m/d ya dio vuelta 885
 * fechas en Compras, y esto cierra esa puerta sin depender de una configuración
 * que nadie controla.
 *
 * `serialDelDia` se sigue usando, pero para **comprobar** y no para escribir: una
 * fecha que no existe se descarta en vez de rodar sola —el 30 de febrero no se
 * convierte en 2 de marzo— y la celda queda vacía.
 */
export function fechaParaLaPlanilla(iso: string | null | undefined): string {
  if (!iso) return "";
  const dia = String(iso).slice(0, 10);
  return serialDelDia(dia) === null ? "" : dia;
}

/**
 * Un número para la planilla, donde el cero va vacío.
 *
 * Es cómo las escribe la gente, y además preserva la distinción: una celda
 * vacía es "acá no pasó nada" y un cero escrito es "se contó y dio cero". La
 * fórmula del saldo suma igual las dos, pero quien mira la planilla no.
 */
const numero = (n: number): string => (n > 0 ? String(n) : "");

/**
 * Qué celdas hay que escribir para dejar el movimiento en la planilla.
 *
 * Va aparte de la llamada a Google para poder probarla: es la parte que decide
 * qué se toca y qué no, y tocar la G de más sería romper la planilla entera.
 */
export function celdasDelMovimiento(
  m: MovimientoAEspejar, fila: number, pestana: string
): Celda[] {
  const celda = (columna: number, valor: string): Celda => ({ pestana, columna, fila, valor });

  return [
    celda(COL.codigo, m.codigo),
    celda(COL.entrada, numero(m.entrada)),
    celda(COL.salida, numero(m.salida)),
    celda(COL.rotura, numero(m.rotura)),
    celda(COL.despacho, numero(m.despacho)),
    celda(COL.fecha, fechaParaLaPlanilla(m.fecha)),
    celda(COL.observacion, m.observacion ?? ""),
    celda(COL.proveedor, m.proveedor ?? ""),
  ];
}

const PLANILLA = () => process.env.GOOGLE_SHEETS_ENVASES_ID ?? "";
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";

export interface ResultadoEspejo {
  ok: boolean;
  /** En qué fila quedó, para reconocerlo al releer. */
  fila?: number;
  /** Qué dijo Google, sin traducir. */
  error?: string;
}

/**
 * Escribe el movimiento al final del kardex.
 *
 * La fila se busca por la **columna A**, que acá es el código y está en todas
 * las filas con datos. (En el almacén se busca por la B, porque allá la A es el
 * N° de requerimiento y viene vacía casi siempre: son dos planillas parecidas
 * con la primera columna distinta.)
 *
 * Se **busca** y no se cuenta, y el motivo no es que la columna tenga huecos
 * —medido el 16/09: la A va de la fila 2 a la 1405, consecutiva—. Es que las
 * fórmulas de B, G y K están arrastradas hasta la 3296: leer el rango entero
 * devuelve **3.298 filas**, y contarlas escribiría el movimiento mil ochocientas
 * filas debajo de donde alguien lo puede ver. Por eso se lee `A:A` —que corta
 * en la última con contenido— y se busca hacia atrás la última llena.
 *
 * No lanza: devuelve qué pasó. Quien lo llama decide, y lo que decide es anotar
 * el pendiente — no tragárselo.
 */
export async function espejarMovimiento(m: MovimientoAEspejar): Promise<ResultadoEspejo> {
  const planilla = PLANILLA();
  if (!planilla) {
    return { ok: false, error: "Falta configurar GOOGLE_SHEETS_ENVASES_ID" };
  }

  const pestana = TAB_KARDEX();

  try {
    const columnaA = await leerValores(planilla, `${pestana}!A:A`, { sinFormato: true });
    const fila = filaSiguienteSegunLaColumna(columnaA);

    await escribirCeldas(planilla, celdasDelMovimiento(m, fila, pestana));
    return { ok: true, fila };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `${detalle}${contextoDeProteccion(detalle)}` };
  }
}

/**
 * Lo que le falta al mensaje de Google cuando la celda está protegida.
 *
 * Google dice "contact the spreadsheet owner to remove protection", y eso manda
 * a mirar con quién está compartida la planilla — donde la cuenta de servicio
 * figura como editor y todo parece bien. **Ser editor del archivo no alcanza:
 * un rango protegido tiene su propia lista de editores**, y si la cuenta no está
 * ahí, la escritura se rechaza igual.
 *
 * Medido el 16/09/2026 en la planilla de envases: `canEdit: true` sobre el
 * archivo, y la pestaña `Entradas  Salidas` con una protección de hoja entera
 * —"ACTUALIZACIÓN DE STOCK"— que no la incluye. El primer alta quedó pendiente
 * con el texto de Google y nada indicaba dónde estaba el permiso que faltaba.
 *
 * El texto de Google se conserva **entero y sin traducir**, como manda la regla
 * del módulo; esto se le pega atrás. Compras resuelve lo mismo pero mejor
 * —`etiquetaSegunLaProteccion` le pregunta a la API *cuál* protección la toca y
 * si la cuenta figura entre sus editores—; acá no se importa para no arrastrar
 * todo `lib/compras/sheets.ts` por un mensaje. Si esto hace falta una tercera
 * vez, esa función se muda al núcleo y las tres la usan.
 */
export function contextoDeProteccion(mensaje: string): string {
  if (!/protected/i.test(mensaje)) return "";
  return (
    " — Ojo: no es el permiso del archivo sino el del rango protegido, que tiene" +
    " su propia lista de editores. El dueño de la planilla tiene que agregar a la" +
    " cuenta de servicio en Datos → Hojas y rangos protegidos."
  );
}
