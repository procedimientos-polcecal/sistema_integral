import { describe, it, expect } from "vitest";
import {
  ultimosMeses, paradasExigidas, ventanasDeReparacion, nombreDelMes,
} from "./dashboard";

describe("ultimosMeses", () => {
  const meses = ultimosMeses(new Date(2026, 7, 25), 12);

  it("devuelve la cantidad pedida, terminando en el mes de hoy", () => {
    expect(meses).toHaveLength(12);
    expect(meses[11].etiqueta).toBe("Ago");
    expect(meses[11].desde).toBe("2026-08-01");
    expect(meses[11].hasta).toBe("2026-09-01");
  });

  it("cruza el fin de año hacia atrás", () => {
    expect(meses[0].desde).toBe("2025-09-01");
    expect(meses[0].etiqueta).toBe("Sep");
  });

  it("marca el año en enero, que es donde se nota el corte", () => {
    const enero = meses.find((m) => m.desde.endsWith("-01-01"))!;
    expect(enero.etiqueta).toBe("Ene '26");
  });

  it("cierra diciembre contra enero del año siguiente", () => {
    const [diciembre] = ultimosMeses(new Date(2026, 11, 5), 1);
    expect(diciembre.desde).toBe("2026-12-01");
    expect(diciembre.hasta).toBe("2027-01-01");
  });
});

describe("paradasExigidas", () => {
  const HOY = "2026-11-19";

  it("junta los sectores con una OT pendiente que obliga a parar", () => {
    const paradas = paradasExigidas([
      { sector_id: "a", requiere_parada_sector: true, ot_number: 10 },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 11 },
      { sector_id: "b", requiere_parada_sector: false, ot_number: 12 },
      { sector_id: "c", requiere_parada_sector: null, ot_number: 13 },
    ], HOY);
    expect(Object.keys(paradas)).toEqual(["a"]);
    expect(paradas.a).toHaveLength(2);
  });

  it("devuelve cuáles son, y no sólo cuántas", () => {
    const paradas = paradasExigidas([
      {
        sector_id: "a", requiere_parada_sector: true, ot_number: 2822,
        estado: "EN_PROCESO", descripcion: "Rellenar espira de sin fin",
        equipo_raw: "Sin fin 1",
      },
    ], HOY);
    expect(paradas.a[0]).toEqual({
      ot_number: 2822,
      estado: "EN_PROCESO",
      descripcion: "Rellenar espira de sin fin",
      equipo_raw: "Sin fin 1",
      atrasada: false,
    });
  });

  it("pone primero la atrasada, y dentro de un estado la más vieja", () => {
    const paradas = paradasExigidas([
      { sector_id: "a", requiere_parada_sector: true, ot_number: 300, estado: "POR_HACER" },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 100, estado: "POR_HACER" },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 500, estado: "ATRASADO" },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 200, estado: "EN_PROCESO" },
    ], HOY);
    expect(paradas.a.map((o) => o.ot_number)).toEqual([500, 200, 100, 300]);
  });

  it("una vencida por fecha cuenta como atrasada aunque la planilla no la marque", () => {
    const paradas = paradasExigidas([
      { sector_id: "a", requiere_parada_sector: true, ot_number: 1, estado: "POR_HACER" },
      {
        sector_id: "a", requiere_parada_sector: true, ot_number: 2, estado: "POR_HACER",
        fecha_ejecucion: "2026-11-10",
      },
    ], HOY);
    expect(paradas.a.map((o) => [o.ot_number, o.atrasada])).toEqual([[2, true], [1, false]]);
  });

  it("una POR_HACER vencida por fecha y una marcada ATRASADO: las dos son atrasadas y desempata el número", () => {
    const paradas = paradasExigidas([
      { sector_id: "a", requiere_parada_sector: true, ot_number: 9, estado: "EN_PROCESO" },
      {
        sector_id: "a", requiere_parada_sector: true, ot_number: 8, estado: "POR_HACER",
        fecha_ejecucion: "2026-11-10",
      },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 7, estado: "ATRASADO" },
    ], HOY);
    // Las dos atrasadas van antes que la EN_PROCESO, y entre ellas manda el número.
    expect(paradas.a.map((o) => [o.ot_number, o.atrasada])).toEqual([[7, true], [8, true], [9, false]]);
  });

  it("un estado que no conoce va al final y no rompe el orden", () => {
    const paradas = paradasExigidas([
      { sector_id: "a", requiere_parada_sector: true, ot_number: 1, estado: "INVENTADO" },
      { sector_id: "a", requiere_parada_sector: true, ot_number: 2, estado: "ATRASADO" },
    ], HOY);
    expect(paradas.a.map((o) => o.ot_number)).toEqual([2, 1]);
  });

  it("sin ninguna que lo exija, no hay sectores", () => {
    expect(paradasExigidas([{ sector_id: "a", requiere_parada_sector: false }], HOY)).toEqual({});
  });
});

describe("ventanasDeReparacion", () => {
  const sectores = [
    { id: "s1", empresa: "POLCECAL" },
    { id: "s2", empresa: "POLCECAL" },
    { id: "s3", empresa: "POLYSAN" },
  ];

  const libre = Array(7).fill("LIBRE");
  const produce = ["EN_PRODUCCION", "EN_PRODUCCION", "EN_PRODUCCION", "EN_PRODUCCION", "EN_PRODUCCION", "LIBRE", "LIBRE"];

  it("encuentra los días en que ningún sector de la empresa produce", () => {
    const ventanas = ventanasDeReparacion(
      sectores,
      [{ sector_id: "s1", days: produce }, { sector_id: "s2", days: produce }],
      []
    );
    expect(ventanas).toHaveLength(1);
    expect(ventanas[0].empresa).toBe("POLCECAL");
    expect(ventanas[0].dias).toEqual(["Sáb", "Dom"]);
  });

  it("no cuenta una empresa donde un sector produce ese día", () => {
    const ventanas = ventanasDeReparacion(
      sectores,
      [{ sector_id: "s1", days: produce }, { sector_id: "s2", days: Array(7).fill("EN_PRODUCCION") }],
      []
    );
    expect(ventanas).toHaveLength(0);
  });

  it("ignora las empresas sin plan cargado", () => {
    // Sin plan todo parece libre, y eso sería anunciar una ventana que nadie
    // planificó.
    const ventanas = ventanasDeReparacion(sectores, [{ sector_id: "s1", days: libre }], []);
    expect(ventanas.map((v) => v.empresa)).toEqual(["POLCECAL"]);
  });

  it("dice cuánto hay pendiente para aprovechar la ventana", () => {
    const ventanas = ventanasDeReparacion(
      sectores,
      [{ sector_id: "s1", days: produce }, { sector_id: "s2", days: produce }],
      [
        { sector_id: "s1", requiere_parada_sector: false },
        { sector_id: "s2", requiere_parada_sector: true },
        { sector_id: "s3", requiere_parada_sector: false },
      ]
    );
    expect(ventanas[0].pendientes).toBe(2);
    expect(ventanas[0].aParar).toBe(1);
  });

  it("no devuelve una ventana sin ningún día libre", () => {
    const ventanas = ventanasDeReparacion(
      sectores,
      [{ sector_id: "s1", days: Array(7).fill("EN_PRODUCCION") }],
      []
    );
    expect(ventanas).toHaveLength(0);
  });
});

describe("nombreDelMes", () => {
  it("da el mes escrito entero, para el título del indicador", () => {
    expect(nombreDelMes(new Date(2026, 7, 25))).toBe("Agosto");
    expect(nombreDelMes(new Date(2026, 0, 1))).toBe("Enero");
    expect(nombreDelMes(new Date(2026, 11, 31))).toBe("Diciembre");
  });

  it("no depende del locale del servidor", () => {
    // `toLocaleDateString` en un servidor sin locale español devuelve
    // "August", y el indicador diría "OT generadas en August".
    expect(nombreDelMes(new Date(2026, 2, 10))).toBe("Marzo");
  });
});
