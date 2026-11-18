import { describe, expect, it } from "vitest";
import {
  ESTADO_CANCELADA,
  SE_CANCELA_DESDE,
  esCancelacion,
  loQueImpideCancelar,
} from "./cancelacion";

const abierta = { estadoPedido: "CANCELADA", estadoActual: "ATRASADO" };

describe("loQueImpideCancelar", () => {
  it("con motivo y desde una abierta, deja", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "  Se dio de baja el equipo  " });
    expect(r).toEqual({ ok: true, texto: "Se dio de baja el equipo" });
  });

  it("sin motivo no deja, y el mensaje dice qué falta", () => {
    for (const vacia of ["", "   ", null, undefined, 7]) {
      const r = loQueImpideCancelar({ ...abierta, justificacion: vacia });
      expect(r).toEqual({ ok: false, error: "Falta decir por qué no se hizo." });
    }
  });

  it("exactamente 1.000 caracteres entra", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "x".repeat(1000) });
    expect(r).toEqual({ ok: true, texto: "x".repeat(1000) });
  });

  it("un estado que no es cancelación con un motivo en blanco no opina", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "EN_PROCESO", estadoActual: "POR_HACER", justificacion: "   ",
    });
    expect(r).toEqual({ ok: true, texto: "" });
  });

  it("un estado actual desconocido no deja cancelar y lo nombra", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "INVENTADO", justificacion: "algo",
    });
    expect(r).toHaveProperty("error", expect.stringContaining("INVENTADO"));
  });

  // Los dos de abajo fijan el orden de los chequeos: con el estado malo y el
  // texto malo a la vez, se oye primero el estado.
  it("realizada con motivo vacío dice lo de la realizada, no lo del motivo", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "REALIZADO", justificacion: "",
    });
    expect(r).toHaveProperty("error", expect.stringContaining("realizada"));
  });

  it("fecha de cierre con motivo vacío dice lo de la fecha, no lo del motivo", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "", fechaCierre: "2026-11-13" });
    expect(r).toHaveProperty("error", expect.stringContaining("fecha de cierre"));
  });

  it("un motivo de más de 1.000 se rechaza, no se recorta", () => {
    const r = loQueImpideCancelar({ ...abierta, justificacion: "x".repeat(1001) });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("1001"));
  });

  it("no se cancela una realizada", () => {
    // Tiene fecha_cierre, y estadoSegunElCierre dice que la fecha manda.
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "REALIZADO", justificacion: "lo que sea",
    });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("realizada"));
  });

  it("una ya cancelada se puede volver a justificar", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA", estadoActual: "CANCELADA", justificacion: "se corrige el motivo",
    });
    expect(r.ok).toBe(true);
  });

  it("una cancelación no lleva fecha de cierre", () => {
    // Una fecha de cierre dice «se hizo tal día»: estadoSegunElCierre la
    // convierte en REALIZADO y costoEquipo la cobra. No se ignora en
    // silencio, porque quien la mandó cree que la guardó.
    const r = loQueImpideCancelar({ ...abierta, justificacion: "x", fechaCierre: "2026-11-13" });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("fecha de cierre"));
  });

  it("la fecha de cierre guardada frena igual, aunque el cuerpo no traiga ninguna", () => {
    // El camino vivo, y el que esta regla no veía: «Parcial» del modal de
    // registrar manda `estado: "EN_PROCESO"` **junto con** `fecha_cierre`, así
    // que la orden queda abierta y con fecha. Cancelarla después pasaba —el
    // estado actual deja cancelar y el cuerpo no trae fecha— y dejaba una
    // CANCELADA con fecha de cierre, que es la fila que se contradice a sí
    // misma. Ahora el PATCH le pasa `body.fecha_cierre ?? la guardada`, y acá
    // queda fijado que con la guardada sola la regla ya habla.
    const r = loQueImpideCancelar({
      estadoPedido: "CANCELADA",
      estadoActual: "EN_PROCESO",
      justificacion: "Se dio de baja el equipo",
      fechaCierre: "2026-11-10",
    });
    expect(r).toEqual({
      ok: false,
      error: "Una orden cancelada no lleva fecha de cierre: esa fecha dice que se hizo.",
    });
  });

  it("una justificación con otro estado es un error del que llama", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "EN_PROCESO", estadoActual: "POR_HACER", justificacion: "algo",
    });
    expect(r.ok).toBe(false);
    expect(r).toHaveProperty("error", expect.stringContaining("justificación"));
  });

  it("sin cancelación y sin justificación no opina", () => {
    const r = loQueImpideCancelar({
      estadoPedido: "EN_PROCESO", estadoActual: "POR_HACER", justificacion: undefined,
    });
    expect(r).toEqual({ ok: true, texto: "" });
  });
});

describe("esCancelacion y SE_CANCELA_DESDE", () => {
  it("sólo CANCELADA es una cancelación", () => {
    expect(esCancelacion(ESTADO_CANCELADA)).toBe(true);
    expect(esCancelacion("REALIZADO")).toBe(false);
    expect(esCancelacion(undefined)).toBe(false);
  });

  it("se cancela desde las tres abiertas y no desde REALIZADO", () => {
    expect([...SE_CANCELA_DESDE]).toEqual(["POR_HACER", "EN_PROCESO", "ATRASADO"]);
  });
});
