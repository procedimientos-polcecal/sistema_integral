import { describe, it, expect } from "vitest";
import {
  aprobarCorreriaFilas,
  esAprobacionDeOS,
  esperaDecision,
  ordenarParaAprobar,
  porQueNoSePuedeAprobar,
  puedeQuitarDeLaListaDeOS,
} from "./aprobacion";

/**
 * La misma regla que la lista de Compras: vaciarla traba el circuito entero.
 * Sin nadie que apruebe, ninguna OS pasa a comparativa, y como aprobar dejo de
 * depender del nivel no hay un administrador que pueda rescatar la situacion
 * aprobando el.
 */
describe("sacar a alguien de la lista de aprobadores de OS", () => {
  it("con dos o mas se puede", () => {
    expect(puedeQuitarDeLaListaDeOS(2).ok).toBe(true);
    expect(puedeQuitarDeLaListaDeOS(5).ok).toBe(true);
  });

  it("al ultimo no, y se dice por que", () => {
    const r = puedeQuitarDeLaListaDeOS(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo.toLowerCase()).toContain("orden de servicio");
  });

  it("una lista vacia tampoco: no hay a quien sacar", () => {
    expect(puedeQuitarDeLaListaDeOS(0).ok).toBe(false);
  });
});

/**
 * Reconocer la aprobacion es lo que decide si hay que salir a leer la pestaña
 * del area antes de escribir. Los demas cambios no la necesitan.
 */
describe("que cambios aprueban una OS", () => {
  it("poner el estado en APROBADO lo es", () => {
    expect(esAprobacionDeOS("APROBADO")).toBe(true);
  });

  it("no importa como venga escrito", () => {
    // La planilla lo escribe en mayuscula, pero la API la puede llamar
    // cualquiera y una regla que se esquiva con minusculas no es una regla.
    expect(esAprobacionDeOS("aprobado")).toBe(true);
    expect(esAprobacionDeOS("  Aprobado  ")).toBe(true);
  });

  it("los demas estados del circuito no lo son", () => {
    expect(esAprobacionDeOS("POR APROBAR")).toBe(false);
    expect(esAprobacionDeOS("EN REVISIÓN")).toBe(false);
    expect(esAprobacionDeOS("EN PROCESO (COMPARATIVA)")).toBe(false);
    expect(esAprobacionDeOS("ACEPTADO")).toBe(false);
    expect(esAprobacionDeOS("DENEGADO")).toBe(false);
  });

  it("no tocar el estado no lo es", () => {
    expect(esAprobacionDeOS(null)).toBe(false);
    expect(esAprobacionDeOS(undefined)).toBe(false);
    expect(esAprobacionDeOS("")).toBe(false);
  });
});

/**
 * Aprobar una OS escribe APROBADO en el maestro, y APROBADO es el unico valor
 * que mete la fila en la pestana de su area. Cuando el FILTER la levanta, las
 * filas de abajo se corren y el seguimiento escrito a mano no se corre con
 * ellas: queda un proveedor o un costo colgado de otra OS.
 *
 * Pero eso pasa solo si la fila entra en el medio. Se verifico contra las 228
 * filas de la base, comparando sheets_row con os_number dentro de cada pestana:
 * cero desordenes en las siete. El FILTER conserva el orden ascendente, asi que
 * una OS con numero mayor que todas las de su pestana entra al final.
 */
describe("si aprobar correria las filas de la pestana", () => {
  it("la 26 si: es vieja y entraria arriba de las 218 de Mantenimiento", () => {
    expect(aprobarCorreriaFilas(26, 218)).toBe(true);
  });

  it("las nuevas no: 220 a 228 van despues de la 218", () => {
    expect(aprobarCorreriaFilas(220, 218)).toBe(false);
    expect(aprobarCorreriaFilas(228, 218)).toBe(false);
  });

  it("la 219 sobre OTRA no: el maximo de esa pestana es 91", () => {
    expect(aprobarCorreriaFilas(219, 91)).toBe(false);
  });

  it("una pestana vacia nunca corre nada: no hay filas abajo", () => {
    // INVERSIONES y DESPACHO estan en la lista de pestanas y no tienen ninguna
    // OS. La primera que se apruebe estrena la pestana.
    expect(aprobarCorreriaFilas(5, null)).toBe(false);
  });

  it("empatar con el maximo tampoco corre nada", () => {
    // No deberia pasar —el numero es unico— pero si pasara, la fila queda al
    // final y no empuja a nadie. Negarse ahi seria negarse por las dudas.
    expect(aprobarCorreriaFilas(218, 218)).toBe(false);
  });
});

/**
 * Que una OS siga en SERVICIOS *es* que no se aprobo: cada pestana de area es
 * un FILTER(...; estado="APROBADO"), asi que llega ahi si y solo si alguien le
 * escribio APROBADO en el maestro.
 *
 * Eso separa dos grupos que en el listado se ven iguales —los dos con el estado
 * vacio— pero que son trabajos distintos: 11 esperan decision y 23 ya estan
 * aprobadas y lo que les falta es el seguimiento.
 */
describe("que OS esperan la decision", () => {
  it("una que sigue en SERVICIOS sin estado, si", () => {
    expect(esperaDecision({ sheets_tab: "SERVICIOS", estado: null })).toBe(true);
  });

  it("POR APROBAR y EN REVISION en SERVICIOS, tambien", () => {
    expect(esperaDecision({ sheets_tab: "SERVICIOS", estado: "POR APROBAR" })).toBe(true);
    expect(esperaDecision({ sheets_tab: "SERVICIOS", estado: "EN REVISIÓN" })).toBe(true);
  });

  it("una ya denegada no: la decision esta tomada", () => {
    expect(esperaDecision({ sheets_tab: "SERVICIOS", estado: "DENEGADO" })).toBe(false);
  });

  it("una que ya esta en la pestana de su area no, aunque tenga el estado vacio", () => {
    // Son 23 hoy. Estar en la pestana significa que el FILTER la levanto, o sea
    // que en SERVICIOS ya dice APROBADO. Pedirle a quien aprueba que vuelva a
    // decidir sobre algo ya decidido es hacerle perder el tiempo.
    expect(esperaDecision({ sheets_tab: "MANTENIMIENTO", estado: null })).toBe(false);
    expect(esperaDecision({ sheets_tab: "TALLER VIAL", estado: null })).toBe(false);
  });

  it("una sin pestana no: no se sabe donde vive", () => {
    expect(esperaDecision({ sheets_tab: null, estado: null })).toBe(false);
  });
});

/**
 * El orden de la bandeja. Primero lo mas urgente, y a igual urgencia lo mas
 * viejo, que es como ya se ordena la seccion de requerimientos.
 */
describe("el orden de la bandeja", () => {
  const os = (
    os_number: number,
    prioridad: string | null,
    fecha: string | null
  ) => ({ os_number, prioridad, fecha });

  it("lo urgente primero, despues 1 semana, normal y leve", () => {
    const ordenadas = ordenarParaAprobar([
      os(1, "LEVE", "2026-01-01"),
      os(2, "URGENTE", "2026-01-01"),
      os(3, "NORMAL", "2026-01-01"),
      os(4, "1 SEMANA", "2026-01-01"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([2, 4, 3, 1]);
  });

  it("a igual prioridad, lo mas viejo arriba", () => {
    const ordenadas = ordenarParaAprobar([
      os(2, "NORMAL", "2026-09-03"),
      os(1, "NORMAL", "2025-12-16"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([1, 2]);
  });

  it("misma fecha: desempata el numero, que es el orden en que entraron", () => {
    const ordenadas = ordenarParaAprobar([
      os(228, null, "2026-09-03"),
      os(223, null, "2026-09-03"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([223, 228]);
  });

  /**
   * Diez de las once que esperan hoy no tienen prioridad cargada. Mandarlas al
   * fondo dejaria las diez que de verdad esperan debajo de la unica vieja, y
   * ponerlas arriba seria decir que son urgentes sin que nadie lo haya dicho.
   */
  it("sin prioridad pesa como NORMAL: ni al fondo ni arriba de todo", () => {
    const ordenadas = ordenarParaAprobar([
      os(1, "LEVE", "2026-01-01"),
      os(2, null, "2026-01-01"),
      os(3, "1 SEMANA", "2026-01-01"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([3, 2, 1]);
  });

  it("una prioridad que la planilla no usa se trata igual que vacia", () => {
    const ordenadas = ordenarParaAprobar([
      os(1, "LEVE", "2026-01-01"),
      os(2, "ALTA", "2026-01-01"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([2, 1]);
  });

  it("sin fecha va al final de su prioridad, no al principio", () => {
    // Una fecha vacia no es una fecha vieja. Tratarla como el ano cero pondria
    // arriba de todo justamente a la que menos se sabe.
    const ordenadas = ordenarParaAprobar([
      os(1, "NORMAL", null),
      os(2, "NORMAL", "2026-09-03"),
    ]);
    expect(ordenadas.map((o) => o.os_number)).toEqual([2, 1]);
  });

  it("no toca el arreglo que recibe", () => {
    const original = [os(2, "LEVE", "2026-01-01"), os(1, "URGENTE", "2026-01-01")];
    ordenarParaAprobar(original);
    expect(original.map((o) => o.os_number)).toEqual([2, 1]);
  });
});

/**
 * Negarse a aprobar no puede ser un "no se pudo". Quien aprueba tiene que
 * saber que hacer, y lo que hay que hacer es aprobarla a mano en la planilla.
 */
describe("lo que se le dice a quien no puede aprobar desde aca", () => {
  const mensaje = porQueNoSePuedeAprobar(26, "MANTENIMIENTO", 218);

  it("nombra la OS y la pestana donde entraria", () => {
    expect(mensaje).toContain("26");
    expect(mensaje).toContain("MANTENIMIENTO");
  });

  it("dice que hay que aprobarla a mano en la planilla", () => {
    expect(mensaje.toLowerCase()).toContain("a mano");
    expect(mensaje.toLowerCase()).toContain("planilla");
  });

  it("explica el dano, que es lo que justifica la negativa", () => {
    expect(mensaje.toLowerCase()).toContain("seguimiento");
  });
});
