import { describe, expect, it } from "vitest";
import { MAX_COMENTARIO, normalizarComentario } from "./comentario";

describe("normalizarComentario", () => {
  it("si no vino, no se toca lo guardado", () => {
    expect(normalizarComentario(undefined)).toEqual({ ok: true, valor: undefined });
  });

  it("vacío, espacios y null son 'sin comentario'", () => {
    expect(normalizarComentario("")).toEqual({ ok: true, valor: null });
    expect(normalizarComentario("   ")).toEqual({ ok: true, valor: null });
    expect(normalizarComentario(null)).toEqual({ ok: true, valor: null });
  });

  it("recorta los espacios de los bordes", () => {
    expect(normalizarComentario("  Se olvidó de fichar la salida ")).toEqual({
      ok: true,
      valor: "Se olvidó de fichar la salida",
    });
  });

  it("rechaza lo que no es texto", () => {
    expect(normalizarComentario(5).ok).toBe(false);
  });

  it("rechaza el que pasa del máximo y dice cuánto tiene", () => {
    const r = normalizarComentario("a".repeat(MAX_COMENTARIO + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(MAX_COMENTARIO + 1));
  });

  it("acepta justo el máximo", () => {
    expect(normalizarComentario("a".repeat(MAX_COMENTARIO)).ok).toBe(true);
  });
});
