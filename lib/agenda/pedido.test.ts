import { describe, it, expect } from "vitest";
import { validar } from "@/lib/core/validar";
import {
  aInstanteISO, aHoraDePared, idDeGoogleDe, invitadosLimpios, eventoParaGoogle, divergenciaVista,
  esquemaDeAlta, esquemaDeCambio, esquemaDeDestrabar, mensajeDeEventoDeOT,
  conSegundos,
} from "./pedido";

describe("las horas", () => {
  it("una hora sin zona es de Argentina: 08:00 son las 11:00 UTC", () => {
    expect(aInstanteISO("2026-11-03T08:00:00")).toBe("2026-11-03T11:00:00.000Z");
  });
  it("una hora con zona se respeta", () => {
    expect(aInstanteISO("2026-11-03T08:00:00-03:00")).toBe("2026-11-03T11:00:00.000Z");
    expect(aInstanteISO("2026-11-03T11:00:00Z")).toBe("2026-11-03T11:00:00.000Z");
  });
  it("una hora que no es una hora da null", () => {
    expect(aInstanteISO("mañana")).toBeNull();
    expect(aHoraDePared("mañana")).toBeNull();
  });
  it("lo que devuelve la base vuelve a hora de pared de Argentina y sin offset", () => {
    expect(aHoraDePared("2026-11-03T11:00:00+00:00")).toBe("2026-11-03T08:00:00");
    expect(aHoraDePared("2026-11-03T11:00:00.123456+00:00")).toBe("2026-11-03T08:00:00");
  });
  it("ida y vuelta no mueve la hora, ni cruzando la medianoche", () => {
    for (const t of ["2026-11-03T08:00:00", "2026-11-03T23:30:00", "2026-11-03T00:15:00"]) {
      expect(aHoraDePared(aInstanteISO(t)!)).toBe(t);
    }
  });
});

describe("las horas sin segundos (datetime-local)", () => {
  it("conSegundos completa la que no los trae, con o sin zona", () => {
    expect(conSegundos("2026-11-03T08:00")).toBe("2026-11-03T08:00:00");
    expect(conSegundos("2026-11-03T08:00-03:00")).toBe("2026-11-03T08:00:00-03:00");
    expect(conSegundos("2026-11-03T08:00Z")).toBe("2026-11-03T08:00:00Z");
  });
  it("no toca la que ya los trae ni lo que no es una hora", () => {
    expect(conSegundos("2026-11-03T08:00:30")).toBe("2026-11-03T08:00:30");
    expect(conSegundos("mañana")).toBe("mañana");
    expect(conSegundos("")).toBe("");
  });
  it("aInstanteISO y aHoraDePared aceptan lo que manda un <input type=datetime-local>", () => {
    expect(aInstanteISO("2026-11-03T08:00")).toBe("2026-11-03T11:00:00.000Z");
    expect(aHoraDePared("2026-11-03T08:00")).toBe("2026-11-03T08:00:00");
  });
  it("el alta y el cambio las normalizan antes de que problemasDelEvento las mire", () => {
    const alta = validar(esquemaDeAlta, { titulo: "x", inicio: "2026-11-03T08:00", fin: "2026-11-03T09:30" });
    expect(alta.ok && alta.datos.inicio).toBe("2026-11-03T08:00:00");
    expect(alta.ok && alta.datos.fin).toBe("2026-11-03T09:30:00");
    const cambio = validar(esquemaDeCambio, { inicio: "2026-11-03T08:00" });
    expect(cambio.ok && cambio.datos.inicio).toBe("2026-11-03T08:00:00");
    const sin = validar(esquemaDeCambio, { titulo: "x" });
    expect(sin.ok && sin.datos.inicio).toBeUndefined();
  });
});

describe("el id de Google", () => {
  it("es el uuid sin guiones y en minúscula, que es base32hex válido", () => {
    const id = idDeGoogleDe("0123ABCD-4567-89ab-cdef-0123456789AB");
    expect(id).toBe("0123abcd456789abcdef0123456789ab");
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});

describe("los invitados", () => {
  it("se limpian, no se repiten y no incluyen al dueño", () => {
    expect(
      invitadosLimpios([" Ana@Polcecal.com", "ana@polcecal.com", "yo@polcecal.com", "luis@x.com"], "Yo@polcecal.com")
    ).toEqual(["ana@polcecal.com", "luis@x.com"]);
  });
});

describe("eventoParaGoogle", () => {
  it("manda la hora de pared, el id derivado y los campos vacíos como texto vacío", () => {
    const e = eventoParaGoogle(
      {
        id: "0123abcd-4567-89ab-cdef-0123456789ab",
        titulo: "Reunión",
        descripcion: null,
        lugar: null,
        inicio: "2026-11-03T11:00:00+00:00",
        fin: "2026-11-03T12:30:00+00:00",
      },
      ["ana@polcecal.com", "yo@polcecal.com"],
      "yo@polcecal.com"
    );
    expect(e).toEqual({
      id: "0123abcd456789abcdef0123456789ab",
      titulo: "Reunión",
      descripcion: "",
      lugar: "",
      inicio: "2026-11-03T08:00:00",
      fin: "2026-11-03T09:30:00",
      invitados: ["ana@polcecal.com"],
    });
  });
});

describe("mensajeDeEventoDeOT", () => {
  it("nombra la orden con su número y dice por qué", () => {
    const m = mensajeDeEventoDeOT("modificar", 2901);
    expect(m).toContain("la orden de trabajo 2901");
    expect(m).toContain("No se puede modificar");
    expect(m).toMatch(/se perdería sin avisar/);
  });
  it("aceptar dice que la verdad es la orden y que reescribir sí se puede", () => {
    const m = mensajeDeEventoDeOT("aceptar", 2901);
    expect(m).toContain("la orden de trabajo 2901");
    expect(m).toMatch(/la verdad es la orden/);
    expect(m).toMatch(/reescribilo/);
  });
  it("sin número no lo inventa", () => {
    const m = mensajeDeEventoDeOT("borrar", null);
    expect(m).toContain("una orden de trabajo");
    expect(m).not.toMatch(/\d{3,}/);
    expect(m).toContain("No se puede borrar");
  });
});

describe("divergenciaVista", () => {
  const el = "2026-11-03T11:00:00+00:00";
  it("la vista de esa misma divergencia cuenta", () => {
    expect(divergenciaVista(el, [{ divergencia_el: "2026-11-03T11:00:00+00:00" }])).toBe(true);
  });
  it("la misma hora escrita con otra zona es la misma divergencia", () => {
    expect(divergenciaVista(el, [{ divergencia_el: "2026-11-03T08:00:00-03:00" }])).toBe(true);
  });
  it("una divergencia nueva vuelve a aparecer", () => {
    expect(divergenciaVista("2026-11-04T09:00:00+00:00", [{ divergencia_el: el }])).toBe(false);
  });
  it("sin divergencia no hay nada que ver", () => {
    expect(divergenciaVista(null, [{ divergencia_el: el }])).toBe(false);
  });
});

describe("los cuerpos", () => {
  it("un alta vacía informa todo junto y no sólo lo primero", () => {
    const r = validar(esquemaDeAlta, {});
    expect(r.ok).toBe(true); // lo que falta lo dice problemasDelEvento, con todo lo demás
    if (r.ok) expect(r.datos).toMatchObject({ titulo: "", inicio: "", fin: "", invitados: [] });
  });
  it("un alta con tipos equivocados se rechaza en castellano", () => {
    const r = validar(esquemaDeAlta, { titulo: 5, invitados: "ana@x.com" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.length).toBe(2);
  });
  it("el cambio acepta vaciar la descripción con null", () => {
    const r = validar(esquemaDeCambio, { descripcion: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.descripcion).toBeNull();
  });
  it("destrabar sólo conoce reescribir y aceptar", () => {
    expect(validar(esquemaDeDestrabar, { como: "reescribir" }).ok).toBe(true);
    expect(validar(esquemaDeDestrabar, { como: "aceptar" }).ok).toBe(true);
    const r = validar(esquemaDeDestrabar, { como: "pisar" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas[0]).toContain("reescribir, aceptar");
  });
});
