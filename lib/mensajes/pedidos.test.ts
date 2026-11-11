import { describe, it, expect } from "vitest";
import { validar } from "@/lib/core/validar";
import {
  MAXIMO_DE_MENCIONES, MAXIMO_DEL_TEXTO, esquemaDelHilo, esquemaDelMensaje, parametrosDeLaUrl,
} from "./pedidos";

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

describe("el cuerpo de un mensaje", () => {
  it("acepta uno completo y recorta los espacios del texto", () => {
    const r = validar(esquemaDelMensaje, {
      tipo: "orden_trabajo", id: ID, texto: "  hola  ", menciones: [OTRO],
    });
    expect(r).toEqual({
      ok: true,
      datos: { tipo: "orden_trabajo", id: ID, texto: "hola", menciones: [OTRO] },
    });
  });

  it("sin menciones es una nota del registro", () => {
    const r = validar(esquemaDelMensaje, { tipo: "requerimiento", id: ID, texto: "hola" });
    expect(r.ok && r.datos.menciones).toEqual([]);
  });

  it("informa todos los problemas juntos y en castellano", () => {
    const r = validar(esquemaDelMensaje, { tipo: "chat", id: "no-es-un-id", texto: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.join(" ")).toContain("tipo tiene que ser uno de");
      expect(r.problemas.join(" ")).toContain("id tiene que ser");
      expect(r.problemas).toContain("Escribí el mensaje.");
    }
  });

  it("un tipo que el registro no conoce se rechaza", () => {
    expect(validar(esquemaDelMensaje, { tipo: "ensayo", id: ID, texto: "x" }).ok).toBe(false);
  });

  it("no deja pasar un texto ni un grupo de menciones desmedidos", () => {
    expect(
      validar(esquemaDelMensaje, {
        tipo: "orden_trabajo", id: ID, texto: "a".repeat(MAXIMO_DEL_TEXTO + 1),
      }).ok
    ).toBe(false);
    const muchos = Array.from(
      { length: MAXIMO_DE_MENCIONES + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    expect(
      validar(esquemaDelMensaje, { tipo: "orden_trabajo", id: ID, texto: "x", menciones: muchos }).ok
    ).toBe(false);
  });

  it("una mención que no es un id se rechaza", () => {
    expect(
      validar(esquemaDelMensaje, { tipo: "orden_trabajo", id: ID, texto: "x", menciones: ["beto"] }).ok
    ).toBe(false);
  });
});

describe("el hilo de un GET", () => {
  it("lo que falta en la URL no se confunde con un valor mal escrito", () => {
    const r = validar(esquemaDelHilo, parametrosDeLaUrl("https://x.test/api/mensajes", ["tipo", "id"]));
    expect(r.ok).toBe(false);
    // Sin `tipo` zod dice cuáles valen, que es más útil que «falta»; sin `id`,
    // «falta» a secas.
    if (!r.ok) {
      expect(r.problemas[0]).toContain("tipo tiene que ser uno de: orden_trabajo");
      expect(r.problemas[1]).toBe("Falta id.");
    }
  });

  it("lee tipo e id de la URL", () => {
    const r = validar(
      esquemaDelHilo,
      parametrosDeLaUrl(`https://x.test/api/mensajes?tipo=orden_trabajo&id=${ID}`, ["tipo", "id"])
    );
    expect(r.ok).toBe(true);
  });
});
