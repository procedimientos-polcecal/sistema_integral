import { agregarFila, escribirCeldas, leerValores } from "@/lib/core/sheets";
import { serialDelDia } from "@/lib/core/fechaDeSheets";
import { columnaDelEquipoEnEstados, filaDeLaFechaEnEstados } from "./planilla";

/**
 * Escribir hacia la planilla real ("SEGUIMIENTO EQUIPOS MÓVILES") lo que se
 * acaba de cargar en el SdG. Acá manda el sistema, no la planilla — pivote
 * del 18/09/2026, ver la migración 20260918101859 — pero se sigue exportando
 * para quien no entra al sistema, mismo patrón que
 * `lib/produccion/espejo.ts`.
 *
 * **No lanza: devuelve qué pasó.** Quien llama guarda el error en
 * `sheets_pendiente` con lo que dijo Google sin traducir, y se lo dice a
 * quien cargó — un fallo de escritura no es un `console.warn`.
 */

const LIBRO = () => process.env.GOOGLE_SHEETS_TALLER_VIAL_ID || "1P1bZb3CxDgR_EulR8-lXUJTNsIZLu5rMVLh-VIY6N4g";

/** Columna H (índice 0-based 7) de "DATOS": el id de la carga en el SdG, ver `esEcoDeCargaDelSistema`. */
const COLUMNA_ID_SISTEMA_EN_DATOS = 7;

export interface ResultadoEspejo {
  ok: boolean;
  /** Lo que dijo Google, sin traducir. */
  error?: string;
}

export interface CargaAEspejar {
  id: string;
  fecha: string; // "YYYY-MM-DD"
  equipoLabel: string; // "EM3 - Doosan 225 1", tal cual aparece en la columna EQUIPO de la planilla
  litros: number;
  lectura: number | null;
}

/**
 * Agrega la carga al final de "DATOS". Sólo escribe A:D (fecha, equipo,
 * litros, lectura): las columnas E/F/G ("TIPO DE COMBUSTIBLE"/"HORAS ó
 * KM"/"LTS/HR") ya tienen su fórmula prellenada en toda la hoja, mucho más
 * abajo de la última fila con datos — escribirlas de acá las pisaría con
 * texto fijo y las dejaría de recalcular. Verificado contra la planilla real
 * el 18/09/2026 antes de escribir esto.
 */
export async function espejarCarga(carga: CargaAEspejar): Promise<ResultadoEspejo> {
  const libro = LIBRO();
  try {
    const serial = serialDelDia(carga.fecha);
    if (serial === null) return { ok: false, error: `Fecha inválida para la planilla: ${carga.fecha}` };

    const fila = await agregarFila(libro, "DATOS", [serial, carga.equipoLabel, carga.litros, carga.lectura ?? ""]);
    await escribirCeldas(libro, [{ pestana: "DATOS", columna: COLUMNA_ID_SISTEMA_EN_DATOS, fila, valor: carga.id }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface EstadoAEspejar {
  fecha: string; // "YYYY-MM-DD"
  equipoCodigo: string; // "EM3"
  /** "OP" | "FS" | "OCF", tal cual el vocabulario de la planilla. */
  codigoSheet: string;
}

/**
 * Escribe el estado en la celda (equipo, fecha) de "HISTORIAL ESTADOS". Si
 * todavía no hay fila para esa fecha —lo normal al cargar el día en curso,
 * que la planilla no trae pre-armado— agrega una fila nueva con esa fecha y
 * sólo la columna de este equipo; el resto queda vacío hasta que otro equipo
 * también reporte ese día.
 */
export async function espejarEstado(estado: EstadoAEspejar): Promise<ResultadoEspejo> {
  const libro = LIBRO();
  try {
    const serial = serialDelDia(estado.fecha);
    if (serial === null) return { ok: false, error: `Fecha inválida para la planilla: ${estado.fecha}` };

    const valores = await leerValores(libro, "HISTORIAL ESTADOS");
    const encabezado = valores[0] ?? [];
    const columna = columnaDelEquipoEnEstados(encabezado, estado.equipoCodigo);
    if (columna === null) {
      return { ok: false, error: `No se encontró (o está repetida) la columna de ${estado.equipoCodigo} en "HISTORIAL ESTADOS"` };
    }

    const busqueda = filaDeLaFechaEnEstados(valores, estado.fecha);
    if (busqueda.fila === null) {
      if (busqueda.motivo === "ambigua") {
        return { ok: false, error: `La fecha ${estado.fecha} aparece más de una vez en "HISTORIAL ESTADOS"` };
      }
      const nuevaFila = new Array(columna + 1).fill("");
      nuevaFila[0] = serial;
      nuevaFila[columna] = estado.codigoSheet;
      await agregarFila(libro, "HISTORIAL ESTADOS", nuevaFila);
    } else {
      await escribirCeldas(libro, [{ pestana: "HISTORIAL ESTADOS", columna, fila: busqueda.fila, valor: estado.codigoSheet }]);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
