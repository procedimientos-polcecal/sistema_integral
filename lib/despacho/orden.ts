import type { EstadoDeOrden, HorarioDeOrden, HorariosDeOrden } from "./types";

/**
 * Todo lo que se despeja de los cuatro horarios de una orden de carga.
 *
 * NADA DE ESTO ES UNA COLUMNA. El estado, el tiempo de carga y el tiempo en
 * predio se calculan al leer. Es la misma decisión que Producción tomó con la
 * producción misma —"guardarlo es exactamente el error del Excel que este
 * módulo reemplaza"— y por el mismo motivo: un valor derivado guardado se
 * desincroniza y nada avisa. En la planilla `Tiempo de Carga` y `Tiempo en
 * Predio` ya son restas de las otras columnas, no datos.
 */

/** Los cuatro, en el orden en que ocurren. El papel los pide en otro orden. */
export const ORDEN_DE_HORARIOS: HorarioDeOrden[] = [
  "entrada_predio",
  "inicio_carga",
  "fin_carga",
  "salida_predio",
];

/** Cómo se llama cada horario en pantalla. El del papel, no el de la planilla. */
export const ETIQUETA_DE_HORARIO: Record<HorarioDeOrden, string> = {
  entrada_predio: "Entrada al predio",
  inicio_carga: "Inicio de carga",
  fin_carga: "Fin de carga",
  salida_predio: "Salida del predio",
};

export const ETIQUETA_DE_ESTADO: Record<EstadoDeOrden, string> = {
  esperando: "Esperando",
  en_predio: "En predio",
  cargando: "Cargando",
  cargado: "Cargado",
  cerrada: "Cerrada",
};

/** El estado que corresponde a haber alcanzado cada horario. */
const ESTADO_TRAS: Record<HorarioDeOrden, EstadoDeOrden> = {
  entrada_predio: "en_predio",
  inicio_carga: "cargando",
  fin_carga: "cargado",
  salida_predio: "cerrada",
};

function marcado(valor: string | null | undefined): boolean {
  return typeof valor === "string" && valor !== "";
}

/**
 * Hasta dónde llegó el camión: **el hito más avanzado que tiene marcado**.
 *
 * No es "el primero que falta", y la diferencia importa. A una orden a la que
 * se le olvidó marcar la entrada pero ya terminó de cargar, "el primero que
 * falta" la dejaría en `esperando` —con el camión cargado— y la pantalla le
 * ofrecería marcar la entrada de un camión que se fue hace dos horas. El hueco
 * se informa aparte, con `horariosSalteados`.
 */
export function estadoDeLaOrden(h: HorariosDeOrden): EstadoDeOrden {
  let estado: EstadoDeOrden = "esperando";
  for (const horario of ORDEN_DE_HORARIOS) {
    if (marcado(h[horario])) estado = ESTADO_TRAS[horario];
  }
  return estado;
}

/**
 * Qué horario le toca marcar al encargado: **uno solo**.
 *
 * La pantalla muestra un botón por fila y no cuatro. Con un camión esperando,
 * cuatro botones son cuatro oportunidades de marcar el equivocado.
 */
export function proximoHorario(h: HorariosDeOrden): HorarioDeOrden | null {
  const estado = estadoDeLaOrden(h);
  if (estado === "cerrada") return null;
  const alcanzado = ORDEN_DE_HORARIOS.findLastIndex((k) => marcado(h[k]));
  return ORDEN_DE_HORARIOS[alcanzado + 1] ?? null;
}

/**
 * Los horarios anteriores al hito alcanzado que quedaron sin marcar.
 *
 * Se muestran para que se corrijan: una orden con un hueco exporta a la
 * planilla una celda vacía y un tiempo que no se puede calcular, y eso hay que
 * poder verlo sin abrirla una por una.
 */
export function horariosSalteados(h: HorariosDeOrden): HorarioDeOrden[] {
  const alcanzado = ORDEN_DE_HORARIOS.findLastIndex((k) => marcado(h[k]));
  if (alcanzado < 0) return [];
  return ORDEN_DE_HORARIOS.slice(0, alcanzado).filter((k) => !marcado(h[k]));
}

function minutosEntre(desde: string | null, hasta: string | null): number | null {
  if (!marcado(desde) || !marcado(hasta)) return null;
  const a = new Date(desde as string).getTime();
  const b = new Date(hasta as string).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

export interface TiemposDeOrden {
  /** `Tiempo de Carga` de la planilla, en minutos. */
  carga: number | null;
  /** `Tiempo en Predio` de la planilla, en minutos. */
  predio: number | null;
}

/**
 * Los dos tiempos, en minutos. Null cuando falta un extremo — **no cero**: un
 * cero dice "tardó nada" y lo que pasa es que no se sabe.
 *
 * Un valor negativo se devuelve tal cual y no se recorta. Significa que alguien
 * corrigió un horario y lo dejó al revés, y es un error de carga que hay que
 * ver: es la misma decisión que Producción con una producción negativa, que se
 * muestra en rojo porque recortarla a cero esconde justo lo que hay que
 * corregir.
 */
export function tiemposDeLaOrden(h: HorariosDeOrden): TiemposDeOrden {
  return {
    carga: minutosEntre(h.inicio_carga, h.fin_carga),
    predio: minutosEntre(h.entrada_predio, h.salida_predio),
  };
}

/**
 * El reloj corriendo del tramo abierto: hace cuánto que está esperando, o
 * cargando, o cargado sin salir.
 *
 * Es lo que la planilla del día siguiente no puede dar, y la mitad del valor de
 * la pantalla de la balanza. Null si la orden está cerrada o si el camión
 * todavía no entró.
 */
export function minutosEnCurso(h: HorariosDeOrden, ahora: Date = new Date()): number | null {
  const alcanzado = ORDEN_DE_HORARIOS.findLastIndex((k) => marcado(h[k]));
  if (alcanzado < 0) return null;
  if (ORDEN_DE_HORARIOS[alcanzado] === "salida_predio") return null;
  return minutosEntre(h[ORDEN_DE_HORARIOS[alcanzado]], ahora.toISOString());
}

/** "1 h 22 min", "42 min", "—". Para no repetir el formateo en tres pantallas. */
export function comoSeLeenLosMinutos(minutos: number | null): string {
  if (minutos === null) return "—";
  const signo = minutos < 0 ? "-" : "";
  const abs = Math.abs(minutos);
  if (abs < 60) return `${signo}${abs} min`;
  const horas = Math.floor(abs / 60);
  const resto = abs % 60;
  return resto === 0 ? `${signo}${horas} h` : `${signo}${horas} h ${resto} min`;
}

// ── Las horas que se tipean ──────────────────────────────────

/**
 * Argentina no tiene horario de verano desde 2009, así que un offset fijo
 * alcanza y no hay que arrastrar una tabla de zonas al navegador.
 */
export const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/**
 * El umbral del cruce de medianoche: **gana la interpretación que da la
 * duración más corta**, así que se suma un día sólo cuando el salto hacia atrás
 * pasa las 12 horas.
 *
 * No es un umbral elegido a dedo. Se midieron los 394 saltos hacia atrás del
 * libro y están partidos en dos grupos con el valle justo acá: 234 de menos de
 * dos horas —una salida anotada unos minutos antes del fin de carga, o sea un
 * error de tipeo— y 106 de más de doce, que son los cruces reales.
 */
const MEDIO_DIA_MS = 12 * 60 * 60 * 1000;

/** "10:20" en hora de Argentina. Vacío si el horario no está marcado. */
export function horaComoSeEscribe(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  return new Date(t - OFFSET_ARGENTINA_MS).toISOString().slice(11, 16);
}

/**
 * Los minutos desde medianoche de una hora tipeada: `"7:35"`, `"07:35"`,
 * `"07:35:00"`. Null si no es una hora.
 *
 * Estricta a propósito: lo que llega de un `<input type="time">` siempre tiene
 * esta forma, y aceptar "735" o "7.35" sería adivinar qué quiso poner alguien.
 */
export function minutosDeLaHoraTipeada(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (s === "") return null;

  const hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!hm) return null;
  const h = Number(hm[1]);
  const m = Number(hm[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Unos minutos del día, anclados a la fecha de la orden y en hora de Argentina.
 *
 * **La hora no trae fecha, y de ahí sale toda la dificultad.** Un camión que
 * entra 23:40 y sale 00:30 daría, con la misma fecha para los dos, un tiempo en
 * predio de menos veintitrés horas. Por eso `anterior`: cuando el horario cae
 * antes del que lo precede, se le suma un día — pero sólo si el salto hacia
 * atrás pasa las 12 horas (ver `MEDIO_DIA_MS`). Un salto más corto es un error
 * de tipeo y **tiene que quedar negativo**, para que se vea en rojo y alguien lo
 * corrija.
 *
 * Es la misma regla que usa el importador del libro, y vive acá una sola vez:
 * la primera versión sumaba un día ante cualquier salto y dejó 250 de las 1.702
 * órdenes importadas con tiempos absurdos, que se promedian sin que nada avise.
 */
export function instanteEnElDia(
  minutos: number | null,
  fecha: string,
  anterior?: string | null
): string | null {
  if (minutos === null) return null;

  const base = new Date(`${fecha}T00:00:00.000Z`).getTime();
  if (isNaN(base)) return null;

  let instante = base + OFFSET_ARGENTINA_MS + minutos * 60000;

  if (anterior) {
    const previo = new Date(anterior).getTime();
    if (!isNaN(previo) && previo - instante > MEDIO_DIA_MS) {
      instante += 2 * MEDIO_DIA_MS;
    }
  }

  return new Date(instante).toISOString();
}

/**
 * Los cuatro horarios después de aplicar lo que se tipeó en la pantalla.
 *
 * Se recorre **en el orden en que ocurren** porque cada hora se ancla contra la
 * anterior: tipear la salida a las 00:30 sólo se entiende como del día
 * siguiente si antes se sabe que el fin de carga fue a las 23:40.
 *
 * **Sólo se ancla lo que vino tipeado.** Un horario que ya estaba guardado se
 * devuelve tal cual, aunque editar otro campo cambie su referencia: volver a
 * anclarlo movería en silencio una hora que nadie tocó. Una cadena vacía es un
 * borrado explícito y deja el horario en null.
 */
export function horariosConLoTipeado(
  actuales: HorariosDeOrden,
  tipeadas: Partial<Record<HorarioDeOrden, string | null>>,
  fecha: string
): HorariosDeOrden {
  const salida: HorariosDeOrden = { ...actuales };
  let anterior: string | null = null;

  for (const horario of ORDEN_DE_HORARIOS) {
    if (horario in tipeadas) {
      const tipeada = tipeadas[horario];
      salida[horario] =
        tipeada === null || tipeada === ""
          ? null
          : instanteEnElDia(minutosDeLaHoraTipeada(tipeada), fecha, anterior);
    }
    if (salida[horario]) anterior = salida[horario];
  }

  return salida;
}
