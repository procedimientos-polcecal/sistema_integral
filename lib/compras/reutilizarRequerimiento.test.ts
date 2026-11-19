import { describe, it, expect } from "vitest";
import {
  copiarDelRequerimiento, numeroDeRi, avisoDeReutilizado,
  type RequerimientoViejo, type Catalogos,
} from "./reutilizarRequerimiento";
import { AMBAS } from "./sectorDelPedido";

const CATALOGOS: Catalogos = {
  areas: ["area-mant", "area-almacen"],
  ubicaciones: ["ubi-taller", "ubi-cantera"],
  equipos: ["eq-d6", "eq-cat320b"],
  empresas: ["emp-polcecal", "emp-polysan"],
  prioridades: ["ALTA", "MEDIA", "BAJA"],
};

const viejo = (p: Partial<RequerimientoViejo> = {}): RequerimientoViejo => ({
  nro_ri: 2184,
  descripcion: "ELECTRODO 7018 X 3,25 MM",
  codigo: "00345",
  cantidad: 30,
  detalle_extra: "Para el taller",
  area_id: "area-mant",
  ubicacion_id: "ubi-taller",
  equipo_id: "eq-d6",
  prioridad: "ALTA",
  empresa_id: "emp-polcecal",
  paga_ambas: false,
  ...p,
});

describe("lo que se copia de un pedido viejo", () => {
  it("copia el material, el lugar y las dos decisiones", () => {
    // Acordado con el usuario el 19/11/2026: todo menos la fecha. El porqué de
    // que la prioridad y quien paga entren —y de que eso NO contradiga el
    // "no se precarga nunca" del modal— esta en el encabezado del modulo.
    const { campos, noEntraron } = copiarDelRequerimiento(viejo(), CATALOGOS);
    expect(campos).toEqual({
      descripcion: "ELECTRODO 7018 X 3,25 MM",
      codigo: "00345",
      cantidad: "30",
      detalle: "Para el taller",
      areaId: "area-mant",
      ubicacionId: "ubi-taller",
      equipoId: "eq-d6",
      prioridad: "ALTA",
      paga: "emp-polcecal",
    });
    expect(noEntraron).toEqual([]);
  });

  it("NO copia la fecha ni la imagen, y no las nombra", () => {
    // Es la regla que el usuario pidio con todas las letras: "copia todo menos
    // las fechas, que las ponés vos". Si alguna de las dos apareciera en
    // `campos`, el formulario la escribiria sin que nadie la haya elegido.
    const campos = copiarDelRequerimiento(viejo(), CATALOGOS).campos;
    expect(campos).not.toHaveProperty("fechaNecesidad");
    expect(campos).not.toHaveProperty("imagenUrl");
    expect(Object.keys(campos).join()).not.toMatch(/fecha|imagen/i);
  });

  it("'Ambas' se copia aunque no sea una empresa del catalogo", () => {
    // AMBAS no esta en `empresas` y no tiene por que estarlo: es un valor que
    // el formulario entiende, igual que en `empresaSugerida`.
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ paga_ambas: true, empresa_id: null }), CATALOGOS
    );
    expect(campos.paga).toBe(AMBAS);
    expect(noEntraron).toEqual([]);
  });

  it("'Ambas' le gana a la empresa si estan las dos", () => {
    // No deberia pasar, pero si pasa: es lo que decide el campo del formulario.
    const { campos } = copiarDelRequerimiento(
      viejo({ paga_ambas: true, empresa_id: "emp-polysan" }), CATALOGOS
    );
    expect(campos.paga).toBe(AMBAS);
  });
});

describe("lo que el desplegable ya no puede mostrar", () => {
  it("una ubicacion dada de baja no entra, y se avisa", () => {
    // El caso real: `compras_ubicaciones.activo` se apaga y el pedido de hace
    // seis meses sigue apuntando ahi. Copiarlo mostraria "—" mientras el
    // formulario guarda otra cosa.
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ ubicacion_id: "ubi-que-ya-no-esta" }), CATALOGOS
    );
    expect(campos).not.toHaveProperty("ubicacionId");
    expect(noEntraron).toEqual(["dónde se necesita"]);
  });

  it("un equipo de baja no entra", () => {
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ equipo_id: "eq-vendido" }), CATALOGOS
    );
    expect(campos).not.toHaveProperty("equipoId");
    expect(noEntraron).toEqual(["el equipo"]);
  });

  it("una empresa que ya no esta no entra, y quien paga queda vacio", () => {
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ empresa_id: "emp-fundida" }), CATALOGOS
    );
    expect(campos).not.toHaveProperty("paga");
    expect(noEntraron).toEqual(["quién paga"]);
  });

  it("una prioridad que el formulario ya no ofrece no entra", () => {
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ prioridad: "URGENTISIMA" }), CATALOGOS
    );
    expect(campos).not.toHaveProperty("prioridad");
    expect(noEntraron).toEqual(["la prioridad"]);
  });

  it("varios a la vez se nombran todos, no el primero", () => {
    const { noEntraron } = copiarDelRequerimiento(
      viejo({ area_id: "x", ubicacion_id: "y", equipo_id: "z" }), CATALOGOS
    );
    expect(noEntraron).toEqual(["el área", "dónde se necesita", "el equipo"]);
  });

  it("un id en null no es un problema: no entra y no se nombra", () => {
    // Un pedido sin equipo es normal —hay pedidos que no son de ninguna
    // maquina—. Avisar de eso seria ruido en el caso corriente.
    const { campos, noEntraron } = copiarDelRequerimiento(
      viejo({ equipo_id: null, prioridad: null }), CATALOGOS
    );
    expect(campos).not.toHaveProperty("equipoId");
    expect(noEntraron).toEqual([]);
  });
});

describe("los textos y la cantidad", () => {
  it("un texto vacio se copia vacio, no se saltea", () => {
    // Copiar es dejar el formulario como ese pedido. Si el viejo no tenia
    // detalle, lo que haya escrito de un intento anterior tiene que irse.
    const { campos } = copiarDelRequerimiento(
      viejo({ detalle_extra: null, codigo: null }), CATALOGOS
    );
    expect(campos.detalle).toBe("");
    expect(campos.codigo).toBe("");
  });

  it("los espacios de los costados se van", () => {
    const { campos } = copiarDelRequerimiento(
      viejo({ descripcion: "  Manguera  " }), CATALOGOS
    );
    expect(campos.descripcion).toBe("Manguera");
  });

  it("una cantidad en cero o negativa no se copia", () => {
    // El formulario no las acepta, asi que copiarlas dejaria un pedido que se
    // niega a enviarse sin que se entienda por que venia asi.
    expect(copiarDelRequerimiento(viejo({ cantidad: 0 }), CATALOGOS).campos.cantidad).toBe("");
    expect(copiarDelRequerimiento(viejo({ cantidad: -5 }), CATALOGOS).campos.cantidad).toBe("");
    expect(copiarDelRequerimiento(viejo({ cantidad: null }), CATALOGOS).campos.cantidad).toBe("");
  });

  it("una cantidad con decimales se copia tal cual", () => {
    expect(copiarDelRequerimiento(viejo({ cantidad: 2.5 }), CATALOGOS).campos.cantidad).toBe("2.5");
  });
});

describe("el numero que alguien escribe", () => {
  it("lee las formas en que se nombra un pedido", () => {
    expect(numeroDeRi("2184")).toBe(2184);
    expect(numeroDeRi("  2184  ")).toBe(2184);
    expect(numeroDeRi("RI 2184")).toBe(2184);
    expect(numeroDeRi("ri2184")).toBe(2184);
  });

  it("lo que no es un numero no pasa", () => {
    // Cero y negativo incluidos: no hay RI 0, y mandarlos solo puede fallar.
    for (const malo of ["", "   ", "abc", "21a84", "-5", "0", "2.5", "2184 y 2185"]) {
      expect(numeroDeRi(malo)).toBeNull();
    }
  });
});

describe("lo que se le dice a quien copio", () => {
  it("siempre pide revisar, porque esos campos no los escribio quien mira", () => {
    expect(avisoDeReutilizado(2184, [])).toBe("Copiado del RI 2184. Revisalo antes de enviar.");
  });

  it("si algo no entro, lo nombra", () => {
    const a = avisoDeReutilizado(2184, ["el equipo", "la prioridad"]);
    expect(a).toContain("RI 2184");
    expect(a).toContain("el equipo, la prioridad");
    expect(a).toContain("ya no está en la lista");
  });
});
