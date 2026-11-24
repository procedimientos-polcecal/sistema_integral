/**
 * Las cuentas que llevan arriba las hojas impresas del mes de órdenes, y el
 * recorte que impide que un día roto se lleve la hoja entera.
 *
 * **Dos cuentas que parecen la misma y no lo son, y es a propósito.** Una orden
 * ocupa todos los días de su ventana, así que aparece en varios días del
 * calendario:
 *
 * - `indicadoresDelMes` cuenta **órdenes distintas** (un `Set` de `ot_number`),
 *   que es lo mismo que hace `totalDelMes` en la pantalla. Es la respuesta a
 *   «cuánto trabajo hay este mes».
 * - `resumenDelDia` y `diaMasCargado` cuentan **lo que cae ese día**, arrastres
 *   incluidos. Es la respuesta a «qué tengo el martes».
 *
 * O sea que **la suma de los cuadritos no da el total del mes**, y nunca va a
 * darlo. No es un error de redondeo: es que una orden de cuatro días está en
 * cuatro cuadritos y en el total una sola vez. La hoja lo dice al pie; si
 * alguien «arregla» una de las dos para que cierren, rompe la otra.
 */
import type { DiaDelCalendario } from "./calendarioDeOT";
import { pasaElFiltro, type Filtros } from "./filtrosDelCalendario";
import { letraDeEspecialidad, LEYENDA_IMPRESA } from "./marcasImpresas";

type OrdenDelDia = DiaDelCalendario["ordenes"][number];

export interface PorLetra {
  letra: string;
  cantidad: number;
}

/**
 * El desglose por letra, en el orden de `LEYENDA_IMPRESA` y **sin las que están
 * en cero**: en un cuadro de 39 × 35 mm, un `E 0` gasta el lugar de un dato.
 */
function desglosar(cuenta: Map<string, number>): PorLetra[] {
  const salida: PorLetra[] = [];
  for (const { letra } of LEYENDA_IMPRESA) {
    const cantidad = cuenta.get(letra) ?? 0;
    if (cantidad > 0) salida.push({ letra, cantidad });
  }
  return salida;
}

export interface ResumenDelDia {
  total: number;
  porLetra: PorLetra[];
  atrasadas: number;
}

/** Qué hay ese día, después del filtro. Los arrastres cuentan: ese día ocupan taller. */
export function resumenDelDia(dia: DiaDelCalendario, f: Filtros): ResumenDelDia {
  const cuenta = new Map<string, number>();
  let total = 0;
  let atrasadas = 0;
  for (const o of dia.ordenes) {
    if (!pasaElFiltro(o, f)) continue;
    total++;
    if (o.atrasada) atrasadas++;
    const letra = letraDeEspecialidad(o.especialidad);
    cuenta.set(letra, (cuenta.get(letra) ?? 0) + 1);
  }
  return { total, porLetra: desglosar(cuenta), atrasadas };
}

export interface IndicadoresDelMes {
  total: number;
  porLetra: PorLetra[];
  atrasadas: number;
  diaMasCargado: { dia: string; cantidad: number } | null;
}

/**
 * Lo que va arriba de la hoja del mes.
 *
 * `mes` es `"YYYY-MM"` y se usa para dejar afuera los días de relleno: la
 * grilla trae semanas enteras, así que los primeros y los últimos cuadritos son
 * de otro mes y contarlos diría que noviembre tiene órdenes de octubre.
 */
export function indicadoresDelMes(
  dias: DiaDelCalendario[],
  mes: string,
  f: Filtros,
): IndicadoresDelMes {
  const vistas = new Set<number>();
  const atrasadasVistas = new Set<number>();
  const cuenta = new Map<string, number>();
  let diaMasCargado: { dia: string; cantidad: number } | null = null;

  for (const d of dias) {
    if (!d.dia.startsWith(mes)) continue;
    let enEseDia = 0;
    for (const o of d.ordenes) {
      if (!pasaElFiltro(o, f)) continue;
      enEseDia++;
      if (vistas.has(o.ot_number)) continue;
      vistas.add(o.ot_number);
      if (o.atrasada) atrasadasVistas.add(o.ot_number);
      const letra = letraDeEspecialidad(o.especialidad);
      cuenta.set(letra, (cuenta.get(letra) ?? 0) + 1);
    }
    // Estrictamente mayor: con un empate gana el primero, que es el más
    // cercano. Decir «el peor es el 24» cuando el 10 es igual de malo manda a
    // mirar el mes que viene en vez de la semana que viene.
    if (enEseDia > 0 && (!diaMasCargado || enEseDia > diaMasCargado.cantidad)) {
      diaMasCargado = { dia: d.dia, cantidad: enEseDia };
    }
  }

  return {
    total: vistas.size,
    porLetra: desglosar(cuenta),
    atrasadas: atrasadasVistas.size,
    diaMasCargado,
  };
}

export interface IndicadoresDeHoy {
  total: number;
  atrasadas: number;
  sinOperario: number;
}

/**
 * Lo que hay hoy, o `null` si hoy no cae en el mes que se está mirando.
 *
 * El `null` es lo que distingue «hoy no hay nada» de «este mes no es el de
 * hoy»: un cero en diciembre mirando marzo sería una mentira tranquilizadora.
 */
export function indicadoresDeHoy(
  dias: DiaDelCalendario[],
  hoy: string,
  f: Filtros,
): IndicadoresDeHoy | null {
  const d = dias.find((x) => x.dia === hoy);
  if (!d) return null;
  let total = 0;
  let atrasadas = 0;
  let sinOperario = 0;
  for (const o of d.ordenes) {
    if (!pasaElFiltro(o, f)) continue;
    total++;
    if (o.atrasada) atrasadas++;
    if (!tieneAlgunOperario(o)) sinOperario++;
  }
  return { total, atrasadas, sinOperario };
}

/** Las tres posiciones son equivalentes: alcanza con que una tenga a alguien. */
function tieneAlgunOperario(o: OrdenDelDia): boolean {
  return [o.operario_1, o.operario_2, o.operario_3].some((n) => (n ?? "").trim() !== "");
}

/**
 * El recorte de una lista larga, con cuántas quedaron afuera.
 *
 * Existe por un caso real y no por prolijidad: el 23/11/2026 un generador dejó
 * **353 órdenes idénticas en un solo día**. Sin tope, la hoja de ese día sale
 * con seis páginas de la misma línea y la impresora del taller se come el
 * resto del papel. Con tope, sale una página que dice que hay 353 y muestra
 * las primeras — que es lo que alguien necesita para darse cuenta de que algo
 * está mal.
 *
 * El recorte **no se decide solo**: quien lo llama tiene que imprimir el
 * `afuera`. Una hoja truncada sin decirlo es peor que una hoja larga.
 */
export function recorteDeLaHoja<T>(ordenes: T[], tope: number): { visibles: T[]; afuera: number } {
  if (ordenes.length <= tope) return { visibles: ordenes, afuera: 0 };
  return { visibles: ordenes.slice(0, tope), afuera: ordenes.length - tope };
}

/**
 * Cuántas filas entran en la hoja de un día antes de que deje de ser una hoja.
 * Medido: la mediana de un día es 6 y el máximo sano 15, así que 60 es cuatro
 * veces el peor día real y sólo recorta lo que ya es un defecto.
 */
export const TOPE_DE_LA_HOJA = 60;
