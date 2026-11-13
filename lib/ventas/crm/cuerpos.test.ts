import { describe, it, expect } from "vitest";
import {
  cuitParaGuardar,
  esquemaDeActividad,
  esquemaDeCliente,
  esquemaDeClienteParcial,
  esquemaDeOportunidad,
  problemaDelCierre,
  problemaDelProximoPaso,
} from "./cuerpos";

const UUID = "0b2a9a4e-3f5b-4a2e-9c1d-6f8e7a5b4c3d";

describe("esquemaDeCliente", () => {
  it("pide la razón social y nada más", () => {
    expect(esquemaDeCliente.safeParse({ razon_social: "Cementos del Sur" }).success).toBe(true);
    expect(esquemaDeCliente.safeParse({}).success).toBe(false);
  });

  it("una razón social de puros espacios no alcanza", () => {
    expect(esquemaDeCliente.safeParse({ razon_social: "   " }).success).toBe(false);
  });

  /**
   * Un `""` y un null se ven igual en la ficha y se comportan distinto en un
   * filtro. Borrar el campo en la pantalla tiene que dejarlo vacío de verdad.
   */
  it("un texto opcional vacío se guarda como null", () => {
    const r = esquemaDeCliente.safeParse({ razon_social: "X", localidad: "  " });
    expect(r.success && r.data.localidad).toBeNull();
  });

  it("recorta los espacios de los textos", () => {
    const r = esquemaDeCliente.safeParse({ razon_social: "  Cal del Valle  " });
    expect(r.success && r.data.razon_social).toBe("Cal del Valle");
  });

  it("un correo que no es correo se rechaza", () => {
    expect(esquemaDeCliente.safeParse({ razon_social: "X", email: "no-es" }).success).toBe(false);
    expect(esquemaDeCliente.safeParse({ razon_social: "X", email: "a@b.com" }).success).toBe(true);
  });

  it("un estado inventado se rechaza", () => {
    expect(esquemaDeCliente.safeParse({ razon_social: "X", estado: "cliente" }).success).toBe(false);
    expect(esquemaDeCliente.safeParse({ razon_social: "X", estado: "activo" }).success).toBe(true);
  });

  /**
   * El parcial es el mismo esquema con `.partial()` y no uno escrito aparte:
   * dos copias de una validación terminan diciendo cosas distintas, y la que se
   * olvida de cambiar es la que queda abierta.
   */
  it("el parcial deja corregir un campo solo pero sigue validando lo que llega", () => {
    expect(esquemaDeClienteParcial.safeParse({ telefono: "2954-11" }).success).toBe(true);
    expect(esquemaDeClienteParcial.safeParse({ email: "no-es" }).success).toBe(false);
    expect(esquemaDeClienteParcial.safeParse({ razon_social: "  " }).success).toBe(false);
  });
});

describe("esquemaDeOportunidad", () => {
  const base = { cliente_id: UUID, titulo: "Cal viva 2027" };

  it("pide cliente y título", () => {
    expect(esquemaDeOportunidad.safeParse(base).success).toBe(true);
    expect(esquemaDeOportunidad.safeParse({ titulo: "X" }).success).toBe(false);
    expect(esquemaDeOportunidad.safeParse({ cliente_id: UUID }).success).toBe(false);
  });

  /**
   * No hay devoluciones en una oportunidad. Un signo invertido daría un embudo
   * que se achica cuando alguien se equivoca, que es un error que nadie busca.
   */
  it("no acepta montos ni toneladas negativos", () => {
    expect(esquemaDeOportunidad.safeParse({ ...base, monto_estimado: -1 }).success).toBe(false);
    expect(esquemaDeOportunidad.safeParse({ ...base, toneladas_estimadas: -0.5 }).success).toBe(
      false
    );
    expect(esquemaDeOportunidad.safeParse({ ...base, monto_estimado: 0 }).success).toBe(true);
  });

  it("sólo acepta las seis etapas y las dos monedas", () => {
    expect(esquemaDeOportunidad.safeParse({ ...base, etapa: "cotizada" }).success).toBe(true);
    expect(esquemaDeOportunidad.safeParse({ ...base, etapa: "inventada" }).success).toBe(false);
    expect(esquemaDeOportunidad.safeParse({ ...base, moneda: "EUR" }).success).toBe(false);
  });
});

describe("esquemaDeActividad", () => {
  const base = { cliente_id: UUID, tipo: "llamado", resumen: "Pidió precio de cal" };

  it("pide cliente, tipo y resumen", () => {
    expect(esquemaDeActividad.safeParse(base).success).toBe(true);
    expect(esquemaDeActividad.safeParse({ ...base, resumen: " " }).success).toBe(false);
    expect(esquemaDeActividad.safeParse({ ...base, tipo: "paloma" }).success).toBe(false);
  });

  // La tabla tiene default current_date: la fecha se tipea cuando hace falta.
  it("la fecha es opcional y tiene que ser una fecha", () => {
    expect(esquemaDeActividad.safeParse(base).success).toBe(true);
    expect(esquemaDeActividad.safeParse({ ...base, fecha: "12/11/2026" }).success).toBe(false);
    expect(esquemaDeActividad.safeParse({ ...base, fecha: "2026-11-12" }).success).toBe(true);
  });
});

describe("problemaDelProximoPaso", () => {
  it("los dos juntos está bien, y ninguno también", () => {
    expect(problemaDelProximoPaso("Llamar al jefe de compras", "2026-11-20")).toBeNull();
    expect(problemaDelProximoPaso(null, null)).toBeNull();
    expect(problemaDelProximoPaso(undefined, undefined)).toBeNull();
  });

  it("uno solo no", () => {
    expect(problemaDelProximoPaso("Llamar", null)).toMatch(/para cuándo/i);
    expect(problemaDelProximoPaso(null, "2026-11-20")).toMatch(/cuál es/i);
  });

  it("un texto vacío cuenta como que no vino", () => {
    expect(problemaDelProximoPaso("", "2026-11-20")).toMatch(/cuál es/i);
  });
});

describe("problemaDelCierre", () => {
  /**
   * El porqué de una venta perdida es el único dato del CRM que no se
   * reconstruye mirando los números, y el que nadie carga si no se lo piden.
   */
  it("perder pide motivo", () => {
    expect(problemaDelCierre("perdida", null)).toMatch(/por qué/i);
    expect(problemaDelCierre("perdida", "   ")).toMatch(/por qué/i);
    expect(problemaDelCierre("perdida", "Precio")).toBeNull();
  });

  it("ninguna otra etapa lo pide", () => {
    expect(problemaDelCierre("ganada", null)).toBeNull();
    expect(problemaDelCierre("cotizada", null)).toBeNull();
    expect(problemaDelCierre(undefined, null)).toBeNull();
  });
});

describe("cuitParaGuardar", () => {
  // 30-71044963-1 es un CUIT con dígito verificador correcto.
  it("normaliza a once dígitos y no avisa nada cuando cierra", () => {
    expect(cuitParaGuardar("30-71044963-1")).toEqual({ cuit: "30710449631", aviso: null });
    expect(cuitParaGuardar(" 30710449631 ")).toEqual({ cuit: "30710449631", aviso: null });
  });

  it("vacío es null sin aviso", () => {
    expect(cuitParaGuardar(null)).toEqual({ cuit: null, aviso: null });
    expect(cuitParaGuardar("  ")).toEqual({ cuit: null, aviso: null });
  });

  /**
   * Nunca rechaza. Descartarlo en silencio es cómo el dato desaparece sin que
   * nadie se entere — el mismo criterio que `cuitEsValido` del núcleo, que
   * existe para informar y no para frenar.
   */
  it("lo que no tiene once dígitos se guarda igual, con aviso", () => {
    const r = cuitParaGuardar("3071044");
    expect(r.cuit).toBe("3071044");
    expect(r.aviso).toMatch(/once dígitos/);
  });

  it("si el dígito verificador no cierra, se guarda normalizado y se avisa", () => {
    const r = cuitParaGuardar("30-71044963-9");
    expect(r.cuit).toBe("30710449639");
    expect(r.aviso).toMatch(/dígito verificador/);
  });
});
