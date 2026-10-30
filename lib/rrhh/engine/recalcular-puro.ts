import type { TimeInterval } from "./calculo";
import { addUtcDays, localDateTime, minutosDelDiaArgentina, utcDateOnlyFrom } from "../dates";

const startOfDay = utcDateOnlyFrom;

export interface FichadaLike {
  fecha: Date;
  horaEntrada: Date;
  horaSalida: Date | null;
}

export interface TurnoLike {
  id: string;
  horaInicio: string;
  horaFin: string;
  toleranciaMinutos: number;
}

function parseHora(hhmm: string): { h: number; m: number; min: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m, min: h * 60 + m };
}

function distanciaCircular(aMin: number, bMin: number): number {
  const diff = Math.abs(aMin - bMin) % 1440;
  return Math.min(diff, 1440 - diff);
}

/**
 * El turno del catálogo más parecido a la marcación real: compara tanto la
 * entrada (contra horaInicio) como la salida (contra horaFin, si ya se
 * conoce) para no confundir turnos que arrancan a la misma hora pero duran
 * distinto (ej. "Oficina" 08-16 vs "Turno pasante" 08-12 con la misma
 * entrada 08:00 pero salidas muy distintas).
 */
export function detectarTurno(entradaMin: number, salidaMin: number | null, turnos: TurnoLike[]): TurnoLike | null {
  if (turnos.length === 0) return null;
  const distancia = (t: TurnoLike): number => {
    const dEntrada = distanciaCircular(entradaMin, parseHora(t.horaInicio).min);
    if (salidaMin === null) return dEntrada;
    return dEntrada + distanciaCircular(salidaMin, parseHora(t.horaFin).min);
  };
  return turnos.reduce((mejor, t) => (distancia(t) < distancia(mejor) ? t : mejor));
}

/** Instantes reales (horario pactado) de inicio/fin del turno para el día calendario `dia`, resolviendo turnos que cruzan medianoche (ej. 22-06). */
export function anclaTurno(dia: Date, turno: TurnoLike): { inicio: Date; fin: Date } {
  const ini = parseHora(turno.horaInicio);
  const fin = parseHora(turno.horaFin);
  const inicio = localDateTime(dia, ini.h, ini.m);
  const finDate = fin.min <= ini.min ? localDateTime(addUtcDays(dia, 1), fin.h, fin.m) : localDateTime(dia, fin.h, fin.m);
  return { inicio, fin: finDate };
}

// Por debajo de este umbral, llegar antes o quedarse de más no cuenta como
// hora extra: es fijo, independiente del margen de tolerancia de cada turno
// (ese margen sigue rigiendo tardanza/retiro anticipado sin cambios), para
// evitar que una diferencia de pocos minutos (imprecisión del reloj o del
// margen) aparezca como una hora extra que en realidad no existió. En 30 (0,5
// horas) a pedido: un turno que termina a las 16 acredita extra desde que
// salió 16:30, no desde 16:15.
const UMBRAL_EXTRA_MINUTOS = 30;

/**
 * Ajusta las fichadas de cada día calendario según el turno del catálogo más
 * cercano a la entrada real. El margen (toleranciaMinutos) es una gracia
 * única de hasta esos minutos, para llegar tarde o para irse antes: dentro
 * del margen se redondea a la hora exacta del turno; pasado el margen, se
 * cuenta el horario real (se pierden esos minutos de las horas normales) y
 * además se marca tardanza o retiro anticipado según corresponda. Si llegó
 * antes o se quedó trabajando más allá de UMBRAL_EXTRA_MINUTOS, ese tiempo de
 * más se acredita igual (queda como hora extra sujeta a validación de RRHH);
 * por debajo de ese umbral no se acredita nada extra, aunque el margen de
 * tolerancia del turno sea menor. Si no hay ningún turno activo en el
 * catálogo, no se ajusta nada (se sigue usando la marcación real tal cual,
 * como antes de tener turnos).
 */
export function ajustarFichadasPorTurno(
  fichadas: FichadaLike[],
  turnos: TurnoLike[]
): { ajustadas: FichadaLike[]; tardePorDia: Map<number, boolean>; retiroAnticipadoPorDia: Map<number, boolean> } {
  const tardePorDia = new Map<number, boolean>();
  const retiroAnticipadoPorDia = new Map<number, boolean>();
  if (turnos.length === 0) return { ajustadas: fichadas, tardePorDia, retiroAnticipadoPorDia };

  const grupos = new Map<number, FichadaLike[]>();
  for (const f of fichadas) {
    const key = startOfDay(f.fecha).getTime();
    const arr = grupos.get(key) ?? [];
    arr.push(f);
    grupos.set(key, arr);
  }

  const ajustadas: FichadaLike[] = [];
  for (const [key, grupoSinOrdenar] of grupos) {
    const grupo = [...grupoSinOrdenar].sort((a, b) => a.horaEntrada.getTime() - b.horaEntrada.getTime());
    const diaGrupo = startOfDay(grupo[0].fecha);
    const primeraEntrada = grupo[0].horaEntrada;
    const entradaMin = minutosDelDiaArgentina(primeraEntrada);
    const ultimaSalidaRaw = grupo[grupo.length - 1].horaSalida;
    const salidaMin = ultimaSalidaRaw ? minutosDelDiaArgentina(ultimaSalidaRaw) : null;
    const turno = detectarTurno(entradaMin, salidaMin, turnos);
    if (!turno) {
      ajustadas.push(...grupo);
      continue;
    }
    const { inicio: anchorInicio, fin: anchorFin } = anclaTurno(diaGrupo, turno);
    const desvioEntrada = (primeraEntrada.getTime() - anchorInicio.getTime()) / 60_000;
    const tarde = desvioEntrada > turno.toleranciaMinutos;
    tardePorDia.set(key, tarde);

    grupo.forEach((f, i) => {
      const esPrimera = i === 0;
      const esUltima = i === grupo.length - 1;
      // Dentro del margen se acredita desde el horario pactado. Pasado el
      // margen de tardanza (propio de cada turno), se pierde ese tiempo real
      // (se acredita desde que fichó, no desde el horario del turno). Si en
      // cambio llegó antes o se quedó trabajando de más, ese tiempo a favor
      // del empleado solo se acredita como hora extra si supera los
      // UMBRAL_EXTRA_MINUTOS: por debajo de eso puede ser una imprecisión del
      // reloj o del margen de tolerancia, no una hora extra real. Este umbral
      // es fijo e independiente del margen de tardanza de cada turno. Sin
      // esto, además, un turno detectado por su hora de entrada real (ej.
      // entró a las 4 y matcheó "Oficina" 08-16 por ser el más cercano) le
      // recortaría silenciosamente todas las horas trabajadas antes del
      // inicio nominal del turno.
      const llegoMuyTemprano = desvioEntrada <= -UMBRAL_EXTRA_MINUTOS;
      const horaEntrada = esPrimera ? (tarde || llegoMuyTemprano ? f.horaEntrada : anchorInicio) : f.horaEntrada;
      let horaSalida = f.horaSalida;
      if (esUltima && f.horaSalida) {
        const desvioSalida = (f.horaSalida.getTime() - anchorFin.getTime()) / 60_000;
        const retiroAnticipado = desvioSalida < -turno.toleranciaMinutos;
        const seQuedoExtra = desvioSalida >= UMBRAL_EXTRA_MINUTOS;
        horaSalida = retiroAnticipado || seQuedoExtra ? f.horaSalida : anchorFin;
        retiroAnticipadoPorDia.set(key, retiroAnticipado);
      }
      ajustadas.push({ fecha: f.fecha, horaEntrada, horaSalida });
    });
  }
  return { ajustadas, tardePorDia, retiroAnticipadoPorDia };
}

/**
 * Arma los intervalos trabajados que corresponden al día calendario `dia`.
 *
 * **Un turno va entero al día en que arrancó**, aunque cruce la medianoche.
 * Las ocho horas de un 20 a 4 se cuentan el día que empezó, y el día siguiente
 * no recibe nada.
 *
 * POR QUÉ, PORQUE ANTES ERA AL REVÉS
 *
 * Hasta el 30/10/2026 esto partía la fichada en la medianoche local, para que
 * cada mitad se calculara con el tipo de día y los recargos que le tocaban. La
 * idea era buena y en la práctica peleaba todos los días con quien liquida: de
 * los **85 turnos de octubre que cruzan medianoche, 73 ya habían sido
 * corregidos a mano** para poner las ocho horas en el día del turno. Partir
 * dejaba además 347 horas del mes imputadas al día siguiente, y al día de la
 * madrugada lo marcaba **ausente teniendo horas** — cuatro personas el 30/10.
 *
 * Una regla que hay que deshacer a mano el 86 % de las veces no es una regla.
 *
 * EL RIESGO QUE SE ASUME, ESCRITO
 *
 * Las horas posteriores a la medianoche de un sábado o de un feriado dejan de
 * llevar el recargo de **ese** día y toman el del día en que empezó el turno.
 * Se decidió así a pedido el 30/10/2026; si alguna vez hace falta lo contrario
 * para un caso puntual, están las horas fijadas a mano, que esto nunca pisa.
 */
export function intervalsParaDia(dia: Date, fichadas: FichadaLike[]): TimeInterval[] {
  const diaKey = dia.getTime();

  const result: TimeInterval[] = [];
  for (const f of fichadas) {
    if (!f.horaSalida) continue;
    if (startOfDay(f.fecha).getTime() !== diaKey) continue;
    if (f.horaSalida > f.horaEntrada) result.push({ start: f.horaEntrada, end: f.horaSalida });
  }
  return result;
}

/**
 * Si el turno de la víspera siguió trabajando dentro de `dia`.
 *
 * Es la otra mitad de la regla de arriba, y existe para no mentir en la otra
 * dirección: con el turno imputado entero al día en que arrancó, la madrugada
 * siguiente se queda sin horas, pero la persona **estuvo**. Marcarla ausente
 * ese día es falso, y es lo que infla la cuenta de ausentes del tablero.
 *
 * Una fichada **abierta** no cuenta: sin hora de salida no se sabe hasta
 * cuándo estuvo, y suponerlo sería inventar la prueba de una presencia.
 */
export function cubiertoPorTurnoDeLaVispera(dia: Date, fichadas: FichadaLike[]): boolean {
  const inicioDia = localDateTime(dia, 0, 0);
  const visperaKey = addUtcDays(dia, -1).getTime();
  return fichadas.some(
    (f) => f.horaSalida !== null && startOfDay(f.fecha).getTime() === visperaKey && f.horaSalida > inicioDia
  );
}
