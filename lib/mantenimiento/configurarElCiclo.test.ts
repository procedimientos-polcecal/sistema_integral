import { describe, expect, test } from "vitest";
import {
  arrancaSolo, comoSeLeeElPrograma, comoSeLeeLaDecision, elMensajeDelChoque,
  elResetPorCambioDeTareas, loQueFaltaParaArmar, loQueImpideGuardar,
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

  /**
   * Éste pasa desde que `Parametros` lleva los dos ids: acota el código en vez
   * de manejarlo. Se comprobó mutando la comparación a `madre !== hija` —falla
   * sólo éste—, que es la única manera de saber que no está de adorno.
   */
  test("la madre y la hija no pueden terminar siendo la misma", () => {
    expect(loQueImpideGuardar({ tarea_madre_id: "a", tarea_hija_id: "a" }, CICLO)).toEqual([
      "La tarea que se repite y la que cierra el ciclo tienen que ser distintas.",
    ]);
  });

  test("cambiar sólo una tarea se compara contra la que el ciclo ya tiene", () => {
    expect(loQueImpideGuardar({ tarea_hija_id: "tarea-madre" }, CICLO)).toHaveLength(1);
    expect(loQueImpideGuardar({ tarea_hija_id: "otra" }, CICLO)).toEqual([]);
  });
});

/**
 * ── POR QUÉ CAMBIAR LAS TAREAS DEVUELVE EL CICLO A «SIN ARRANCAR» ──────────
 *
 * Porque `desde` y `vuelta_desde` describen el par viejo: «la 2ª rotación el
 * 14/11» no quiere decir nada si la hija pasó a ser otra tarea, y dejarlo ahí
 * haría que el ciclo siguiera contando vueltas de un trabajo que ya no es el
 * suyo. El estado anterior no se puede traducir, así que se tira y se dice.
 *
 * Esto es además lo que evita el callejón sin salida: con `unique
 * (equipment_id)`, sin botón de borrar y sin poder cambiar las tareas, un
 * equipo cuyo ciclo se apagó nunca más podría tener otro.
 */
describe("elResetPorCambioDeTareas", () => {
  test("cambiar la hija resetea el ciclo a sin arrancar", () => {
    expect(elResetPorCambioDeTareas({ tarea_hija_id: "otra" }, CICLO)).toEqual({
      desde: null,
      vuelta_desde: null,
    });
  });

  test("cambiar la madre también lo resetea", () => {
    expect(elResetPorCambioDeTareas({ tarea_madre_id: "otra" }, CICLO)).toEqual({
      desde: null,
      vuelta_desde: null,
    });
  });

  test("mandar las mismas tareas no resetea nada", () => {
    expect(
      elResetPorCambioDeTareas(
        { tarea_madre_id: "tarea-madre", tarea_hija_id: "tarea-hija" },
        CICLO
      )
    ).toBeNull();
  });

  test("no mandar tareas no resetea nada", () => {
    expect(elResetPorCambioDeTareas({}, CICLO)).toBeNull();
    expect(elResetPorCambioDeTareas({ repeticiones: 5 }, CICLO)).toBeNull();
  });
});

describe("loQueFaltaParaArmar", () => {
  const ALTA = {
    equipment_id: "eq-1",
    componente: "Martillos",
    accionMadre: "CAMBIO",
    nombreMadre: "Cambio de Martillos",
    accionHija: "ROTACION",
    nombreHija: "Rotación de Martillos",
    periodo_dias: 3,
    repeticiones: 3,
  };

  test("un alta completa no tiene nada que objetar", () => {
    expect(loQueFaltaParaArmar(ALTA)).toEqual([]);
  });

  test("pide el equipo, el componente, las dos acciones, los dos nombres, el plazo y las repeticiones", () => {
    expect(loQueFaltaParaArmar({})).toHaveLength(8);
  });

  test("la acción tiene que estar en el vocabulario", () => {
    expect(loQueFaltaParaArmar({ ...ALTA, accionHija: "INVENTADA" })).toHaveLength(1);
  });

  /**
   * Es la forma en que `tarea_madre_id = tarea_hija_id` llegaría a la base
   * desde el alta: la clave única de una tarea es (equipo, acción,
   * componente), así que el mismo par resuelve a la misma fila y el check
   * `mant_ciclos_de_ot_tareas_distintas` lo rechaza con un 500.
   */
  test("la madre y la hija no pueden ser la misma acción sobre el mismo componente", () => {
    expect(loQueFaltaParaArmar({ ...ALTA, accionMadre: "CAMBIO", accionHija: "CAMBIO" })).toEqual([
      "La tarea que se repite y la que cierra el ciclo tienen que ser distintas.",
    ]);
  });

  test("un componente escrito a mano es válido: 62 de los 269 equipos no tienen ninguno relevado", () => {
    expect(loQueFaltaParaArmar({ ...ALTA, componente: "Zaranda vibratoria" })).toEqual([]);
  });

  test("hereda los límites del plazo, las repeticiones y las horas", () => {
    expect(loQueFaltaParaArmar({ ...ALTA, periodo_dias: 0 })).toHaveLength(1);
    expect(loQueFaltaParaArmar({ ...ALTA, repeticiones: 21 })).toHaveLength(1);
    expect(loQueFaltaParaArmar({ ...ALTA, horas_estimadas: -3 })).toHaveLength(1);
  });
});

/**
 * El único camino que la validación **no** puede cubrir: dos pestañas abiertas,
 * o una página vieja que todavía ofrece un equipo que entre medio recibió un
 * ciclo. Ahí decide la base, y lo que llega tiene que ser una frase.
 */
describe("elMensajeDelChoque", () => {
  test("un equipo que ya tiene ciclo se contesta con una frase, no con el error de Postgres", () => {
    expect(
      elMensajeDelChoque({
        code: "23505",
        message: 'duplicate key value violates unique constraint "mant_ciclos_de_ot_un_ciclo_por_equipo"',
      })
    ).toBe("Ese equipo ya tiene un ciclo. Si está apagado, se prende desde su tarjeta.");
  });

  test("un error que no es un choque no se traduce", () => {
    expect(elMensajeDelChoque({ code: "23503", message: "foreign key" })).toBeNull();
  });

  test("un choque contra otra constraint tampoco se traduce: diría algo que no es", () => {
    expect(
      elMensajeDelChoque({ code: "23505", message: 'duplicate key ... "otra_constraint"' })
    ).toBeNull();
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
