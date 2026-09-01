import { describe, it, expect } from "vitest";
import { cuerpoJson } from "./cuerpo";

const req = (cuerpo: string) =>
  new Request("http://x/api", { method: "POST", body: cuerpo });

describe("cuerpoJson", () => {
  it("un JSON valido llega tal cual", async () => {
    expect(await cuerpoJson(req('{"a":1,"b":"x"}'))).toEqual({ a: 1, b: "x" });
  });

  /**
   * El caso que devolvia un 500 con stack: 60 handlers hacian
   * `await request.json()` sin catch.
   */
  it("un cuerpo vacio da {} y no revienta", async () => {
    expect(await cuerpoJson(req(""))).toEqual({});
  });

  it("un cuerpo que no es JSON da {}", async () => {
    expect(await cuerpoJson(req("no soy json"))).toEqual({});
    expect(await cuerpoJson(req("{roto"))).toEqual({});
  });

  /** `JSON.parse` acepta estos y no son un cuerpo con campos. */
  it("un JSON valido que no es objeto tambien da {}", async () => {
    expect(await cuerpoJson(req("null"))).toEqual({});
    expect(await cuerpoJson(req("3"))).toEqual({});
    expect(await cuerpoJson(req('"texto"'))).toEqual({});
  });

  it("un arreglo si es un objeto: se respeta", async () => {
    expect(await cuerpoJson(req("[1,2]"))).toEqual([1, 2]);
  });

  it("destructurar el resultado da undefined, no una excepcion", async () => {
    const { falta } = await cuerpoJson<{ falta?: string }>(req(""));
    expect(falta).toBeUndefined();
  });
});
