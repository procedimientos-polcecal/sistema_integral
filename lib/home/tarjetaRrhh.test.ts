import { describe, expect, it } from "vitest";
import { armarTarjetaRrhh, contarPresentes, presentesDeTotal, type ResumenRrhh } from "./tarjetaRrhh";

const base: ResumenRrhh = {
  empleadosActivos: 68,
  dia: "2026-09-30",
  diaLegible: "30/09/2026",
  ausentes: 5,
  sinClasificar: 2,
  presentesHoy: 0,
};

describe("contarPresentes", () => {
  it("cuenta personas y no fichadas", () => {
    // Quien sale a almorzar y vuelve tiene dos filas.
    expect(contarPresentes(["a", "a", "b"], ["a", "b", "c"])).toBe(2);
  });

  it("no cuenta a quien ya no es activo", () => {
    // Si no, la tarjeta diría "69 de 68".
    expect(contarPresentes(["a", "baja"], ["a", "b"])).toBe(1);
  });

  it("sin fichadas son cero", () => {
    expect(contarPresentes([], ["a", "b"])).toBe(0);
  });

  it("acepta cualquier iterable de activos", () => {
    expect(contarPresentes(["a"], new Set(["a"]))).toBe(1);
  });
});

describe("presentesDeTotal", () => {
  it("se lee N de M", () => {
    expect(presentesDeTotal(42, 68)).toBe("42 de 68");
  });
});

describe("armarTarjetaRrhh", () => {
  describe("con marcaciones de hoy", () => {
    const t = armarTarjetaRrhh({ ...base, presentesHoy: 42 });

    it("el titular son los presentes", () => {
      expect(t.hero).toEqual({ label: "Presentes hoy", valor: "42 de 68" });
    });

    it("los ausentes del último día hábil bajan a secundaria, con su día", () => {
      expect(t.secundarias).toContainEqual({ label: "Ausentes el 30/09/2026", valor: 5 });
    });

    it("sin clasificar sigue estando, y dice de qué día es", () => {
      expect(t.secundarias).toContainEqual({ label: "Sin clasificar el 30/09/2026", valor: 2 });
    });

    // Se dispara apenas hay una persona: es un conteo que crece.
    it("una sola marcación ya alcanza", () => {
      const uno = armarTarjetaRrhh({ ...base, presentesHoy: 1 });
      expect(uno.hero).toEqual({ label: "Presentes hoy", valor: "1 de 68" });
    });
  });

  describe("sin marcaciones de hoy", () => {
    const t = armarTarjetaRrhh({ ...base, presentesHoy: 0 });

    it("el titular es el de siempre", () => {
      expect(t.hero).toEqual({ label: "Ausentes el 30/09/2026", valor: 5 });
    });

    it("nunca muestra '0 de N' como titular", () => {
      expect(String(t.hero.valor)).not.toMatch(/de/);
      expect(t.hero.label).not.toMatch(/Presentes/);
    });

    it("conserva las secundarias que ya había", () => {
      expect(t.secundarias).toContainEqual({ label: "Empleados activos", valor: 68 });
      expect(t.secundarias).toContainEqual({ label: "Sin clasificar", valor: 2 });
    });

    it("dice con palabras que no entró ninguna marcación", () => {
      expect(t.secundarias).toContainEqual({ label: "Marcaciones de hoy", valor: "Ninguna todavía" });
    });
  });

  describe("cuando no se pudo leer fichadas", () => {
    const t = armarTarjetaRrhh({ ...base, presentesHoy: null });

    it("el titular es el de siempre", () => {
      expect(t.hero).toEqual({ label: "Ausentes el 30/09/2026", valor: 5 });
    });

    // Un error no es "ninguna marcación": no se afirma nada.
    it("no afirma que no haya marcaciones", () => {
      expect(t.secundarias.map((s) => s.label)).not.toContain("Marcaciones de hoy");
    });

    it("deja exactamente las dos secundarias de antes", () => {
      expect(t.secundarias).toEqual([
        { label: "Empleados activos", valor: 68 },
        { label: "Sin clasificar", valor: 2 },
      ]);
    });
  });

  describe("sin ningún día de referencia", () => {
    const sinDia = { ...base, dia: null, diaLegible: null, ausentes: 0, sinClasificar: 0 };

    it("sin marcaciones, igual que antes: 'Sin fichadas importadas'", () => {
      const t = armarTarjetaRrhh({ ...sinDia, presentesHoy: null });
      expect(t.hero).toEqual({ label: "Sin fichadas importadas", valor: "—" });
    });

    it("con marcaciones de hoy, los presentes igual son el titular", () => {
      // La primera mañana tras activar la integración, si no hubiera días anteriores.
      const t = armarTarjetaRrhh({ ...sinDia, presentesHoy: 12 });
      expect(t.hero).toEqual({ label: "Presentes hoy", valor: "12 de 68" });
      expect(t.secundarias).toContainEqual({ label: "Sin fichadas importadas", valor: "—" });
    });
  });
});
