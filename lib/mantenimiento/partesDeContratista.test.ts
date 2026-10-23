import { describe, it, expect } from "vitest";
import {
  normalizarLugar, repartoParejo, horasTrasUnCambio, controlarHoras,
  inicioDeLaQuincena, finDeLaQuincena, claveDeOT,
  agruparEnOrdenes, descripcionDeLaOT,
  type RenglonParaAgrupar,
} from "./partesDeContratista";

describe("el texto escrito a mano", () => {
  it("la misma cosa escrita de tres formas es una sola", () => {
    expect(normalizarLugar("Molino Horizontal")).toBe("molino horizontal");
    expect(normalizarLugar("  molino   HORIZONTAL ")).toBe("molino horizontal");
    expect(normalizarLugar("Rincón Soñado")).toBe("rincon soñado");
  });

  /**
   * La eñe se conserva. Normalizar en NFD la parte en `n` + tilde y la barrida
   * de marcas se la lleva: "caño" y "cano" quedarian iguales, que no es lo
   * mismo que "Rincon" y "Rincón".
   */
  it("la eñe no se come", () => {
    expect(normalizarLugar("Caño")).not.toBe(normalizarLugar("Cano"));
    expect(normalizarLugar("Rincón")).toBe(normalizarLugar("Rincon"));
  });
});

/**
 * El reparto parejo es **el punto de partida y no la regla**.
 *
 * Hasta el 22/10/2026 las horas de cada renglón salían de leer la expresión
 * del papel —"2 P. x 8H + 1 P. x 2H"— y repartir el primer término entre los
 * renglones que no eran riego. Eso suponía que todos los frentes llevaron lo
 * mismo, y a veces no: una limpieza de horno puede llevarse la mañana entera
 * mientras el bajo cintas lleva una hora. Ahora las horas las escribe quien
 * carga, y esto sólo las propone.
 */
describe("el reparto parejo, que es lo que propone la pantalla", () => {
  it("un total que divide justo queda igual en todos", () => {
    expect(repartoParejo(18, 5)).toEqual([3.6, 3.6, 3.6, 3.6, 3.6]);
  });

  /**
   * Lo que no divide justo lo carga el último. No es cosmética: el control de
   * la factura exige que los renglones den el total escrito, así que un
   * reparto que arranca a centésimas de cerrar obligaría a corregir a mano
   * algo que nadie midió mal.
   */
  it("lo que no divide justo lo carga el ultimo, para que cierre", () => {
    const partes = repartoParejo(16, 3);
    expect(partes).toEqual([5.33, 5.33, 5.34]);
    expect(partes.reduce((s, h) => s + h, 0)).toBe(16);
  });

  it("no redondea a la media hora ni a la hora", () => {
    expect(repartoParejo(16, 5)).toEqual([3.2, 3.2, 3.2, 3.2, 3.2]);
  });

  it("sin renglones no propone nada", () => {
    expect(repartoParejo(18, 0)).toEqual([]);
  });
});

/**
 * Cuándo la propuesta vuelve a correr y cuándo no.
 *
 * Es la regla que decide si el formulario pisa lo que alguien escribió, así
 * que vive acá y no en la pantalla: una pantalla no se puede probar, y un
 * reparto que pisa una corrección no avisa — la hora queda cambiada y el
 * parte cierra igual, contra el sector equivocado.
 */
describe("la propuesta, despues de agregar o quitar un renglon", () => {
  it("mientras nadie corrigio a mano, repropone parejo", () => {
    expect(horasTrasUnCambio(["3.6", "3.6", ""], 18, false)).toEqual(["6", "6", "6"]);
  });

  it("cuando ya se corrigio a mano, no pisa nada", () => {
    expect(horasTrasUnCambio(["10", "4", ""], 18, true)).toEqual(["10", "4", ""]);
  });

  it("un total que todavia no es un numero deja las horas en blanco", () => {
    expect(horasTrasUnCambio(["3.6", "3.6"], "", false)).toEqual(["", ""]);
  });

  it("sin renglones no hay horas que proponer", () => {
    expect(horasTrasUnCambio([], 18, false)).toEqual([]);
  });
});

/**
 * El control de la factura, que es para lo que existe todo esto: lo que el
 * sistema suma tiene que dar lo que Candia escribió a mano en la casilla
 * "HORAS". Sin esa comprobación esto sería sólo transcribir.
 */
describe("el control contra el total del papel", () => {
  const limpieza = (lugar: string, horas: number) => ({
    actividad: "Limpieza", lugar_raw: lugar, horas,
  });

  it("cuando las horas escritas a mano dan el total, cierra", () => {
    const r = controlarHoras(
      [limpieza("Horno N°1", 6), limpieza("Molino horizontal", 4), {
        actividad: "Riego en planta", lugar_raw: "Riego en planta", horas: 8,
      }],
      18
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBe(18);
  });

  it("las centesimas del reparto parejo cierran", () => {
    const r = controlarHoras(
      [limpieza("Caja E", 5.33), limpieza("Bandejas", 5.33), limpieza("Balanza", 5.34)],
      16
    );
    expect(r.ok).toBe(true);
  });

  it("la suma que no llega al total se dice con los dos numeros y la diferencia", () => {
    const r = controlarHoras([limpieza("Horno N°1", 6), limpieza("Caja E", 6)], 18);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.join(" ")).toContain("12");
      expect(r.problemas.join(" ")).toContain("18");
      expect(r.problemas.join(" ")).toContain("faltan 6");
    }
  });

  it("y cuando se pasa, tambien", () => {
    const r = controlarHoras([limpieza("Horno N°1", 12), limpieza("Caja E", 12)], 18);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.join(" ")).toContain("sobran 6");
  });

  /**
   * Un renglón en cero aparecería en el parte sin generar horas ni OT. Se
   * pidió que no: si el frente se trabajó, lleva horas; si no se trabajó, no
   * es un renglón del parte.
   */
  it("un renglon sin horas no se guarda, y se dice cual", () => {
    const r = controlarHoras([limpieza("Horno N°1", 18), limpieza("Caja E", 0)], 18);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.join(" ")).toContain("renglón 2");
  });

  it("una hora que no es un numero tampoco", () => {
    const r = controlarHoras(
      [{ actividad: "Limpieza", lugar_raw: "Horno N°1", horas: Number.NaN }],
      18
    );
    expect(r.ok).toBe(false);
  });

  it("las horas negativas no pasan", () => {
    const r = controlarHoras(
      [limpieza("Horno N°1", 20), limpieza("Caja E", -2)],
      18
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.join(" ")).toContain("renglón 2");
  });

  /** La vara de `validar()` del núcleo: todo junto y no de a uno. */
  it("dice todo lo que no cierra de una sola vez", () => {
    const r = controlarHoras([limpieza("Horno N°1", 0), limpieza("Caja E", 0)], 18);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.length).toBeGreaterThan(2);
  });

  it("sin renglones no hay nada que controlar", () => {
    const r = controlarHoras([], 18);
    expect(r.ok).toBe(false);
  });

  it("sin total escrito no hay contra que controlar", () => {
    const r = controlarHoras([limpieza("Horno N°1", 18)], 0);
    expect(r.ok).toBe(false);
  });
});


/**
 * La unidad es la **quincena** desde el 23/10/2026, y no la semana: del 1 al
 * 15 y del 16 a fin de mes, caiga el dia de la semana que caiga. Es como
 * Candia entrega los partes y como se factura, asi que una OT por quincena es
 * una OT por lo que se paga.
 */
describe("la quincena", () => {
  it("del 1 al 15 es la primera, caiga el dia que caiga", () => {
    // El 1/10/2026 es jueves y el 15 es jueves tambien: no importa.
    expect(inicioDeLaQuincena("2026-10-01")).toBe("2026-10-01");
    expect(inicioDeLaQuincena("2026-10-07")).toBe("2026-10-01");
    expect(inicioDeLaQuincena("2026-10-15")).toBe("2026-10-01");
    expect(finDeLaQuincena("2026-10-07")).toBe("2026-10-15");
  });

  it("del 16 en adelante es la segunda, y termina con el mes", () => {
    expect(inicioDeLaQuincena("2026-10-16")).toBe("2026-10-16");
    expect(inicioDeLaQuincena("2026-10-31")).toBe("2026-10-16");
    expect(finDeLaQuincena("2026-10-20")).toBe("2026-10-31");
  });

  /** El fin de la segunda no es un numero fijo: lo pone el mes. */
  it("la segunda quincena termina el 30, el 28 o el 29 segun el mes", () => {
    expect(finDeLaQuincena("2026-04-18")).toBe("2026-04-30");
    expect(finDeLaQuincena("2026-02-20")).toBe("2026-02-28");
    expect(finDeLaQuincena("2028-02-20")).toBe("2028-02-29");
  });

  it("una fecha que no es fecha no inventa una quincena", () => {
    expect(inicioDeLaQuincena("ayer")).toBe("");
    expect(finDeLaQuincena("ayer")).toBe("");
  });
});

describe("las OT que salen de los partes", () => {
  const CALCINACION = "sec-calcinacion";
  const MOLIENDA = "sec-molienda";
  const TRITURACION3 = "sec-trituracion-3";

  const renglon = (p: Partial<RenglonParaAgrupar> & { id: string }): RenglonParaAgrupar => ({
    parte_numero: 1301, fecha: "2026-10-01", actividad: "Limpieza",
    lugar_raw: "x", sector_id: CALCINACION, equipo_id: null, horas: 4,
    orden_trabajo_id: null, ...p,
  });

  /**
   * El caso que decidio repartir por renglon y no por actividad: «Planta N°3
   * zaranda» y «bajo cintas» son dos renglones del mismo sector, asi que al
   * agrupar se funden en una sola OT de 8 h.
   */
  it("dos renglones del mismo sector y la misma semana son una sola OT", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", lugar_raw: "Planta N°3 zaranda", sector_id: TRITURACION3 }),
      renglon({ id: "b", lugar_raw: "Bajo cintas", sector_id: TRITURACION3 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].horas).toBe(8);
    expect(grupos[0].renglon_ids).toEqual(["a", "b"]);
  });

  it("una OT por actividad y por sector", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", sector_id: CALCINACION }),
      renglon({ id: "b", sector_id: MOLIENDA }),
      renglon({ id: "c", sector_id: CALCINACION, actividad: "Riego", horas: 2 }),
    ]);
    expect(grupos).toHaveLength(3);
  });

  /**
   * Lo que cambio el 23/10/2026: el 1 y el 6 de octubre son semanas distintas
   * —jueves y martes— y la misma quincena, asi que ahora son **una sola OT**.
   */
  it("dos fechas de la misma quincena son una sola OT aunque sean semanas distintas", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-10-01" }),
      renglon({ id: "b", fecha: "2026-10-06" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].quincena).toBe("2026-10-01");
  });

  it("dos quincenas no se mezclan aunque sean el mismo sector y la misma actividad", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-10-15" }),
      renglon({ id: "b", fecha: "2026-10-16" }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.quincena)).toEqual(["2026-10-01", "2026-10-16"]);
  });

  it("la OT cierra el dia del ultimo parte del grupo", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-10-03", parte_numero: 1300 }),
      renglon({ id: "b", fecha: "2026-10-05", parte_numero: 1302 }),
      renglon({ id: "c", fecha: "2026-10-04", parte_numero: 1301 }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].fecha_cierre).toBe("2026-10-05");
  });

  /**
   * El cruce de mes, que con la semana no existia: del 28/9 al 4/10 era una
   * sola semana, asi que el 30/9 y el 1/10 caian juntos. Con la quincena son
   * dos OT, y tienen que serlo — son dos facturas distintas.
   */
  it("el 30 y el 1 son dos quincenas aunque esten pegados", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-09-30", parte_numero: 1300 }),
      renglon({ id: "b", fecha: "2026-10-01", parte_numero: 1301 }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.quincena)).toEqual(["2026-09-16", "2026-10-01"]);
  });

  /**
   * Enlazar al que se le parece es peor que dejar en null: un renglon sin
   * sector pondria las horas en un centro de costo que nadie eligio, y eso no
   * se nota nunca. Queda afuera para que alguien lo enganche.
   */
  it("un renglon sin sector no se manda a ningun lado: queda aparte", () => {
    const { grupos, sinSector } = agruparEnOrdenes([
      renglon({ id: "a" }),
      renglon({ id: "b", sector_id: null, lugar_raw: "Caja E" }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(sinSector.map((r) => r.lugar_raw)).toEqual(["Caja E"]);
  });

  /**
   * La unica excepcion a «toda OT lleva equipo»: una semana de limpieza que
   * toco el horno y ademas las cintas no es de ninguna de las dos maquinas, y
   * quedarse con una le daria las horas de la otra a su MTBF.
   */
  it("la OT lleva el equipo solo si todos los renglones apuntan al mismo", () => {
    const iguales = agruparEnOrdenes([
      renglon({ id: "a", equipo_id: "eq-horno" }),
      renglon({ id: "b", equipo_id: "eq-horno" }),
    ]);
    expect(iguales.grupos[0].equipo_id).toBe("eq-horno");

    const distintos = agruparEnOrdenes([
      renglon({ id: "a", equipo_id: "eq-horno" }),
      renglon({ id: "b", equipo_id: "eq-cintas" }),
    ]);
    expect(distintos.grupos[0].equipo_id).toBeNull();

    // Y uno con equipo mas uno sin: tampoco se queda con el que hay.
    const mixto = agruparEnOrdenes([
      renglon({ id: "a", equipo_id: "eq-horno" }),
      renglon({ id: "b", equipo_id: null }),
    ]);
    expect(mixto.grupos[0].equipo_id).toBeNull();
    // Pero las horas siguen enteras: no se pierde nada por no saber el equipo.
    expect(mixto.grupos[0].horas).toBe(8);
  });

  /**
   * EL AGUJERO DEL 20/10/2026, encontrado cargando el 1301 de verdad.
   *
   * Una quincena no se carga de una sentada. Si la agrupacion mirara solo los
   * renglones pendientes, la segunda tanda volveria a producir la clave que la
   * primera ya convirtio y se crearia una SEGUNDA OT para el mismo sector y la
   * misma semana — justo lo contrario de "una OT por semana, por sector". El
   * `orden_trabajo_id` impide reconvertir un renglon; no impide eso.
   */
  it("un grupo que ya tiene orden la trae, en vez de pedir otra", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", parte_numero: 1301, orden_trabajo_id: "ot-1" }),
      renglon({ id: "b", parte_numero: 1302, orden_trabajo_id: null }),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].ot_existentes).toEqual(["ot-1"]);
    // Las horas son las de los dos: a esa OT hay que dejarla en 8, no crear
    // otra de 4.
    expect(grupos[0].horas).toBe(8);
    // Y sólo el que falta se marca: remarcar el primero le cambiaria la orden.
    expect(grupos[0].renglon_ids_sin_ot).toEqual(["b"]);
  });

  it("un grupo entero sin convertir no trae ninguna orden", () => {
    const { grupos } = agruparEnOrdenes([renglon({ id: "a" }), renglon({ id: "b" })]);
    expect(grupos[0].ot_existentes).toEqual([]);
    expect(grupos[0].renglon_ids_sin_ot).toEqual(["a", "b"]);
  });

  /**
   * No deberia pasar nunca, y si pasa no se toca ninguna: repartir horas entre
   * dos ordenes que ya existen es inventar. Quien llama lo informa.
   */
  it("dos ordenes para la misma clave se denuncian, no se eligen", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", orden_trabajo_id: "ot-1" }),
      renglon({ id: "b", orden_trabajo_id: "ot-2" }),
    ]);
    expect(grupos[0].ot_existentes).toEqual(["ot-1", "ot-2"]);
  });

  it("la clave es la misma se calcule de donde se calcule", () => {
    // Es lo que sostiene todo lo de arriba: si las dos cuentas se separaran,
    // la segunda tanda no reconoceria la orden de la primera.
    expect(claveDeOT("2026-10-01", "Limpieza", "s-1"))
      .toBe(claveDeOT("2026-10-14", "LIMPIEZA", "s-1"));
    expect(claveDeOT("2026-10-01", "Limpieza", "s-1"))
      .not.toBe(claveDeOT("2026-10-16", "Limpieza", "s-1"));
  });

  /**
   * Pedir "del 1 al 15" ya es una quincena entera, asi que estirar no hace
   * nada — que es justamente lo que se pidio. Lo que sigue importando es
   * pedir "del 3 al 10": eso trae la quincena completa, porque es la unidad.
   */
  it("el rango se estira a quincenas enteras", () => {
    expect(inicioDeLaQuincena("2026-10-03")).toBe("2026-10-01");
    expect(finDeLaQuincena("2026-10-10")).toBe("2026-10-15");
    expect(inicioDeLaQuincena("2026-10-01")).toBe("2026-10-01");
    expect(finDeLaQuincena("2026-10-15")).toBe("2026-10-15");
  });

  it("la actividad agrupa sin importar como se escribio", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", actividad: "Limpieza" }),
      renglon({ id: "b", actividad: "LIMPIEZA" }),
    ]);
    expect(grupos).toHaveLength(1);
  });
});

describe("lo que dice la OT", () => {
  it("lleva los textos de Candia con su numero de parte, para volver al papel", () => {
    const { grupos } = agruparEnOrdenes([
      {
        id: "a", parte_numero: 1301, fecha: "2026-10-01", actividad: "Limpieza",
        lugar_raw: "Planta N°3 zaranda", sector_id: "s3", equipo_id: null, horas: 4,
      },
      {
        id: "b", parte_numero: 1302, fecha: "2026-10-02", actividad: "Limpieza",
        lugar_raw: "Bajo cintas", sector_id: "s3", equipo_id: null, horas: 4,
      },
    ]);
    const texto = descripcionDeLaOT(grupos[0], "CANDIA");
    expect(texto).toContain("CANDIA");
    expect(texto).toContain("Planta N°3 zaranda");
    expect(texto).toContain("parte 1301");
    expect(texto).toContain("Bajo cintas");
    expect(texto).toContain("8 h");
  });

  /**
   * De donde salen las horas, dicho en la propia OT. En seis meses alguien va
   * a leer "4 h" y va a querer saber quien las conto.
   */
  it("deja dicho de donde salen las horas", () => {
    const { grupos } = agruparEnOrdenes([{
      id: "a", parte_numero: 1301, fecha: "2026-10-01", actividad: "Limpieza",
      lugar_raw: "Horno N°1", sector_id: "s1", equipo_id: null, horas: 4,
    }]);
    expect(descripcionDeLaOT(grupos[0], "CANDIA")).toContain("quien cargó el parte");
  });
});
