/**
 * De las filas crudas del robot a turnos con su estado. Es lógica pura: no toca
 * Drive ni la base, y es donde viven las cuatro maneras en que el dato del
 * robot miente sin avisar (ver el spec de molinos, secciones 2 a 4 y el
 * corolario del huérfano).
 *
 * El orden en que se aplican las reglas importa, y es éste:
 *
 * 1. **Un día sin ninguna fila sale de la secuencia.** No es un dato que falta:
 *    es una planta que no trabajó (los 22 de Filler 1 son domingo o feriado), y
 *    contarlo inventaría 528 horas de molino parado. Ni numerador ni
 *    denominador: no genera turnos de ningún tipo.
 * 2. **Un turno en cero dentro de un día con filas es una parada normal.** No es
 *    lo mismo que la regla anterior y la diferencia es la trampa: Filler 2 deja
 *    cuatro ceros donde Filler 1 deja el día vacío. Acá el cero es un dato.
 * 3. **Una fila que excede su duración se cubre con la racha de turnos
 *    faltantes que tiene justo antes** (`acumulado`), o queda `inconsistente`.
 *    Dentro de la tolerancia el exceso es deriva del reloj del PLC y no es nada.
 * 4. **Un turno que falta y que ninguna fila absorbió es `huerfano`**: no es una
 *    parada, no entra en ningún indicador, pero se lista.
 *
 * `porMaterial` se arrastra tal cual desde la fila cruda. **No se concilia con
 * `kg` ni se reparte**: son dos contadores distintos del robot y en 65 de 842
 * turnos de Filler 1 no coinciden (hasta 695 kg). Forzarlos a coincidir
 * inventaría un número. Quien acumule turnos en una racha suma los
 * `porMaterial` entre sí, nunca contra `kg`.
 */

import type { CorteDeTurno, EstadoDeTurno, FilaCruda, TurnoDeMolino } from "./types";

/** Duración teórica, en minutos, del bloque que cierra a cada hora. */
export const DURACION: Record<CorteDeTurno, number> = {
  "23:59": 240,
  "3:59": 240,
  "11:59": 480,
  "19:59": 480,
};

/**
 * Los cortes en el orden en que ocurren dentro de un día calendario: el de las
 * 3:59 cierra las 00 a 04 de **ese** día, así que abre la secuencia y el de las
 * 23:59 la cierra. Es orden de reloj, no el del archivo: cada molino numera los
 * suyos distinto.
 */
const MINUTOS_DE_UN_DIA = 240 + 480 + 480 + 240;

const CORTES_EN_ORDEN: readonly CorteDeTurno[] = ["3:59", "11:59", "19:59", "23:59"];

/** El turno lo decide la hora de cierre y nunca la posición de la columna. */
export function turnoDelCorte(corte: CorteDeTurno): TurnoDeMolino {
  switch (corte) {
    case "23:59":
      return "20_00";
    case "3:59":
      return "00_04";
    case "11:59":
      return "04_12";
    case "19:59":
      return "12_20";
  }
}

export interface TurnoDeRobot {
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: TurnoDeMolino;
  kg: number;
  /** Lo que informó el robot, sin recortar ni repartir. 0 en un huérfano. */
  minutosMarcha: number;
  /**
   * Contra qué se mide la marcha: la duración del bloque; la marcha informada si
   * excede por poco; la suma de la racha si es `acumulado`. 0 en un huérfano,
   * que no entra en ningún indicador.
   */
  minutosTeoricos: number;
  estado: EstadoDeTurno;
  /** Tal cual lo leyó el parser; no tiene por qué sumar `kg` (ver el encabezado). */
  porMaterial: Record<string, number>;
}

/** Un lugar de la secuencia: tiene fila o es un turno que el robot no informó. */
interface Casilla {
  fecha: string;
  corte: CorteDeTurno;
  fila: FilaCruda | undefined;
}

/** Días de calendario de `a` a `b`, ambos "YYYY-MM-DD" con `a` <= `b`. */
function diasEntre(a: string, b: string): number {
  const ms = (f: string) => {
    const [y, m, d] = f.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** "YYYY-MM-DD" del día siguiente. UTC para que un cambio de hora no lo corra. */
function diaSiguiente(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

function huerfano(c: Casilla): TurnoDeRobot {
  return {
    fecha: c.fecha,
    turno: turnoDelCorte(c.corte),
    kg: 0,
    minutosMarcha: 0,
    minutosTeoricos: 0,
    estado: "huerfano",
    porMaterial: {},
  };
}

/**
 * Arma los turnos de un molino a partir de sus filas, en orden cronológico, y
 * la lista de días en que la planta no operó (los que quedan entre el primero y
 * el último día con filas sin tener ninguna).
 *
 * `toleranciaMin` es cuánto puede pasarse la marcha de la duración del bloque
 * antes de pensar que hay una racha: 10 minutos. Los tres excesos chicos que se
 * midieron (+1, +6, +18) son deriva del reloj; el de +18 quedó afuera de la
 * tolerancia y por eso es el caso `inconsistente` de los tests.
 *
 * Si llegan dos filas para el mismo día y corte —no debería: cada archivo trae
 * una— se queda con la última, igual que el desglose del parser. Sumarlas
 * duplicaría un turno cuando un zip se relee.
 */
export function armarTurnos(
  filas: FilaCruda[],
  toleranciaMin = 10,
): { turnos: TurnoDeRobot[]; diasNoOperativos: string[] } {
  const porClave = new Map<string, FilaCruda>();
  for (const f of filas) porClave.set(`${f.fecha}|${f.corte}`, f);
  if (porClave.size === 0) return { turnos: [], diasNoOperativos: [] };

  const diasConFilas = [...new Set([...porClave.values()].map((f) => f.fecha))].sort();

  // Los días de hueco entre el primero y el último. Antes del primero y después
  // del último no se sabe nada: no se puede decir que la planta no operó un día
  // que el zip todavía no trae.
  const conFilas = new Set(diasConFilas);
  const diasNoOperativos: string[] = [];
  for (let d = diaSiguiente(diasConFilas[0]); d < diasConFilas[diasConFilas.length - 1]; d = diaSiguiente(d)) {
    if (!conFilas.has(d)) diasNoOperativos.push(d);
  }

  // La secuencia sólo tiene los días operativos: un día sin filas no aporta
  // casillas, ni como parada ni como parte de una racha.
  const secuencia: Casilla[] = diasConFilas.flatMap((fecha) =>
    CORTES_EN_ORDEN.map((corte) => ({ fecha, corte, fila: porClave.get(`${fecha}|${corte}`) })),
  );

  const turnos: TurnoDeRobot[] = [];
  // Los faltantes desde la última fila presente, que son los candidatos a ser
  // absorbidos por la próxima.
  let racha: Casilla[] = [];
  // Los minutos de los días sin filas que la racha atraviesa. Cuentan para
  // explicar un exceso —el robot no corta nada mientras la planta está parada, y
  // la fila que sigue lo carga todo— pero no son huérfanos: ese día no existe.
  // Es lo que da los 2.160 minutos del 09/03/2026, que cruza el domingo 08/03.
  let minutosDeDiasParados = 0;
  let diaAnterior = secuencia[0].fecha;

  for (const casilla of secuencia) {
    minutosDeDiasParados += Math.max(0, diasEntre(diaAnterior, casilla.fecha) - 1) * MINUTOS_DE_UN_DIA;
    diaAnterior = casilla.fecha;
    const fila = casilla.fila;
    if (!fila) {
      racha.push(casilla);
      continue;
    }

    const teorica = DURACION[casilla.corte];
    let estado: EstadoDeTurno = "normal";
    let minutosTeoricos = teorica;
    let absorbida = false;

    if (fila.minutos > teorica + toleranciaMin) {
      // Sin racha el `reduce` da 0 y el exceso queda sin cubrir: es justamente
      // el caso `inconsistente`.
      const cubierta =
        teorica + racha.reduce((s, c) => s + DURACION[c.corte], 0) + minutosDeDiasParados;
      if (fila.minutos <= cubierta + toleranciaMin) {
        estado = "acumulado";
        minutosTeoricos = cubierta;
        absorbida = true;
      } else {
        estado = "inconsistente";
      }
    } else if (fila.minutos > teorica) {
      // Deriva del reloj: la duración teórica se toma como la marcha informada,
      // para que la utilización de ese turno no pase del 100 %.
      minutosTeoricos = fila.minutos;
    }

    // Lo que la fila no absorbió queda como huérfano, en su lugar cronológico.
    if (!absorbida) for (const c of racha) turnos.push(huerfano(c));
    racha = [];
    minutosDeDiasParados = 0;

    turnos.push({
      fecha: fila.fecha,
      turno: turnoDelCorte(fila.corte),
      kg: fila.kg,
      minutosMarcha: fila.minutos,
      minutosTeoricos,
      estado,
      porMaterial: fila.porMaterial,
    });
  }

  // Lo que quedó al final no tiene fila posterior que lo absorba: es el día en
  // curso, que el zip corta a las 09:00.
  for (const c of racha) turnos.push(huerfano(c));

  return { turnos, diasNoOperativos };
}
