import { describe, it, expect } from "vitest";
import {
  CLAVES_DE_ETAPA,
  ETAPAS,
  ETAPAS_ABIERTAS,
  estaAbierta,
  etapaDe,
  sePuedePasarDe,
} from "./etapas";

describe("la lista de etapas", () => {
  /**
   * Es el espejo del `check` de `ventas_oportunidades.etapa`. Este test no
   * puede mirar la base: lo que hace es que agregar o renombrar una etapa
   * rompa acá y obligue a acordarse de la migración que falta.
   */
  it("son las seis claves que acepta la base, en ese orden", () => {
    expect(ETAPAS.map((e) => e.clave)).toEqual([
      "contacto_inicial",
      "relevamiento",
      "cotizada",
      "negociacion",
      "ganada",
      "perdida",
    ]);
  });

  it("el orden no se repite y empieza en 1", () => {
    const ordenes = ETAPAS.map((e) => e.orden);
    expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    expect(new Set(ordenes).size).toBe(ETAPAS.length);
    expect(ordenes[0]).toBe(1);
  });

  it("las dos cerradas son las últimas", () => {
    expect(ETAPAS_ABIERTAS.map((e) => e.clave)).toEqual([
      "contacto_inicial",
      "relevamiento",
      "cotizada",
      "negociacion",
    ]);
  });

  it("la probabilidad crece con la etapa y vive entre 0 y 100", () => {
    for (const e of ETAPAS) {
      expect(e.probabilidad).toBeGreaterThanOrEqual(0);
      expect(e.probabilidad).toBeLessThanOrEqual(100);
    }
    const abiertas = ETAPAS_ABIERTAS.map((e) => e.probabilidad);
    expect(abiertas).toEqual([...abiertas].sort((a, b) => a - b));
    expect(etapaDe("ganada")!.probabilidad).toBe(100);
    expect(etapaDe("perdida")!.probabilidad).toBe(0);
  });

  it("CLAVES_DE_ETAPA dice lo mismo que ETAPAS", () => {
    expect([...CLAVES_DE_ETAPA]).toEqual(ETAPAS.map((e) => e.clave));
  });
});

describe("etapaDe", () => {
  it("encuentra la etapa por su clave", () => {
    expect(etapaDe("cotizada")?.nombre).toBe("Cotizada");
  });

  // Una etapa que no se reconoce se muestra como desconocida; lanzar dejaría
  // la pantalla en blanco por una fila vieja.
  it("devuelve null para lo que no es una etapa, incluido null y vacío", () => {
    expect(etapaDe("inventada")).toBeNull();
    expect(etapaDe(null)).toBeNull();
    expect(etapaDe(undefined)).toBeNull();
    expect(etapaDe("")).toBeNull();
  });
});

describe("estaAbierta", () => {
  it("las cuatro primeras sí, las dos cerradas no", () => {
    expect(estaAbierta("contacto_inicial")).toBe(true);
    expect(estaAbierta("negociacion")).toBe(true);
    expect(estaAbierta("ganada")).toBe(false);
    expect(estaAbierta("perdida")).toBe(false);
  });

  it("una clave que no existe no cuenta como abierta", () => {
    expect(estaAbierta("inventada")).toBe(false);
    expect(estaAbierta(null)).toBe(false);
  });
});

describe("sePuedePasarDe", () => {
  it("avanza", () => {
    expect(sePuedePasarDe("relevamiento", "cotizada")).toBe(true);
  });

  // A propósito: el cliente cambió el pedido y la cotización vuelve atrás.
  // Obligar a cerrarla y abrir otra rompería el historial de esa venta.
  it("también vuelve para atrás", () => {
    expect(sePuedePasarDe("cotizada", "relevamiento")).toBe(true);
  });

  it("cierra desde cualquier etapa abierta", () => {
    expect(sePuedePasarDe("contacto_inicial", "perdida")).toBe(true);
    expect(sePuedePasarDe("negociacion", "ganada")).toBe(true);
  });

  // Lo único que no se puede. `cerrada_el` ya alimentó el informe del mes:
  // reabrirla dejaría una fecha de cierre sobre algo que no está cerrado.
  it("no sale de una cerrada", () => {
    expect(sePuedePasarDe("ganada", "negociacion")).toBe(false);
    expect(sePuedePasarDe("perdida", "cotizada")).toBe(false);
    expect(sePuedePasarDe("ganada", "perdida")).toBe(false);
  });

  it("deja quedarse donde está, aunque esté cerrada", () => {
    // Un PATCH que toca las notas manda la etapa sin cambiarla.
    expect(sePuedePasarDe("ganada", "ganada")).toBe(true);
  });

  it("sin etapa de origen es un alta: vale cualquier etapa válida", () => {
    expect(sePuedePasarDe(null, "contacto_inicial")).toBe(true);
    expect(sePuedePasarDe(undefined, "ganada")).toBe(true);
  });

  it("nunca se pasa a algo que no es una etapa", () => {
    expect(sePuedePasarDe("cotizada", "inventada")).toBe(false);
    expect(sePuedePasarDe(null, "inventada")).toBe(false);
  });
});
