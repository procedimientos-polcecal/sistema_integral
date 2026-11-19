import { describe, expect, it } from "vitest";
import {
  elCuerpoDeLaAsignacion,
  porQueNoEntra,
  porQueNoSePuedeAsignar,
  turnoDelDia,
  type OrdenQueSeAsigna,
} from "./asignarOperario";
import type { OperarioDelCatalogo } from "./operarioDelCatalogo";

const vacios = { operario_1: null, operario_2: null, operario_3: null };
const abierta: OrdenQueSeAsigna = { estado: "POR_HACER", ...vacios };

const delCatalogo = (
  nombre: string,
  slot: number,
  extra: Partial<OperarioDelCatalogo> = {},
): OperarioDelCatalogo => ({
  nombre,
  slot,
  empleadoId: `i-${nombre}`,
  porQueNoSeSabe: null,
  oficio: "mecanico",
  ...extra,
});

const piparo = delCatalogo("Piparo", 3);

describe("a que orden se le puede asignar", () => {
  it("una orden abierta se puede asignar", () => {
    expect(porQueNoSePuedeAsignar(abierta)).toBeNull();
  });

  it("una REALIZADO no, y dice que ahi ya dice quien lo hizo", () => {
    expect(porQueNoSePuedeAsignar({ ...abierta, estado: "REALIZADO" }))
      .toContain("ya dice quién lo hizo");
  });

  it("una CANCELADA tampoco", () => {
    expect(porQueNoSePuedeAsignar({ ...abierta, estado: "CANCELADA" }))
      .not.toBeNull();
  });

  /*
   * Una orden de arrastre no es un caso aparte: el día que se mira no cambia
   * si la orden admite gente. Lo que decide es el estado y nada más.
   */
  it("lo unico que decide si se puede asignar es el estado", () => {
    const enProceso: OrdenQueSeAsigna = { estado: "EN_PROCESO", ...vacios };
    expect(porQueNoSePuedeAsignar(enProceso)).toBeNull();
    expect(porQueNoSePuedeAsignar({ ...enProceso, operario_1: "Aguirre" })).toBeNull();
  });

  it("una orden sin estado se deja asignar: no consta que este cerrada", () => {
    expect(porQueNoSePuedeAsignar({ estado: null, ...vacios })).toBeNull();
  });
});

describe("si ese nombre entra en esa orden", () => {
  it("un nombre entra en su propia posicion", () => {
    expect(porQueNoEntra(abierta, piparo)).toBeNull();
  });

  it("si esa posicion ya tiene a alguien, lo dice en vez de pisarlo", () => {
    expect(porQueNoEntra({ ...abierta, operario_3: "Picart" }, piparo))
      .toContain("Picart");
  });

  it("el mismo nombre dos veces no entra", () => {
    const ocupada: OrdenQueSeAsigna = { ...abierta, operario_3: "Piparo" };
    expect(porQueNoEntra(ocupada, piparo)).toContain("ya está");
  });

  it("otra posicion ocupada no molesta", () => {
    expect(porQueNoEntra({ ...abierta, operario_1: "Aguirre" }, piparo)).toBeNull();
  });

  it("una orden cerrada contesta lo mismo que porQueNoSePuedeAsignar", () => {
    const cerrada: OrdenQueSeAsigna = { ...abierta, estado: "REALIZADO" };
    expect(porQueNoEntra(cerrada, piparo)).toBe(porQueNoSePuedeAsignar(cerrada));
  });

  it("un slot que no es 1, 2 ni 3 no entra en ninguna columna", () => {
    expect(porQueNoEntra(abierta, delCatalogo("Raro", 4))).not.toBeNull();
  });
});

describe("el cuerpo que se le manda al PATCH", () => {
  it("nombra la columna del slot", () => {
    expect(elCuerpoDeLaAsignacion("abc", 2, "Garcia"))
      .toEqual({ id: "abc", operario_2: "Garcia" });
  });

  /*
   * Vacío y no `null`: lo que decide en `repartirRegistroDeOT` es que la clave
   * venga, y su `texto()` convierte el vacío en null para la tabla y en celda
   * vacía para la planilla. Omitir la clave dejaría el nombre donde estaba.
   */
  it("sacar manda la columna vacia y no la omite", () => {
    expect(elCuerpoDeLaAsignacion("abc", 2, null))
      .toEqual({ id: "abc", operario_2: "" });
  });

  it("no manda ninguna otra columna", () => {
    expect(Object.keys(elCuerpoDeLaAsignacion("abc", 1, "Aguirre")).sort())
      .toEqual(["id", "operario_1"]);
  });
});

describe("el turno real de un dia", () => {
  it("la pisada gana sobre el ciclo, y sin pisada manda el ciclo", () => {
    expect(turnoDelDia("4-12", "12-20")).toBe("12-20");
    expect(turnoDelDia("4-12", null)).toBe("4-12");
    expect(turnoDelDia(null, null)).toBeNull();
  });

  it("una pisada sobre alguien sin turno del ciclo igual lo ubica", () => {
    expect(turnoDelDia(null, "8-16")).toBe("8-16");
  });
});
