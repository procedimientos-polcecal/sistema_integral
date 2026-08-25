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

/**
 * El texto de una celda, o null.
 *
 * Una celda con error de fórmula —"#REF!", "#N/A"— se lee como vacía: la
 * planilla tiene una que deja el mensaje de error en la celda de quién avisó,
 * y guardarlo sería guardar el error como si fuera un nombre.
 */
const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  return /^#(REF|N\/A|VALUE|NAME|DIV\/0|NULL|NUM)/i.test(s) ? null : s;
};

/**
 * Una fecha de la planilla, que se lee sin formato.
 *
 * Llega como serial de Sheets —los días desde el 30/12/1899—. El respaldo en
 * texto lee d/m/aaaa, que es como escribe la gente acá: leerlo al revés fue lo
 * que dio vuelta 885 fechas en Compras.
 */
export function fechaDeSheets(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;

  const n = Number(valor);
  if (!isNaN(n) && n >= 1) {
    const ms = (Math.floor(n) - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(valor).trim();

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

/**
 * El código del equipo dentro del texto que escribió quien avisó.
 *
 * En la planilla el equipo viene como texto libre —"PO-A1-01 Compresor A1",
 * "Compresor (PO-A1-01)"— y el código es lo que permite enlazarlo con el
 * equipo de verdad.
 */
export function codigoDeEquipo(texto: string | null | undefined): string | null {
  const s = String(texto ?? "");
  const m = s.match(/\b([A-Z]{2,}-[A-Z0-9]+-\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

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
