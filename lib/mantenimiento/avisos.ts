/**
 * Avisos: leer la planilla donde se reportan.
 *
 * Un aviso (N° OA) dice que algo necesita mantenimiento. De un aviso puede
 * salir después una orden de trabajo.
 *
 * La planilla se lee **por posición de columna**, no por encabezado, porque
 * así está armada en el origen: A el número, B la fecha, C el sector, D el
 * equipo, E la descripción, F la urgencia, G quién avisó, J si ya tiene OT,
 * K la imagen y L las observaciones. H e I son restos de una fórmula que parte
 * el nombre en dos y no se leen.
 *
 * Verificado contra la planilla: el código de origen leía las observaciones de
 * K, que hoy es la imagen, así que los avisos con foto guardaban la URL de
 * Drive en el campo de observaciones. Si alguien inserta una columna en el
 * medio, esto se rompe en silencio.
 */

import { texto, fechaDeSheets, codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { fechaDeTexto, comoSeLee } from "@/lib/core/fechas";

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  oa: 0,
  fecha: 1,
  sector: 2,
  equipo: 3,
  descripcion: 4,
  urgencia: 5,
  quien: 6,
  otAsignada: 9,
  imagen: 10,
  observaciones: 11,
} as const;

export interface AvisoLeido {
  oa_number: string;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  descripcion: string | null;
  urgencia: string | null;
  quien_aviso: string | null;
  ot_asignada: string | null;
  observaciones: string | null;
  /** La columna "Imagen": un link de Drive a la foto del aviso. */
  reference_photos: string[] | null;
  sheets_row: number;
}

/** Una fila de la planilla como aviso. `null` si no lo es. */
export function filaDeAviso(fila: unknown[], numeroFila: number): AvisoLeido | null {
  const oa = texto(fila[COL.oa]);
  if (!oa) return null;

  const equipoRaw = texto(fila[COL.equipo]);
  const imagen = texto(fila[COL.imagen]);

  return {
    oa_number: oa,
    fecha: fechaDeSheets(fila[COL.fecha]),
    sector_raw: texto(fila[COL.sector]),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    descripcion: texto(fila[COL.descripcion]),
    urgencia: texto(fila[COL.urgencia]),
    quien_aviso: texto(fila[COL.quien]),
    ot_asignada: texto(fila[COL.otAsignada]),
    observaciones: texto(fila[COL.observaciones]),
    reference_photos: imagen ? [imagen] : null,
    sheets_row: numeroFila,
  };
}

/**
 * Qué prioridad de OT le corresponde a la urgencia del aviso.
 *
 * En la planilla la urgencia viene con emoji —"🟠 Alta", "🟡 Media", "🟢 Baja"—,
 * verificado contra ella, así que se busca la palabra adentro en vez de
 * comparar la celda entera.
 */
export function prioridadDeUrgencia(urgencia: string | null | undefined): string {
  const s = String(urgencia ?? "");
  if (/alta/i.test(s)) return "ALTA";
  if (/baja/i.test(s)) return "BAJA";
  return "MEDIA";
}

/**
 * Las urgencias de la planilla, con su emoji.
 *
 * Se escriben igual que ahí —"🟠 Alta", no "ALTA"— o quedarían dos vocabularios
 * para lo mismo y la próxima lectura no los reconocería igual.
 */
export const URGENCIAS = ["🟠 Alta", "🟡 Media", "🟢 Baja"] as const;

/** La columna donde la planilla anota qué OT se generó. */
export const COLUMNA_OT_ASIGNADA = COL.otAsignada;

/**
 * El próximo número de aviso.
 *
 * Van como `A1`, `A2`… y se compara el número, no el texto: alfabéticamente
 * "A9" es mayor que "A10" y el próximo aviso pisaría uno existente.
 */
export function proximoNumeroDeAviso(existentes: (string | null | undefined)[]): string {
  const mayor = existentes.reduce((max, n) => {
    const m = String(n ?? "").trim().match(/^A(\d+)$/i);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);

  return `A${mayor + 1}`;
}

/**
 * Qué fecha trae una carga en su cuerpo: ninguna, una que sirve, o por qué no.
 *
 * Hasta ahora las dos rutas de alta fechaban con `hoyEnArgentina()` o con lo
 * que viniera sin mirarlo, porque la carga era en el momento. Una carga hecha
 * sin señal el viernes puede entrar el lunes, cuando el teléfono vuelve a tener
 * red, y quedaría fechada el lunes: de esa fecha salen el historial del equipo
 * y el MTBF, así que no es un detalle de presentación. Por eso el cuerpo puede
 * traer la suya.
 *
 * LAS TRES RESPUESTAS SON DISTINTAS A PROPÓSITO, y la última es la que importa:
 *
 * - `ausente`: no vino ninguna. Quien llama pone hoy, que es lo de siempre.
 * - `sirve`: la fecha, ya en "YYYY-MM-DD".
 * - `no-sirve`: vino algo y no se puede usar. **No se corrige a hoy.** Devolver
 *   hoy calladamente dejaría la carga fechada un día que nadie eligió —y en el
 *   aviso eso viaja a la planilla— sin que nadie se entere nunca: es la misma
 *   forma del error que dio vuelta 885 fechas en Compras. Quien llama lo
 *   devuelve como 400, que para la cola es definitivo, así que la carga queda
 *   parada y visible con el motivo.
 *
 * Una fecha **futura** tampoco entra: el reloj del teléfono lo pone la persona,
 * y algo fechado el mes que viene no lo encuentra nadie.
 *
 * Y TAMPOCO UNA DE HACE MÁS DE UN AÑO, que es el agujero del otro lado y es el
 * peor de los dos. El futuro se rechazaba y el pasado se aceptaba entero, así
 * que un teléfono con la hora perdida —la pila que se agotó, el aparato que
 * vuelve a la fecha de fábrica— fechaba el aviso en 2019 **sin decir nada**, y
 * de esa fecha salen el historial del equipo y el MTBF. Una futura se nota; una
 * de 2019 se mete en el medio de la serie y ahí se queda.
 *
 * Un año y no un mes porque **cargar algo viejo es legítimo**: estas rutas
 * también reciben trabajo ya hecho que se carga tarde, y con un tope corto eso
 * quedaría rechazado sin que nadie tenga nada mal. Lo que un año sí descarta es
 * el único caso que importa, el reloj que no sabe en qué año está.
 *
 * El motivo se escribe para quien cargó, no para el log: nombra el valor que
 * vino, porque lo primero que hace quien lo lee es buscarlo en su pantalla.
 *
 * `hoy` se recibe en vez de calcularse para poder probarla, igual que en
 * `lib/core/fechas.ts`.
 */
export type FechaDeLaCarga =
  | { estado: "ausente" }
  | { estado: "sirve"; fecha: string }
  | { estado: "no-sirve"; motivo: string };

export function fechaDeLaCarga(valor: unknown, hoy: string): FechaDeLaCarga {
  const crudo = String(valor ?? "").trim();
  if (crudo === "") return { estado: "ausente" };

  const fecha = fechaDeTexto(crudo);
  if (!fecha) {
    return {
      estado: "no-sirve",
      motivo: `"${crudo}" no es una fecha. Va como 16/10/2026 o 2026-10-16.`,
    };
  }

  // Las dos son "YYYY-MM-DD", así que comparar los textos compara los días.
  if (fecha > hoy) {
    return {
      estado: "no-sirve",
      motivo: `La fecha ${comoSeLee(fecha)} todavía no llegó. Fijate la hora del teléfono.`,
    };
  }

  if (fecha < haceUnAño(hoy)) {
    return {
      estado: "no-sirve",
      motivo:
        `La fecha ${comoSeLee(fecha)} es de hace más de un año. ` +
        `Fijate la hora del teléfono.`,
    };
  }

  return { estado: "sirve", fecha };
}

/**
 * El mismo día del año pasado, en "YYYY-MM-DD", para comparar como texto.
 *
 * Restarle uno al año y nada más: un 29 de febrero da un "2025-02-29" que no
 * existe como día, y eso **no importa** porque nunca se construye una fecha con
 * esto — sólo se compara texto contra texto, y ahí "2025-02-29" se ordena justo
 * donde tiene que ordenarse. Hacerlo con `Date` traería los husos horarios a un
 * cálculo que no los necesita, que es de donde salen los errores de un día.
 */
function haceUnAño(hoy: string): string {
  const [año, resto] = [hoy.slice(0, 4), hoy.slice(4)];
  return `${String(Number(año) - 1).padStart(4, "0")}${resto}`;
}

/** Una fecha ISO como la escribe la planilla. */
const fechaAR = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/**
 * Un aviso nuevo, como las celdas de la planilla.
 *
 * Las columnas H e I quedan vacías a propósito: son restos de una fórmula que
 * parte en dos el nombre de quien avisó, y escribir ahí pisaría lo que la
 * planilla calcula sola.
 */
export function filaParaLaPlanilla(aviso: {
  oa_number: string;
  fecha?: string | null;
  sector_raw?: string | null;
  equipo_raw?: string | null;
  descripcion?: string | null;
  urgencia?: string | null;
  quien_aviso?: string | null;
  observaciones?: string | null;
}): string[] {
  // Hasta la L —las observaciones—, que es la última que se lee.
  const fila = new Array(COL.observaciones + 1).fill("");

  fila[COL.oa] = aviso.oa_number;
  fila[COL.fecha] = fechaAR(aviso.fecha);
  fila[COL.sector] = aviso.sector_raw ?? "";
  fila[COL.equipo] = aviso.equipo_raw ?? "";
  fila[COL.descripcion] = aviso.descripcion ?? "";
  fila[COL.urgencia] = aviso.urgencia ?? "";
  fila[COL.quien] = aviso.quien_aviso ?? "";
  fila[COL.observaciones] = aviso.observaciones ?? "";

  return fila;
}
