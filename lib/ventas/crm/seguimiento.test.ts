import { describe, it, expect } from "vitest";
import {
  DIAS_AL_DIA,
  DIAS_A_DESTIEMPO,
  clasificarProximoPaso,
  estadoDeSeguimiento,
  pasosPendientes,
  resumirPasos,
  ultimaActividadPorCliente,
} from "./seguimiento";

const HOY = "2026-11-12";

describe("estadoDeSeguimiento", () => {
  it("lo de hoy y lo de esta semana está al día", () => {
    expect(estadoDeSeguimiento(HOY, HOY)).toBe("al_dia");
    expect(estadoDeSeguimiento("2026-11-05", HOY)).toBe("al_dia");
  });

  // Los dos bordes exactos, que es donde un `>` por un `>=` no se nota nunca.
  it("el día del corte todavía está del lado bueno", () => {
    expect(DIAS_AL_DIA).toBe(30);
    expect(estadoDeSeguimiento("2026-10-13", HOY)).toBe("al_dia");
    expect(estadoDeSeguimiento("2026-10-12", HOY)).toBe("a_destiempo");
  });

  it("y lo mismo en el segundo corte", () => {
    expect(DIAS_A_DESTIEMPO).toBe(60);
    expect(estadoDeSeguimiento("2026-09-13", HOY)).toBe("a_destiempo");
    expect(estadoDeSeguimiento("2026-09-12", HOY)).toBe("sin_contacto");
  });

  it("hace tres meses es sin contacto", () => {
    expect(estadoDeSeguimiento("2026-08-01", HOY)).toBe("sin_contacto");
  });

  /**
   * «Nunca» no es «sin contacto»: un cliente cargado ayer no está abandonado,
   * y lo que hay que hacer con cada uno es distinto. Si esto se unificara, el
   * rojo dejaría de querer decir algo.
   */
  it("un cliente sin ninguna actividad dice «nunca», no «sin contacto»", () => {
    expect(estadoDeSeguimiento(null, HOY)).toBe("nunca");
    expect(estadoDeSeguimiento(undefined, HOY)).toBe("nunca");
  });

  // El cruce de mes y de año se hace con sumarDias, que cuenta en UTC.
  it("cruza el año sin perder un día", () => {
    expect(estadoDeSeguimiento("2025-12-20", "2026-01-10")).toBe("al_dia");
    expect(estadoDeSeguimiento("2025-12-10", "2026-01-10")).toBe("a_destiempo");
  });
});

describe("clasificarProximoPaso", () => {
  it("ayer está vencido, hoy es hoy, mañana es próximo", () => {
    expect(clasificarProximoPaso("2026-11-11", null, HOY)).toBe("vencido");
    expect(clasificarProximoPaso(HOY, null, HOY)).toBe("hoy");
    expect(clasificarProximoPaso("2026-11-13", null, HOY)).toBe("proximo");
  });

  /**
   * Cumplido gana sobre vencido aunque se haya cumplido tarde: sigue estando
   * hecho. Si no, la lista de vencidos crecería para siempre con trabajo
   * terminado.
   */
  it("cumplido tarde sigue siendo cumplido", () => {
    expect(clasificarProximoPaso("2026-10-01", "2026-11-10", HOY)).toBe("cumplido");
  });

  it("sin fecha no hay próximo paso que clasificar", () => {
    expect(clasificarProximoPaso(null, null, HOY)).toBeNull();
    expect(clasificarProximoPaso(undefined, "2026-11-01", HOY)).toBeNull();
  });
});

const paso = (fecha: string | null, cumplido: string | null = null) => ({
  proximo_paso: fecha ? "llamar" : null,
  proximo_paso_el: fecha,
  cumplido_el: cumplido,
});

describe("resumirPasos", () => {
  it("cuenta cada situación por separado", () => {
    const resumen = resumirPasos(
      [paso("2026-10-01"), paso("2026-11-11"), paso(HOY), paso("2026-11-14")],
      HOY
    );
    expect(resumen).toEqual({ vencidos: 2, hoy: 1, proximos: 1 });
  });

  it("lo cumplido y lo que no tiene fecha no cuentan en ningún lado", () => {
    const resumen = resumirPasos([paso("2026-10-01", "2026-10-02"), paso(null)], HOY);
    expect(resumen).toEqual({ vencidos: 0, hoy: 0, proximos: 0 });
  });

  /**
   * La asimetría es el diseño: lo vencido es todo —esconder lo de hace dos
   * meses es cómo se pierde— y lo que viene se recorta a una semana, que es lo
   * que entra en la cabeza de alguien al empezar el día.
   */
  it("la ventana recorta lo próximo y nunca lo vencido", () => {
    const actividades = [paso("2026-01-01"), paso("2026-11-19"), paso("2026-11-20")];
    expect(resumirPasos(actividades, HOY)).toEqual({ vencidos: 1, hoy: 0, proximos: 1 });
    expect(resumirPasos(actividades, HOY, 30)).toEqual({ vencidos: 1, hoy: 0, proximos: 2 });
  });

  it("el último día de la ventana entra", () => {
    expect(resumirPasos([paso("2026-11-19")], HOY, 7).proximos).toBe(1);
    expect(resumirPasos([paso("2026-11-20")], HOY, 7).proximos).toBe(0);
  });

  it("sin actividades da todo en cero y no explota", () => {
    expect(resumirPasos([], HOY)).toEqual({ vencidos: 0, hoy: 0, proximos: 0 });
  });
});

describe("pasosPendientes", () => {
  it("ordena lo más vencido primero y deja afuera lo cumplido", () => {
    const lista = [
      paso("2026-11-14"),
      paso("2026-09-01"),
      paso("2026-10-15", "2026-10-16"),
      paso(HOY),
      paso(null),
    ];
    expect(pasosPendientes(lista, HOY).map((a) => a.proximo_paso_el)).toEqual([
      "2026-09-01",
      HOY,
      "2026-11-14",
    ]);
  });

  // No tiene ventana: lo que hay que hacer es todo lo que hay que hacer. El
  // recorte a una semana es sólo del conteo del tablero.
  it("no recorta lo lejano", () => {
    expect(pasosPendientes([paso("2027-05-01")], HOY)).toHaveLength(1);
  });
});

describe("ultimaActividadPorCliente", () => {
  it("se queda con la más nueva de cada cliente", () => {
    const mapa = ultimaActividadPorCliente([
      { cliente_id: "a", fecha: "2026-10-01" },
      { cliente_id: "a", fecha: "2026-11-02" },
      { cliente_id: "a", fecha: "2026-09-30" },
      { cliente_id: "b", fecha: "2026-01-05" },
    ]);
    expect(mapa.get("a")).toBe("2026-11-02");
    expect(mapa.get("b")).toBe("2026-01-05");
  });

  it("un cliente sin actividades no está en el mapa", () => {
    expect(ultimaActividadPorCliente([]).get("a")).toBeUndefined();
  });
});
