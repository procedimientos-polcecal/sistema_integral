import { describe, expect, it } from "vitest";
import { diaDeLaSemana, sumarDias } from "@/lib/core/fechas";
import {
  diasQueArrancan,
  diasQueCruzaron,
  lasQueArrancan,
  lasQueSeAtrasaron,
  textoDeLasAtrasadas,
  textoDeLasQueArrancan,
  type OrdenParaRecordar,
} from "./recordatorioDeOT";

// El 2026-11-19 es jueves; 21 sábado, 22 domingo, 23 lunes.

function ot(
  n: number,
  sector: string | null,
  descripcion: string | null = null,
  resto: Partial<OrdenParaRecordar> = {}
): OrdenParaRecordar {
  return {
    ot_number: n,
    estado: "POR_HACER",
    fecha_ejecucion: null,
    fecha_ejecucion_pendiente: null,
    fecha_fin: null,
    sector_raw: sector,
    descripcion,
    ...resto,
  };
}

/** Todos los días entre dos fechas, inclusive. */
function diasDe(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

describe("qué días mira cada corrida", () => {
  it("un día común mira ayer, y pasado mañana", () => {
    expect(diasQueCruzaron("2026-11-19")).toEqual(["2026-11-18"]);
    expect(diasQueArrancan("2026-11-19")).toEqual(["2026-11-21"]);
  });
  it("el sábado mira dos días hacia adelante, porque el domingo no corre", () => {
    expect(diasQueArrancan("2026-11-21")).toEqual(["2026-11-23", "2026-11-24"]);
    expect(diasQueCruzaron("2026-11-21")).toEqual(["2026-11-20"]);
  });
  it("el lunes cubre lo que cruzó el sábado y el domingo", () => {
    expect(diasQueCruzaron("2026-11-23")).toEqual(["2026-11-21", "2026-11-22"]);
    expect(diasQueArrancan("2026-11-23")).toEqual(["2026-11-25"]);
  });
  it("ningún día queda sin cubrir, ni hacia atrás ni hacia adelante", () => {
    // Las corridas de un mes: lunes a sábado, nunca domingo.
    const corridas = diasDe("2026-11-01", "2026-11-30").filter((d) => diaDeLaSemana(d) !== 0);
    const cruzados = new Set(corridas.flatMap(diasQueCruzaron));
    const arrancan = new Set(corridas.flatMap(diasQueArrancan));
    // Todo día del medio del mes es mirado por las dos puntas, exactamente una vez.
    for (const dia of diasDe("2026-11-05", "2026-11-25")) {
      expect(cruzados.has(dia)).toBe(true);
      expect(arrancan.has(dia)).toBe(true);
      expect(corridas.filter((c) => diasQueCruzaron(c).includes(dia))).toHaveLength(1);
      expect(corridas.filter((c) => diasQueArrancan(c).includes(dia))).toHaveLength(1);
    }
  });
});

describe("a quién nombra", () => {
  const HOY = "2026-11-19"; // jueves: mira el 18 hacia atrás y el 21 hacia adelante

  it("la que arrancaba ayer y sigue abierta", () => {
    const o = ot(1, "Hidratación", null, { fecha_ejecucion: "2026-11-18" });
    expect(lasQueSeAtrasaron([o], HOY)).toEqual([o]);
  });
  it("no nombra la que arrancó otro día, ni la de anteayer", () => {
    const anteayer = ot(2, null, null, { fecha_ejecucion: "2026-11-17" });
    const hoyMismo = ot(3, null, null, { fecha_ejecucion: "2026-11-19" });
    expect(lasQueSeAtrasaron([anteayer, hoyMismo], HOY)).toEqual([]);
  });
  it("no nombra la que sigue dentro de su ventana", () => {
    const enVentana = ot(4, null, null, { fecha_ejecucion: "2026-11-18", fecha_fin: "2026-11-25" });
    expect(lasQueSeAtrasaron([enVentana], HOY)).toEqual([]);
  });
  it("una ventana que terminó ayer o antes sí cuenta, si arrancó ayer", () => {
    // fecha_fin igual al inicio es «duró un día»: ya venció.
    const o = ot(5, null, null, { fecha_ejecucion: "2026-11-18", fecha_fin: "2026-11-18" });
    expect(lasQueSeAtrasaron([o], HOY)).toEqual([o]);
  });
  it("no nombra una realizada ni una cancelada", () => {
    const realizada = ot(6, null, null, { estado: "REALIZADO", fecha_ejecucion: "2026-11-18" });
    const cancelada = ot(7, null, null, { estado: "CANCELADA", fecha_ejecucion: "2026-11-18" });
    expect(lasQueSeAtrasaron([realizada, cancelada], HOY)).toEqual([]);
    const futuraRealizada = ot(8, null, null, { estado: "REALIZADO", fecha_ejecucion: "2026-11-21" });
    const futuraCancelada = ot(9, null, null, { estado: "CANCELADA", fecha_ejecucion: "2026-11-21" });
    expect(lasQueArrancan([futuraRealizada, futuraCancelada], HOY)).toEqual([]);
  });
  it("no nombra la que no tiene ninguna fecha", () => {
    const sinFecha = ot(10, null);
    expect(lasQueSeAtrasaron([sinFecha], HOY)).toEqual([]);
    expect(lasQueArrancan([sinFecha], HOY)).toEqual([]);
  });
  it("usa la pendiente y no la de la planilla", () => {
    // La planilla dice ayer, pero se postergó al 21: no se atrasó, arranca pasado mañana.
    const postergada = ot(11, null, null, {
      fecha_ejecucion: "2026-11-18",
      fecha_ejecucion_pendiente: "2026-11-21",
    });
    expect(lasQueSeAtrasaron([postergada], HOY)).toEqual([]);
    expect(lasQueArrancan([postergada], HOY)).toEqual([postergada]);
    // Al revés: la planilla dice el 21 pero la pendiente la dejó en ayer.
    const adelantada = ot(12, null, null, {
      fecha_ejecucion: "2026-11-21",
      fecha_ejecucion_pendiente: "2026-11-18",
    });
    expect(lasQueSeAtrasaron([adelantada], HOY)).toEqual([adelantada]);
    expect(lasQueArrancan([adelantada], HOY)).toEqual([]);
  });
  it("las que arrancan: la del día que toca y no la de otro", () => {
    const justa = ot(13, null, null, { fecha_ejecucion: "2026-11-21" });
    const manana = ot(14, null, null, { fecha_ejecucion: "2026-11-20" });
    const despues = ot(15, null, null, { fecha_ejecucion: "2026-11-22" });
    expect(lasQueArrancan([justa, manana, despues], HOY)).toEqual([justa]);
  });
  it("el sábado nombra las que arrancan el lunes y el martes", () => {
    const lunes = ot(16, null, null, { fecha_ejecucion: "2026-11-23" });
    const martes = ot(17, null, null, { fecha_ejecucion: "2026-11-24" });
    const miercoles = ot(18, null, null, { fecha_ejecucion: "2026-11-25" });
    expect(lasQueArrancan([lunes, martes, miercoles], "2026-11-21")).toEqual([lunes, martes]);
  });
});

describe("el texto", () => {
  it("null cuando no hay ninguna", () => {
    expect(textoDeLasAtrasadas([])).toBeNull();
    expect(textoDeLasQueArrancan([])).toBeNull();
  });
  it("con una sola la nombra entera", () => {
    expect(textoDeLasAtrasadas([ot(2926, "Planta filler 1", "Revisión sinfín de retorno")])).toEqual({
      title: "Se atrasó una orden de trabajo",
      body: "OT 2926 · Planta filler 1 — Revisión sinfín de retorno",
      url: "/mantenimiento/ordenes?atrasada=1",
    });
  });
  it("con una sola que arranca, lo dice y lleva al listado", () => {
    const a = textoDeLasQueArrancan([ot(2926, "Planta filler 1", "Revisión sinfín de retorno")]);
    expect(a?.title).toBe("Una orden de trabajo arranca en dos días");
    expect(a?.body).toBe("OT 2926 · Planta filler 1 — Revisión sinfín de retorno");
    expect(a?.url).toBe("/mantenimiento/ordenes");
  });
  it("con varias dice cuántas y nombra tres", () => {
    const a = textoDeLasQueArrancan([
      ot(3145, "Hidratación"),
      ot(3147, "Planta filler 1"),
      ot(2486, "Planta filler 1"),
      ot(2825, "Planta filler 1"),
      ot(3122, "Hidratación"),
    ]);
    expect(a?.title).toBe("5 órdenes de trabajo arrancan en dos días");
    expect(a?.body).toBe("OT 3145 (Hidratación), OT 3147 (Planta filler 1), OT 2486 (Planta filler 1) y 2 más");
  });
  it("varias atrasadas: el título dice que se atrasaron y lleva a las atrasadas", () => {
    const a = textoDeLasAtrasadas([ot(1, "A"), ot(2, "B")]);
    expect(a?.title).toBe("2 órdenes de trabajo se atrasaron");
    expect(a?.body).toBe("OT 1 (A) y OT 2 (B)");
    expect(a?.url).toBe("/mantenimiento/ordenes?atrasada=1");
  });
  it("recorta la descripción a 60 caracteres", () => {
    const larga = "x".repeat(80);
    const a = textoDeLasAtrasadas([ot(7, "Taller", larga)]);
    expect(a?.body).toBe(`OT 7 · Taller — ${"x".repeat(60)}…`);
    const justa = textoDeLasAtrasadas([ot(7, "Taller", "y".repeat(60))]);
    expect(justa?.body).toBe(`OT 7 · Taller — ${"y".repeat(60)}`);
  });
  it("aguanta el sector y la descripción vacíos", () => {
    expect(textoDeLasAtrasadas([ot(8, null, null)])?.body).toBe("OT 8");
    expect(textoDeLasAtrasadas([ot(8, "  ", "  ")])?.body).toBe("OT 8");
    expect(textoDeLasAtrasadas([ot(8, "Taller", null)])?.body).toBe("OT 8 · Taller");
    expect(textoDeLasAtrasadas([ot(8, null, "Cambio de correa")])?.body).toBe("OT 8 — Cambio de correa");
    expect(textoDeLasAtrasadas([ot(8, null), ot(9, "")])?.body).toBe("OT 8 y OT 9");
  });
});
