import { describe, it, expect } from "vitest";
import { paradasPorSector } from "./paradasDeSector";
import type { CambioDeSector } from "./historialDeSectores";

const AHORA = "2026-11-19T12:00:00Z";
const DIA = 86_400_000;

let siguiente = 1;
const cambio = (p: Partial<CambioDeSector>): CambioDeSector => ({
  id: `c${siguiente++}`,
  sector_id: "s1",
  sector: "Trituración 2",
  old_status: null,
  new_status: "ACTIVA",
  reason: null,
  changed_at: "2026-11-12T00:00:00Z",
  autor: null,
  ...p,
});

const unSector = (r: ReturnType<typeof paradasPorSector>, id: string) =>
  r.sectores.find((s) => s.sectorId === id)!;

describe("paradasPorSector", () => {
  it("sin ningún cambio devuelve la lista vacía y desde en null", () => {
    // `sectores_status_log` tenía 3 filas el 19/11/2026: una base casi vacía
    // es el caso normal y no una rareza.
    expect(paradasPorSector([], AHORA)).toEqual({ sectores: [], desde: null });
  });

  it("suma PARADA y EN_REPARACION como fuera de servicio", () => {
    // Desde producción las dos son lo mismo: la planta no produce.
    const r = paradasPorSector([
      cambio({ id: "a", new_status: "PARADA", changed_at: "2026-11-01T00:00:00Z" }),
      cambio({ id: "b", new_status: "ACTIVA", changed_at: "2026-11-03T00:00:00Z" }),
      cambio({ id: "c", new_status: "EN_REPARACION", changed_at: "2026-11-05T00:00:00Z" }),
      cambio({ id: "d", new_status: "ACTIVA", changed_at: "2026-11-06T00:00:00Z" }),
    ], AHORA);

    expect(unSector(r, "s1").veces).toBe(2);
    expect(unSector(r, "s1").fueraDeServicioMs).toBe(3 * DIA);
  });

  it("no cuenta el arranque como una parada", () => {
    const r = paradasPorSector([
      cambio({ id: "a", new_status: "ACTIVA", changed_at: "2026-11-01T00:00:00Z" }),
      cambio({ id: "b", new_status: "ACTIVA", changed_at: "2026-11-03T00:00:00Z" }),
    ], AHORA);

    expect(unSector(r, "s1").veces).toBe(0);
    expect(unSector(r, "s1").fueraDeServicioMs).toBe(0);
  });

  it("una parada todavía abierta cuenta hasta ahora y dice desde cuándo", () => {
    // Dejarla afuera haría que el número bajara justo cuando hay una planta
    // parada, que es cuando se mira.
    const r = paradasPorSector([
      cambio({ id: "a", new_status: "EN_REPARACION", changed_at: "2026-11-17T12:00:00Z" }),
    ], AHORA);

    expect(unSector(r, "s1").paradoDesde).toBe("2026-11-17T12:00:00Z");
    expect(unSector(r, "s1").fueraDeServicioMs).toBe(2 * DIA);
  });

  it("un sector que volvió a ACTIVA no está parado ahora", () => {
    const r = paradasPorSector([
      cambio({ id: "a", new_status: "PARADA", changed_at: "2026-11-12T00:00:00Z" }),
      cambio({ id: "b", new_status: "ACTIVA", changed_at: "2026-11-16T00:00:00Z" }),
    ], AHORA);

    expect(unSector(r, "s1").paradoDesde).toBeNull();
  });

  it("desde es el cambio más viejo de todos, no el del primer sector", () => {
    const r = paradasPorSector([
      cambio({ id: "a", sector_id: "s2", sector: "Hidratación", changed_at: "2026-11-19T00:00:00Z" }),
      cambio({ id: "b", sector_id: "s1", changed_at: "2026-11-12T00:00:00Z" }),
    ], AHORA);

    expect(r.desde).toBe("2026-11-12T00:00:00Z");
  });

  it("ordena por tiempo fuera de servicio, de más a menos", () => {
    const r = paradasPorSector([
      cambio({ id: "a", sector_id: "s1", new_status: "PARADA", changed_at: "2026-11-01T00:00:00Z" }),
      cambio({ id: "b", sector_id: "s1", new_status: "ACTIVA", changed_at: "2026-11-02T00:00:00Z" }),
      cambio({ id: "c", sector_id: "s2", sector: "Hidratación", new_status: "PARADA", changed_at: "2026-11-01T00:00:00Z" }),
      cambio({ id: "d", sector_id: "s2", sector: "Hidratación", new_status: "ACTIVA", changed_at: "2026-11-06T00:00:00Z" }),
    ], AHORA);

    expect(r.sectores.map((s) => s.sector)).toEqual(["Hidratación", "Trituración 2"]);
  });

  it("un sector que sólo arrancó aparece igual, en cero", () => {
    // Que alguien lo haya tocado es información: la lista dice qué sectores
    // tienen historia, no sólo cuáles pararon.
    const r = paradasPorSector([
      cambio({ id: "a", new_status: "ACTIVA" }),
    ], AHORA);

    expect(r.sectores).toHaveLength(1);
    expect(r.sectores[0].veces).toBe(0);
  });

  it("una fila huérfana no se mezcla con las demás", () => {
    // El sector se borró: `sector_id` queda en null y el nombre sobrevive.
    const r = paradasPorSector([
      cambio({ id: "a", sector_id: null, sector: "Despacho Cal", new_status: "PARADA", changed_at: "2026-11-01T00:00:00Z" }),
      cambio({ id: "b", sector_id: null, sector: "Otro que ya no está", new_status: "PARADA", changed_at: "2026-11-02T00:00:00Z" }),
    ], AHORA);

    expect(r.sectores).toHaveLength(2);
    expect(r.sectores.map((s) => s.sector).sort()).toEqual(["Despacho Cal", "Otro que ya no está"]);
  });

  it("un sector sin nombre lo dice en vez de quedar en blanco", () => {
    const r = paradasPorSector([cambio({ sector: null })], AHORA);

    expect(r.sectores[0].sector).toBe("Sector sin nombre");
  });
});
