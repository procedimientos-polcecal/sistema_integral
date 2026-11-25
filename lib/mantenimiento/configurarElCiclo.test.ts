import { describe, expect, test } from "vitest";
import {
  arrancaSolo, comoSeLeeElPrograma, comoSeLeeLaDecision, loQueImpideGuardar,
  type CicloComoEsta,
} from "./configurarElCiclo";

/** Hidratación al 24/11/2026: tres rotaciones, parada en la segunda. */
const CICLO: CicloComoEsta = {
  repeticiones: 3,
  vuelta_desde: 2,
  tarea_madre_id: "tarea-madre",
  tarea_hija_id: "tarea-hija",
};

const TAREAS = { madre: "Cambio de Martillos", hija: "Rotación de Martillos" };

describe("comoSeLeeLaDecision", () => {
  test("una decisión de crear se lee con la tarea, la cara y la fecha", () => {
    expect(
      comoSeLeeLaDecision({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-27" }, TAREAS)
    ).toBe("Crea «Rotación de Martillos» — a 3ª cara — para el 27/11/2026");
  });

  test("la vuelta 0 se lee con el nombre de la madre y sin cara", () => {
    expect(
      comoSeLeeLaDecision({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-12-01" }, TAREAS)
    ).toBe("Crea «Cambio de Martillos» para el 01/12/2026");
  });

  test("esperar nombra la orden", () => {
    expect(comoSeLeeLaDecision({ que: "esperar", ot: 3166 }, TAREAS)).toBe("Espera la OT 3166");
  });

  test("sin arrancar lo dice con todas las letras", () => {
    expect(comoSeLeeLaDecision({ que: "sin_arrancar" }, TAREAS)).toBe(
      "No arrancó, así que no genera ninguna orden"
    );
  });

  test("trabado devuelve el motivo tal cual, que es el que explica qué pasa", () => {
    expect(
      comoSeLeeLaDecision({ que: "trabado", porque: "El equipo PO-C1-04 está inactivo." }, TAREAS)
    ).toBe("El equipo PO-C1-04 está inactivo.");
  });
});

/**
 * `arrancaSolo` no es una lista de claves escrita a mano: le pregunta al mismo
 * `pareceUnCambio()` que usa el arranque automático, armando el texto con la
 * etiqueta corta de la acción y **el componente de este ciclo**. Así el día
 * que ese regex cambie, esto lo sigue sin que haya dos listas que mantener.
 */
describe("arrancaSolo", () => {
  test("una madre escrita como reemplazo arranca sola", () => {
    expect(arrancaSolo("CAMBIO", "Martillos")).toBe(true);
  });

  test("una madre que el detector no puede ver no arranca sola", () => {
    expect(arrancaSolo("LIMPIEZA", "Martillos")).toBe(false);
    expect(arrancaSolo("REVISION", "Martillos")).toBe(false);
    expect(arrancaSolo("ROTACION", "Martillos")).toBe(false);
  });

  test("una acción que no está en el vocabulario no arranca sola", () => {
    expect(arrancaSolo("INVENTADA", "Martillos")).toBe(false);
  });

  test("lo decide con el componente de este ciclo y no con uno de muestra", () => {
    // El detector descarta las rotaciones **de ese componente**, así que la
    // respuesta puede depender del componente y no sólo de la acción.
    expect(arrancaSolo("CAMBIO", "Grillas")).toBe(true);
    expect(arrancaSolo("ROTACION", "Grillas")).toBe(false);
  });
});

/**
 * Los límites son **los checks de la base**, copiados acá para que la pantalla
 * los niegue antes: un `repeticiones` por debajo de la vuelta en curso rompe
 * `mant_ciclos_de_ot_vuelta` y sale como un 500, que no le dice nada a nadie.
 */
describe("loQueImpideGuardar", () => {
  test("no se bajan las repeticiones por debajo de la vuelta en la que está", () => {
    expect(loQueImpideGuardar({ repeticiones: 2 }, { ...CICLO, vuelta_desde: 3 })).toEqual([
      "El ciclo está en la vuelta 3, así que no puede repetirse menos de 3 veces.",
    ]);
  });

  test("un ciclo sin arrancar admite cualquier repetición válida", () => {
    expect(loQueImpideGuardar({ repeticiones: 1 }, { ...CICLO, vuelta_desde: null })).toEqual([]);
  });

  test("las repeticiones van de 1 a 20", () => {
    expect(loQueImpideGuardar({ repeticiones: 0 }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ repeticiones: 21 }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ repeticiones: 20 }, CICLO)).toEqual([]);
  });

  test("el plazo va de 1 a 3650 días y no acepta texto", () => {
    expect(loQueImpideGuardar({ periodo_dias: 0 }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ periodo_dias: 3651 }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ periodo_dias: Number.NaN }, CICLO)).toHaveLength(1);
  });

  test("el plazo puede vaciarse, y eso deja el ciclo detenido", () => {
    expect(loQueImpideGuardar({ periodo_dias: null }, CICLO)).toEqual([]);
  });

  test("las horas estimadas no pueden ser negativas", () => {
    expect(loQueImpideGuardar({ horas_estimadas: -1 }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ horas_estimadas: null }, CICLO)).toEqual([]);
  });

  test("informa todos los problemas juntos y no de a uno", () => {
    expect(loQueImpideGuardar({ repeticiones: 0, periodo_dias: 0 }, CICLO)).toHaveLength(2);
  });

  test("no mandar nada no impide nada", () => {
    expect(loQueImpideGuardar({}, CICLO)).toEqual([]);
  });
});

describe("comoSeLeeElPrograma", () => {
  test("un programado mensual se lee con su etiqueta", () => {
    expect(comoSeLeeElPrograma("MENSUAL", null)).toBe("Mensual");
  });

  test("uno personalizado dice cada cuántos días", () => {
    expect(comoSeLeeElPrograma("PERSONALIZADO", 45)).toBe("Personalizado (días) · cada 45 días");
  });

  test("un tipo que no está en la lista se muestra tal cual en vez de desaparecer", () => {
    expect(comoSeLeeElPrograma("RARO", null)).toBe("RARO");
  });
});
