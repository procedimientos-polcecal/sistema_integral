import { describe, it, expect } from "vitest";
import {
  borradorDe,
  cambiosDe,
  faltasPendientes,
  filtrarCondiciones,
  nivelDeRiesgo,
  ordenarParaGestion,
  resumenDeCondiciones,
  SIN_FILTROS,
  tramoDeGestion,
  type FilaDeCondicion,
} from "./gestion";
import { clasificar } from "./riesgo";

const HOY = "2026-10-29";

/** Una condición completa, abierta y a tiempo: lo que no la mueve de lugar. */
function condicion(n: number, cambios: Partial<FilaDeCondicion> = {}): FilaDeCondicion {
  return {
    id: `id-${n}`,
    numero: n,
    sector_id: "sec-1",
    equipo_id: null,
    detectada_el: "2026-10-01",
    detectada_por: "u-1",
    descripcion: "Falta la protección del cardán",
    peligro_id: "pel-1",
    accion_propuesta: "Colocar la protección",
    prioridad: 2,
    responsable_id: "u-2",
    fecha_maxima: "2026-11-15",
    fecha_ejecucion: null,
    requiere_inversion: false,
    observaciones: null,
    frecuencia: 2,
    antecedentes: 2,
    controles: 3,
    magnitud_dano: 7,
    legislacion: 3,
    probabilidad: 7,
    gravedad: 10,
    nivel_riesgo: 70,
    sectores: { nombre: "Cantera" },
    equipos: null,
    syh_peligros: { nombre: "Atrapado por" },
    ...cambios,
  };
}

const VENCIDA = (n: number, maxima = "2026-10-20") => condicion(n, { fecha_maxima: maxima });
const SIN_EVALUAR = (n: number) =>
  condicion(n, { frecuencia: null, antecedentes: null, controles: null, magnitud_dano: null, legislacion: null, nivel_riesgo: null });
const CERRADA = (n: number, nivel = 200) =>
  condicion(n, { fecha_ejecucion: "2026-10-25", nivel_riesgo: nivel });

describe("nivelDeRiesgo", () => {
  it("multiplica probabilidad por gravedad, como las columnas de la tabla", () => {
    // (3 + 3 + 5) × (9 + 5) = 11 × 14
    expect(
      nivelDeRiesgo({ frecuencia: 3, antecedentes: 3, controles: 5, magnitud_dano: 9, legislacion: 5 })
    ).toEqual({ probabilidad: 11, gravedad: 14, nivel: 154 });
  });

  it("el máximo clasifica I y el mínimo, NS", () => {
    const maximo = nivelDeRiesgo({ frecuencia: 3, antecedentes: 3, controles: 5, magnitud_dano: 9, legislacion: 5 });
    const minimo = nivelDeRiesgo({ frecuencia: 1, antecedentes: 1, controles: 1, magnitud_dano: 3, legislacion: 1 });
    expect(clasificar(maximo!.nivel)).toBe("I");
    expect(minimo!.nivel).toBe(12);
    expect(clasificar(minimo!.nivel)).toBe("NS");
  });

  it("con un puntaje que falta no hay nivel", () => {
    expect(
      nivelDeRiesgo({ frecuencia: 3, antecedentes: 3, controles: 5, magnitud_dano: 9, legislacion: null })
    ).toBeNull();
  });
});

describe("el orden: lo que falta se ve antes que lo que está completo", () => {
  it("vencidas, después las que les falta algo, después las completas por nivel, y las cerradas al final", () => {
    const completaBaja = condicion(1, { nivel_riesgo: 30 });
    const completaAlta = condicion(2, { nivel_riesgo: 120 });
    const sinEvaluar = SIN_EVALUAR(3);
    const vencida = VENCIDA(4);
    const cerrada = CERRADA(5, 250);

    const orden = ordenarParaGestion([completaBaja, cerrada, completaAlta, sinEvaluar, vencida], HOY).map(
      (c) => c.numero
    );

    expect(orden).toEqual([4, 3, 2, 1, 5]);
  });

  it("una cerrada intolerable no queda arriba de una abierta moderada", () => {
    const orden = ordenarParaGestion([CERRADA(1, 300), condicion(2, { nivel_riesgo: 50 })], HOY);
    expect(orden.map((c) => c.numero)).toEqual([2, 1]);
  });

  it("entre las vencidas va primero la que venció hace más", () => {
    const orden = ordenarParaGestion([VENCIDA(1, "2026-10-28"), VENCIDA(2, "2026-09-01")], HOY);
    expect(orden.map((c) => c.numero)).toEqual([2, 1]);
  });

  it("entre las que les falta algo va primero a la que más le falta", () => {
    const sinNada = condicion(1, {
      responsable_id: null, fecha_maxima: null, sector_id: null, equipo_id: null,
      frecuencia: null, nivel_riesgo: null,
    });
    const soloSinAsignar = condicion(2, { responsable_id: null, nivel_riesgo: 150 });
    const orden = ordenarParaGestion([soloSinAsignar, sinNada], HOY);
    expect(orden.map((c) => c.numero)).toEqual([1, 2]);
  });

  it("la máxima de hoy todavía no venció: no sube al primer tramo", () => {
    expect(tramoDeGestion(condicion(1, { fecha_maxima: HOY }), HOY)).toBe(2);
  });

  it("en el empate de nivel va primero la más nueva", () => {
    const orden = ordenarParaGestion([condicion(1), condicion(7)], HOY);
    expect(orden.map((c) => c.numero)).toEqual([7, 1]);
  });

  it("no modifica la lista que recibe", () => {
    const original = [condicion(1), VENCIDA(2)];
    ordenarParaGestion(original, HOY);
    expect(original.map((c) => c.numero)).toEqual([1, 2]);
  });
});

describe("filtrarCondiciones", () => {
  const sinEquipos = new Map<string, string | null>();

  const todas = [condicion(1), VENCIDA(2), SIN_EVALUAR(3), CERRADA(4)];

  it("sin filtros devuelve todas", () => {
    expect(filtrarCondiciones(todas, SIN_FILTROS, HOY, sinEquipos)).toHaveLength(4);
  });

  it("por estado", () => {
    const f = (estado: "Pendiente" | "Vencida" | "Cerrada") =>
      filtrarCondiciones(todas, { ...SIN_FILTROS, estado }, HOY, sinEquipos).map((c) => c.numero);
    expect(f("Vencida")).toEqual([2]);
    expect(f("Cerrada")).toEqual([4]);
    expect(f("Pendiente")).toEqual([1, 3]);
  });

  it("por falta: una en particular, o cualquiera", () => {
    const f = (falta: "sin_evaluar" | "alguna") =>
      filtrarCondiciones(todas, { ...SIN_FILTROS, falta }, HOY, sinEquipos).map((c) => c.numero);
    expect(f("sin_evaluar")).toEqual([3]);
    expect(f("alguna")).toEqual([3]);
  });

  it("filtrar por un sector incluye las condiciones de sus equipos", () => {
    const enEquipo = condicion(5, { sector_id: null, equipo_id: "eq-1", sectores: null });
    const enOtroSector = condicion(6, { sector_id: "sec-2" });
    const equipos = new Map([["eq-1", "sec-1"]]);
    const visibles = filtrarCondiciones([enEquipo, enOtroSector, condicion(7)], { ...SIN_FILTROS, lugar: "s:sec-1" }, HOY, equipos);
    expect(visibles.map((c) => c.numero)).toEqual([5, 7]);
  });

  it("filtrar por un equipo trae sólo ese equipo", () => {
    const enEquipo = condicion(5, { sector_id: null, equipo_id: "eq-1" });
    const visibles = filtrarCondiciones([enEquipo, condicion(7)], { ...SIN_FILTROS, lugar: "e:eq-1" }, HOY, new Map([["eq-1", "sec-1"]]));
    expect(visibles.map((c) => c.numero)).toEqual([5]);
  });

  it("por clasificación, y «sin clasificar» es la que no tiene nivel", () => {
    const intolerable = condicion(8, { nivel_riesgo: 150 });
    const lista = [intolerable, condicion(9, { nivel_riesgo: 70 }), SIN_EVALUAR(10)];
    const f = (clasificacion: "I" | "M" | "sin_clasificar") =>
      filtrarCondiciones(lista, { ...SIN_FILTROS, clasificacion }, HOY, sinEquipos).map((c) => c.numero);
    expect(f("I")).toEqual([8]);
    expect(f("M")).toEqual([9]);
    expect(f("sin_clasificar")).toEqual([10]);
  });
});

describe("un solo criterio para «le falta algo»: el número, el filtro y las marcas dicen lo mismo", () => {
  const sinNada = { sector_id: null, equipo_id: null };
  // Las dos que se escapaban: la vencida a la que le falta evaluar, y la cerrada a la que también.
  const vencidaSinEvaluar = { ...SIN_EVALUAR(21), fecha_maxima: "2026-10-01" };
  const cerradaSinEvaluar = { ...SIN_EVALUAR(22), fecha_ejecucion: "2026-10-25" };
  const lista = [condicion(1), VENCIDA(2), vencidaSinEvaluar, SIN_EVALUAR(3), cerradaSinEvaluar, CERRADA(4)];
  const sinEquipos = new Map<string, string | null>();

  it("faltasPendientes: una cerrada no pide nada aunque le falte todo; una vencida sí", () => {
    expect(faltasPendientes(cerradaSinEvaluar, HOY)).toEqual([]);
    expect(faltasPendientes({ ...cerradaSinEvaluar, ...sinNada }, HOY)).toEqual([]);
    expect(faltasPendientes(vencidaSinEvaluar, HOY)).toEqual(["sin_evaluar"]);
  });

  it("el filtro «les falta algo» trae la vencida sin evaluar y deja afuera la cerrada sin evaluar", () => {
    const numeros = filtrarCondiciones(lista, { ...SIN_FILTROS, falta: "alguna" }, HOY, sinEquipos).map((c) => c.numero);
    expect(numeros).toContain(21);
    expect(numeros).not.toContain(22);
    expect(numeros.sort((a, b) => a - b)).toEqual([3, 21]);
  });

  it("«sin_evaluar» también ignora las cerradas", () => {
    const numeros = filtrarCondiciones(lista, { ...SIN_FILTROS, falta: "sin_evaluar" }, HOY, sinEquipos).map((c) => c.numero);
    expect(numeros.sort((a, b) => a - b)).toEqual([3, 21]);
  });

  it("el estado «abierta» es pendiente o vencida, nunca cerrada", () => {
    const numeros = filtrarCondiciones(lista, { ...SIN_FILTROS, estado: "abierta" }, HOY, sinEquipos).map((c) => c.numero);
    expect(numeros.sort((a, b) => a - b)).toEqual([1, 2, 3, 21]);
  });

  it("el número de «sin completar» es exactamente lo que muestra el botón que lo filtra", () => {
    const r = resumenDeCondiciones(lista, HOY);
    const alApretar = filtrarCondiciones(lista, { ...SIN_FILTROS, falta: "alguna", estado: "abierta" }, HOY, sinEquipos);
    expect(alApretar).toHaveLength(r.sinCompletar);
    expect(r.sinCompletar).toBe(2);
  });

  it("el número de «abiertas» es exactamente lo que muestra el botón que lo filtra", () => {
    const r = resumenDeCondiciones(lista, HOY);
    expect(filtrarCondiciones(lista, { ...SIN_FILTROS, estado: "abierta" }, HOY, sinEquipos)).toHaveLength(r.abiertas);
  });

  it("el número de «vencidas» es exactamente lo que muestra el botón que lo filtra", () => {
    const r = resumenDeCondiciones(lista, HOY);
    expect(filtrarCondiciones(lista, { ...SIN_FILTROS, estado: "Vencida" }, HOY, sinEquipos)).toHaveLength(r.vencidas);
    expect(r.vencidas).toBe(2); // la completa vencida y la vencida sin evaluar
  });
});

describe("resumenDeCondiciones", () => {
  it("cuenta las abiertas, las vencidas y las que les falta algo; las cerradas no cuentan como pendientes", () => {
    const r = resumenDeCondiciones(
      [condicion(1), VENCIDA(2), SIN_EVALUAR(3), CERRADA(4), { ...SIN_EVALUAR(5), fecha_ejecucion: "2026-10-01" }],
      HOY
    );
    expect(r).toEqual({ total: 5, abiertas: 3, cerradas: 2, vencidas: 1, sinCompletar: 1 });
  });

  it("una vencida a la que le falta algo cuenta en las dos; una cerrada a la que le falta algo, en ninguna", () => {
    const vencidaSinEvaluar = { ...SIN_EVALUAR(1), fecha_maxima: "2026-10-01" };
    const cerradaSinEvaluar = { ...SIN_EVALUAR(2), fecha_ejecucion: "2026-10-25" };
    expect(resumenDeCondiciones([vencidaSinEvaluar, cerradaSinEvaluar], HOY)).toEqual({
      total: 2, abiertas: 1, cerradas: 1, vencidas: 1, sinCompletar: 1,
    });
  });
});

describe("cambiosDe: sólo lo que cambió, sólo lo que se puede tocar", () => {
  it("sin tocar nada no manda nada", () => {
    const c = condicion(1);
    expect(cambiosDe(c, borradorDe(c), true)).toEqual({});
  });

  it("un edicion que corrige la descripción no manda campos de admin aunque estén cambiados", () => {
    const c = condicion(1);
    const b = { ...borradorDe(c), descripcion: "Otra cosa", frecuencia: "3", fecha_ejecucion: "2026-10-28" };
    expect(cambiosDe(c, b, false)).toEqual({ descripcion: "Otra cosa" });
  });

  it("un admin manda además los puntajes, la fecha máxima y la de ejecución", () => {
    const c = SIN_EVALUAR(1);
    const b = { ...borradorDe(c), frecuencia: "3", controles: "5", fecha_ejecucion: "2026-10-28" };
    expect(cambiosDe(c, b, true)).toEqual({ frecuencia: 3, controles: 5, fecha_ejecucion: "2026-10-28" });
  });

  it("reabrir es mandar la fecha de ejecución en null", () => {
    const c = CERRADA(1);
    const b = { ...borradorDe(c), fecha_ejecucion: "" };
    expect(cambiosDe(c, b, true)).toEqual({ fecha_ejecucion: null });
  });

  it("vaciar un puntaje lo manda en null", () => {
    const c = condicion(1);
    const b = { ...borradorDe(c), legislacion: "" };
    expect(cambiosDe(c, b, true)).toEqual({ legislacion: null });
  });

  it("mover el lugar manda los dos campos, uno en null", () => {
    const c = condicion(1); // en el sector sec-1
    const b = { ...borradorDe(c), lugar: { tipo: "equipo" as const, id: "eq-9" } };
    expect(cambiosDe(c, b, false)).toEqual({ sector_id: null, equipo_id: "eq-9" });
  });

  it("requiere inversión pasa de sí/no a booleano, y vacío a null", () => {
    const c = condicion(1, { requiere_inversion: null });
    expect(cambiosDe(c, { ...borradorDe(c), requiere_inversion: "si" }, true)).toEqual({ requiere_inversion: true });
    expect(cambiosDe(c, { ...borradorDe(c), requiere_inversion: "no" }, true)).toEqual({ requiere_inversion: false });
  });
});
