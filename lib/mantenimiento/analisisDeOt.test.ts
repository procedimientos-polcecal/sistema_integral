import { describe, expect, it } from "vitest";
import {
  analizarLaSemana,
  lasQueNecesitanReprogramarse,
  type OrdenParaAnalisis,
} from "./analisisDeOt";

/**
 * El fixture vive acá y NO sale de producción.
 *
 * Los números de la semana 45 del spec —55/45/10/47/9 el 18/11 y 61/51/10/53/9
 * el 19/11— son muestra de forma: la planilla sigue recibiendo cierres de
 * semanas pasadas, así que un test que los afirmara nacería en rojo. Lo que se
 * reproduce acá es la **forma**: una semana con órdenes que arrancan dentro,
 * otras que cierran dentro habiendo arrancado antes, las tres maneras de no
 * cerrar en la propia semana, y los dos casos raros que existen de verdad —una
 * que cerró antes de arrancar, y una `REALIZADO` sin fecha de cierre—.
 */

function orden(o: Partial<OrdenParaAnalisis> & { ot_number: number }): OrdenParaAnalisis {
  return {
    id: `ot-${o.ot_number}`,
    sector_raw: "Planta filler 1",
    equipo_raw: "PY-A1-08 – Molino de bolas",
    tipo: "PROGRAMADO",
    descripcion: "Revisión",
    fecha_ejecucion: null,
    fecha_cierre: null,
    estado: "REALIZADO",
    app_created: false,
    reprogramada_veces: 0,
    ...o,
  };
}

/** Semana 45 de 2026: lunes 02/11 a domingo 08/11. */
const LUNES = "2026-11-02";
const DOMINGO = "2026-11-08";

const ORDENES: OrdenParaAnalisis[] = [
  // ── Con inicio en la semana y cierre dentro de la semana (5) ──────────────
  orden({ ot_number: 2390, tipo: "CORRECTIVO", fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-02" }),
  orden({ ot_number: 2838, fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-02" }),
  orden({ ot_number: 2936, fecha_ejecucion: "2026-11-03", fecha_cierre: "2026-11-04" }),
  orden({ ot_number: 2952, tipo: "MEJORA", fecha_ejecucion: "2026-11-06", fecha_cierre: "2026-11-06" }),
  orden({ ot_number: 2965, fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-02" }),

  // ── Con inicio en la semana que NO cerraron dentro (5) ────────────────────
  // Sigue abierta y además lo dice con el valor ATRASADO, que no se mira.
  orden({ ot_number: 2969, fecha_ejecucion: "2026-11-06", estado: "ATRASADO" }),
  // Sigue abierta y es CORRECTIVA: prueba que la lista no filtra por tipo.
  orden({ ot_number: 2990, tipo: "CORRECTIVO", fecha_ejecucion: "2026-11-04", estado: "EN_PROCESO" }),
  // Cerró después del domingo.
  orden({ ot_number: 2832, fecha_ejecucion: "2026-11-03", fecha_cierre: "2026-11-09" }),
  // Cerrada sin fecha de cierre: existen 220 así. No consta que cerrara en su
  // semana, así que cae del lado de las que cerraron fuera de fecha.
  orden({ ot_number: 3021, tipo: "CORRECTIVO", fecha_ejecucion: "2026-11-03", fecha_cierre: null }),
  // Cerró ANTES de su propia fecha de inicio.
  orden({ ot_number: 2931, fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-10-30" }),

  // ── Cerraron en la semana habiendo arrancado antes (2) ────────────────────
  orden({ ot_number: 2800, tipo: "CORRECTIVO", fecha_ejecucion: "2026-10-28", fecha_cierre: "2026-11-05" }),
  orden({ ot_number: 2801, fecha_ejecucion: "2026-10-30", fecha_cierre: "2026-11-07" }),

  // ── Nada que ver con la semana 45 ─────────────────────────────────────────
  orden({ ot_number: 2700, fecha_ejecucion: "2026-10-20", fecha_cierre: "2026-10-21" }),
  orden({ ot_number: 2555, fecha_ejecucion: "2026-09-01", estado: "CANCELADA" }),
  orden({ ot_number: 3100, fecha_ejecucion: "2026-11-12", estado: "POR_HACER" }),
  orden({ ot_number: 2600, fecha_ejecucion: "2026-10-15", estado: "EN_PROCESO", app_created: true }),
  orden({ ot_number: 3050, fecha_ejecucion: null, estado: "POR_HACER" }),
  // Abierta y dice ATRASADO, pero su fecha de inicio todavía no llegó.
  orden({ ot_number: 3200, fecha_ejecucion: "2026-11-25", estado: "ATRASADO" }),
];

const numeros = (os: readonly OrdenParaAnalisis[]) => os.map((o) => o.ot_number);

describe("analizarLaSemana", () => {
  const a = analizarLaSemana(ORDENES, "2026-11-04");

  it("cuenta con inicio en la semana sin filtrar por tipo", () => {
    expect(a.lunes).toBe(LUNES);
    expect(a.domingo).toBe(DOMINGO);
    // Las diez con fecha de inicio entre el lunes y el domingo, de todo tipo:
    // ocho PROGRAMADO, dos CORRECTIVO y una MEJORA.
    expect(a.conInicio).toBe(10);
    expect(numeros(a.listas.conInicio)).toEqual([
      2390, 2832, 2838, 2931, 2936, 2952, 2965, 2969, 2990, 3021,
    ]);
  });

  it("cuenta las que además cerraron dentro de la misma semana", () => {
    expect(a.cerradasDentro).toBe(5);
  });

  it("el cumplimiento es la división de las dos", () => {
    expect(a.cumplimiento).toBe(0.5);
  });

  it("el cumplimiento es null si no hay ninguna con inicio", () => {
    const vacia = analizarLaSemana(ORDENES, "2026-12-14");
    expect(vacia.conInicio).toBe(0);
    expect(vacia.cumplimiento).toBeNull();
    expect(vacia.noCerraron).toBe(0);
    expect(vacia.diagnostico).toBe("No se cerró ninguna OT en la semana.");
  });

  it("cuenta las cerradas en la semana aunque hayan empezado antes", () => {
    expect(a.cerradasEnLaSemana).toBe(7);
    expect(numeros(a.listas.cerradasEnLaSemana)).toEqual([
      2390, 2800, 2801, 2838, 2936, 2952, 2965,
    ]);
  });

  it("las correctivas cerradas salen de las cerradas en la semana", () => {
    // La 3021 es CORRECTIVO y está cerrada, pero no cerró en esta semana.
    expect(a.correctivasCerradas).toBe(2);
  });

  it("el cuadro por tipo suma 100% y manda lo que no es programado ni correctivo a 'Otros'", () => {
    expect(a.porTipo).toEqual([
      { tipo: "PROGRAMADO", cantidad: 4, porcentaje: 57.1 },
      { tipo: "CORRECTIVO", cantidad: 2, porcentaje: 28.6 },
      { tipo: "Otros", cantidad: 1, porcentaje: 14.3 },
    ]);
    const suma = a.porTipo.reduce((t, f) => t + f.porcentaje, 0);
    expect(suma).toBeCloseTo(100, 6);
    expect(a.porTipo.reduce((t, f) => t + f.cantidad, 0)).toBe(a.cerradasEnLaSemana);
  });

  it("el diagnóstico es la frase de una línea de la hoja", () => {
    expect(a.diagnostico).toBe(
      "Balance positivo: predominó la ejecución programada (4 OT) sobre los imprevistos (2).",
    );
    const masCorrectivas = analizarLaSemana(
      [
        orden({ ot_number: 1, tipo: "CORRECTIVO", fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-02" }),
        orden({ ot_number: 2, tipo: "CORRECTIVO", fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-03" }),
        orden({ ot_number: 3, fecha_ejecucion: "2026-11-02", fecha_cierre: "2026-11-03" }),
      ],
      LUNES,
    );
    expect(masCorrectivas.diagnostico).toBe(
      "Alta carga correctiva (2 OT contra 1 programadas): redujo la capacidad de cumplir lo planificado.",
    );
  });

  it("abre las que no cerraron en siguen abiertas / cerraron después / cerraron antes", () => {
    expect(a.noCerraron).toBe(5);
    expect(a.lasDiez).toEqual({
      siguenAbiertas: 2,
      cerraronDespues: 2,
      cerraronAntes: 1,
      sinFechaDeCierre: 1,
    });
  });

  it("las tres partes suman exactamente las que no cerraron", () => {
    const { siguenAbiertas, cerraronDespues, cerraronAntes } = a.lasDiez;
    expect(siguenAbiertas + cerraronDespues + cerraronAntes).toBe(a.noCerraron);
    expect(a.noCerraron).toBe(a.conInicio - a.cerradasDentro);
  });

  it("dice cuántas de las que cerraron después están ahí sin que conste cuándo", () => {
    // La 3021 es la única `REALIZADO` sin fecha de cierre, y está adentro de
    // las 2 de «cerraron después»: es un subconjunto, no una cuarta parte.
    expect(a.lasDiez.sinFechaDeCierre).toBe(1);
    expect(a.lasDiez.sinFechaDeCierre).toBeLessThanOrEqual(a.lasDiez.cerraronDespues);
    expect(numeros(a.listas.cerradasFueraDeFecha)).toContain(3021);
  });

  it("sin ninguna cerrada sin fecha, ese número es cero y el desglose no cambia", () => {
    const todasConFecha = ORDENES.map((o) =>
      o.ot_number === 3021 ? { ...o, fecha_cierre: "2026-11-10" } : o,
    );
    const b = analizarLaSemana(todasConFecha, LUNES);
    expect(b.lasDiez).toEqual({
      siguenAbiertas: 2,
      cerraronDespues: 2,
      cerraronAntes: 1,
      sinFechaDeCierre: 0,
    });
    expect(b.noCerraron).toBe(a.noCerraron);
  });

  it("una cerrada antes de su fecha de inicio cuenta en 'cerraron antes' y NO en 'fuera de fecha'", () => {
    // La 2931 arrancó el 02/11 y cerró el 30/10.
    expect(numeros(a.listas.cerradasFueraDeFecha)).not.toContain(2931);
    expect(numeros(a.listas.cerradasFueraDeFecha)).toEqual([2832, 3021]);
    expect(a.lasDiez.cerraronAntes).toBe(1);
  });

  it("las listas no filtran por tipo ni por estado", () => {
    // «Sin cerrar» trae una CORRECTIVA y un estado que no es ATRASADO.
    expect(numeros(a.listas.sinCerrar)).toEqual([2969, 2990]);
    expect(a.listas.sinCerrar.map((o) => o.tipo)).toContain("CORRECTIVO");
    // «Cerradas fuera de fecha» trae una CORRECTIVA, que la hoja dejaba afuera.
    expect(a.listas.cerradasFueraDeFecha.map((o) => o.tipo)).toContain("CORRECTIVO");
    // Y «con inicio en la semana» trae abiertas y cerradas juntas.
    expect(a.listas.conInicio.map((o) => o.estado)).toContain("ATRASADO");
    expect(a.listas.conInicio.map((o) => o.estado)).toContain("REALIZADO");
  });

  it("la semana es de lunes a domingo tome el día que tome", () => {
    const porElLunes = analizarLaSemana(ORDENES, LUNES);
    const porElDomingo = analizarLaSemana(ORDENES, DOMINGO);
    for (const otro of [porElLunes, porElDomingo]) {
      expect(otro.lunes).toBe(LUNES);
      expect(otro.domingo).toBe(DOMINGO);
      expect(otro.conInicio).toBe(a.conInicio);
      expect(otro.cerradasEnLaSemana).toBe(a.cerradasEnLaSemana);
    }
  });
});

describe("lasQueNecesitanReprogramarse", () => {
  const HOY = "2026-11-19";
  const vencidas = lasQueNecesitanReprogramarse(ORDENES, HOY);

  it("son las abiertas con la fecha de inicio anterior a hoy", () => {
    expect(numeros(vencidas)).toEqual([2600, 2990, 2969, 3100]);
  });

  it("NO mira el valor ATRASADO del estado", () => {
    // La 3200 dice ATRASADO y su fecha de inicio todavía no llegó.
    expect(numeros(vencidas)).not.toContain(3200);
    // Y la 2600 no lo dice —está EN_PROCESO— y sí está vencida.
    expect(numeros(vencidas)).toContain(2600);
  });

  it("deja afuera REALIZADO y CANCELADA", () => {
    // La 2931 está REALIZADO con fecha vieja; la 2555, CANCELADA desde septiembre.
    expect(numeros(vencidas)).not.toContain(2931);
    expect(numeros(vencidas)).not.toContain(2555);
  });

  it("deja afuera las que no tienen fecha de inicio", () => {
    expect(numeros(vencidas)).not.toContain(3050);
  });

  it("ordena por días vencida, la más vieja primero", () => {
    const fechas = vencidas.map((o) => o.fecha_ejecucion);
    expect(fechas).toEqual(["2026-10-15", "2026-11-04", "2026-11-06", "2026-11-12"]);
  });

  it("una fecha de inicio que es hoy todavía no está vencida", () => {
    const hoyMismo = lasQueNecesitanReprogramarse(ORDENES, "2026-11-12");
    expect(numeros(hoyMismo)).not.toContain(3100);
  });
});
