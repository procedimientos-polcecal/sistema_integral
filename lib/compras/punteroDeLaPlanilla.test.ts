import { describe, it, expect } from "vitest";
import {
  punterosARefrescar, type DondeEsta, type PunteroGuardado,
} from "./punteroDeLaPlanilla";

const MASTER = "Requerimientos internos";
const AREA = "RI MANTENIMIENTO";

const guardados = (
  filas: [numero: number, hoja: string | null, fila: number | null][]
): ReadonlyMap<number, PunteroGuardado> =>
  new Map(filas.map(([nro, hoja_origen, sheets_fila]) => [nro, { hoja_origen, sheets_fila }]));

describe("los punteros de las filas que la importacion saltea", () => {
  it("el caso que motivo el arreglo: el RI paso del master a la pestania de su area", () => {
    // Es la secuencia medida: el alta anota la hoja de respuestas, la primera
    // sincronizacion lo pasa al master, aprobar desde el sistema pone
    // `editado_en_app` y a partir de ahi la importacion saltea la fila. La
    // aprobacion es lo que hace que el FILTER lo lleve a la pestania del area,
    // asi que el puntero se congelaba justo antes de servir para algo.
    const salteadas: DondeEsta[] = [{ nro_ri: 1906, hoja: AREA, fila: 812 }];

    expect(punterosARefrescar(salteadas, guardados([[1906, MASTER, 1907]]))).toEqual([
      { nro_ri: 1906, hoja_origen: AREA, sheets_fila: 812 },
    ]);
  });

  it("una fila que se corrio dentro de la misma pestania tambien se refresca", () => {
    // Las pestanias son un FILTER del master: aprobar un RI mas viejo mete una
    // fila arriba y corre todas las de abajo. Escribir en la fila de antes es
    // escribirle el estado de este pedido a otro.
    const salteadas: DondeEsta[] = [{ nro_ri: 1231, hoja: AREA, fila: 500 }];

    expect(punterosARefrescar(salteadas, guardados([[1231, AREA, 499]]))).toEqual([
      { nro_ri: 1231, hoja_origen: AREA, sheets_fila: 500 },
    ]);
  });

  it("el que no se movio no se escribe", () => {
    // Es lo que hace que esto no cueste nada en regimen: sin la comparacion
    // serian tantos updates como RI congelados haya, cada quince minutos.
    const salteadas: DondeEsta[] = [
      { nro_ri: 1231, hoja: AREA, fila: 500 },
      { nro_ri: 1232, hoja: AREA, fila: 501 },
    ];

    expect(punterosARefrescar(salteadas, guardados([
      [1231, AREA, 500],
      [1232, AREA, 501],
    ]))).toEqual([]);
  });

  it("un RI salteado sin puntero guardado se escribe", () => {
    // Sin puntero no se puede exportar a ninguna parte, asi que no hay nada
    // que conservar.
    const salteadas: DondeEsta[] = [{ nro_ri: 1841, hoja: AREA, fila: 300 }];

    expect(punterosARefrescar(salteadas, guardados([[1841, null, null]]))).toEqual([
      { nro_ri: 1841, hoja_origen: AREA, sheets_fila: 300 },
    ]);
    expect(punterosARefrescar(salteadas, guardados([]))).toEqual([
      { nro_ri: 1841, hoja_origen: AREA, sheets_fila: 300 },
    ]);
  });

  it("la hoja igual con la fila distinta cuenta como movimiento, y al reves tambien", () => {
    // Las dos columnas son un solo dato: la celda es el par. Comparar una sola
    // dejaria la mitad de los casos sin refrescar.
    expect(
      punterosARefrescar([{ nro_ri: 7, hoja: AREA, fila: 10 }], guardados([[7, AREA, 11]]))
    ).toHaveLength(1);
    expect(
      punterosARefrescar([{ nro_ri: 7, hoja: MASTER, fila: 10 }], guardados([[7, AREA, 10]]))
    ).toHaveLength(1);
  });

  it("sin filas salteadas no hay nada que escribir", () => {
    expect(punterosARefrescar([], guardados([[1231, AREA, 500]]))).toEqual([]);
  });
});
