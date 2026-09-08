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
