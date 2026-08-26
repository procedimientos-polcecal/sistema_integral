import { describe, it, expect } from "vitest";
import {
  OS_PESTANAS, ALIAS_OS, pestanaDeArea, mapearEncabezados, filaDeOS,
  ESTADOS_OS, PRIORIDADES_OS, ESTADO_INICIAL_OS, puedeEscribirse, seguimientoHuerfano,
} from "./os";

describe("pestanaDeArea", () => {
  it("encuentra la pestaña del área", () => {
    expect(pestanaDeArea("Mantenimiento")).toBe("MANTENIMIENTO");
    expect(pestanaDeArea("taller vial")).toBe("TALLER VIAL");
  });

  it("ignora los acentos", () => {
    expect(pestanaDeArea("Produccion")).toBe("PRODUCCIÓN");
    expect(pestanaDeArea("Almacen")).toBe("ALMACÉN");
  });

  it("manda a OTRA lo que no tiene pestaña propia", () => {
    expect(pestanaDeArea("Compras")).toBe("OTRA");
    expect(pestanaDeArea(null)).toBe("OTRA");
  });

  it("SERVICIOS es la primera: es la hoja maestra", () => {
    expect(OS_PESTANAS[0]).toBe("SERVICIOS");
  });
});

describe("mapearEncabezados", () => {
  const ENCABEZADO = [
    "N° OS", "FECHA", "AREA", "SECTOR", "EQUIPO", "DESCRIPCIÓN",
    "FECHA DE REQ", "PRIORIDAD", "EMPRESA", "ESTADO", "COSTO SIN IVA",
    "FECHA DE REALIZACION", "OBSERVACIONES",
  ];

  it("ubica cada columna por su encabezado", () => {
    const idx = mapearEncabezados(ENCABEZADO);
    expect(idx.os_number).toBe(0);
    expect(idx.descripcion).toBe(5);
    expect(idx.estado).toBe(9);
    expect(idx.observaciones).toBe(12);
  });

  it("marca con -1 las columnas que la pestaña no tiene", () => {
    // Cada área tiene su propia planilla y no todas traen todo.
    expect(mapearEncabezados(ENCABEZADO).cuit).toBe(-1);
  });

  it("acepta las variantes del encabezado del número", () => {
    expect(mapearEncabezados(["NRO OS", "FECHA"]).os_number).toBe(0);
    expect(mapearEncabezados(["N OS", "FECHA"]).os_number).toBe(0);
  });

  it("cae en la columna A cuando el encabezado del número viene ilegible", () => {
    // En SERVICIOS el encabezado viene raro, pero el número siempre es la
    // primera columna.
    expect(mapearEncabezados(["", "FECHA", "AREA"]).os_number).toBe(0);
  });

  it("ignora acentos, puntos y espacios de más al comparar", () => {
    const idx = mapearEncabezados(["N° OS", "  Descripción  ", "F.ECHA"]);
    expect(idx.descripcion).toBe(1);
  });

  it("conoce todas las claves que sabe leer", () => {
    const idx = mapearEncabezados(["N° OS"]);
    for (const clave of Object.keys(ALIAS_OS)) {
      expect(idx).toHaveProperty(clave);
    }
  });
});

describe("filaDeOS", () => {
  const idx = mapearEncabezados([
    "N° OS", "FECHA", "AREA", "SECTOR", "EQUIPO", "DESCRIPCIÓN",
    "PRIORIDAD", "ESTADO", "COSTO SIN IVA", "PROVEEDOR ELEGIDO",
    "FECHA DE REALIZACION", "OBSERVACIONES",
  ]);

  const FILA = [
    142, 46160, "Mantenimiento", "Otros", "PY-B1-09 – Molino vertical",
    "900 hs de mantenimiento general", "ALTA", "PEDIDO", 18000000,
    "Omar Piparo", "", "sin novedad",
  ];

  it("lee una fila de la planilla", () => {
    const os = filaDeOS(FILA, idx, "MANTENIMIENTO", 5);
    expect(os).not.toBeNull();
    expect(os!.os_number).toBe(142);
    expect(os!.fecha).toBe("2026-05-18");
    expect(os!.descripcion).toBe("900 hs de mantenimiento general");
    expect(os!.proveedor_elegido).toBe("Omar Piparo");
    expect(os!.costo).toBe(18000000);
    expect(os!.sheets_tab).toBe("MANTENIMIENTO");
    expect(os!.sheets_row).toBe(5);
  });

  it("saca el código del equipo del texto libre", () => {
    expect(filaDeOS(FILA, idx, "MANTENIMIENTO", 5)!.equipo_code).toBe("PY-B1-09");
  });

  it("usa la pestaña como área cuando la celda viene vacía", () => {
    const fila = [142, 46160, "", "Otros"];
    expect(filaDeOS(fila, idx, "CANTERA", 5)!.area).toBe("CANTERA");
  });

  it("descarta las filas sin número de OS", () => {
    expect(filaDeOS(["", "", ""], idx, "SERVICIOS", 90)).toBeNull();
    expect(filaDeOS(["total", "", ""], idx, "SERVICIOS", 91)).toBeNull();
  });

  it("deja en null el costo que no es un número", () => {
    const fila = [142, 46160, "Mantenimiento", "Otros", "", "", "", "", "a convenir"];
    expect(filaDeOS(fila, idx, "MANTENIMIENTO", 5)!.costo).toBeNull();
  });

  it("no inventa fecha cuando la celda está vacía", () => {
    const fila = [142, "", "Mantenimiento"];
    expect(filaDeOS(fila, idx, "MANTENIMIENTO", 5)!.fecha).toBeNull();
  });
});

describe("el vocabulario de la planilla", () => {
  it("tiene los estados que la planilla usa de verdad", () => {
    // Verificado sobre las 220 OS cargadas.
    expect(ESTADOS_OS).toEqual([
      "POR APROBAR", "EN REVISIÓN", "APROBADO",
      "EN PROCESO (COMPARATIVA)", "ACEPTADO",
    ]);
  });

  it("tiene las prioridades que la planilla usa de verdad", () => {
    // No son ALTA/MEDIA/BAJA como en las OT.
    expect(PRIORIDADES_OS).toEqual(["URGENTE", "1 SEMANA", "NORMAL", "LEVE"]);
  });

  it("arranca una OS nueva en el primer estado del circuito", () => {
    expect(ESTADO_INICIAL_OS).toBe("POR APROBAR");
  });
});

describe("puedeEscribirse", () => {
  it("deja escribir el seguimiento", () => {
    // Son las columnas a la derecha del FILTER: valores escritos a mano.
    expect(puedeEscribirse("estado")).toBe(true);
    expect(puedeEscribirse("proveedor_elegido")).toBe(true);
    expect(puedeEscribirse("costo")).toBe(true);
    expect(puedeEscribirse("fecha_realizacion")).toBe(true);
    expect(puedeEscribirse("observaciones")).toBe(true);
  });

  it("no deja tocar lo que es fórmula", () => {
    // En las pestañas de área, A..K son un FILTER sobre SERVICIOS; escribir
    // ahí rompe la fórmula y con ella toda la pestaña.
    expect(puedeEscribirse("os_number")).toBe(false);
    expect(puedeEscribirse("fecha")).toBe(false);
    expect(puedeEscribirse("area")).toBe(false);
    expect(puedeEscribirse("descripcion")).toBe(false);
    expect(puedeEscribirse("empresa")).toBe(false);
  });
});

describe("filaDeOS con la planilla de verdad", () => {
  const idx = mapearEncabezados(["N° OS", "FECHA", "ÁREA", "SECTOR", "EQUIPO"]);

  it("no toma un guión suelto como equipo", () => {
    // 39 filas de la planilla tienen "-" en EQUIPO.
    const fila = [91, 46000, "OTRA", "Otros", "-"];
    expect(filaDeOS(fila, idx, "OTRA", 5)!.equipo_raw).toBeNull();
  });

  it("lee la fecha aunque venga con hora", () => {
    // La planilla la carga un formulario: "28/11/2025 10:45:13".
    expect(filaDeOS([1, "28/11/2025 10:45:13"], idx, "SERVICIOS", 2)!.fecha)
      .toBe("2025-11-28");
  });

  it("descarta la fila con #N/A en el número", () => {
    // Las pestañas sin ninguna OS aprobada muestran el error del FILTER.
    expect(filaDeOS(["#N/A", "", ""], idx, "DESPACHO", 2)).toBeNull();
  });
});

describe("seguimientoHuerfano", () => {
  const vacias = (n: number) => Array(n).fill("");

  it("detecta una fila con seguimiento pero sin OS", () => {
    // El FILTER corre las filas y el seguimiento escrito a mano no se corre
    // con ellas: queda un proveedor colgado de ninguna orden.
    expect(seguimientoHuerfano([...vacias(11), "LINK", "Metalúrgica Mario", "ACEPTADO"]))
      .toBe(true);
  });

  it("no marca una fila del todo vacía", () => {
    expect(seguimientoHuerfano(vacias(4))).toBe(false);
  });

  it("no marca la plantilla: 'LINK' está en las mil filas", () => {
    // La columna COMPARATIVA viene precargada hasta el final de la pestaña.
    // Contarla daría por huérfana la planilla entera.
    expect(seguimientoHuerfano([...vacias(11), "LINK"])).toBe(false);
  });

  it("no marca una fila que sí tiene su OS", () => {
    expect(seguimientoHuerfano([16, 46000, "Mantenimiento", ...vacias(8), "LINK", "ConMet"]))
      .toBe(false);
  });
});
