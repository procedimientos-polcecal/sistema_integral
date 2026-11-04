import { describe, it, expect } from "vitest";
import { diferenciaDeInvitados } from "./invitados";

describe("diferenciaDeInvitados", () => {
  it("saca los que sobran y agrega los que faltan, sin tocar los que siguen", () => {
    expect(diferenciaDeInvitados(["a@x.com", "b@x.com"], ["b@x.com", "c@x.com"])).toEqual({
      sacar: ["a@x.com"],
      agregar: ["c@x.com"],
    });
  });
  it("la misma lista no cambia nada", () => {
    expect(diferenciaDeInvitados(["a@x.com"], ["a@x.com"])).toEqual({ sacar: [], agregar: [] });
  });
  it("vaciar la lista saca a todos", () => {
    expect(diferenciaDeInvitados(["a@x.com", "b@x.com"], [])).toEqual({
      sacar: ["a@x.com", "b@x.com"],
      agregar: [],
    });
  });
});
