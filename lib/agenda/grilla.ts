import { sumarDias } from "@/lib/core/fechas";
import { diaYHoraDe, type EventoVista } from "./vista";

/**
 * Dónde cae cada evento en la grilla de la Agenda y cuánto ancho le toca.
 * Sin React y sin red: la pantalla dibuja lo que devuelve esto y nada más.
 *
 * **Lo único que este módulo tiene que garantizar es que un evento entero no
 * deje de dibujarse**: ni por ser demasiado corto, ni por superponerse con
 * otro, ni por empezar un día y terminar otro. En producción hay dos eventos y
 * nunca se tocan, así que ninguna de esas fallas se vería mirando la pantalla;
 * lo que las defiende son los tests de al lado.
 *
 * Los minutos son **hora de pared de Argentina** y salen de `diaYHoraDe`, nunca
 * de `getHours()`: el servidor corre en UTC y el navegador en lo que tenga la
 * máquina, y un evento de las 22:30 no puede caer en el día siguiente según
 * quién lo mire.
 */

/**
 * El alto mínimo de un bloque, en minutos.
 *
 * Existe porque **un evento de duración cero es posible**: Google lo permite y
 * «aceptar lo de Google» lo puede traer a la agenda. Un bloque de alto cero es
 * un evento que existe, se puede abrir y borrar, y no se ve en ningún lado —
 * exactamente la falla que este módulo está para evitar—. Veinte minutos es
 * lo que mide una línea de texto legible en la grilla.
 */
export const MINUTOS_MINIMOS = 20;

const MINUTOS_DEL_DIA = 24 * 60;

/** Un evento visto desde **un** día. */
export interface PedazoDelDia {
  evento: EventoVista;
  /** El día (`YYYY-MM-DD`, Argentina) en que cae este pedazo. */
  dia: string;
  /** Minutos desde la medianoche de `dia`, recortados a `[0, 1440]`. */
  desdeMin: number;
  hastaMin: number;
  /** El evento empezó antes de este día: la pantalla lo puede marcar. */
  vieneDeAntes: boolean;
  /** El evento sigue después de este día. */
  sigueDespues: boolean;
}

/** Un pedazo con su lugar: la columna que ocupa dentro de su racimo y cuántas tiene el racimo. */
export interface PedazoUbicado extends PedazoDelDia {
  columna: number;
  columnas: number;
}

function minutosDe(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Parte cada evento en un pedazo por cada uno de los `dias` que toca.
 *
 * Un evento que cruza la medianoche —Google lo permite— da un pedazo en cada
 * día, y alcanza con que **un** día de los pedidos lo toque para que salga:
 * mirar sólo el día de llegada de uno que empezó ayer a las 23:00 lo muestra
 * igual, marcado `vieneDeAntes`. La salida va por día en el orden en que vienen
 * `dias` y, dentro de cada día, en el orden de `eventos`.
 *
 * Dos bordes que no son obvios:
 * - Un evento que termina **a las 00:00 en punto** de un día posterior termina
 *   al cierre del anterior (1440). Si no, dejaría un pedazo fantasma de nada en
 *   el día siguiente.
 * - Un fin igual o anterior al inicio es un dato roto, y **un dato roto no
 *   puede ser un evento que desaparece**: se trata como de duración cero.
 */
export function partirPorDia(eventos: readonly EventoVista[], dias: readonly string[]): PedazoDelDia[] {
  const pedazos: PedazoDelDia[] = [];

  for (const dia of dias) {
    for (const evento of eventos) {
      const inicio = diaYHoraDe(evento.inicio);
      const fin = diaYHoraDe(evento.fin);
      const desdeInicioMin = minutosDe(inicio.hora);

      let ultimoDia = fin.dia;
      let finMin = minutosDe(fin.hora);
      if (Date.parse(evento.fin) <= Date.parse(evento.inicio)) {
        ultimoDia = inicio.dia;
        finMin = desdeInicioMin;
      } else if (fin.dia > inicio.dia && finMin === 0) {
        ultimoDia = sumarDias(fin.dia, -1);
        finMin = MINUTOS_DEL_DIA;
      }

      // «YYYY-MM-DD» ordena como texto.
      if (dia < inicio.dia || dia > ultimoDia) continue;

      let desdeMin = dia === inicio.dia ? desdeInicioMin : 0;
      let hastaMin = dia === ultimoDia ? finMin : MINUTOS_DEL_DIA;

      // El mínimo va al final y, si no entra antes de las 24:00, se corre hacia
      // arriba en vez de pasarse: un bloque fuera de la grilla tampoco se ve.
      if (hastaMin - desdeMin < MINUTOS_MINIMOS) {
        hastaMin = Math.min(MINUTOS_DEL_DIA, desdeMin + MINUTOS_MINIMOS);
        desdeMin = hastaMin - MINUTOS_MINIMOS;
      }

      pedazos.push({
        evento,
        dia,
        desdeMin,
        hastaMin,
        vieneDeAntes: dia > inicio.dia,
        sigueDespues: dia < ultimoDia,
      });
    }
  }

  return pedazos;
}

/**
 * Le da a cada pedazo su columna y el ancho (`columnas`) del racimo en que cae.
 *
 * Se trabaja **por día**: los pedazos de días distintos no se estorban nunca,
 * porque son columnas distintas de la pantalla. Dentro de un día se ordena por
 * hora de inicio y se agrupan en racimos de pedazos que se superponen
 * encadenados —a toca a b y b toca a c: los tres son un racimo aunque a y c no
 * se toquen—, y cada uno toma la primera columna libre. `columnas` es el ancho
 * del racimo, igual para todos los suyos, así que un racimo apretado no le
 * quita ancho al de la mañana. Que uno termine justo cuando empieza otro no es
 * superponerse.
 *
 * **No hay tope de columnas ni nada que se descarte**: seis eventos a la vez son
 * seis columnas angostas, y angostas se ven; faltantes no.
 *
 * **El resultado no depende del orden de entrada**: el empate de hora de inicio
 * se resuelve por `evento.id`. Sin eso, dos eventos idénticos cambiarían de
 * columna entre un render y el siguiente según cómo los devolvió la base. La
 * salida va ordenada por día, inicio e id.
 */
export function acomodar(pedazos: readonly PedazoDelDia[]): PedazoUbicado[] {
  const ordenados = [...pedazos].sort(
    (a, b) =>
      (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0) ||
      a.desdeMin - b.desdeMin ||
      (a.evento.id < b.evento.id ? -1 : a.evento.id > b.evento.id ? 1 : 0) ||
      a.hastaMin - b.hastaMin
  );

  const ubicados: PedazoUbicado[] = [];
  let racimo: PedazoUbicado[] = [];
  /** Hasta cuándo está ocupada cada columna del racimo en curso. */
  let ocupadaHasta: number[] = [];
  let finDelRacimo = 0;
  let diaDelRacimo = "";

  const cerrarRacimo = () => {
    for (const p of racimo) p.columnas = ocupadaHasta.length;
    racimo = [];
    ocupadaHasta = [];
  };

  for (const p of ordenados) {
    if (racimo.length > 0 && (p.dia !== diaDelRacimo || p.desdeMin >= finDelRacimo)) cerrarRacimo();
    if (racimo.length === 0) {
      diaDelRacimo = p.dia;
      finDelRacimo = p.hastaMin;
    }

    let columna = ocupadaHasta.findIndex((hasta) => hasta <= p.desdeMin);
    if (columna === -1) {
      columna = ocupadaHasta.length;
      ocupadaHasta.push(p.hastaMin);
    } else {
      ocupadaHasta[columna] = p.hastaMin;
    }
    finDelRacimo = Math.max(finDelRacimo, p.hastaMin);

    const u: PedazoUbicado = { ...p, columna, columnas: 0 };
    racimo.push(u);
    ubicados.push(u);
  }
  cerrarRacimo();

  return ubicados;
}
