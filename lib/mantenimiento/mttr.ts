/**
 * Cuánto tarda una máquina en volver, medido en horas de trabajo.
 *
 * MTTR = horas de reparación / cantidad de reparaciones. Es el indicador que
 * acompaña al MTBF y se lee con él: el MTBF dice cada cuánto se rompe y éste
 * cuánto cuesta levantarla. Comparten la ventana, el tipo de orden y la fecha
 * —los mismos 365 días, las mismas correctivas, el mismo `fecha_ejecucion`—
 * justamente para que se puedan leer en la misma línea sin aclarar nada.
 *
 * ── QUÉ ES `horas`, Y POR QUÉ ESTO SE PUEDE CALCULAR ──────────────────────
 *
 * **`horas` es cuánto duró el trabajo, no horas-hombre.** No es una
 * suposición: está verificado contra los datos en `costoEquipo.ts`, que lo
 * necesitaba para lo contrario —multiplicarlo por la gente— y lo midió. Las
 * órdenes con tres operarios tienen la misma mediana que las de uno, 3 horas,
 * cuando serían el triple si ya vinieran multiplicadas. Por eso el promedio de
 * `horas` es un tiempo de reparación y no un costo disfrazado.
 *
 * ── LAS DE CONTRATISTA NO ENTRAN, Y ESO ES LA MITAD DEL DISEÑO ────────────
 *
 * En una orden con contratista, `horas` deja de ser la duración y pasa a ser
 * lo que el tercero factura. La prueba es aritmética y no de opinión: la OT
 * 2064 tiene **415 horas entre el 20 y el 29 de junio**, nueve días de
 * calendario, que son 216 horas de reloj. No es una reparación de 415 horas:
 * es una cuadrilla. Promediar eso con una correctiva propia de 3 horas no da
 * un MTTR malo, da un número que no mide nada.
 *
 * Medido el 11/11/2026 sobre las 612 reparaciones de la ventana con horas y
 * equipo —555 propias y 57 con contratista—, el precio de mezclarlas:
 *
 *   MTTR de la planta, sólo propias ....  3,25 h
 *   MTTR de la planta, mezclado ........  5,46 h
 *   MTTR de las de contratista .........  26,93 h
 *
 * Y el ranking, que es lo que alguien mira para decidir, se da vuelta: con las
 * de contratista adentro los **dos primeros puestos son «Edificio»** —PO-C1
 * con 84,8 h y PO-A1 con 49 h—, que es el equipo comodín al que se imputa lo
 * que no tiene máquina. Sin ellas, los primeros son dos máquinas de verdad, la
 * Cadena de arrastre 6 y el Molino de bolas.
 *
 * El criterio de "es de un tercero" es **que `contratista` tenga texto**, el
 * mismo que ya usa `costoEquipo.ts` para no costear esas horas. Dos criterios
 * distintos para la misma pregunta es cómo se separan dos módulos que miran la
 * misma tabla.
 *
 * ── LO QUE ESTE NÚMERO NO ES ──────────────────────────────────────────────
 *
 * **No es tiempo de parada de la máquina.** Son las horas que llevó el
 * trabajo, no las que el equipo estuvo detenido esperando el repuesto. Y no se
 * puede sacar del calendario: `fecha_cierre - fecha_ejecucion` da **0 en 750
 * de 811** correctivas cerradas de la ventana, porque la fecha de cierre se
 * carga el mismo día que se registra el trabajo. Esa es la trampa que el spec
 * del MTBF dejó anotada —«una OT cerrada tarde no es una reparación larga»— y
 * por el otro lado tampoco sirve: una cerrada el mismo día no es una
 * reparación instantánea.
 *
 * Todas las fechas viajan como texto `YYYY-MM-DD` y se comparan como texto,
 * por lo mismo que en `mtbf.ts`: pasar por `toISOString()` corre el día en un
 * servidor en UTC.
 */
import { sumarDias } from "@/lib/core/fechas";
import { fechaDeFalla, VENTANA_DIAS } from "./mtbf";

/**
 * Cuántas reparaciones hacen falta para publicar un promedio.
 *
 * Con una sola, "el promedio" es esa orden; con dos, cualquiera de las dos la
 * mueve a la mitad. El equipo aparece igual con su cuenta de reparaciones y
 * sin número, que es lo que hace `mtbf.ts` cuando la ventana observada no
 * llega al piso: decir "todavía no" en vez de publicar ruido.
 *
 * Medido el 11/11/2026: de los 119 equipos con alguna reparación propia en la
 * ventana, **47 llegan a tres**.
 */
export const MINIMO_REPARACIONES = 3;

/** Una orden como la necesita esta cuenta. */
export interface OtReparacion {
  ot_number: number;
  tipo: string | null;
  fecha: string | null;
  fecha_ejecucion: string | null;
  horas: number | null;
  equipment_id: string | null;
  contratista: string | null;
}

export interface Reparacion {
  otNumber: number;
  equipmentId: string;
  fecha: string;
  horas: number;
}

export interface FilaMttr {
  equipmentId: string;
  reparaciones: number;
  /** null bajo MINIMO_REPARACIONES: hay cuenta, todavía no hay promedio. */
  mttr: number | null;
  horasTotales: number;
  /**
   * La que más tardó, para poder ir a mirarla.
   *
   * Un MTTR alto casi siempre es una orden larga y no un equipo lento, y sin
   * esto hay que salir a buscarla a mano por el listado de OT.
   */
  masLarga: Reparacion;
}

/**
 * Lo que quedó afuera, contado.
 *
 * Va en el resultado y no en un `console.warn` porque es la mitad de lo que
 * hace creíble al número: quien lee "3,3 h" tiene derecho a saber sobre qué
 * parte de las correctivas se calculó. Es la misma decisión que `sinAtribuir`
 * en `mtbf.ts`.
 *
 * **Los cuatro números cierran contra las correctivas de la ventana**, y eso
 * es lo que lo hace auditable: medido el 11/11/2026 con la lectura real,
 * 555 contables + 89 de contratista + 330 sin horas + 5 sin equipo = 979, que
 * son exactamente las correctivas de la ventana. Si alguna orden se contara
 * en dos motivos, o en ninguno, la suma lo diría.
 */
export interface LoQueQuedoAfuera {
  /** Correctivas de la ventana con horas, hechas por un tercero. */
  deContratista: number;
  /** Correctivas de la ventana sin horas cargadas: no se sabe cuánto llevaron. */
  sinHoras: number;
  /** Propias, con horas, pero sin equipo enlazado: no se le pueden imputar a nadie. */
  sinEquipo: number;
}

export interface Mttr {
  /** Ordenadas por mttr descendente —primero las que más tardan—; las null al final. */
  filas: FilaMttr[];
  /** El promedio de toda la planta. null si no hubo ninguna reparación contable. */
  mttrDeLaPlanta: number | null;
  /** Las que entraron a la cuenta. */
  reparaciones: number;
  afuera: LoQueQuedoAfuera;
}

const tieneTexto = (v: string | null | undefined): boolean => String(v ?? "").trim() !== "";

/**
 * Si la hizo un tercero.
 *
 * Mira `contratista` y no `quien`, igual que `costoEquipo.ts`: `quien` es lo
 * que se eligió en un desplegable y `contratista` es el campo donde está el
 * nombre del que vino. Cuando los dos no coinciden, el que tiene el dato es
 * éste.
 */
export function esDeUnTercero(ot: OtReparacion): boolean {
  return tieneTexto(ot.contratista);
}

/**
 * Las reparaciones propias de la ventana, y qué quedó afuera.
 *
 * La ventana es la misma del MTBF —`VENTANA_DIAS` hasta `hasta`, inclusive— y
 * la fecha también: `fechaDeFalla`, que es `fecha_ejecucion` y sólo si falta,
 * `fecha`. Lo ejecutado después de `hasta` queda afuera por lo mismo que allá:
 * hay órdenes con fechas del futuro por errores de carga.
 *
 * El orden de los descartes importa para que la cuenta de `afuera` no mienta:
 * una orden de contratista sin horas se cuenta **una sola vez**, en
 * `deContratista`, que es la razón de más arriba.
 */
export function reparacionesDeLaVentana(
  ordenes: OtReparacion[],
  hasta: string
): { reparaciones: Reparacion[]; afuera: LoQueQuedoAfuera } {
  const desde = sumarDias(hasta, -(VENTANA_DIAS - 1));
  const reparaciones: Reparacion[] = [];
  const afuera: LoQueQuedoAfuera = { deContratista: 0, sinHoras: 0, sinEquipo: 0 };

  for (const ot of ordenes) {
    if (ot.tipo !== "CORRECTIVO") continue;
    const fecha = fechaDeFalla(ot);
    if (fecha === null || fecha < desde || fecha > hasta) continue;

    if (esDeUnTercero(ot)) {
      afuera.deContratista += 1;
      continue;
    }
    // Cero horas no es "duró cero": es que no se cargó. Una reparación que
    // existe duró algo, aunque sea diez minutos.
    if (ot.horas === null || !(ot.horas > 0)) {
      afuera.sinHoras += 1;
      continue;
    }
    if (ot.equipment_id === null) {
      afuera.sinEquipo += 1;
      continue;
    }

    reparaciones.push({
      otNumber: ot.ot_number,
      equipmentId: ot.equipment_id,
      fecha,
      horas: ot.horas,
    });
  }

  return { reparaciones, afuera };
}

const promedio = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function calcularMttr(ordenes: OtReparacion[], hasta: string): Mttr {
  const { reparaciones, afuera } = reparacionesDeLaVentana(ordenes, hasta);

  if (reparaciones.length === 0) {
    return { filas: [], mttrDeLaPlanta: null, reparaciones: 0, afuera };
  }

  const porEquipo = new Map<string, Reparacion[]>();
  for (const r of reparaciones) {
    const lista = porEquipo.get(r.equipmentId) ?? [];
    lista.push(r);
    porEquipo.set(r.equipmentId, lista);
  }

  const filas: FilaMttr[] = [...porEquipo.entries()].map(([equipmentId, propias]) => ({
    equipmentId,
    reparaciones: propias.length,
    mttr: propias.length >= MINIMO_REPARACIONES ? promedio(propias.map((r) => r.horas)) : null,
    horasTotales: propias.reduce((a, r) => a + r.horas, 0),
    // Con dos iguales gana la más reciente: es la que todavía se recuerda.
    masLarga: propias.reduce((peor, r) =>
      r.horas > peor.horas || (r.horas === peor.horas && r.fecha > peor.fecha) ? r : peor
    ),
  }));

  filas.sort((a, b) => {
    if (a.mttr === null && b.mttr === null) return b.reparaciones - a.reparaciones;
    if (a.mttr === null) return 1;
    if (b.mttr === null) return -1;
    return b.mttr - a.mttr;
  });

  return {
    filas,
    mttrDeLaPlanta: promedio(reparaciones.map((r) => r.horas)),
    reparaciones: reparaciones.length,
    afuera,
  };
}

/** La fila de un equipo, o null si no tuvo reparaciones contables en la ventana. */
export function mttrDelEquipo(mttr: Mttr | null, equipmentId: string): FilaMttr | null {
  return mttr?.filas.find((f) => f.equipmentId === equipmentId) ?? null;
}

/**
 * Las horas de un MTTR: "5,4 h". Sin número no se escribe ninguno.
 *
 * Va a mano y no con `toLocaleString` por lo mismo que `conComa` en
 * `mtbfVista.ts`: el servidor y el navegador pueden tener ICU distintos, y un
 * "5,4" que sale "5.4" en uno de los dos es un error de hidratación que no se
 * ve en el desarrollo.
 */
export function horasDeReparacion(mttr: number | null): string {
  return mttr === null ? "—" : `${mttr.toFixed(1).replace(".", ",")} h`;
}
