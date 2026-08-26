import { describe, it, expect } from "vitest";
import {
  entero, fechaDeExcel, filaDeTipo, filaDeFicha, filaDeComponente,
  fichaDesdeFormulario,
} from "./ficha";

describe("entero", () => {
  it("lee un número entero", () => {
    expect(entero(1450)).toBe(1450);
    expect(entero("1450")).toBe(1450);
  });

  it("redondea en vez de truncar", () => {
    // 1449.6 rpm es 1450, no 1449.
    expect(entero(1449.6)).toBe(1450);
  });

  it("devuelve null cuando no hay número", () => {
    expect(entero("")).toBeNull();
    expect(entero(null)).toBeNull();
    expect(entero("s/d")).toBeNull();
  });

  it("no confunde el cero con vacío", () => {
    // El origen usaba `Number(v) || null`, que convertía el 0 en null.
    expect(entero(0)).toBe(0);
  });
});

describe("fechaDeExcel", () => {
  it("lee el serial", () => {
    expect(fechaDeExcel(45994)).toBe("2025-12-03");
  });

  it("lee la fecha escrita a mano", () => {
    expect(fechaDeExcel("3/12/2025")).toBe("2025-12-03");
  });

  it("devuelve null si no hay fecha", () => {
    expect(fechaDeExcel("")).toBeNull();
    expect(fechaDeExcel("nunca")).toBeNull();
  });
});

describe("filaDeTipo", () => {
  it("lee un tipo de equipo", () => {
    const t = filaDeTipo({
      tipo_id: " TIP-001 ",
      categoria: "Rotativo",
      nombre_tipo: "Cinta transportadora",
      lubricante_tipo: "Grasa EP2",
    });
    expect(t).not.toBeNull();
    expect(t!.tipo_id).toBe("TIP-001");
    expect(t!.nombre_tipo).toBe("Cinta transportadora");
    expect(t!.lubricante_tipo).toBe("Grasa EP2");
  });

  it("descarta una fila sin identificador", () => {
    expect(filaDeTipo({ nombre_tipo: "Sin id" })).toBeNull();
  });

  it("no inventa columnas que la hoja no trae", () => {
    const t = filaDeTipo({ tipo_id: "TIP-002" })!;
    expect(t.categoria).toBeNull();
    expect(t).not.toHaveProperty("una_columna_inventada");
  });

  it("ignora las columnas que no conoce", () => {
    // Guardarlas haría fallar el insert entero por una columna de más.
    const t = filaDeTipo({ tipo_id: "TIP-003", comentario_del_relevador: "ojo" })!;
    expect(t).not.toHaveProperty("comentario_del_relevador");
  });
});

describe("filaDeFicha", () => {
  it("lee la ficha técnica de un equipo", () => {
    const f = filaDeFicha({
      equipo_id: "PO-B1-27",
      marca: "SEW",
      modelo: "K107",
      "año_fabricacion": 2014,
      rpm_motor: 1450,
      fp_cos_phi: 0.86,
      potencia_kw: 15,
    });
    expect(f).not.toBeNull();
    expect(f!.code).toBe("PO-B1-27");
    expect(f!.campos.marca).toBe("SEW");
    expect(f!.campos.anio_fabricacion).toBe(2014);
    expect(f!.campos.rpm_motor).toBe(1450);
    expect(f!.campos.fp_cos_phi).toBe(0.86);
    expect(f!.campos.power_kw).toBe(15);
  });

  it("acepta el encabezado sin la eñe", () => {
    expect(filaDeFicha({ equipo_id: "X", anio_instalacion: 2016 })!.campos.anio_instalacion).toBe(2016);
  });

  it("acepta el encabezado en mayúsculas y con espacios", () => {
    expect(filaDeFicha({ equipo_id: "X", "  MARCA  ": "SKF" })!.campos.marca).toBe("SKF");
  });

  it("sólo devuelve los campos que vinieron con algo", () => {
    // La hoja se completa de a poco: una celda vacía no puede borrar lo que
    // ya está cargado en el sistema.
    const f = filaDeFicha({ equipo_id: "PO-B1-27", marca: "SEW", modelo: "" })!;
    expect(f.campos).toHaveProperty("marca");
    expect(f.campos).not.toHaveProperty("modelo");
  });

  it("descarta una fila sin código de equipo", () => {
    expect(filaDeFicha({ marca: "SEW" })).toBeNull();
  });

  it("no devuelve nada para pisar cuando la fila sólo trae el código", () => {
    expect(filaDeFicha({ equipo_id: "PO-B1-27" })!.campos).toEqual({});
  });
});

describe("filaDeComponente", () => {
  it("lee un componente", () => {
    const c = filaDeComponente({
      equipo_id: "PO-B1-27",
      componente_id: "COMP-0001",
      nombre_componente: "Rodamiento lado motor",
      categoria_componente: "Rodamiento",
      criticidad_componente: "ALTA",
      cantidad: 2,
    });
    expect(c).not.toBeNull();
    expect(c!.code).toBe("PO-B1-27");
    expect(c!.componente.nombre).toBe("Rodamiento lado motor");
    expect(c!.componente.categoria).toBe("Rodamiento");
    expect(c!.componente.criticidad).toBe("ALTA");
    expect(c!.componente.cantidad).toBe("2");
  });

  it("necesita el equipo y el nombre", () => {
    expect(filaDeComponente({ equipo_id: "PO-B1-27" })).toBeNull();
    expect(filaDeComponente({ nombre_componente: "Rodamiento" })).toBeNull();
  });
});

describe("fichaDesdeFormulario", () => {
  it("sólo toca los campos que el formulario mandó", () => {
    const campos = fichaDesdeFormulario({ marca: "SEW", rpm_motor: 1450 });
    expect(Object.keys(campos).sort()).toEqual(["marca", "rpm_motor"]);
  });

  it("vaciar un campo lo borra", () => {
    // Al revés que en la importación: ahí una celda vacía es "todavía no lo
    // relevé"; acá es "esto no va".
    expect(fichaDesdeFormulario({ marca: "" }).marca).toBeNull();
  });

  it("ignora lo que no es un campo de la ficha", () => {
    expect(fichaDesdeFormulario({ status: "DADO_DE_BAJA", is_active: false }))
      .toEqual({});
  });

  it("convierte los números", () => {
    const campos = fichaDesdeFormulario({ anio_fabricacion: "2014", fp_cos_phi: "0,86" });
    expect(campos.anio_fabricacion).toBe(2014);
    expect(campos.fp_cos_phi).toBe(0.86);
  });
});
