import { describe, it, expect } from "vitest";
import {
  conPermanencia, duracionLegible, filtrarCambios, resumirHistorial,
  hayFiltrosDelHistorial, FILTROS_DEL_HISTORIAL_VACIOS,
  type CambioDeSector,
} from "./historialDeSectores";

const cambio = (p: Partial<CambioDeSector> & { id: string; changed_at: string }): CambioDeSector => ({
  sector_id: "s1",
  sector: "Hidratación",
  old_status: "ACTIVA",
  new_status: "PARADA",
  reason: null,
  autor: "Francisco Varela",
  ...p,
});

const AHORA = "2026-11-19T12:00:00.000Z";

describe("conPermanencia", () => {
  it("cada cambio dura hasta el siguiente del mismo sector", () => {
    const [primero, segundo] = conPermanencia([
      cambio({ id: "a", changed_at: "2026-11-12T00:00:00.000Z", new_status: "PARADA" }),
      cambio({ id: "b", changed_at: "2026-11-14T00:00:00.000Z", new_status: "ACTIVA" }),
    ], AHORA);

    expect(primero.hasta).toBe("2026-11-14T00:00:00.000Z");
    expect(primero.duracionMs).toBe(2 * 24 * 60 * 60 * 1000);
    expect(segundo.hasta).toBeNull();
  });

  it("el estado abierto se mide contra ahora", () => {
    const [solo] = conPermanencia(
      [cambio({ id: "a", changed_at: "2026-11-18T12:00:00.000Z" })],
      AHORA
    );
    expect(solo.hasta).toBeNull();
    expect(solo.duracionMs).toBe(24 * 60 * 60 * 1000);
  });

  it("el cambio de otro sector no cierra el de éste", () => {
    const filas = conPermanencia([
      cambio({ id: "a", sector_id: "s1", changed_at: "2026-11-10T00:00:00.000Z" }),
      cambio({ id: "b", sector_id: "s2", changed_at: "2026-11-11T00:00:00.000Z" }),
      cambio({ id: "c", sector_id: "s1", changed_at: "2026-11-15T00:00:00.000Z" }),
    ], AHORA);

    const a = filas.find((f) => f.id === "a")!;
    expect(a.hasta).toBe("2026-11-15T00:00:00.000Z");

    // El de s2 sigue abierto: nada lo cerró.
    expect(filas.find((f) => f.id === "b")!.hasta).toBeNull();
  });

  it("ordena por su cuenta: la lista puede venir al revés", () => {
    const filas = conPermanencia([
      cambio({ id: "nueva", changed_at: "2026-11-15T00:00:00.000Z" }),
      cambio({ id: "vieja", changed_at: "2026-11-10T00:00:00.000Z" }),
    ], AHORA);

    expect(filas.find((f) => f.id === "vieja")!.hasta).toBe("2026-11-15T00:00:00.000Z");
    expect(filas.find((f) => f.id === "nueva")!.hasta).toBeNull();
  });

  it("dos huérfanas no se encadenan entre sí", () => {
    const filas = conPermanencia([
      cambio({ id: "a", sector_id: null, sector: null, changed_at: "2026-11-10T00:00:00.000Z" }),
      cambio({ id: "b", sector_id: null, sector: null, changed_at: "2026-11-15T00:00:00.000Z" }),
    ], AHORA);

    // Podrían ser de dos sectores borrados distintos: nada dice que sean el
    // mismo, así que ninguna cierra a la otra.
    expect(filas.every((f) => f.hasta === null)).toBe(true);
  });

  it("una fecha futura no da una duración negativa", () => {
    const [solo] = conPermanencia(
      [cambio({ id: "a", changed_at: "2026-12-25T00:00:00.000Z" })],
      AHORA
    );
    expect(solo.duracionMs).toBe(0);
  });

  it("devuelve todas las filas que recibió", () => {
    const entran = [
      cambio({ id: "a", sector_id: "s1", changed_at: "2026-11-10T00:00:00.000Z" }),
      cambio({ id: "b", sector_id: "s2", changed_at: "2026-11-11T00:00:00.000Z" }),
      cambio({ id: "c", sector_id: "s1", changed_at: "2026-11-15T00:00:00.000Z" }),
    ];
    expect(conPermanencia(entran, AHORA)).toHaveLength(3);
  });
});

describe("duracionLegible", () => {
  it("abajo del minuto no inventa precisión", () => {
    expect(duracionLegible(0)).toBe("menos de un minuto");
    expect(duracionLegible(59_000)).toBe("menos de un minuto");
  });

  it("minutos, horas y días", () => {
    expect(duracionLegible(12 * 60_000)).toBe("12 min");
    expect(duracionLegible(5 * 3_600_000)).toBe("5 h");
    expect(duracionLegible(5 * 3_600_000 + 20 * 60_000)).toBe("5 h 20 min");
    expect(duracionLegible(3 * 86_400_000)).toBe("3 días");
    expect(duracionLegible(3 * 86_400_000 + 4 * 3_600_000)).toBe("3 días 4 h");
  });

  it("un día es singular", () => {
    expect(duracionLegible(86_400_000)).toBe("1 día");
  });

  it("corta en dos unidades: los minutos no aparecen al lado de los días", () => {
    expect(duracionLegible(3 * 86_400_000 + 4 * 3_600_000 + 17 * 60_000))
      .toBe("3 días 4 h");
  });
});

describe("filtrarCambios", () => {
  const filas = conPermanencia([
    cambio({ id: "a", sector_id: "s1", sector: "Hidratación", changed_at: "2026-11-10T10:00:00.000Z", new_status: "PARADA", reason: "Rotura de bomba" }),
    cambio({ id: "b", sector_id: "s2", sector: "Molienda", changed_at: "2026-11-12T10:00:00.000Z", new_status: "EN_REPARACION", autor: "Ana Gómez" }),
    cambio({ id: "c", sector_id: "s1", sector: "Hidratación", changed_at: "2026-11-15T10:00:00.000Z", new_status: "ACTIVA" }),
  ], AHORA);

  const ids = (f: Parameters<typeof filtrarCambios>[1]) =>
    filtrarCambios(filas, f).map((c) => c.id).sort();

  it("sin filtros devuelve todo", () => {
    expect(ids(FILTROS_DEL_HISTORIAL_VACIOS)).toEqual(["a", "b", "c"]);
  });

  it("por sector", () => {
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, sectores: ["s1"] })).toEqual(["a", "c"]);
  });

  it("por estado al que se pasó", () => {
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, estados: ["PARADA", "EN_REPARACION"] }))
      .toEqual(["a", "b"]);
  });

  it("el rango de fechas incluye los dos extremos", () => {
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, desde: "2026-11-12", hasta: "2026-11-15" }))
      .toEqual(["b", "c"]);
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, desde: "2026-11-10", hasta: "2026-11-10" }))
      .toEqual(["a"]);
  });

  it("el texto busca sin acentos en motivo, sector y autor", () => {
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "hidratacion" })).toEqual(["a", "c"]);
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "bomba" })).toEqual(["a"]);
    expect(ids({ ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "ana" })).toEqual(["b"]);
  });

  it("una huérfana no entra cuando se filtra por sector, pero sí por su nombre", () => {
    // Desde la 20261119104730 una fila cuyo sector se borró conserva el
    // nombre que tenía: `sector_id` en null es lo único que la delata.
    const conHuerfana = conPermanencia([
      cambio({ id: "h", sector_id: null, sector: "Despacho Cal", changed_at: "2026-11-11T10:00:00.000Z" }),
    ], AHORA);

    // Por sector no hay con qué cruzarla: ya no tiene id.
    expect(filtrarCambios(conHuerfana, { ...FILTROS_DEL_HISTORIAL_VACIOS, sectores: ["s1"] }))
      .toEqual([]);
    // Por texto sí, que es el único camino que le queda a quien la busque.
    expect(filtrarCambios(conHuerfana, { ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "despacho" }))
      .toHaveLength(1);
    expect(filtrarCambios(conHuerfana, FILTROS_DEL_HISTORIAL_VACIOS)).toHaveLength(1);
  });
});

describe("hayFiltrosDelHistorial", () => {
  it("vacío es sin filtros, y un texto con espacios también", () => {
    expect(hayFiltrosDelHistorial(FILTROS_DEL_HISTORIAL_VACIOS)).toBe(false);
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "   " })).toBe(false);
  });

  it("cualquiera de los cinco cuenta", () => {
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, sectores: ["s1"] })).toBe(true);
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, estados: ["PARADA"] })).toBe(true);
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, desde: "2026-01-01" })).toBe(true);
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, hasta: "2026-01-01" })).toBe(true);
    expect(hayFiltrosDelHistorial({ ...FILTROS_DEL_HISTORIAL_VACIOS, texto: "x" })).toBe(true);
  });
});

describe("resumirHistorial", () => {
  it("cuenta las paradas y suma lo que no estuvo ACTIVA", () => {
    const filas = conPermanencia([
      cambio({ id: "a", sector_id: "s1", changed_at: "2026-11-10T00:00:00.000Z", new_status: "PARADA" }),
      cambio({ id: "b", sector_id: "s1", changed_at: "2026-11-12T00:00:00.000Z", new_status: "ACTIVA" }),
      cambio({ id: "c", sector_id: "s2", changed_at: "2026-11-18T12:00:00.000Z", new_status: "EN_REPARACION" }),
    ], AHORA);

    const r = resumirHistorial(filas);
    expect(r.cambios).toBe(3);
    expect(r.paradas).toBe(2);
    expect(r.sectores).toBe(2);
    // Dos días de la parada cerrada + un día del EN_REPARACION todavía abierto.
    expect(r.fueraDeServicioMs).toBe(3 * 86_400_000);
  });

  it("PARADA y EN_REPARACION suman juntas, que es lo que se mira", () => {
    const filas = conPermanencia([
      cambio({ id: "a", sector_id: "s1", changed_at: "2026-11-18T12:00:00.000Z", new_status: "PARADA" }),
      cambio({ id: "b", sector_id: "s2", changed_at: "2026-11-18T12:00:00.000Z", new_status: "EN_REPARACION" }),
    ], AHORA);
    expect(resumirHistorial(filas).fueraDeServicioMs).toBe(2 * 86_400_000);
  });

  it("sin nada devuelve ceros y no NaN", () => {
    expect(resumirHistorial([])).toEqual({
      cambios: 0, paradas: 0, fueraDeServicioMs: 0, sectores: 0,
    });
  });
});
