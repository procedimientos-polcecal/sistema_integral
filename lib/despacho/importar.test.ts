import { describe, it, expect } from "vitest";
import { indicesDeColumnas, ordenDeFilaDePlanilla, ordenesDeLaPlanilla } from "./importar";

const ENCABEZADOS = [
  "Fecha Orden",
  "Nro de Orden",
  "Cliente",
  "Material ",
  "Hora comienzo de Carga",
  "Hora Salida de carga ",
  "Hora Ingreso al predio",
  "Hora Salida del Predio",
  "Observaciones",
  "Tiempo de Carga",
  "Tiempo en Predio",
];

describe("indicesDeColumnas", () => {
  /**
   * Los encabezados reales tienen espacios de más ("Material ", "Hora Salida de
   * carga ") y mayúsculas irregulares. Buscar por igualdad exacta contra el
   * texto del libro es lo que hace que un día falte una columna que está.
   */
  it("encuentra las columnas aunque el encabezado tenga espacios o acentos de más", () => {
    expect(indicesDeColumnas(ENCABEZADOS)).toEqual({
      fecha: 0,
      numero: 1,
      cliente: 2,
      material: 3,
      inicioCarga: 4,
      finCarga: 5,
      entradaPredio: 6,
      salidaPredio: 7,
      observaciones: 8,
    });
  });

  it("no encuentra nada en una fila que no es la de encabezados", () => {
    expect(indicesDeColumnas(["8/9/2026", "13801", "VECCHIO"])).toBeNull();
  });

  /** Sin `Nro de Orden` no hay clave y la importación no puede seguir. */
  it("faltando una columna imprescindible devuelve null", () => {
    expect(indicesDeColumnas(ENCABEZADOS.filter((h) => !h.startsWith("Nro")))).toBeNull();
    expect(indicesDeColumnas(ENCABEZADOS.filter((h) => !h.toLowerCase().startsWith("fecha")))).toBeNull();
  });

  /**
   * El libro no llama igual a la columna de fecha en todas las pestañas: hay
   * `Fecha`, `Fecha Orden` y `Fecha Orden de carga`. Con un solo nombre
   * esperado, dos de las seis pestañas quedaban sin importar.
   */
  it("acepta los tres nombres que el libro le da a la fecha", () => {
    for (const nombre of ["Fecha", "Fecha Orden", "Fecha Orden de carga"]) {
      const fila = [nombre, ...ENCABEZADOS.slice(1)];
      expect(indicesDeColumnas(fila)?.fecha).toBe(0);
    }
  });

  /**
   * Una columna que no es imprescindible puede faltar: queda en -1 y su valor
   * en null. Devolver null por eso perdería las doscientas órdenes de la
   * pestaña.
   */
  it("una pestaña sin Observaciones se importa igual", () => {
    const sinObs = ENCABEZADOS.filter((h) => h !== "Observaciones");
    const idx = indicesDeColumnas(sinObs);
    expect(idx).not.toBeNull();
    expect(idx!.observaciones).toBe(-1);

    const r = ordenDeFilaDePlanilla(["8/9/2026", "13801", "VECCHIO", "Cal"], idx!);
    expect(r!.numero).toBe("13801");
    expect(r!.notas).toBeNull();
  });
});

describe("ordenDeFilaDePlanilla", () => {
  const idx = indicesDeColumnas(ENCABEZADOS)!;

  it("arma la orden con los cuatro horarios en su columna", () => {
    const r = ordenDeFilaDePlanilla(
      ["8/9/2026", "13801", "VECCHIO", "Cal a granel", "10:20", "11:00", "10:00", "11:15", "portón 2"],
      idx
    );

    expect(r).toEqual({
      numero: "13801",
      fecha: "2026-09-08",
      cliente_raw: "VECCHIO",
      producto_raw: "Cal a granel",
      entrada_predio: "2026-09-08T13:00:00.000Z",
      inicio_carga: "2026-09-08T13:20:00.000Z",
      fin_carga: "2026-09-08T14:00:00.000Z",
      salida_predio: "2026-09-08T14:15:00.000Z",
      notas: "portón 2",
    });
  });

  /**
   * La trampa que da vuelta el turno de noche: los horarios se encadenan en el
   * orden en que ocurren —entrada, inicio, fin, salida— y no en el de las
   * columnas, así que un camión que entra 23:40 y sale 00:30 sale del día
   * siguiente en vez de dar un tiempo negativo de catorce horas.
   */
  it("un camión que cruza la medianoche no da tiempos negativos", () => {
    const r = ordenDeFilaDePlanilla(
      ["8/9/2026", "13990", "VECCHIO", "Cal", "23:50", "00:10", "23:40", "00:30", ""],
      idx
    )!;

    expect(r.entrada_predio).toBe("2026-09-09T02:40:00.000Z");
    expect(r.salida_predio).toBe("2026-09-09T03:30:00.000Z");

    const predio =
      (new Date(r.salida_predio!).getTime() - new Date(r.entrada_predio!).getTime()) / 60000;
    expect(predio).toBe(50);
  });

  it("las fechas se leen d/m y nunca m/d", () => {
    const r = ordenDeFilaDePlanilla(["3/9/2026", "1", "", "", "", "", "", "", ""], idx)!;
    expect(r.fecha).toBe("2026-09-03");
  });

  it("un serial de Sheets también es una fecha", () => {
    const r = ordenDeFilaDePlanilla([46273, "1", "", "", "", "", "", "", ""], idx)!;
    expect(r.fecha).toBe("2026-09-08");
  });

  it("una fila sin número o sin fecha se saltea en vez de entrar a medias", () => {
    expect(ordenDeFilaDePlanilla(["8/9/2026", "", "VECCHIO"], idx)).toBeNull();
    expect(ordenDeFilaDePlanilla(["", "13801", "VECCHIO"], idx)).toBeNull();
    expect(ordenDeFilaDePlanilla([], idx)).toBeNull();
  });

  it("las celdas vacías quedan en null y no en cadena vacía", () => {
    const r = ordenDeFilaDePlanilla(["8/9/2026", "13801", "", "", "", "", "", "", ""], idx)!;
    expect(r.cliente_raw).toBeNull();
    expect(r.producto_raw).toBeNull();
    expect(r.notas).toBeNull();
    expect(r.entrada_predio).toBeNull();
  });
});

describe("ordenesDeLaPlanilla", () => {
  const hoja = (filas: unknown[][]) => [ENCABEZADOS, ...filas];

  it("devuelve cada orden con el número de fila del libro, contando desde uno", () => {
    const r = ordenesDeLaPlanilla(
      hoja([
        ["1/9/2026", "13745", "Suplemin", "Calcio + Dolomita 02", "15:15", "15:50", "14:39", "16:00"],
        ["1/9/2026", "13747", "Moyano", "Calcio 200 en bolsa", "14:40", "15:02", "14:31", "15:03"],
      ])
    );

    expect(r.filaDeEncabezados).toBe(0);
    expect(r.ordenes.map((o) => [o.numero, o.fila])).toEqual([
      ["13745", 2],
      ["13747", 3],
    ]);
  });

  /**
   * `ABRIL 2026` devuelve mil filas, y las últimas están vacías salvo el `0`
   * que dejan las fórmulas de las columnas J y K. Contarlas como salteadas
   * ahogaría el aviso de las que sí tienen datos.
   */
  it("las filas de relleno con el cero de la fórmula no cuentan como salteadas", () => {
    const r = ordenesDeLaPlanilla(
      hoja([
        ["15/4/2026", "11867", "Casaro", "Calcio 02 en Bolson", "6:55", "7:20", "", "", "", "0:25", "0"],
        ["", "", "", "", "", "", "", "", "", "0", "0"],
        ["", "", "", "", "", "", "", "", "", "0", "0"],
      ])
    );

    expect(r.ordenes).toHaveLength(1);
    expect(r.salteadas).toBe(0);
  });

  /** Las 19 del libro que tienen número y no tienen fecha: se cuentan y se avisan. */
  it("una fila con datos que no se pudo leer sí se cuenta", () => {
    const r = ordenesDeLaPlanilla(
      hoja([["", "13844", "Vialnorcar", "Cal en Bolsa", "04:40", "06:50"]])
    );

    expect(r.ordenes).toHaveLength(0);
    expect(r.salteadas).toBe(1);
  });

  it("una pestaña cuyos encabezados no se reconocen no importa nada a medias", () => {
    const r = ordenesDeLaPlanilla([["Cosa", "Otra"], ["1", "2"]]);
    expect(r).toEqual({ ordenes: [], filaDeEncabezados: null, salteadas: 0 });
  });
});
