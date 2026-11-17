import { describe, expect, it } from "vitest";
import { ausentesPublicos, rangoPedido, MAXIMO_DE_DIAS } from "./disponibilidadPublica";

const ana = { id: "e1", nombre: "Ana", apellido: "Pérez", sector: "Taller" };
const beto = { id: "e2", nombre: "Beto", apellido: "Álvarez", sector: null };

describe("ausentesPublicos", () => {
  it("da una entrada por persona y por día, recortada a los días pedidos", () => {
    const r = ausentesPublicos(
      [{ empleado_id: "e1", fecha_desde: "2026-11-02", fecha_hasta: "2026-11-04", tipo: "VACACIONES" }],
      [ana],
      ["2026-11-03", "2026-11-04", "2026-11-05"],
    );
    expect(r.map((x) => x.dia)).toEqual(["2026-11-03", "2026-11-04"]);
    expect(r[0]).toEqual({ empleadoId: "e1", nombre: "Pérez, Ana", sector: "Taller", dia: "2026-11-03" });
  });

  it("la tardanza no es un hueco: esa persona vino", () => {
    const r = ausentesPublicos(
      [{ empleado_id: "e1", fecha_desde: "2026-11-03", fecha_hasta: "2026-11-03", tipo: "TARDANZA" }],
      [ana],
      ["2026-11-03"],
    );
    expect(r).toEqual([]);
  });

  it("una persona sin sector aparece, con sector null", () => {
    const r = ausentesPublicos(
      [{ empleado_id: "e2", fecha_desde: "2026-11-03", fecha_hasta: "2026-11-03", tipo: "OTRA" }],
      [beto],
      ["2026-11-03"],
    );
    expect(r).toHaveLength(1);
    expect(r[0].sector).toBeNull();
  });

  it("dos ausencias que se pisan el mismo día dan un solo hueco", () => {
    const r = ausentesPublicos(
      [
        { empleado_id: "e1", fecha_desde: "2026-11-03", fecha_hasta: "2026-11-05", tipo: "VACACIONES" },
        { empleado_id: "e1", fecha_desde: "2026-11-04", fecha_hasta: "2026-11-04", tipo: "PERMISO_PERSONAL" },
      ],
      [ana],
      ["2026-11-03", "2026-11-04", "2026-11-05"],
    );
    expect(r).toHaveLength(3);
  });

  it("ordena por día y después por nombre", () => {
    const r = ausentesPublicos(
      [
        { empleado_id: "e1", fecha_desde: "2026-11-03", fecha_hasta: "2026-11-04", tipo: "OTRA" },
        { empleado_id: "e2", fecha_desde: "2026-11-04", fecha_hasta: "2026-11-04", tipo: "OTRA" },
      ],
      [ana, beto],
      ["2026-11-03", "2026-11-04"],
    );
    expect(r.map((x) => `${x.dia} ${x.nombre}`)).toEqual([
      "2026-11-03 Pérez, Ana",
      "2026-11-04 Álvarez, Beto",
      "2026-11-04 Pérez, Ana",
    ]);
  });

  it("EL MOTIVO NO SALE: ni el tipo ni lo que se agregue a la fila de entrada", () => {
    // La fila de entrada trae más de lo que el contrato dice, a propósito: si la
    // consulta algún día agrega `observaciones` o `justificada`, tampoco salen.
    const filaConDemas = {
      empleado_id: "e1",
      fecha_desde: "2026-11-03",
      fecha_hasta: "2026-11-03",
      tipo: "ENFERMEDAD_ACCIDENTE_INCULPABLE",
      observaciones: "operación de rodilla",
      justificada: true,
    };
    const r = ausentesPublicos([filaConDemas], [ana], ["2026-11-03"]);
    expect(r).toHaveLength(1);
    const json = JSON.stringify(r);
    expect(json).not.toContain("ENFERMEDAD");
    expect(json).not.toContain("rodilla");
    expect(json).not.toContain("tipo");
    expect(json).not.toContain("observaciones");
    expect(json).not.toContain("justificada");
    expect(Object.keys(r[0]).sort()).toEqual(["dia", "empleadoId", "nombre", "sector"]);
  });
});

describe("rangoPedido", () => {
  it("sin parámetros da la semana de hoy, lunes a domingo", () => {
    const r = rangoPedido(null, null, "2026-11-04");
    expect("dias" in r && r.dias[0]).toBe("2026-11-02");
    expect("dias" in r && r.dias).toHaveLength(7);
  });

  it("con las dos fechas da todos los días, extremos incluidos", () => {
    const r = rangoPedido("2026-11-30", "2026-12-02", "2026-11-04");
    expect(r).toEqual({ dias: ["2026-11-30", "2026-12-01", "2026-12-02"] });
  });

  it("con una sola de las dos es un error, no un valor adivinado", () => {
    expect(rangoPedido("2026-11-02", null, "2026-11-04")).toHaveProperty("error");
    expect(rangoPedido(null, "2026-11-02", "2026-11-04")).toHaveProperty("error");
  });

  it("rechaza fechas que no existen y rangos al revés", () => {
    expect(rangoPedido("2026-02-30", "2026-03-01", "2026-11-04")).toHaveProperty("error");
    expect(rangoPedido("2026-11-05", "2026-11-04", "2026-11-04")).toHaveProperty("error");
  });

  it("tiene un tope", () => {
    expect(rangoPedido("2026-01-01", "2026-12-31", "2026-11-04")).toHaveProperty("error");
    const limite = rangoPedido("2026-01-01", "2026-04-03", "2026-11-04"); // 93 días justos
    expect("dias" in limite && limite.dias.length).toBe(MAXIMO_DE_DIAS);
  });
});
