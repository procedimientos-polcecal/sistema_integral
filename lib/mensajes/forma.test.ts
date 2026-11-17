import { describe, it, expect } from "vitest";
import { darFormaAlMensaje, type FilaDeMensaje } from "./forma";

const fila: FilaDeMensaje = {
  id: "m1",
  texto: "¿Llegó el repuesto?",
  creado_en: "2026-11-11T10:00:00Z",
  creado_por: "ana",
  autor: { nombre: "Ana", apellido: "Pérez" },
  menciones: [
    {
      usuario_id: "beto",
      leido_en: "2026-11-11T11:00:00Z",
      avisado_en: null,
      aviso_fallo: "El servicio de correo no lo pudo enviar: casilla beto@polcecal.com",
      usuario: { nombre: "Beto", apellido: "Gómez" },
    },
  ],
};

describe("darFormaAlMensaje", () => {
  it("al autor le muestra por qué falló el aviso", () => {
    const m = darFormaAlMensaje(fila, "ana");
    expect(m.menciones[0].aviso).toBe("fallo");
    expect(m.menciones[0].aviso_fallo).toContain("beto@polcecal.com");
  });

  it("a los demás les muestra el estado pero no el texto del servicio de correo", () => {
    const m = darFormaAlMensaje(fila, "carla");
    expect(m.menciones[0].aviso).toBe("fallo");
    // Lo que sale es lo que llega del otro lado: se pregunta sobre el JSON.
    expect(JSON.stringify(m)).not.toContain("beto@polcecal.com");
  });

  it("de la lectura ajena sale un sí o un no, nunca la hora", () => {
    const m = darFormaAlMensaje(fila, "carla");
    expect(m.menciones[0].leido).toBe(true);
    expect(JSON.stringify(m)).not.toContain("11:00:00");
  });

  it("un mensaje sin menciones es una nota del registro: lista vacía", () => {
    expect(darFormaAlMensaje({ ...fila, menciones: [] }, "ana").menciones).toEqual([]);
    expect(darFormaAlMensaje({ ...fila, menciones: null }, "ana").menciones).toEqual([]);
  });

  it("un autor que ya no está en la tabla sale como null", () => {
    expect(darFormaAlMensaje({ ...fila, autor: null }, "ana").autor).toBeNull();
    expect(darFormaAlMensaje(fila, "ana").autor).toBe("Ana Pérez");
  });
});
