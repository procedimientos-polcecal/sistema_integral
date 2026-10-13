import { describe, expect, it } from "vitest";
import {
  armarResumenHoy,
  armarTarjetasHoy,
  clasificarHoy,
  comoPorcentaje,
  diaCorto,
  tituloDeDetalle,
  type DatosDeHoy,
  type ResumenHoy,
} from "./tarjetasHoy";

/*
 * El caso real del martes 13/10/2026 a las 08:07 (hora de Argentina), medido
 * contra producción: 68 activos, 23 con marcación, `calculos_diarios` de hoy con
 * las 68 filas (45 ausentes, 0 tarde), sin vacaciones ni tardanzas a mano. El
 * último día hábil con fichadas es el sábado 10/10 —el 11 es domingo y el 12
 * feriado—, con 4 ausentes.
 */
const ids = Array.from({ length: 68 }, (_, i) => `e${i}`);

function hoyMedido(sobre: Partial<DatosDeHoy> = {}): DatosDeHoy {
  const quienesMarcaron = ids.slice(0, 23);
  return {
    empleadoIds: ids,
    // Algunos ficharon dos veces (almuerzo): una persona, no dos.
    fichadasHoy: [...quienesMarcaron, ...quienesMarcaron.slice(0, 5)],
    calculosHoy: ids.map((id, i) => ({ empleado_id: id, ausente: i >= 23, tarde: false })),
    tardanzasManualesIds: [],
    vacacionesIds: [],
    dia: "2026-10-10",
    calculosDia: ids.map((id, i) => ({ empleado_id: id, ausente: i < 4 })),
    ...sobre,
  };
}

const resumenDe = (d: DatosDeHoy) => armarResumenHoy("2026-10-13", d.empleadoIds.length, clasificarHoy(d));

describe("presentes", () => {
  it("cuenta empleados distintos con marcación hoy, no filas ni activos menos ausentes", () => {
    expect(resumenDe(hoyMedido()).presentes).toBe(23);
  });

  // La resta anterior daba 68 presentes, 100%, a las siete de la mañana si el
  // recálculo no había corrido: sin filas no hay ausentes que restar.
  it("no depende de que el día se haya recalculado", () => {
    const r = resumenDe(hoyMedido({ calculosHoy: [] }));
    expect(r.presentes).toBe(23);
    expect(r.ausentes.cantidad).toBe(4);
  });

  it("sin marcaciones es 0, y sin poder leerlas es null: no son lo mismo", () => {
    expect(resumenDe(hoyMedido({ fichadasHoy: [] })).presentes).toBe(0);
    expect(resumenDe(hoyMedido({ fichadasHoy: null })).presentes).toBeNull();
  });

  it("no cuenta marcaciones de quien no está en el tablero (baja o filtrado por sector)", () => {
    const r = resumenDe(hoyMedido({ empleadoIds: ids.slice(0, 10) }));
    expect(r.presentes).toBe(10);
    expect(r.totalActivos).toBe(10);
  });
});

describe("ausentes", () => {
  it("son los del último día hábil con fichadas, y dicen cuál", () => {
    const r = resumenDe(hoyMedido());
    expect(r.ausentes).toEqual({ cantidad: 4, dia: "2026-10-10" });
  });

  it("no se contagian de los 45 'ausentes' de hoy, que son gente cuyo día no empezó", () => {
    const d = hoyMedido();
    expect(d.calculosHoy.filter((c) => c.ausente)).toHaveLength(45);
    expect(resumenDe(d).ausentes.cantidad).toBe(4);
  });

  it("sin ningún día con fichadas no hay cantidad, no un 0", () => {
    expect(resumenDe(hoyMedido({ dia: null, calculosDia: [] })).ausentes).toEqual({ cantidad: null, dia: null });
  });

  it("un día con fichadas pero sin cálculo tampoco es 'cero ausentes'", () => {
    expect(resumenDe(hoyMedido({ calculosDia: [] })).ausentes).toEqual({ cantidad: null, dia: "2026-10-10" });
  });

  it("respeta el filtro: sólo los ausentes de los empleados del tablero", () => {
    // Los cuatro ausentes son e0..e3.
    expect(resumenDe(hoyMedido({ empleadoIds: ids.slice(2, 30) })).ausentes.cantidad).toBe(2);
  });
});

describe("tardanzas", () => {
  it("suma las del reloj y las cargadas a mano, y una persona con las dos cuenta una vez", () => {
    const d = hoyMedido({
      calculosHoy: ids.map((id, i) => ({ empleado_id: id, ausente: i >= 23, tarde: i === 1 || i === 2 })),
      tardanzasManualesIds: ["e2", "e30"],
    });
    const r = resumenDe(d);
    expect(r.tardes.cantidad).toBe(3); // e1, e2 (una vez) y e30
    expect(r.tardes.manuales).toBe(2);
  });

  it("con el día calculado y cero tardanzas, es un cero de verdad", () => {
    const t = armarTarjetasHoy(resumenDe(hoyMedido())).find((x) => x.clave === "tardes")!;
    expect(t.valor).toBe(0);
    expect(t.sub).toBe("0%");
  });

  // El punto central: sin filas de hoy el 0 no es "cero tardanzas", es "no sé".
  it("sin filas de hoy no se ve como cero", () => {
    const r = resumenDe(hoyMedido({ calculosHoy: [] }));
    expect(r.tardes.calculados).toBe(0);
    const t = armarTarjetasHoy(r).find((x) => x.clave === "tardes")!;
    expect(t.valor).toBe("—");
    expect(t.sub).toBe("Todavía no se calculó el día");
  });

  it("sin filas de hoy igual nombra las cargadas a mano, que no dependen del cálculo", () => {
    const r = resumenDe(hoyMedido({ calculosHoy: [], tardanzasManualesIds: ["e5", "e6"] }));
    const t = armarTarjetasHoy(r).find((x) => x.clave === "tardes")!;
    expect(t.valor).toBe("—");
    expect(t.sub).toBe("Sin calcular todavía · 2 cargadas a mano");
  });

  it("avisa cuando alguien marcó después del último recálculo", () => {
    // El cálculo de las 06:00: todos ausentes. Después ficharon 23, y a e0 le
    // faltaría figurar como tarde.
    const r = resumenDe(
      hoyMedido({ calculosHoy: ids.map((id) => ({ empleado_id: id, ausente: true, tarde: false })) })
    );
    expect(r.tardes.calculados).toBe(68);
    expect(r.tardes.sinCalcular).toBe(23);
    const t = armarTarjetasHoy(r).find((x) => x.clave === "tardes")!;
    expect(t.valor).toBe(0);
    expect(t.sub).toBe("0% · 23 marcaciones sin calcular");
  });

  it("con el cálculo al día no hay nada sin calcular", () => {
    expect(resumenDe(hoyMedido()).tardes.sinCalcular).toBe(0);
  });

  it("una fila parcial como la del 06/10 (2 de 68) deja ver cuántas marcaciones faltan", () => {
    const r = resumenDe(hoyMedido({ calculosHoy: [{ empleado_id: "e0", ausente: false, tarde: false }, { empleado_id: "e1", ausente: false, tarde: true }] }));
    expect(r.tardes.cantidad).toBe(1);
    expect(r.tardes.sinCalcular).toBe(21);
  });
});

describe("vacaciones", () => {
  it("cuenta personas del tablero, no depende de que alguien fiche", () => {
    const r = resumenDe(hoyMedido({ fichadasHoy: [], calculosHoy: [], vacacionesIds: ["e40", "e41", "e999"] }));
    expect(r.vacaciones).toBe(2);
  });
});

describe("armarTarjetasHoy — el caso medido el 13/10/2026", () => {
  const tarjetas = armarTarjetasHoy(resumenDe(hoyMedido()));
  const por = (clave: string) => tarjetas.find((t) => t.clave === clave)!;

  it("presentes 23, con su porcentaje", () => {
    expect(por("presentes")).toMatchObject({ valor: 23, sub: "33,8%" });
  });

  it("ausentes 4, y la tarjeta dice de qué día son, sin porcentaje", () => {
    expect(por("ausentes")).toMatchObject({ valor: 4, sub: "el sáb 10/10" });
  });

  it("tardes 0 y vacaciones 0", () => {
    expect(por("tardes")).toMatchObject({ valor: 0, sub: "0%" });
    expect(por("vacaciones")).toMatchObject({ valor: 0, sub: "0%" });
  });

  it("siempre las cuatro, en el orden de la pantalla", () => {
    expect(tarjetas.map((t) => t.clave)).toEqual(["presentes", "ausentes", "tardes", "vacaciones"]);
  });
});

describe("armarTarjetasHoy — lo que no se sabe no se muestra como cero", () => {
  const base: ResumenHoy = resumenDe(hoyMedido());

  it("presentes sin poder leer las marcaciones", () => {
    const t = armarTarjetasHoy({ ...base, presentes: null })[0];
    expect(t.valor).toBe("—");
  });

  it("presentes 0 dice que todavía no marcó nadie", () => {
    const t = armarTarjetasHoy({ ...base, presentes: 0 })[0];
    expect(t).toMatchObject({ valor: 0, sub: "Sin marcaciones todavía" });
  });

  it("ausentes sin día de referencia", () => {
    const t = armarTarjetasHoy({ ...base, ausentes: { cantidad: null, dia: null } })[1];
    expect(t).toMatchObject({ valor: "—", sub: "Sin fichadas importadas" });
  });

  it("ausentes con día pero sin cálculo", () => {
    const t = armarTarjetasHoy({ ...base, ausentes: { cantidad: null, dia: "2026-10-10" } })[1];
    expect(t).toMatchObject({ valor: "—", sub: "Sin cálculo del sáb 10/10" });
  });

  it("sin empleados no divide por cero", () => {
    const t = armarTarjetasHoy({ ...base, totalActivos: 0, presentes: 3 })[0];
    expect(t.sub).toBe("0%");
  });
});

describe("tituloDeDetalle", () => {
  const r = resumenDe(hoyMedido());

  it("el de los ausentes nombra su día; los otros son de hoy", () => {
    expect(tituloDeDetalle("ausentes", r)).toBe("Ausentes el sáb 10/10");
    expect(tituloDeDetalle("presentes", r)).toBe("Presentes hoy");
    expect(tituloDeDetalle("tardes", r)).toBe("Tardanzas hoy");
    expect(tituloDeDetalle("vacaciones", r)).toBe("Vacaciones hoy");
  });
});

describe("clasificarHoy — el detalle coincide con el número", () => {
  it("las personas de cada conjunto son tantas como dice el resumen", () => {
    const d = hoyMedido({ vacacionesIds: ["e50"], tardanzasManualesIds: ["e7"] });
    const c = clasificarHoy(d);
    const r = armarResumenHoy("2026-10-13", 68, c);
    expect(c.presentes?.size).toBe(r.presentes);
    expect(c.ausentes.size).toBe(r.ausentes.cantidad);
    expect(c.tardes.size).toBe(r.tardes.cantidad);
    expect(c.vacaciones.size).toBe(r.vacaciones);
  });
});

describe("diaCorto y comoPorcentaje", () => {
  it("escribe el día de la semana y la fecha, sin año", () => {
    expect(diaCorto("2026-10-10")).toBe("sáb 10/10");
    expect(diaCorto("2026-10-09")).toBe("vie 09/10");
    expect(diaCorto("2026-10-04")).toBe("dom 04/10");
  });

  it("redondea a un decimal y usa coma", () => {
    expect(comoPorcentaje(23, 68)).toBe("33,8%");
    expect(comoPorcentaje(1, 4)).toBe("25%");
    expect(comoPorcentaje(0, 68)).toBe("0%");
    expect(comoPorcentaje(1, 0)).toBe("0%");
  });
});
