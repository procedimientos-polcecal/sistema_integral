import { describe, it, expect } from "vitest";
import type { TurnoDeRobot } from "./turnos";
import type { TurnoDeMolino, EstadoDeTurno } from "./types";
import {
  armarElDia,
  armarElMes,
  condicionDelDia,
  diasNoOperativosDelMes,
  diaDeMolino,
  enOrdenCronologico,
  mesDeMolino,
} from "./consultas";
import { comoSeLeeElTurnoDelRobot, leyendaDelEstado, minutosComoSeLee, nombreDelMolino } from "./formato";

function turno(
  fecha: string,
  t: TurnoDeMolino,
  estado: EstadoDeTurno = "normal",
  extra: Partial<TurnoDeRobot> = {},
): TurnoDeRobot {
  const teorica = t === "04_12" || t === "12_20" ? 480 : 240;
  return {
    fecha,
    turno: t,
    kg: estado === "huerfano" ? 0 : 10_000,
    minutosMarcha: estado === "huerfano" ? 0 : teorica,
    minutosTeoricos: estado === "huerfano" ? 0 : teorica,
    estado,
    porMaterial: {},
    ...extra,
  };
}

const RANGO = { primero: "2026-03-01", ultimo: "2026-10-29" };

describe("condicionDelDia", () => {
  it("un día con renglones tiene datos", () => {
    expect(condicionDelDia("2026-10-12", true, RANGO)).toBe("con_datos");
  });
  it("un día sin renglones entre el primero y el último no operó", () => {
    expect(condicionDelDia("2026-10-12", false, RANGO)).toBe("no_operativo");
  });
  it("antes del primero y después del último no se sabe nada: sin datos, no no operativo", () => {
    expect(condicionDelDia("2026-02-27", false, RANGO)).toBe("sin_datos");
    expect(condicionDelDia("2026-10-30", false, RANGO)).toBe("sin_datos");
  });
  it("el primero y el último día, por definición, tienen renglones; sin ellos es un hueco de la base y no una planta parada", () => {
    expect(condicionDelDia("2026-03-01", false, RANGO)).toBe("sin_datos");
    expect(condicionDelDia("2026-10-29", false, RANGO)).toBe("sin_datos");
  });
  it("un molino sin ningún renglón no tiene días no operativos", () => {
    expect(condicionDelDia("2026-10-12", false, null)).toBe("sin_datos");
  });
});

describe("armarElDia", () => {
  it("un día no operativo no son cuatro ceros: no trae casillas ni indicadores", () => {
    const d = armarElDia("2026-10-12", [], [], RANGO);
    expect(d.condicion).toBe("no_operativo");
    expect(d.casillas).toEqual([]);
    expect(d.indicadores).toBeNull();
  });

  it("devuelve los cuatro turnos en orden de reloj aunque lleguen mezclados", () => {
    const filas = [
      turno("2026-10-05", "20_00"),
      turno("2026-10-05", "04_12"),
      turno("2026-10-05", "00_04"),
      turno("2026-10-05", "12_20"),
    ];
    const d = armarElDia("2026-10-05", filas, [], RANGO);
    expect(d.casillas.map((c) => c.turno)).toEqual(["00_04", "04_12", "12_20", "20_00"]);
    expect(d.casillas.every((c) => c.dato !== null)).toBe(true);
    // 240 + 480 + 480 + 240 de teórica y marcha completa: 100 %.
    expect(d.indicadores?.utilizacion).toBe(1);
    expect(d.indicadores?.toneladas).toBe(40);
  });

  it("un turno que absorbió un acumulado deja a los anteriores 'cubiertos', sin inventarles renglón", () => {
    // 04_12 y 12_20 no informaron; el 20_00 trae el trabajo de los tres.
    const acumulado = turno("2026-10-05", "20_00", "acumulado", { minutosMarcha: 1100, minutosTeoricos: 1200 });
    const filas = [turno("2026-10-05", "00_04"), acumulado];
    const d = armarElDia("2026-10-05", filas, [], RANGO);
    const [c0, c1, c2, c3] = d.casillas;
    expect(c0.dato?.estado).toBe("normal");
    expect(c1.dato).toBeNull();
    expect(c1.cubiertoPor).toEqual({ fecha: "2026-10-05", turno: "20_00" });
    expect(c2.cubiertoPor).toEqual({ fecha: "2026-10-05", turno: "20_00" });
    expect(c3.dato?.estado).toBe("acumulado");
    // El acumulado entra con su teórica de racha: 1100/1200 y no 1100/240.
    expect(d.indicadores?.utilizacion).toBeCloseTo((240 + 1100) / (240 + 1200), 10);
  });

  it("el acumulado que cubre un turno puede estar en el día siguiente", () => {
    const filas = [turno("2026-10-05", "00_04"), turno("2026-10-05", "04_12"), turno("2026-10-05", "12_20")];
    const sig = [turno("2026-10-06", "00_04", "acumulado", { minutosMarcha: 400, minutosTeoricos: 480 })];
    const d = armarElDia("2026-10-05", filas, sig, RANGO);
    expect(d.casillas[3].dato).toBeNull();
    expect(d.casillas[3].cubiertoPor).toEqual({ fecha: "2026-10-06", turno: "00_04" });
  });

  it("si lo que viene después no es un acumulado no se inventa quién lo cubre", () => {
    const filas = [turno("2026-10-05", "00_04"), turno("2026-10-05", "12_20"), turno("2026-10-05", "20_00")];
    const d = armarElDia("2026-10-05", filas, [], RANGO);
    expect(d.casillas[1].dato).toBeNull();
    expect(d.casillas[1].cubiertoPor).toBeNull();
  });

  it("un huérfano está en la lista pero no aporta nada a los indicadores", () => {
    const filas = [
      turno("2026-10-29", "00_04"),
      turno("2026-10-29", "04_12", "huerfano"),
      turno("2026-10-29", "12_20", "huerfano"),
      turno("2026-10-29", "20_00", "huerfano"),
    ];
    const d = armarElDia("2026-10-29", filas, [], { primero: "2026-03-01", ultimo: "2026-10-29" });
    expect(d.casillas.map((c) => c.dato?.estado)).toEqual(["normal", "huerfano", "huerfano", "huerfano"]);
    expect(d.indicadores?.utilizacion).toBe(1);
    expect(d.indicadores?.horasDeMarcha).toBe(4);
  });

  it("un inconsistente aporta toneladas y no horas", () => {
    const filas = [
      turno("2026-06-04", "00_04"),
      turno("2026-06-04", "04_12", "inconsistente", { minutosMarcha: 498, minutosTeoricos: 480, kg: 8_000 }),
      turno("2026-06-04", "12_20"),
      turno("2026-06-04", "20_00"),
    ];
    const d = armarElDia("2026-06-04", filas, [], RANGO);
    expect(d.indicadores?.toneladas).toBe(38);
    expect(d.indicadores?.horasDeMarcha).toBe((240 + 480 + 240) / 60);
  });

  it("cuatro turnos en cero son una parada, no un día no operativo: el cero es un dato", () => {
    const filas = (["00_04", "04_12", "12_20", "20_00"] as const).map((t) =>
      turno("2026-10-12", t, "normal", { kg: 0, minutosMarcha: 0 }),
    );
    const d = armarElDia("2026-10-12", filas, [], RANGO);
    expect(d.condicion).toBe("con_datos");
    expect(d.indicadores?.utilizacion).toBe(0);
  });
});

describe("diasNoOperativosDelMes", () => {
  it("cuenta los días sin renglones dentro del rango y no los de afuera", () => {
    const con = ["2026-10-01", "2026-10-02", "2026-10-05"];
    // Octubre: del 3 al 4 sin renglones; del 6 al 28 también, pero el rango
    // termina el 5, así que sólo cuentan 3 y 4.
    const r = diasNoOperativosDelMes("2026-10", con, { primero: "2026-03-01", ultimo: "2026-10-05" });
    expect(r).toEqual(["2026-10-03", "2026-10-04"]);
  });
  it("un molino sin datos no tiene días no operativos", () => {
    expect(diasNoOperativosDelMes("2026-10", [], null)).toEqual([]);
  });
});

describe("armarElMes", () => {
  it("los días no operativos van aparte y entran al conteo de los indicadores sin tocar la utilización", () => {
    const turnos = [
      ...(["00_04", "04_12", "12_20", "20_00"] as const).map((t) => turno("2026-10-01", t)),
      ...(["00_04", "04_12", "12_20", "20_00"] as const).map((t) => turno("2026-10-05", t)),
    ];
    const m = armarElMes("2026-10", turnos, { primero: "2026-03-01", ultimo: "2026-10-05" });
    expect(m.diasNoOperativos).toEqual(["2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(m.indicadores.diasNoOperativos).toBe(3);
    expect(m.indicadores.utilizacion).toBe(1);
    expect(m.diasConDatos).toBe(2);
  });

  it("cuenta cada estado y lista los que no son normales, en orden cronológico", () => {
    const turnos = [
      turno("2026-10-02", "12_20", "huerfano"),
      turno("2026-10-01", "04_12", "acumulado", { minutosMarcha: 700, minutosTeoricos: 960 }),
      turno("2026-10-01", "00_04"),
      turno("2026-10-03", "20_00", "inconsistente"),
    ];
    const m = armarElMes("2026-10", turnos, { primero: "2026-10-01", ultimo: "2026-10-03" });
    expect(m.conteoPorEstado).toEqual({ normal: 1, acumulado: 1, inconsistente: 1, huerfano: 1 });
    expect(m.senalados.map((t) => `${t.fecha} ${t.turno} ${t.estado}`)).toEqual([
      "2026-10-01 04_12 acumulado",
      "2026-10-02 12_20 huerfano",
      "2026-10-03 20_00 inconsistente",
    ]);
  });

  it("un mes sin renglones devuelve indicadores sin dividir por cero", () => {
    const m = armarElMes("2026-12", [], { primero: "2026-03-01", ultimo: "2026-10-29" });
    expect(m.indicadores.utilizacion).toBeNull();
    expect(m.indicadores.productividad).toBeNull();
  });
});

describe("enOrdenCronologico", () => {
  it("ordena por reloj dentro del día y no por el orden del enum de la base", () => {
    // El enum de la base declara 20_00 primero; el reloj lo pone último.
    const r = enOrdenCronologico([turno("2026-10-05", "20_00"), turno("2026-10-05", "00_04"), turno("2026-10-04", "20_00")]);
    expect(r.map((t) => `${t.fecha} ${t.turno}`)).toEqual(["2026-10-04 20_00", "2026-10-05 00_04", "2026-10-05 20_00"]);
  });
});

// ── La parte que habla con la base, contra un cliente de mentira ─────────────

interface FilaBase {
  molino_id: string;
  fecha: string;
  turno: TurnoDeMolino;
  kg: number;
  minutos_marcha: number;
  minutos_teoricos: number;
  estado: EstadoDeTurno;
  por_material: Record<string, number>;
}

/**
 * Un `admin` que imita a PostgREST en lo que importa: **responde a lo sumo
 * 1.000 filas por consulta**, como el real, así que una lectura sin paginar se
 * queda corta igual que en producción.
 */
function adminFalso(filas: FilaBase[]) {
  const llamadas = { rangos: 0 };
  const consulta = () => {
    const f: { molino?: string; fecha?: string; gt?: string; gte?: string; lte?: string; asc: boolean } = { asc: true };
    const resultado = () => {
      let r = filas.filter((x) => (f.molino ? x.molino_id === f.molino : true));
      if (f.fecha) r = r.filter((x) => x.fecha === f.fecha);
      if (f.gt) r = r.filter((x) => x.fecha > f.gt!);
      if (f.gte) r = r.filter((x) => x.fecha >= f.gte!);
      if (f.lte) r = r.filter((x) => x.fecha <= f.lte!);
      return [...r].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0) * (f.asc ? 1 : -1));
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, v: string) => { if (col === "molino_id") f.molino = v; if (col === "fecha") f.fecha = v; return q; },
      gt: (_c: string, v: string) => { f.gt = v; return q; },
      gte: (_c: string, v: string) => { f.gte = v; return q; },
      lte: (_c: string, v: string) => { f.lte = v; return q; },
      order: (_c: string, o?: { ascending: boolean }) => { if (o) f.asc = o.ascending; return q; },
      limit: (n: number) => Promise.resolve({ data: resultado().slice(0, Math.min(n, 1000)), error: null }),
      range: (d: number, h: number) => {
        llamadas.rangos++;
        return Promise.resolve({ data: resultado().slice(d, Math.min(h + 1, d + 1000)), error: null });
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: resultado().slice(0, 1000), error: null }).then(ok),
    };
    return q;
  };
  return { admin: { from: () => consulta() } as never, llamadas };
}

function base(molino: string, fecha: string, t: TurnoDeMolino, estado: EstadoDeTurno = "normal"): FilaBase {
  const x = turno(fecha, t, estado);
  return {
    molino_id: molino, fecha, turno: t, kg: x.kg, minutos_marcha: x.minutosMarcha,
    minutos_teoricos: x.minutosTeoricos, estado, por_material: {},
  };
}

describe("mesDeMolino y diaDeMolino contra una base que corta en 1000", () => {
  it("el mes trae todas las filas: con más de mil en total, el mes pedido sale entero", () => {
    // 300 días x 4 turnos = 1.200 filas del molino A. El mes de octubre son 124.
    const filas: FilaBase[] = [];
    for (let i = 0; i < 300; i++) {
      const fecha = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      for (const t of ["00_04", "04_12", "12_20", "20_00"] as const) filas.push(base("A", fecha, t));
    }
    const { admin } = adminFalso(filas);
    return mesDeMolino(admin, "A", "2026-10").then((m) => {
      // Enero 1 + 299 = 27/10: octubre llega hasta el 27 y tiene 27 días x 4.
      expect(m.turnos.length).toBe(27 * 4);
      expect(m.diasConDatos).toBe(27);
    });
  });

  it("pagina de verdad: un rango de más de mil filas se trae completo", async () => {
    // Sólo para comprobar que `traerTodo` está puesto: el "mes" de la base falsa
    // abarca 1.100 filas porque ignora el rango de fechas.
    const filas: FilaBase[] = [];
    for (let i = 0; i < 275; i++) {
      const fecha = new Date(Date.UTC(2026, 9, 1 + (i % 28))).toISOString().slice(0, 10);
      for (const t of ["00_04", "04_12", "12_20", "20_00"] as const) filas.push({ ...base("A", fecha, t), fecha });
    }
    const { admin, llamadas } = adminFalso(filas);
    const m = await mesDeMolino(admin, "A", "2026-10");
    expect(m.turnos.length).toBe(1100);
    expect(llamadas.rangos).toBeGreaterThanOrEqual(2);
  });

  it("el día devuelve cubierto un turno que absorbió el acumulado del día siguiente", async () => {
    const filas: FilaBase[] = [
      base("A", "2026-10-01", "00_04"),
      base("A", "2026-10-01", "04_12"),
      base("A", "2026-10-01", "12_20"),
      // El 20_00 del 1/10 no tiene renglón: lo cubre el acumulado del 2/10.
      base("A", "2026-10-02", "00_04", "acumulado"),
      base("A", "2026-10-02", "04_12"),
      base("A", "2026-10-02", "12_20"),
      base("A", "2026-10-02", "20_00"),
      // Otro molino con renglones en las mismas fechas: no tiene que mezclarse.
      base("B", "2026-10-01", "20_00", "huerfano"),
    ];
    const { admin } = adminFalso(filas);
    const d = await diaDeMolino(admin, "A", "2026-10-01");
    expect(d.condicion).toBe("con_datos");
    expect(d.casillas[3].dato).toBeNull();
    expect(d.casillas[3].cubiertoPor).toEqual({ fecha: "2026-10-02", turno: "00_04" });
  });

  it("un día sin renglones dentro del rango sale no operativo", async () => {
    const filas = [base("A", "2026-10-01", "00_04"), base("A", "2026-10-05", "00_04")];
    const { admin } = adminFalso(filas);
    const d = await diaDeMolino(admin, "A", "2026-10-03");
    expect(d.condicion).toBe("no_operativo");
    expect(d.casillas).toEqual([]);
  });
});

describe("formato", () => {
  it("el molino se dice siempre acompañado", () => {
    expect(nombreDelMolino("Filler 1")).toBe("molino Filler 1");
    expect(nombreDelMolino("Filler 2 (Calera)")).toBe("molino Filler 2 (Calera)");
    expect(nombreDelMolino("molino Filler 1")).toBe("molino Filler 1");
  });
  it("los minutos se leen como horas", () => {
    expect(minutosComoSeLee(45)).toBe("45 min");
    expect(minutosComoSeLee(480)).toBe("8 h");
    expect(minutosComoSeLee(462)).toBe("7 h 42 min");
  });
  it("las leyendas dicen lo que se hace con cada estado, y el normal no lleva", () => {
    const d = { minutosMarcha: 631, minutosTeoricos: 2_880 };
    expect(leyendaDelEstado("normal", d)).toBeNull();
    expect(leyendaDelEstado("acumulado", d)).toContain("48 h");
    expect(leyendaDelEstado("acumulado", d)).toContain("no se reparte ni se promedia");
    expect(leyendaDelEstado("inconsistente", d)).toContain("toneladas cuentan");
    expect(leyendaDelEstado("huerfano", d)).toContain("No es una parada");
  });
  it("los cuatro turnos se leen distinto entre sí", () => {
    const todos = (["00_04", "04_12", "12_20", "20_00"] as const).map(comoSeLeeElTurnoDelRobot);
    expect(new Set(todos).size).toBe(4);
  });
});
