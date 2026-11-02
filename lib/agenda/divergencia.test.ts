import { describe, expect, it } from "vitest";
import { queDivergio } from "./divergencia";

const escrito = { inicio: "2026-11-03T08:00:00-03:00", fin: "2026-11-03T09:30:00-03:00" };
const igual = { ...escrito, cancelado: false, invitados: [] };

describe("queDivergio", () => {
  it("cancelado es un borrado", () => {
    expect(queDivergio(escrito, { ...igual, cancelado: true })).toBe("borrado");
  });
  it("que Google no lo tenga también es un borrado", () => {
    expect(queDivergio(escrito, null)).toBe("borrado");
  });
  it("otro inicio es movido", () => {
    expect(queDivergio(escrito, { ...igual, inicio: "2026-11-03T09:00:00-03:00" })).toBe("movido");
  });
  it("otro fin es movido", () => {
    expect(queDivergio(escrito, { ...igual, fin: "2026-11-03T10:00:00-03:00" })).toBe("movido");
  });
  it("igual que lo escrito no es nada", () => {
    expect(queDivergio(escrito, igual)).toBeNull();
  });
  it("cancelado gana sobre un horario que además cambió", () => {
    expect(queDivergio(escrito, { ...igual, inicio: "2026-11-03T09:00:00-03:00", cancelado: true })).toBe("borrado");
  });

  // El eco de las propias escrituras del SdG.
  it("lo que el SdG acaba de escribir no es divergencia", () => {
    // `escrito` se actualiza en cada escritura propia, así que la notificación
    // que Google manda por ese cambio llega comparando igual contra igual.
    const e = { inicio: "2026-11-03T12:00:00-03:00", fin: "2026-11-03T13:30:00-03:00" };
    expect(queDivergio(e, { ...e, cancelado: false, invitados: [] })).toBeNull();
  });
  it("la misma hora en otra zona es el mismo momento", () => {
    expect(queDivergio(escrito, { ...igual, inicio: "2026-11-03T11:00:00Z", fin: "2026-11-03T12:30:00Z" })).toBeNull();
  });

  // El cambio que más veces va a llegar.
  it("que un invitado acepte o rechace no es divergencia", () => {
    expect(queDivergio(escrito, {
      ...igual, invitados: [{ email: "gerencia@polcecal.com", respuesta: "declined" }],
    })).toBeNull();
  });
  it("cambiar el título o los invitados tampoco es divergencia", () => {
    expect(queDivergio(escrito, {
      ...igual, titulo: "otro título",
      invitados: [{ email: "alguien.nuevo@polcecal.com" }],
    })).toBeNull();
  });

  it("un evento que el SdG todavía no escribió no diverge", () => {
    expect(queDivergio(null, { inicio: "x", fin: "y", cancelado: false, invitados: [] })).toBeNull();
  });
  it("sin escrito ni evento tampoco", () => {
    expect(queDivergio(null, null)).toBeNull();
  });
});
