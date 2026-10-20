import { describe, it, expect } from "vitest";
import {
  normalizarLugar, esRiego, terminosDeLaExpresion, totalDeLaExpresion,
  repartirHoras, lunesDeLaSemana, agruparEnOrdenes, descripcionDeLaOT,
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

  it("el riego se reconoce por la palabra y no por una lista cerrada", () => {
    expect(esRiego("Riego")).toBe(true);
    expect(esRiego("Riego en planta")).toBe(true);
    expect(esRiego("riego de caminos")).toBe(true);
    expect(esRiego("Limpieza")).toBe(false);
    expect(esRiego("Riegos")).toBe(true);
    // Por palabra y no por `includes`: una actividad que apenas contiene las
    // letras no es el riego, y confundirla le daria a esa OT las horas enteras
    // del segundo termino, que no trabajo.
    expect(esRiego("Desmalezado")).toBe(false);
    expect(esRiego("Arriego")).toBe(false);
  });
});

describe("la suma de horas del papel", () => {
  it("lee los dos terminos de una hoja de Candia", () => {
    expect(terminosDeLaExpresion("2 P. x 8H + 1 P. x 2H")).toEqual([
      { personas: 2, horas: 8 },
      { personas: 1, horas: 2 },
    ]);
  });

  it("acepta las formas que aparecen escritas", () => {
    expect(terminosDeLaExpresion("2P x 8 Hs")).toEqual([{ personas: 2, horas: 8 }]);
    expect(terminosDeLaExpresion("2 Pers. × 8h")).toEqual([{ personas: 2, horas: 8 }]);
    expect(terminosDeLaExpresion("3 x 4")).toEqual([{ personas: 3, horas: 4 }]);
  });

  /**
   * No adivina. Quien carga tiene el papel delante; repartir sobre una lectura
   * dudosa pondria horas en sectores que nadie eligio.
   */
  it("se niega con lo que no entiende, en vez de arriesgar", () => {
    expect(terminosDeLaExpresion("dos personas ocho horas")).toBeNull();
    expect(terminosDeLaExpresion("2 P. x")).toBeNull();
    expect(terminosDeLaExpresion("")).toBeNull();
    expect(terminosDeLaExpresion("0 P. x 8H")).toBeNull();
  });

  it("suma personas por horas", () => {
    expect(totalDeLaExpresion([{ personas: 2, horas: 8 }, { personas: 1, horas: 2 }])).toBe(18);
  });
});

/**
 * Las tres hojas que se midieron el 20/10/2026, con los lugares traducidos a
 * sector por la persona: «molino horizontal» es el molino de Molienda de cal y
 * «bajo cintas» son las cintas de la Planta de trituracion 3.
 */
describe("el reparto, contra las tres hojas reales", () => {
  const renglones1301 = [
    { actividad: "Limpieza", lugar_raw: "Horno N°1" },
    { actividad: "Limpieza", lugar_raw: "Molino horizontal" },
    { actividad: "Riego", lugar_raw: "Riego en planta" },
    { actividad: "Limpieza", lugar_raw: "Planta N°3 zaranda" },
    { actividad: "Limpieza", lugar_raw: "Bajo cintas" },
  ];

  it("1301: el riego se lleva el segundo termino y el resto se parte en cuatro", () => {
    const r = repartirHoras("2 P. x 8H + 1 P. x 2H", renglones1301, 18);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renglones.map((x) => x.horas)).toEqual([4, 4, 2, 4, 4]);
    expect(r.total).toBe(18);
  });

  it("1303: sin segundo termino no hay riego, y las 16 van entre los cinco", () => {
    const cinco = [
      { actividad: "Limpieza", lugar_raw: "Caja E" },
      { actividad: "Limpieza", lugar_raw: "Bandejas" },
      { actividad: "Limpieza", lugar_raw: "Balanza" },
      { actividad: "Limpieza", lugar_raw: "Horno N°1" },
      { actividad: "Limpieza", lugar_raw: "Bajo cintas" },
    ];
    const r = repartirHoras("2 P. x 8H", cinco, 16);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renglones.map((x) => x.horas)).toEqual([3.2, 3.2, 3.2, 3.2, 3.2]);
    expect(r.total).toBe(16);
  });

  /**
   * 3,2 no se redondea. Redondear a 3 o a 3,5 rompe que la quincena cierre
   * contra la factura, que es para lo que existe todo esto.
   */
  it("no redondea a la media hora", () => {
    const r = repartirHoras(
      "2 P. x 8H",
      Array.from({ length: 5 }, (_, i) => ({ actividad: "Limpieza", lugar_raw: `L${i}` })),
      16
    );
    if (!r.ok) throw new Error("tenia que repartir");
    expect(r.renglones[0].horas).not.toBe(3);
    expect(r.renglones[0].horas).not.toBe(3.5);
  });

  it("una division que no es exacta queda en centesimas, no en una suma rota", () => {
    const r = repartirHoras("2 P. x 8H", [
      { actividad: "Limpieza", lugar_raw: "A" },
      { actividad: "Limpieza", lugar_raw: "B" },
      { actividad: "Limpieza", lugar_raw: "C" },
    ], 16);
    if (!r.ok) throw new Error("tenia que repartir");
    expect(r.renglones.map((x) => x.horas)).toEqual([5.33, 5.33, 5.33]);
    // Y la diferencia se ve: el numero con el que se controla la factura es
    // `horas_declaradas`, no esta suma.
    expect(r.total).toBe(15.99);
  });
});

describe("cuando el papel no cierra", () => {
  const unos = [
    { actividad: "Limpieza", lugar_raw: "A" },
    { actividad: "Limpieza", lugar_raw: "B" },
  ];

  /** El control de la factura. Sin esto, esto seria solo transcribir. */
  it("la suma que no da el total escrito se dice con los dos numeros", () => {
    const r = repartirHoras("2 P. x 8H", unos, 20);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.join(" ")).toContain("16");
    expect(r.problemas.join(" ")).toContain("20");
  });

  it("la expresion ilegible no se reparte", () => {
    const r = repartirHoras("ocho horas", unos, 8);
    expect(r.ok).toBe(false);
  });

  /**
   * La regla dice: si no hay segundo termino no hubo riego AUNQUE EL DETALLE
   * LO NOMBRE. Se muestra en vez de acomodarlo — inventarle horas seria
   * cobrarle al sistema algo que el papel no paga.
   */
  it("el detalle nombra riego pero la suma no lo paga", () => {
    const r = repartirHoras("2 P. x 8H", [
      { actividad: "Limpieza", lugar_raw: "A" },
      { actividad: "Riego", lugar_raw: "Riego en planta" },
    ], 16);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.join(" ")).toContain("segundo término");
  });

  it("la suma paga riego pero el detalle no lo nombra", () => {
    const r = repartirHoras("2 P. x 8H + 1 P. x 2H", unos, 18);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.join(" ")).toContain("riego");
  });

  it("un tercer termino no se interpreta: lo contesta una persona", () => {
    const r = repartirHoras("2 P. x 8H + 1 P. x 2H + 1 P. x 1H", [
      { actividad: "Limpieza", lugar_raw: "A" },
      { actividad: "Riego", lugar_raw: "Riego" },
    ], 19);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.join(" ")).toContain("tres términos".replace("tres ", "3 "));
  });

  /** La vara de `validar()`: todo junto y no de a uno. */
  it("dice todo lo que no cierra de una sola vez", () => {
    const r = repartirHoras("2 P. x 8H + 1 P. x 2H", unos, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problemas.length).toBeGreaterThan(1);
  });

  it("sin renglones no hay entre que repartir", () => {
    const r = repartirHoras("2 P. x 8H", [], 16);
    expect(r.ok).toBe(false);
  });
});

describe("la semana", () => {
  it("corre de lunes a domingo", () => {
    // 2026-10-01 es jueves.
    expect(lunesDeLaSemana("2026-10-01")).toBe("2026-09-28");
    expect(lunesDeLaSemana("2026-09-28")).toBe("2026-09-28");
    // El domingo cae en la semana que termina, no en la que empieza.
    expect(lunesDeLaSemana("2026-10-04")).toBe("2026-09-28");
    expect(lunesDeLaSemana("2026-10-05")).toBe("2026-10-05");
  });

  it("una fecha que no es fecha no inventa una semana", () => {
    expect(lunesDeLaSemana("ayer")).toBe("");
  });
});

describe("las OT que salen de los partes", () => {
  const CALCINACION = "sec-calcinacion";
  const MOLIENDA = "sec-molienda";
  const TRITURACION3 = "sec-trituracion-3";

  const renglon = (p: Partial<RenglonParaAgrupar> & { id: string }): RenglonParaAgrupar => ({
    parte_numero: 1301, fecha: "2026-10-01", actividad: "Limpieza",
    lugar_raw: "x", sector_id: CALCINACION, equipo_id: null, horas: 4, ...p,
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

  it("dos semanas no se mezclan aunque sean el mismo sector y la misma actividad", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-10-01" }),
      renglon({ id: "b", fecha: "2026-10-06" }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.semana)).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("la OT cierra el dia del ultimo parte del grupo", () => {
    const { grupos } = agruparEnOrdenes([
      renglon({ id: "a", fecha: "2026-09-30", parte_numero: 1300 }),
      renglon({ id: "b", fecha: "2026-10-02", parte_numero: 1302 }),
      renglon({ id: "c", fecha: "2026-10-01", parte_numero: 1301 }),
    ]);
    expect(grupos[0].fecha_cierre).toBe("2026-10-02");
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
   * Las horas son una convencion y la OT lo dice. En seis meses alguien va a
   * leer "4 h" y va a creer que alguien las conto.
   */
  it("deja dicho que las horas salen de un reparto", () => {
    const { grupos } = agruparEnOrdenes([{
      id: "a", parte_numero: 1301, fecha: "2026-10-01", actividad: "Limpieza",
      lugar_raw: "Horno N°1", sector_id: "s1", equipo_id: null, horas: 4,
    }]);
    expect(descripcionDeLaOT(grupos[0], "CANDIA")).toContain("convención");
  });
});
