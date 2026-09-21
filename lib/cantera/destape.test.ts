import { describe, expect, it } from "vitest";
import {
  capacidadDe,
  costoDeRegistro,
  resolverFleteroDestape,
  resolverOperarioDestape,
  resumenPorYacimiento,
  tarifaVigenteDestape,
  type CapacidadFletero,
  type EmpleadoLiviano,
  type FleteroLiviano,
  type RegistroDestape,
  type TarifaDestape,
} from "./destape";

// Tarifas reales de agosto 2026 (vigencia jul-ago), relevadas en vivo.
const TARIFAS: TarifaDestape[] = [
  { categoria: "fletero_externo", clave: "camion_grande", desde: "2026-07-01", hasta: null, tarifa: 55635.5 },
  { categoria: "fletero_externo", clave: "camion_chico", desde: "2026-07-01", hasta: null, tarifa: 27817.75 },
  { categoria: "maquina_propia", clave: "EM3", desde: "2026-05-01", hasta: "2026-05-31", tarifa: 3871845.26 },
];

const CAPACIDADES: CapacidadFletero[] = [
  { fleteroId: "orsatti", tipoCamion: "camion_grande", toneladasPorViaje: 0 },
  { fleteroId: "amaray", tipoCamion: "camion_chico", toneladasPorViaje: 16 },
  { fleteroId: "schneider", tipoCamion: "camion_grande", toneladasPorViaje: 44 },
];

describe("tarifaVigenteDestape", () => {
  it("resuelve la tarifa vigente en la fecha pedida", () => {
    expect(tarifaVigenteDestape(TARIFAS, "fletero_externo", "camion_grande", "2026-08-15")).toBe(55635.5);
  });

  it("null si no hay ninguna tarifa cargada para esa categoría+clave — no inventa un costo", () => {
    expect(tarifaVigenteDestape(TARIFAS, "mo_propia", "general", "2026-08-15")).toBeNull();
  });

  it("null fuera de la vigencia (una tarifa vieja que ya terminó)", () => {
    expect(tarifaVigenteDestape(TARIFAS, "maquina_propia", "EM3", "2026-08-01")).toBeNull();
  });
});

describe("costoDeRegistro — verificado contra la planilla real de agosto 2026", () => {
  it("Orsatti, Camión grande, 8 h → $445.084 (8 × $55.635,50)", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "fletero_externo",
      equipoCodigo: null, fleteroId: "orsatti", tipoCamion: "camion_grande",
      horas: 8, viajes: 16,
    };
    const c = costoDeRegistro(r, TARIFAS, CAPACIDADES);
    expect(c.costoFletero).toBeCloseTo(445084, 0);
    expect(c.costoTotal).toBeCloseTo(445084, 0);
    // Orsatti tiene capacidad 0 relevada para Camión grande — toneladas da 0, no se inventa.
    expect(c.toneladasEstimadas).toBe(0);
  });

  it("Schneider, mismo camión y horas que Orsatti → el MISMO costo (la tarifa es por tipo de camión, no por fletero)", () => {
    const orsatti = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, fleteroId: "orsatti", tipoCamion: "camion_grande", horas: 8, viajes: 16 },
      TARIFAS, CAPACIDADES
    );
    const schneider = costoDeRegistro(
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo", equipoCodigo: null, fleteroId: "schneider", tipoCamion: "camion_grande", horas: 8, viajes: 12 },
      TARIFAS, CAPACIDADES
    );
    expect(schneider.costoFletero).toBeCloseTo(orsatti.costoFletero, 6);
  });

  it("Amaray, Camión chico, 28 viajes → 448 t (28 × 16 t/viaje)", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-16", tipoRecurso: "fletero_externo",
      equipoCodigo: null, fleteroId: "amaray", tipoCamion: "camion_chico",
      horas: 8, viajes: 28,
    };
    const c = costoDeRegistro(r, TARIFAS, CAPACIDADES);
    expect(c.toneladasEstimadas).toBe(448);
  });

  it("operario propio con máquina sin tarifa vigente ese mes (agosto) da costo 0, no un error", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "operario_propio",
      equipoCodigo: "EM3", fleteroId: null, tipoCamion: null,
      horas: 8, viajes: null,
    };
    const c = costoDeRegistro(r, TARIFAS, CAPACIDADES);
    expect(c.costoMaquina).toBe(0);
    expect(c.costoMo).toBe(0);
    expect(c.toneladasEstimadas).toBeNull();
  });

  it("sin viajes cargados, toneladas da null — no es lo mismo que 0 viajes", () => {
    const r: RegistroDestape = {
      fecha: "2026-08-15", tipoRecurso: "fletero_externo",
      equipoCodigo: null, fleteroId: "amaray", tipoCamion: "camion_chico",
      horas: 8, viajes: null,
    };
    expect(costoDeRegistro(r, TARIFAS, CAPACIDADES).toneladasEstimadas).toBeNull();
  });
});

describe("capacidadDe", () => {
  it("0 sin fletero o tipo de camión", () => {
    expect(capacidadDe(CAPACIDADES, null, "camion_chico")).toBe(0);
    expect(capacidadDe(CAPACIDADES, "amaray", null)).toBe(0);
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
      { fecha: "2026-08-15", tipoRecurso: "fletero_externo" as const, equipoCodigo: null, fleteroId: "orsatti", tipoCamion: "camion_grande" as const, horas: 8, viajes: 16, yacimientoCodigo: "D1" },
      { fecha: "2026-08-15", tipoRecurso: "operario_propio" as const, equipoCodigo: "EM3", fleteroId: null, tipoCamion: null, horas: 8, viajes: null, yacimientoCodigo: "D1" },
      { fecha: "2026-08-16", tipoRecurso: "fletero_externo" as const, equipoCodigo: null, fleteroId: "amaray", tipoCamion: "camion_chico" as const, horas: 8, viajes: 28, yacimientoCodigo: null },
    ];
    const r = resumenPorYacimiento(registros, TARIFAS, CAPACIDADES);
    const d1 = r.find((f) => f.yacimientoCodigo === "D1")!;
    expect(d1.horasOperario).toBe(8);
    expect(d1.horasFletero).toBe(8);
    expect(d1.costoTotal).toBeCloseTo(445084, 0);

    const sinYacimiento = r.find((f) => f.yacimientoCodigo === "(sin yacimiento)")!;
    expect(sinYacimiento.horasFletero).toBe(8);
  });
});
