import { agregarFila, escribirCeldas, leerValores } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { serialDelDia } from "@/lib/core/fechaDeSheets";
import { filaParte, type ParteParaPlanilla } from "./planilla";

/**
 * Escribir en `PLANTA {N}` el parte que se acaba de guardar. Acá manda el
 * sistema, no la planilla — misma dirección que Producción, Despacho,
 * Cantera fase 1 y Taller Vial.
 *
 * **No lanza: devuelve qué pasó.** Quien llama anota `sheets_pendiente` con lo
 * que dijo Google sin traducir, y se lo dice a quien guardó.
 *
 * La clave para upsert es la **fecha** (columna A), no un id: es lo que ya
 * usa la planilla real para no repetir un día, y evita tener que guardar un
 * número de fila (`sheets_fila`) como hace Despacho.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_TRITURACION_ID ?? "";

function pestanaDePlanta(codigoPlanta: string): string {
  return `PLANTA ${codigoPlanta}`;
}

export interface ResultadoEspejo {
  ok: boolean;
  error?: string;
}

export function hayEspejoDeTrituracion(): boolean {
  return hayCredencialesGoogle() && Boolean(PLANILLA());
}

/**
 * La fila (1-based) cuya columna A, leída como fecha, es exactamente
 * `fechaIso`. Hasta la 3000: cada pestaña real tiene hoy menos de 1050 filas.
 * Compara por el valor formateado de Google ("2/6/2026", "15-06-26", ...) en
 * vez de reparsear cada formato posible — no hace falta: sólo se busca para
 * encontrar la propia fila que este mismo código ya escribió antes, que
 * siempre queda con el serial que escribe `filaParte`.
 */
async function buscarFilaPorFecha(planilla: string, pestana: string, fechaIso: string): Promise<number | null> {
  const columnaA = await leerValores(planilla, `${pestana}!A2:A3000`, { sinFormato: true });
  const serial = serialDelDia(fechaIso);
  for (let i = 0; i < columnaA.length; i++) {
    const crudo = Number(columnaA[i]?.[0]);
    if (!isNaN(crudo) && serial !== null && Math.round(crudo) === Math.round(serial)) return i + 2;
  }
  return null;
}

export async function espejarParte(codigoPlanta: string, parte: ParteParaPlanilla): Promise<ResultadoEspejo> {
  if (!hayEspejoDeTrituracion()) {
    return {
      ok: false,
      error:
        "Falta GOOGLE_SHEETS_TRITURACION_ID o la credencial de Google: el parte quedó sin escribir en la planilla.",
    };
  }

  const planilla = PLANILLA();
  const pestana = pestanaDePlanta(codigoPlanta);
  const valores = filaParte(parte);

  try {
    const fila = await buscarFilaPorFecha(planilla, pestana, parte.fecha);
    if (fila !== null) {
      await escribirCeldas(
        planilla,
        valores.map((valor, columna) => ({ pestana, columna, fila, valor }))
      );
    } else {
      await agregarFila(planilla, pestana, valores);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
