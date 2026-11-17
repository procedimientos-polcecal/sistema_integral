import { describe, expect, it } from "vitest";
import { comoSeMuestraElTrabajo, estadoDelTrabajo } from "./trabajoDelAviso";

describe("estadoDelTrabajo", () => {
  const conOt = { work_order_id: "ot-a", ot_asignada: "2814" };

  it("cerrado con fecha", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado: "REALIZADO", fecha_cierre: "2026-11-04" }))
      .toEqual({ tipo: "cerrado", ot: 2814, fecha: "2026-11-04" });
  });

  it("cerrado sin fecha: lo decide el estado y no la fecha (son 220 OT)", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado: "REALIZADO", fecha_cierre: null }))
      .toEqual({ tipo: "cerrado", ot: 2814, fecha: null });
  });

  it.each([
    ["POR_HACER", "Por hacer"],
    ["EN_PROCESO", "En proceso"],
    ["ATRASADO", "Atrasada"],
  ])("abierto: %s", (estado, comoSeLlama) => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado, fecha_cierre: null }))
      .toEqual({ tipo: "abierto", ot: 2814, estado, comoSeLlama });
  });

  it("un estado que no conocemos se muestra tal cual", () => {
    const r = estadoDelTrabajo(conOt, { ot_number: 2814, estado: "ANULADO", fecha_cierre: null });
    expect(r).toEqual({ tipo: "abierto", ot: 2814, estado: "ANULADO", comoSeLlama: "ANULADO" });
  });

  it("sin enlace: el texto crudo de la planilla", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "1889 - 1886" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "1889 - 1886" });
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "Revision" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "Revision" });
  });

  it("sin orden: pendiente o desestimado", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: null }, null)).toEqual({ tipo: "sin-ot" });
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "", desestimado_en: "2026-10-21" }, null))
      .toEqual({ tipo: "sin-ot" });
  });

  it("si la orden no llegó, el aviso sigue diciendo lo de siempre y nunca «sin orden»", () => {
    expect(estadoDelTrabajo(conOt, undefined)).toEqual({ tipo: "sin-enlace", texto: "2814" });
  });

  it("con enlace pero sin texto y sin orden leída: sin-enlace con texto vacío, nunca sin-ot", () => {
    expect(estadoDelTrabajo({ work_order_id: "ot-a", ot_asignada: null }, null))
      .toEqual({ tipo: "sin-enlace", texto: "" });
    expect(estadoDelTrabajo({ work_order_id: "ot-a", ot_asignada: "" }, undefined))
      .toEqual({ tipo: "sin-enlace", texto: "" });
  });

  it("estado null en una orden leída: abierto con comoSeLlama vacío (a decidir en la pantalla)", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: 2814, estado: null, fecha_cierre: null }))
      .toEqual({ tipo: "abierto", ot: 2814, estado: "", comoSeLlama: "" });
  });

  it("orden sin ot_number: se ignora y manda el aviso", () => {
    expect(estadoDelTrabajo(conOt, { ot_number: null, estado: "REALIZADO", fecha_cierre: null }))
      .toEqual({ tipo: "sin-enlace", texto: "2814" });
  });

  it("el guión suelto de la planilla no es una orden", () => {
    expect(estadoDelTrabajo({ work_order_id: null, ot_asignada: "-" }, null))
      .toEqual({ tipo: "sin-enlace", texto: "-" });
  });
});

describe("comoSeMuestraElTrabajo", () => {
  const conOt = { work_order_id: "ot-a", ot_asignada: "2814" };
  const de = (estado: string | null, fecha_cierre: string | null = null) =>
    comoSeMuestraElTrabajo(estadoDelTrabajo(conOt, { ot_number: 2814, estado, fecha_cierre }));

  it("cerrada con fecha: d/m y verde", () => {
    expect(de("REALIZADO", "2026-11-06")).toEqual({ texto: "Cerrada el 6/11", color: "#15803D", peso: 500 });
  });

  it("cerrada sin fecha: sólo «Cerrada»", () => {
    expect(de("REALIZADO")).toEqual({ texto: "Cerrada", color: "#15803D", peso: 500 });
  });

  it("abierta: el nombre del estado en ámbar", () => {
    expect(de("EN_PROCESO")).toEqual({ texto: "En proceso", color: "#B45309", peso: 500 });
    expect(de("POR_HACER")).toEqual({ texto: "Por hacer", color: "#B45309", peso: 500 });
  });

  it("atrasada: en rojo", () => {
    expect(de("ATRASADO")).toEqual({ texto: "Atrasada", color: "#DC2626", peso: 500 });
  });

  it("estado null: «sin estado», pintado como abierta", () => {
    expect(de(null)).toEqual({ texto: "sin estado", color: "#B45309", peso: 500 });
  });

  it("sin-enlace y sin-ot no son una orden con estado", () => {
    expect(comoSeMuestraElTrabajo({ tipo: "sin-enlace", texto: "si" })).toBeNull();
    expect(comoSeMuestraElTrabajo({ tipo: "sin-ot" })).toBeNull();
  });
});
