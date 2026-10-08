import { ajustarFichadasPorTurno, type FichadaLike, type TurnoLike } from "../engine/recalcular-puro";
import { formatHHMM, utcDateOnlyFrom } from "../dates";

/**
 * Lo que se acredita de una marcación, y cómo se muestra junto a la marca.
 *
 * La marcación guardada en `fichadas` es lo que marcó el reloj y no se toca
 * nunca. Dentro del margen del turno el motor acredita desde el horario pactado
 * y no desde la marca, y eso no está guardado en ningún lado: sin verlo, RRHH
 * corregía a mano marcaciones que el motor ya cerraba bien (una salida 03:42 se
 * editaba a 04:00 "para que pague las 8"), y de paso falsificaba el dato
 * original del reloj. Por eso **el rango acreditado sí se calcula acá**, con el
 * mismo `ajustarFichadasPorTurno` del motor.
 *
 * **Todo lo demás lo dice `calculos_diarios`, no esta pantalla.** Tardanza,
 * retiro anticipado y horas fijadas a mano son decisiones que el motor ya tomó
 * y guardó por (empleado, día): re-derivarlas acá era una segunda copia de la
 * regla, y cada cosa que la pantalla deduce por su cuenta puede discrepar de
 * lo que se paga. Ya lo hacía: el motor no marca tardanza los domingos ni los
 * sábados de los sectores de lunes a viernes, y la pantalla no sabe de
 * sectores.
 */

/** Las columnas de `fichadas` que hacen falta; el resto de la fila no importa acá. */
export interface FichadaCruda {
  id: string;
  /** Instante ISO de la entrada tal cual la guardó el reloj. */
  hora_entrada: string;
  /** Instante ISO de la salida, o null si no hay marcación de salida. */
  hora_salida: string | null;
}

export interface FichadaCrudaDeLista extends FichadaCruda {
  /** Día calendario "YYYY-MM-DD": el día en que arrancó el turno. */
  fecha: string;
  empleado_id: string;
}

/** Lo que el motor decidió para un (empleado, día), tal cual está en `calculos_diarios`. */
export interface CalculoDelDia {
  horas_normales: number;
  horas_extra_50: number;
  horas_extra_100: number;
  tarde: boolean;
  retiro_anticipado: boolean;
  /** RRHH fijó las horas a mano: el motor no las recalcula y se liquidan esas. */
  horas_manual: boolean;
}

/**
 * El cálculo del día tal como llega a la pantalla:
 * - un objeto: el motor ya calculó ese día;
 * - `null`: no hay fila, el día todavía no se recalculó;
 * - `undefined`: no se pudo leer la tabla. No es lo mismo que "sin calcular".
 */
export type CalculoDelDiaLeido = CalculoDelDia | null | undefined;

export interface Acreditado {
  /** Instante desde el que se acredita. Igual a la marca si no hubo ajuste. */
  entrada: Date;
  /** Instante hasta el que se acredita; null si la marcación no tiene salida. */
  salida: Date | null;
  /** La entrada acreditada se ve distinta (al minuto) de la marcada. */
  difiereEntrada: boolean;
  difiereSalida: boolean;
  /**
   * Horas que aporta esta marcación, de corrido: un turno 20 a 4 son 8, no 4 y
   * 4 como las parte el cálculo diario en la medianoche. Null si no tiene
   * salida: el motor ignora una fichada abierta y no acredita nada por ella.
   */
  horas: number | null;
  /** Primera marcación del día: donde se anota la tardanza. */
  esPrimeraDelDia: boolean;
  /** Última marcación del día: donde se anota el retiro anticipado. */
  esUltimaDelDia: boolean;
}

function aMinuto(instante: Date): number {
  return Math.floor(instante.getTime() / 60_000);
}

function aLike(f: FichadaCruda, fecha: Date): FichadaLike {
  return {
    fecha,
    horaEntrada: new Date(f.hora_entrada),
    horaSalida: f.hora_salida ? new Date(f.hora_salida) : null,
  };
}

/**
 * Lo acreditado de cada marcación de UN día de UN empleado, por id de fichada.
 *
 * Las marcaciones tienen que ser todas las del día: el turno se detecta con la
 * primera entrada y la última salida. Con un día cortado a la mitad el
 * resultado se ve bien y está mal, por eso quien llama debe traerlo completo.
 *
 * Devuelve un Map vacío si no hay marcaciones. Sin turnos activos en el
 * catálogo el motor no ajusta nada, y acá tampoco: lo acreditado es la marca.
 */
export function acreditarDia(
  fichadas: FichadaCruda[],
  fecha: string,
  turnos: TurnoLike[]
): Map<string, Acreditado> {
  const resultado = new Map<string, Acreditado>();
  if (fichadas.length === 0) return resultado;

  const dia = utcDateOnlyFrom(new Date(fecha));
  // Ordenadas por entrada, como las ordena el motor por dentro: así la
  // posición i de lo ajustado es la de la marcación i y se puede volver al id.
  const ordenadas = [...fichadas].sort(
    (a, b) => new Date(a.hora_entrada).getTime() - new Date(b.hora_entrada).getTime()
  );
  const reales = ordenadas.map((f) => aLike(f, dia));
  const { ajustadas } = ajustarFichadasPorTurno(reales, turnos);

  ordenadas.forEach((f, i) => {
    const real = reales[i];
    const ajustada = ajustadas[i];
    resultado.set(f.id, {
      entrada: ajustada.horaEntrada,
      salida: ajustada.horaSalida,
      difiereEntrada: aMinuto(ajustada.horaEntrada) !== aMinuto(real.horaEntrada),
      difiereSalida:
        !!ajustada.horaSalida && !!real.horaSalida && aMinuto(ajustada.horaSalida) !== aMinuto(real.horaSalida),
      horas: ajustada.horaSalida ? (ajustada.horaSalida.getTime() - ajustada.horaEntrada.getTime()) / 3_600_000 : null,
      esPrimeraDelDia: i === 0,
      esUltimaDelDia: i === ordenadas.length - 1,
    });
  });

  return resultado;
}

/**
 * Lo mismo para una lista con marcaciones de varios empleados y varios días:
 * las agrupa por empleado y día, que es como las agrupa el motor, y devuelve
 * todo junto por id de fichada.
 *
 * Es pura sobre la lista que recibe, así que sigue valiendo cuando la pantalla
 * se refresca con otra lista: el dato se deriva de lo que se muestra y no se
 * guarda aparte.
 */
export function acreditarLista(
  fichadas: FichadaCrudaDeLista[],
  turnos: TurnoLike[]
): Map<string, Acreditado> {
  const grupos = new Map<string, FichadaCrudaDeLista[]>();
  for (const f of fichadas) {
    const clave = `${f.empleado_id}|${f.fecha.slice(0, 10)}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(f);
    else grupos.set(clave, [f]);
  }

  const resultado = new Map<string, Acreditado>();
  for (const grupo of grupos.values()) {
    for (const [id, acreditado] of acreditarDia(grupo, grupo[0].fecha.slice(0, 10), turnos)) {
      resultado.set(id, acreditado);
    }
  }
  return resultado;
}

/** "8h", "7h 53m", "45m". Redondea al minuto. */
export function formatearHoras(horas: number): string {
  const total = Math.round(horas * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "20:00 → 04:00" de lo acreditado, en hora de Argentina. */
export function rangoAcreditado(a: Acreditado): string {
  return `${formatHHMM(a.entrada)} → ${a.salida ? formatHHMM(a.salida) : "-"}`;
}

/** Las horas que el motor guardó para el día, sumadas. */
export function horasDelCalculo(c: CalculoDelDia): number {
  return Number(c.horas_normales) + Number(c.horas_extra_50) + Number(c.horas_extra_100);
}

/**
 * Qué se muestra de una marcación. Un campo en null es "no mostrar".
 *
 * - **Día con horas fijadas a mano:** se muestran esas horas y se dice que son
 *   fijadas; el rango acreditado no, porque no es lo que se liquida. Van en la
 *   primera marcación del día, que es donde está el total: repetirlas en cada
 *   fila sería contar el día dos veces.
 * - **Rango:** sólo si difiere de la marca; repetirla cuando coincide es ruido.
 * - **Tardanza y retiro:** los dice `calculos_diarios`. Si no hay fila, el día
 *   todavía no se calculó y se avisa, para que no se confunda con un día sin
 *   tardanza; si la tabla no se pudo leer (`undefined`), no se dice nada de
 *   ninguna de las dos cosas.
 */
export interface TextoAcreditado {
  /** "20:00 → 04:00" si alguna punta difiere de la marca y el día no es manual. */
  rango: string | null;
  /** "8h", o null si no hay horas que mostrar para esta fila. */
  horas: string | null;
  /** Las horas mostradas son las fijadas a mano del día. */
  horasFijadasAMano: boolean;
  sinSalida: boolean;
  /** No hay fila en `calculos_diarios`: el día aún no se recalculó. */
  diaSinCalcular: boolean;
  tardanza: boolean;
  retiroAnticipado: boolean;
}

export function textoAcreditado(a: Acreditado, calculo: CalculoDelDiaLeido): TextoAcreditado {
  const manual = !!calculo && calculo.horas_manual;
  const base: TextoAcreditado = {
    rango: null,
    horas: null,
    horasFijadasAMano: false,
    sinSalida: false,
    diaSinCalcular: calculo === null,
    tardanza: !!calculo && calculo.tarde && a.esPrimeraDelDia,
    retiroAnticipado: !!calculo && calculo.retiro_anticipado && a.esUltimaDelDia,
  };

  if (manual) {
    return {
      ...base,
      horas: a.esPrimeraDelDia ? formatearHoras(horasDelCalculo(calculo)) : null,
      horasFijadasAMano: a.esPrimeraDelDia,
    };
  }

  return {
    ...base,
    rango: a.difiereEntrada || a.difiereSalida ? rangoAcreditado(a) : null,
    horas: a.horas === null ? null : formatearHoras(a.horas),
    sinSalida: a.horas === null,
  };
}

/**
 * Un instante ISO a partir de lo que se tipea en el formulario: día "YYYY-MM-DD"
 * y hora "HH:MM" de pared en Argentina (UTC-3 fijo, igual que `localDateTime`).
 * Null si falta algo o no es una fecha válida.
 *
 * Sirve para mostrar lo acreditado mientras se edita, antes de guardar: ver que
 * una salida 03:42 ya se acredita como 04:00 es lo que evita "arreglarla".
 */
export function instanteDePared(fecha: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const instante = new Date(`${fecha}T${hhmm}:00-03:00`);
  return Number.isNaN(instante.getTime()) ? null : instante.toISOString();
}
