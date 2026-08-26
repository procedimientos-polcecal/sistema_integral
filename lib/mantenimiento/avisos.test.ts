import { describe, it, expect } from "vitest";
import {
  filaDeAviso, prioridadDeUrgencia, URGENCIAS,
  proximoNumeroDeAviso, filaParaLaPlanilla, COLUMNA_OT_ASIGNADA,
} from "./avisos";

describe("filaDeAviso", () => {
  const FILA = [
    "A138", 46200, "Calcinación", "PO-B1-27 – Cadena", "No arranca",
    "🟠 Alta", "MARTIN SANDOVAL", "", "", "2333",
    "https://drive.google.com/open?id=xxx", "se revisó el motor",
  ];

  it("lee una fila de la planilla", () => {
    const a = filaDeAviso(FILA, 139)!;
    expect(a.oa_number).toBe("A138");
    expect(a.urgencia).toBe("🟠 Alta");
    expect(a.ot_asignada).toBe("2333");
    expect(a.observaciones).toBe("se revisó el motor");
    expect(a.reference_photos).toEqual(["https://drive.google.com/open?id=xxx"]);
    expect(a.sheets_row).toBe(139);
  });

  it("no confunde la imagen con las observaciones", () => {
    // El código de origen leía las observaciones de la K, que es la imagen.
    expect(filaDeAviso(FILA, 139)!.observaciones).not.toContain("drive.google");
  });

  it("descarta una fila sin número de aviso", () => {
    expect(filaDeAviso(["", "", ""], 500)).toBeNull();
  });
});

describe("prioridadDeUrgencia", () => {
  it("traduce la urgencia con emoji de la planilla", () => {
    expect(prioridadDeUrgencia("🟠 Alta")).toBe("ALTA");
    expect(prioridadDeUrgencia("🟡 Media")).toBe("MEDIA");
    expect(prioridadDeUrgencia("🟢 Baja")).toBe("BAJA");
  });

  it("sin urgencia, media", () => {
    expect(prioridadDeUrgencia(null)).toBe("MEDIA");
    expect(prioridadDeUrgencia("")).toBe("MEDIA");
  });
});

describe("URGENCIAS", () => {
  it("son las tres de la planilla, con su emoji", () => {
    // Se escriben igual que en la planilla o quedarían dos vocabularios.
    expect(URGENCIAS).toEqual(["🟠 Alta", "🟡 Media", "🟢 Baja"]);
  });
});

describe("proximoNumeroDeAviso", () => {
  it("sigue la numeración de la planilla", () => {
    expect(proximoNumeroDeAviso(["A1", "A138", "A57"])).toBe("A139");
  });

  it("empieza en A1 cuando no hay ninguno", () => {
    expect(proximoNumeroDeAviso([])).toBe("A1");
  });

  it("ignora lo que no sigue el formato", () => {
    // Que alguien haya escrito "sin numero" no puede frenar el próximo.
    expect(proximoNumeroDeAviso(["A3", "sin numero", "", "12"])).toBe("A4");
  });

  it("no se queda corto por el orden alfabético", () => {
    // "A9" es mayor que "A10" alfabéticamente: hay que comparar el número.
    expect(proximoNumeroDeAviso(["A9", "A10"])).toBe("A11");
  });
});

describe("filaParaLaPlanilla", () => {
  const aviso = {
    oa_number: "A139",
    fecha: "2026-08-26",
    sector_raw: "Calcinación",
    equipo_raw: "PO-B1-27 – Cadena",
    descripcion: "No arranca",
    urgencia: "🟠 Alta",
    quien_aviso: "Martín Sandoval",
    observaciones: "se escuchó un ruido",
  };

  it("pone cada dato en su columna", () => {
    const f = filaParaLaPlanilla(aviso);
    expect(f[0]).toBe("A139");
    expect(f[1]).toBe("26/08/2026");
    expect(f[2]).toBe("Calcinación");
    expect(f[4]).toBe("No arranca");
    expect(f[5]).toBe("🟠 Alta");
    expect(f[6]).toBe("Martín Sandoval");
    expect(f[11]).toBe("se escuchó un ruido");
  });

  it("deja vacías las columnas H e I", () => {
    // Son restos de una fórmula que parte el nombre en dos: escribir ahí
    // pisaría lo que la planilla calcula.
    const f = filaParaLaPlanilla(aviso);
    expect(f[7]).toBe("");
    expect(f[8]).toBe("");
  });

  it("nace sin OT asignada", () => {
    expect(filaParaLaPlanilla(aviso)[COLUMNA_OT_ASIGNADA]).toBe("");
  });

  it("llega hasta las observaciones y no más", () => {
    expect(filaParaLaPlanilla(aviso)).toHaveLength(12);
  });
});
