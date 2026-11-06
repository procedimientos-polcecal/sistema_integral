import { describe, it, expect } from "vitest";
import { filasPorLeer, type FilaOcupada } from "./desdeLaPlanilla";

// CODIGO, DESCRIPCION, ENTRADAS, SALIDAS, TOTAL, VEGETAL, RESIDUAL, FECHA,
// STOCK FISICO, ERROR, ID DEL SdG (K)
const fila = (
  codigo: string,
  entradas: number | "",
  salidas: number | "",
  serial: number,
  id = ""
) => [codigo, "", entradas, salidas, "", "", "", serial, "", "", id];

/** 46276 = 2026-09-11; 46277 = 2026-09-12. */
const LUNES = 46276;
const MARTES = 46277;

const ENCABEZADO = ["CODIGO", "DESCRIPCION", "ENTRADAS", "SALIDAS"];

/** Tres renglones ya leídos, cada uno con su id en la columna K. */
const PLANILLA = [
  ENCABEZADO,
  fila("00003", 20.58, "", LUNES, "m-1"),
  fila("00015", "", 37, LUNES, "m-2"),
  fila("00007", 19.14, "", MARTES, "m-3"),
];

const ocupada = (
  id: string,
  fila: number,
  entradas: number | null,
  salidas: number | null
): [string, FilaOcupada] => [id, { fila, entradas, salidas }];

const TODAS = new Map([
  ocupada("m-1", 2, 20.58, null),
  ocupada("m-2", 3, null, 37),
  ocupada("m-3", 4, 19.14, null),
]);

describe("filasPorLeer", () => {
  it("una fila sin id en la columna K es nueva", () => {
    const conUnaNueva = [...PLANILLA, fila("00006", 15.2, "", MARTES)];
    const r = filasPorLeer(TODAS, conUnaNueva);
    expect(r.nuevas.map((n) => n.fila)).toEqual([5]);
  });

  it("una fila con su id no se vuelve a leer: es lo que evita el lazo", () => {
    expect(filasPorLeer(TODAS, PLANILLA).nuevas).toEqual([]);
  });

  it("salta el encabezado y las filas vacías", () => {
    const sinLeer = [
      ENCABEZADO,
      fila("00003", 20.58, "", LUNES),
      fila("00015", "", 37, LUNES),
      ["", ""],
      ["", " "],
    ];
    expect(filasPorLeer(new Map(), sinLeer).nuevas.map((n) => n.fila)).toEqual([2, 3]);
  });

  /* ── Lo que el número de fila no sabía hacer ──────────────── */

  it("INSERTAR UNA FILA EN EL MEDIO no desancla nada: el id viaja con su fila", () => {
    // Pasó tres veces en un mes: alguien agrega un camión olvidado en su lugar
    // cronológico y todos los números de abajo se corren.
    const conInsercion = [
      ENCABEZADO,
      fila("00003", 20.58, "", LUNES, "m-1"),
      fila("00009", 18.4, "", LUNES), // la nueva, sin id
      fila("00015", "", 37, LUNES, "m-2"),
      fila("00007", 19.14, "", MARTES, "m-3"),
    ];
    const r = filasPorLeer(TODAS, conInsercion);
    expect(r.nuevas.map((n) => n.fila)).toEqual([3]);
    expect(r.relecturas).toEqual([]);
    // Y las dos que se corrieron quedan anotadas para actualizarles la fila.
    expect(r.reubicadas).toEqual([
      { id: "m-2", fila: 4 },
      { id: "m-3", fila: 5 },
    ]);
  });

  it("EDITAR LA CANTIDAD de una fila ya leída manda a releerla, no a informarla", () => {
    // Acá manda la planilla, así que su número es el que vale. Informarlo y no
    // aplicarlo deja al SdG con un número que él mismo sabe que está mal: entre
    // el 21 y el 23/10/2026 eso lo dejó 59 t abajo, con una fila por día.
    const editada = [
      ENCABEZADO,
      fila("00003", 21.58, "", LUNES, "m-1"),
      fila("00015", "", 37, LUNES, "m-2"),
      fila("00007", 19.14, "", MARTES, "m-3"),
    ];
    const r = filasPorLeer(TODAS, editada);
    expect(r.nuevas).toEqual([]);
    expect(r.relecturas).toHaveLength(1);
    expect(r.relecturas[0].id).toBe("m-1");
    expect(r.relecturas[0].fila).toBe(2);
    // Lleva las celdas, porque releer es convertir la fila entera de nuevo.
    expect(r.relecturas[0].celdas[2]).toBe(21.58);
    expect(r.relecturas[0].motivo).toContain("21.58");
    expect(r.relecturas[0].motivo).toContain("20.58");
  });

  it("CAMBIAR DE TIPO también se relee: un consumo que pasó a ser un camión", () => {
    // Pasó el 21/10/2026 en la fila 1146: alguien escribió una entrada de
    // WALKIMIA encima de un consumo de 36, y la columna K quedó igual. Por eso
    // releer es borrar y volver a convertir, y no corregirle el número: un
    // `update` de toneladas sobre un consumo que ahora es entrada lo rechaza el
    // CHECK `calidad_mov_signo`, que fue exactamente lo que pasó al intentarlo.
    const repisada = [
      ENCABEZADO,
      fila("00003", 20.58, "", LUNES, "m-1"),
      fila("00007", 18.04, "", LUNES, "m-2"), // era un consumo de 37
      fila("00007", 19.14, "", MARTES, "m-3"),
    ];
    const r = filasPorLeer(TODAS, repisada);
    expect(r.relecturas).toHaveLength(1);
    expect(r.relecturas[0].id).toBe("m-2");
    expect(r.relecturas[0].celdas[0]).toBe("00007");
    expect(r.relecturas[0].celdas[2]).toBe(18.04);
  });

  it("una fila ocupada que no cambió no se relee", () => {
    const r = filasPorLeer(TODAS, PLANILLA);
    expect(r.relecturas).toEqual([]);
    expect(r.reubicadas).toEqual([]);
  });

  it("una fila que se vació NO se relee sola: se informa", () => {
    // Vaciar una fila es la unica forma de "borrar" que tiene la planilla, y es
    // indistinguible de una planilla que esta calculando — que devuelve unas
    // celdas con `Cargando…` y las demas VACIAS. Releer eso borraria el
    // movimiento. `leerValores()` ya corta solo en ese caso; esto es la segunda
    // defensa, porque lo que se pierde no se recupera.
    const vaciada = [
      ENCABEZADO,
      fila("00003", 20.58, "", LUNES, "m-1"),
      ["", "", "", "", "", "", "", "", "", "", "m-2"],
      fila("00007", 19.14, "", MARTES, "m-3"),
    ];
    const r = filasPorLeer(TODAS, vaciada);
    expect(r.relecturas).toEqual([]);
    expect(r.vaciadas).toHaveLength(1);
    expect(r.vaciadas[0].fila).toBe(3);
    expect(r.vaciadas[0].motivo).toMatch(/vac/i);
  });

  /* ── Los modos de falla que trae el id ────────────────────── */

  it("el mismo id en dos filas no entra: va a la bandeja", () => {
    // Copiar y pegar una fila duplica su id. Sin esto, el SdG creería que la
    // copia es el movimiento original y lo seguiría a la fila que no es.
    const copiada = [...PLANILLA, fila("00003", 20.58, "", MARTES, "m-1")];
    const r = filasPorLeer(TODAS, copiada);
    expect(r.duplicadas).toHaveLength(2);
    expect(r.duplicadas.map((d) => d.fila)).toEqual([2, 5]);
    expect(r.duplicadas[0].motivo).toMatch(/dos filas/i);
    // Y ninguna de las dos se toca mientras esté en disputa.
    expect(r.relecturas).toEqual([]);
    expect(r.reubicadas).toEqual([]);
  });

  it("un id que ya no es de ningún movimiento se informa y no se relee", () => {
    // El movimiento se borró del SdG pero la planilla conserva su id. Releerla
    // la crearía de nuevo con otro id, y quedarían dos marcas para un camión.
    const conHuerfano = [...PLANILLA, fila("00006", 15.2, "", MARTES, "m-borrado")];
    const r = filasPorLeer(TODAS, conHuerfano);
    expect(r.nuevas).toEqual([]);
    expect(r.huerfanas).toHaveLength(1);
    expect(r.huerfanas[0].fila).toBe(5);
  });

  it("un movimiento cuyo id ya no está en la planilla se informa", () => {
    const sinLaUltima = PLANILLA.slice(0, 3);
    expect(filasPorLeer(TODAS, sinLaUltima).desaparecidas).toEqual(["m-3"]);
  });

  /* ── Lo que ya valía y sigue valiendo ─────────────────────── */

  it("una fila con entrada Y salida a la vez no se importa: se informa", () => {
    // `movimientoDesdeElRenglon` toma la entrada y pierde la salida en silencio.
    const rara = [...PLANILLA, fila("00003", 20.58, 37, MARTES)];
    const r = filasPorLeer(TODAS, rara);
    expect(r.nuevas).toEqual([]);
    expect(r.ambiguas).toHaveLength(1);
    expect(r.ambiguas[0].fila).toBe(5);
    expect(r.ambiguas[0].motivo).toMatch(/entrada y salida/i);
  });

  it("una planilla vacía no es un error", () => {
    expect(filasPorLeer(new Map(), [])).toEqual({
      nuevas: [],
      relecturas: [],
      vaciadas: [],
      ambiguas: [],
      duplicadas: [],
      huerfanas: [],
      desaparecidas: [],
      reubicadas: [],
    });
  });
});
