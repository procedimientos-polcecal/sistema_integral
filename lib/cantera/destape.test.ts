import { describe, expect, it } from "vitest";
import {
  costoDeRegistro,
  resolverFleteroDestape,
  resolverOperarioDestape,
  resumenPorYacimiento,
  toneladasPromedioPorFletero,
  type EmpleadoLiviano,
  type FleteroLiviano,
  type RegistroDestape,
} from "./destape";
import type { TarifaAcarreo } from "./acarreo";

// La tarifa "horas_destape" real de Acarreo (vigencia jul-ago 2026, relevada
// en vivo) — es la ÚNICA que hace falta: "Camión grande" no es una tarifa
// aparte, es esta misma × 2 (verificado exacto contra la planilla real en
// las 4 vigencias que tiene cargadas).
const TARIFAS_ACARREO: TarifaAcarreo[] = [
  { tipo: "horas_destape", desde: "2026-07-01", hasta: null, tarifa: 27817.75 },
];

// Promedio de toneladas por viaje, medido sobre el historial real de Acarreo de cada fletero.
const TONELADAS_PROMEDIO: Record<string, number> = { amaray: 16, schneider: 44 };
const COSTO_HORA_MAQUINA: Record<string, number> = { EM3: 15000 };

describe("costoDeRegistro — verificado contra la planilla real de agosto 2026", () => {
  it("Orsatti, Camión grande, 8 h → $445.084 (8 × $27.817,75 × 2)", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "fletero_externo",
      equipoCodigo: null, operarioValorHora: null, fleteroId: "orsatti", tipoCamion: "camion_grande",
      horas: 8, viajes: 16,
    };
    const c = costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA);
    expect(c.costoFletero).toBeCloseTo(445084, 0);
    expect(c.costoTotal).toBeCloseTo(445084, 0);
    // Orsatti no tiene ninguna pesada real resuelta en el fixture — sin promedio, toneladas da null, no se inventa.
    expect(c.toneladasEstimadas).toBeNull();
  });

  it("camión grande cobra el doble que camión chico, misma tarifa base, mismas horas", () => {
    const chico = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, operarioValorHora: null, fleteroId: "amaray", tipoCamion: "camion_chico", horas: 8, viajes: null },
      TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA
    );
    const grande = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, operarioValorHora: null, fleteroId: "orsatti", tipoCamion: "camion_grande", horas: 8, viajes: null },
      TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA
    );
    expect(chico.costoFletero).toBeCloseTo(8 * 27817.75, 6);
    expect(grande.costoFletero).toBeCloseTo(chico.costoFletero * 2, 6);
  });

  it("Schneider, mismo camión y horas que Orsatti → el MISMO costo (la tarifa es por tipo de camión, no por fletero)", () => {
    const orsatti = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, operarioValorHora: null, fleteroId: "orsatti", tipoCamion: "camion_grande", horas: 8, viajes: 16 },
      TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA
    );
    const schneider = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, operarioValorHora: null, fleteroId: "schneider", tipoCamion: "camion_grande", horas: 8, viajes: 12 },
      TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA
    );
    expect(schneider.costoFletero).toBeCloseTo(orsatti.costoFletero, 6);
  });

  it("Amaray, Camión chico, 28 viajes → 448 t (28 × 16 t/viaje promedio)", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-16", tipoRecurso: "fletero_externo",
      equipoCodigo: null, operarioValorHora: null, fleteroId: "amaray", tipoCamion: "camion_chico",
      horas: 8, viajes: 28,
    };
    const c = costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA);
    expect(c.toneladasEstimadas).toBe(448);
  });

  it("sin tarifa 'horas_destape' vigente ese mes, costo fletero da 0 — no se inventa", () => {
    const r: RegistroDestape = {
      fecha: "2026-01-15", tipoRecurso: "fletero_externo",
      equipoCodigo: null, operarioValorHora: null, fleteroId: "amaray", tipoCamion: "camion_chico",
      horas: 8, viajes: null,
    };
    expect(costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA).costoFletero).toBe(0);
  });

  it("operario propio: costo máquina = horas × $/h del equipo ese mes, costo MO = horas × valor_hora_normal del operario", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "operario_propio",
      equipoCodigo: "EM3", operarioValorHora: 5000, fleteroId: null, tipoCamion: null,
      horas: 8, viajes: null,
    };
    const c = costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA);
    expect(c.costoMaquina).toBe(8 * 15000);
    expect(c.costoMo).toBe(8 * 5000);
    expect(c.toneladasEstimadas).toBeNull();
  });

  it("operario propio con equipo sin costo/hora calculado ese mes da costo máquina 0, no un error", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "operario_propio",
      equipoCodigo: "EM9", operarioValorHora: null, fleteroId: null, tipoCamion: null,
      horas: 8, viajes: null,
    };
    const c = costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA);
    expect(c.costoMaquina).toBe(0);
    expect(c.costoMo).toBe(0);
  });

  it("sin viajes cargados, toneladas da null — no es lo mismo que 0 viajes", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "fletero_externo",
      equipoCodigo: null, operarioValorHora: null, fleteroId: "amaray", tipoCamion: "camion_chico",
      horas: 8, viajes: null,
    };
    expect(costoDeRegistro(r, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA).toneladasEstimadas).toBeNull();
  });
});

describe("toneladasPromedioPorFletero", () => {
  it("promedia las toneladas de cada fletero sobre todas sus pesadas, sin filtrar por material", () => {
    const pesadas = [
      { fleteroId: "amaray", toneladas: 20 },
      { fleteroId: "amaray", toneladas: 12 },
      { fleteroId: "schneider", toneladas: 44 },
    ];
    const r = toneladasPromedioPorFletero(pesadas);
    expect(r.amaray).toBe(16);
    expect(r.schneider).toBe(44);
  });

  it("una pesada sin fletero resuelto no entra en ningún promedio", () => {
    const r = toneladasPromedioPorFletero([{ fleteroId: null, toneladas: 30 }]);
    expect(r).toEqual({});
  });

  it("un fletero sin ninguna pesada no aparece en el resultado — no se inventa un 0", () => {
    const r = toneladasPromedioPorFletero([{ fleteroId: "amaray", toneladas: 10 }]);
    expect(r.orsatti).toBeUndefined();
  });
});

describe("resolverFleteroDestape — con los 11 fleteros reales de Cantera", () => {
  const FLETEROS: FleteroLiviano[] = [
    { id: "amaray", nombre: "Amaray" }, { id: "arenzo", nombre: "Arenzo" },
    { id: "dumerauf1", nombre: "Dumerauf 1" }, { id: "dumerauf2", nombre: "Dumerauf 2" },
    { id: "luna", nombre: "Luna" }, { id: "maneri", nombre: "Maneri" },
    { id: "orsatti1", nombre: "Orsatti 1" }, { id: "orsatti2", nombre: "Orsatti 2" },
    { id: "priola", nombre: "Priola" }, { id: "schneider", nombre: "Schneider" }, { id: "timpanaro", nombre: "Timpanaro" },
  ];

  it("resuelve un nombre que no repite", () => {
    expect(resolverFleteroDestape("Amaray", FLETEROS)).toBe("amaray");
    expect(resolverFleteroDestape("Schneider", FLETEROS)).toBe("schneider");
  });

  it("'Orsatti' sin número es ambiguo entre Orsatti 1 y 2 — queda sin resolver", () => {
    expect(resolverFleteroDestape("Orsatti", FLETEROS)).toBeNull();
    expect(resolverFleteroDestape("Dumerauf", FLETEROS)).toBeNull();
  });

  it("vacío da null", () => {
    expect(resolverFleteroDestape("", FLETEROS)).toBeNull();
  });
});

describe("resolverOperarioDestape — con los Becker/Farias reales", () => {
  const EMPLEADOS: EmpleadoLiviano[] = [
    { id: "marcelo", nombre: "MARCELO BALTAZAR", apellido: "BECKER" },
    { id: "jorge", nombre: "JORGE ENRIQUE", apellido: "BECKER" },
    { id: "miqueas", nombre: "MIQUEAS ANDRES", apellido: "BECKER" },
    { id: "alberto", nombre: "ALBERTO MARTIN", apellido: "FARIAS" },
  ];

  it("'Jorge Becker' desambigua entre 3 Becker por el nombre de pila", () => {
    expect(resolverOperarioDestape("Jorge Becker", EMPLEADOS)).toBe("jorge");
  });

  it("'Martín Farias' resuelve directo: un solo Farias", () => {
    expect(resolverOperarioDestape("Martín Farias", EMPLEADOS)).toBe("alberto");
  });

  it("sólo el apellido, sin ningún Becker que combine con ese nombre, queda sin resolver", () => {
    expect(resolverOperarioDestape("Roberto Becker", EMPLEADOS)).toBeNull();
  });

  it("apellido que no existe da null", () => {
    expect(resolverOperarioDestape("Juan Perez", EMPLEADOS)).toBeNull();
  });
});

describe("resumenPorYacimiento", () => {
  it("suma horas y costos por yacimiento, agrupa sin yacimiento aparte", () => {
    const registros = [
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo" as const, equipoCodigo: null, operarioValorHora: null, fleteroId: "orsatti", tipoCamion: "camion_grande" as const, horas: 8, viajes: 16, yacimientoCodigo: "D1" },
      { fecha: "2026-08-15", tipoRecurso: "operario_propio" as const, equipoCodigo: "EM3", operarioValorHora: 5000, fleteroId: null, tipoCamion: null, horas: 8, viajes: null, yacimientoCodigo: "D1" },
      { fecha: "2026-08-16", tipoRecurso: "fletero_externo" as const, equipoCodigo: null, operarioValorHora: null, fleteroId: "amaray", tipoCamion: "camion_chico" as const, horas: 8, viajes: 28, yacimientoCodigo: null },
    ];
    const r = resumenPorYacimiento(registros, TARIFAS_ACARREO, TONELADAS_PROMEDIO, COSTO_HORA_MAQUINA);
    const d1 = r.find((f) => f.yacimientoCodigo === "D1")!;
    expect(d1.horasOperario).toBe(8);
    expect(d1.horasFletero).toBe(8);
    expect(d1.costoMaquina).toBe(8 * 15000);
    expect(d1.costoMo).toBe(8 * 5000);
    expect(d1.costoTotal).toBeCloseTo(445084 + 8 * 15000 + 8 * 5000, 0);

    const sinYacimiento = r.find((f) => f.yacimientoCodigo === "(sin yacimiento)")!;
    expect(sinYacimiento.horasFletero).toBe(8);
  });
});
