import { describe, it, expect } from "vitest";
import {
  estadoDelLibro, filaDePlanta, filaDeSector, filaDeEquipo, buscarCodigo,
} from "./inventario";

describe("estadoDelLibro", () => {
  it("traduce las abreviaturas que usa el libro", () => {
    // Verificado: de los 239 equipos, 24 traen estado y son "op", "rep" o
    // "fuera".
    expect(estadoDelLibro("op")).toBe("OPERATIVO");
    expect(estadoDelLibro("rep")).toBe("EN_REPARACION");
    expect(estadoDelLibro("fuera")).toBe("FUERA_DE_SERVICIO");
  });

  it("no depende de mayúsculas ni espacios", () => {
    expect(estadoDelLibro("  OP ")).toBe("OPERATIVO");
  });

  it("acepta el estado escrito entero", () => {
    expect(estadoDelLibro("OPERATIVO")).toBe("OPERATIVO");
    expect(estadoDelLibro("En reparación")).toBe("EN_REPARACION");
  });

  it("una máquina sin estado se da por operativa", () => {
    // Es de lo que se parte: 215 equipos vienen sin estado, y darlos por
    // fuera de servicio apagaría media planta.
    expect(estadoDelLibro("")).toBe("OPERATIVO");
    expect(estadoDelLibro(null)).toBe("OPERATIVO");
    expect(estadoDelLibro("cualquier cosa")).toBe("OPERATIVO");
  });
});

describe("filaDePlanta", () => {
  it("lee una planta", () => {
    const p = filaDePlanta({ planta_id: "POLCECAL", nombre_planta: "Polcecal" });
    expect(p).toEqual({ codigo: "POLCECAL", nombre: "Polcecal", compartida: false });
  });

  it("reconoce la planta que no es una planta", () => {
    // "AMBOS" es donde van los equipos que sirven a las dos empresas.
    expect(filaDePlanta({ planta_id: "AMBOS", nombre_planta: "Ambos" })?.compartida).toBe(true);
  });

  it("descarta una fila sin identificador", () => {
    expect(filaDePlanta({ nombre_planta: "Sin id" })).toBeNull();
  });
});

describe("filaDeSector", () => {
  it("lee un sector", () => {
    const s = filaDeSector({
      sector_id: "PO-B1", planta_id: "POLCECAL", nombre_sector: "Calcinación",
      proceso_principal: "Calcinación de caliza",
    });
    expect(s).toEqual({
      codigo: "PO-B1",
      planta: "POLCECAL",
      nombre: "Calcinación",
      descripcion: "Calcinación de caliza",
    });
  });

  it("necesita código y nombre", () => {
    expect(filaDeSector({ sector_id: "PO-B1" })).toBeNull();
    expect(filaDeSector({ nombre_sector: "Calcinación" })).toBeNull();
  });
});

describe("filaDeEquipo", () => {
  const FILA = {
    equipo_id: "PO-A1-02", tipo_id: "RM", sector_id: "PO-A1", planta_id: "POLCECAL",
    nombre_equipo: "Rompedora de mandíbulas",
    descripcion_proceso: "Tritura la piedra bruta",
    potencia_kw: 55, estado: "op", marca: "Metso",
  };

  it("lee un equipo", () => {
    const e = filaDeEquipo(FILA)!;
    expect(e.code).toBe("PO-A1-02");
    expect(e.sector).toBe("PO-A1");
    expect(e.campos.name).toBe("Rompedora de mandíbulas");
    expect(e.campos.power_kw).toBe(55);
    expect(e.campos.status).toBe("OPERATIVO");
    expect(e.campos.tipo_id).toBe("RM");
    expect(e.campos.marca).toBe("Metso");
  });

  it("guarda para qué sirve la máquina", () => {
    expect(filaDeEquipo(FILA)!.campos.descripcion_proceso).toBe("Tritura la piedra bruta");
  });

  it("no manda los campos de ficha que el libro trae vacíos", () => {
    // El relevamiento todavía no se hizo: de 239 equipos, 15 tienen marca y
    // ninguno rodamientos. Mandarlos en null borraría lo que alguien cargue.
    const e = filaDeEquipo({ ...FILA, marca: "", modelo: "" })!;
    expect(e.campos).not.toHaveProperty("marca");
    expect(e.campos).not.toHaveProperty("modelo");
  });

  it("necesita código y nombre", () => {
    expect(filaDeEquipo({ equipo_id: "PO-A1-02" })).toBeNull();
    expect(filaDeEquipo({ nombre_equipo: "Sin código" })).toBeNull();
  });

  it("acepta los códigos cortos de los equipos compartidos", () => {
    // C1..C5 y EM1..EM16 no siguen el patrón SECTOR-NN.
    const e = filaDeEquipo({
      equipo_id: "EM2", sector_id: "AMB-EM", planta_id: "AMBOS",
      nombre_equipo: "Retroexcavadora 2",
    })!;
    expect(e.code).toBe("EM2");
    expect(e.sector).toBe("AMB-EM");
  });
});

describe("buscarCodigo", () => {
  const conocidos = ["PO-A1-01", "EM2", "EM16", "C1"];

  it("encuentra el código largo dentro del texto", () => {
    expect(buscarCodigo("PO-A1-01 Compresor A1", conocidos)).toBe("PO-A1-01");
    expect(buscarCodigo("Compresor (po-a1-01)", conocidos)).toBe("PO-A1-01");
  });

  it("encuentra el código corto, que ningún patrón reconocería", () => {
    // La planilla de OS dice "EM2 - Caterpillar 320 C".
    expect(buscarCodigo("EM2 - Caterpillar 320 C", conocidos)).toBe("EM2");
    expect(buscarCodigo("Compresor C1", conocidos)).toBe("C1");
  });

  it("prefiere el código más largo cuando uno contiene al otro", () => {
    // "EM1" está dentro de "EM16": tomar el corto lo mandaría a otra máquina.
    expect(buscarCodigo("Reparación de EM16", conocidos)).toBe("EM16");
  });

  it("no lo confunde con una palabra que lo contiene", () => {
    expect(buscarCodigo("Cambio de aceite en el SEC1", conocidos)).toBeNull();
    expect(buscarCodigo("EM20 no existe", conocidos)).toBeNull();
  });

  it("devuelve null cuando no hay nada que reconocer", () => {
    expect(buscarCodigo("", conocidos)).toBeNull();
    expect(buscarCodigo("Bomba de agua", conocidos)).toBeNull();
  });
});

describe("buscarCodigo con códigos de sector", () => {
  const sectores = ["PO-A1", "PO-C1", "AMB-EM"];

  it("reconoce el sector cuando el trabajo no es sobre una máquina", () => {
    // 296 OT dicen cosas como "PO-C1 - Edificio": no hay equipo, pero sí se
    // sabe en qué sector se trabajó.
    expect(buscarCodigo("PO-C1 - Edificio", sectores)).toBe("PO-C1");
  });

  it("no confunde el sector con un equipo de ese sector", () => {
    // "PO-A1" está dentro de "PO-A1-01", pero son cosas distintas y el equipo
    // ya se resolvió antes.
    expect(buscarCodigo("PO-A1-01 Acarreador", sectores)).toBeNull();
  });
});
