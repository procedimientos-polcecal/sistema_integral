import { describe, it, expect } from "vitest";
import { monto, porcentaje, siNo } from "./planilla";
import {
  COMPARATIVA_PESTANAS, pestanaDeSector, filaDeComparativa,
  filaParaComparativa, coincideLaFila, porOrdenDeServicio, resumenDeCotizaciones,
  pareceCotizacion,
} from "./comparativas";

describe("pestanaDeSector", () => {
  it("encuentra la pestaña aunque el sector venga sin acento", () => {
    // La planilla se llama "Calcinación" y las OS escriben "Calcinacion".
    expect(pestanaDeSector("Calcinacion")).toBe("Calcinación");
  });

  it("ignora mayúsculas y espacios de más", () => {
    expect(pestanaDeSector("  planta   filler 2 ")).toBe("Planta Filler 2");
  });

  it("manda a Otros lo que no tiene pestaña propia", () => {
    expect(pestanaDeSector("Depósito nuevo")).toBe("Otros");
    expect(pestanaDeSector(null)).toBe("Otros");
  });

  it("tiene las doce pestañas de la planilla", () => {
    expect(COMPARATIVA_PESTANAS).toHaveLength(12);
    expect(COMPARATIVA_PESTANAS).toContain("Otros");
  });
});

describe("monto", () => {
  it("lee el número que manda la planilla sin formato", () => {
    expect(monto(1972500)).toBe(1972500);
    expect(monto(17486726.4)).toBe(17486726.4);
  });

  it("lee el texto con formato argentino", () => {
    expect(monto(" $1.972.500,00")).toBe(1972500);
    expect(monto("$ 459.800,00")).toBe(459800);
  });

  it("lee un precio escrito en dólares", () => {
    // La columna es de texto justamente porque a veces pasa esto.
    expect(monto("U$D 286")).toBe(286);
  });

  it("no se come el decimal de un número escrito como texto", () => {
    // Es como quedan guardados: String(1848315.535). Tomar ese punto por
    // separador de miles daba mil veces el precio y arruinaba la comparación.
    expect(monto("1848315.535")).toBe(1848315.535);
    expect(monto("1359998.8599999999")).toBeCloseTo(1359998.86, 2);
  });

  it("distingue los puntos de miles de un punto decimal", () => {
    // Con varios puntos no puede ser un decimal.
    expect(monto("1.972.500")).toBe(1972500);
    expect(monto("1972500")).toBe(1972500);
  });

  it("devuelve null cuando no hay número", () => {
    expect(monto("")).toBeNull();
    expect(monto(null)).toBeNull();
    expect(monto("a convenir")).toBeNull();
  });
});

describe("porcentaje", () => {
  it("lee la fracción que manda la planilla sin formato", () => {
    expect(porcentaje(0.21)).toBe(0.21);
    expect(porcentaje(0)).toBe(0);
  });

  it("lee el texto con el signo", () => {
    // Leída con formato, la celda dice "21%": tomarla como número da 21.
    expect(porcentaje("21%")).toBe(0.21);
    expect(porcentaje("0%")).toBe(0);
  });

  it("devuelve null si no hay nada", () => {
    expect(porcentaje("")).toBeNull();
    expect(porcentaje(null)).toBeNull();
  });
});

describe("siNo", () => {
  it("acepta el booleano y el texto", () => {
    expect(siNo(true)).toBe(true);
    expect(siNo("TRUE")).toBe(true);
    expect(siNo("Sí")).toBe(true);
    expect(siNo("x")).toBe(true);
  });

  it("todo lo demás es que no", () => {
    expect(siNo(false)).toBe(false);
    expect(siNo("FALSE")).toBe(false);
    expect(siNo("")).toBe(false);
  });
});

const FILA = [
  16, 45994.42693385416, "Mantenimiento", "Planta filler 2",
  "PY-B1-09 – Molino vertical", "Eje para cañonera molino cimma",
  "Met. Don Alfredo", 1972500, 0.21, 2386725, 45989, 15,
  "20 días F.F", "", true,
];

describe("filaDeComparativa", () => {
  it("lee una fila de la planilla", () => {
    const c = filaDeComparativa(FILA, 2, "Planta Filler 2");
    expect(c).not.toBeNull();
    expect(c!.os_number).toBe(16);
    expect(c!.proveedor).toBe("Met. Don Alfredo");
    expect(c!.fecha).toBe("2025-12-03");
    expect(c!.iva).toBe(0.21);
    expect(c!.precio_total).toBe("2386725");
    expect(c!.eleccion).toBe(true);
    expect(c!.sheets_tab).toBe("Planta Filler 2");
    expect(c!.sheets_row).toBe(2);
  });

  it("saca el código del equipo del texto libre", () => {
    expect(filaDeComparativa(FILA, 2, "Planta Filler 2")!.equipo_code).toBe("PY-B1-09");
  });

  it("descarta las filas vacías de la plantilla", () => {
    // La planilla trae cientos: sin N° de OS y sin proveedor.
    const vacia = ["", "", "", "", "", "", "", "", "", 0, "", "", "", "", false];
    expect(filaDeComparativa(vacia, 800, "Otros")).toBeNull();
  });

  it("descarta una fila con OS pero sin proveedor", () => {
    const sinProveedor = [16, 45994, "Mantenimiento", "Planta filler 2", "", "", "  "];
    expect(filaDeComparativa(sinProveedor, 5, "Otros")).toBeNull();
  });

  it("usa la pestaña como sector cuando la celda viene vacía", () => {
    const fila = [16, 45994, "Mantenimiento", "", "", "", "Proveedor"];
    expect(filaDeComparativa(fila, 5, "Calcinación")!.sector).toBe("Calcinación");
  });
});

describe("porOrdenDeServicio", () => {
  const cots = [
    { os_number: 16, proveedor: "A", precio_total: "100", eleccion: false },
    { os_number: 16, proveedor: "B", precio_total: "80", eleccion: true },
    { os_number: 18, proveedor: "C", precio_total: "50", eleccion: false },
  ];

  it("agrupa por número de OS", () => {
    const m = porOrdenDeServicio(cots);
    expect(m[16]).toHaveLength(2);
    expect(m[18]).toHaveLength(1);
  });
});

describe("resumenDeCotizaciones", () => {
  it("dice cuál está elegida y cuál es la más barata", () => {
    const r = resumenDeCotizaciones([
      { proveedor: "A", precio_total: "100", eleccion: false },
      { proveedor: "B", precio_total: "80", eleccion: true },
      { proveedor: "C", precio_total: "120", eleccion: false },
    ]);
    expect(r.cantidad).toBe(3);
    expect(r.elegida?.proveedor).toBe("B");
    expect(r.masBarata?.proveedor).toBe("B");
    expect(r.seEligioLaMasBarata).toBe(true);
  });

  it("avisa cuando la elegida no es la más barata", () => {
    // Puede ser correcto —plazo, garantía—, pero tiene que verse.
    const r = resumenDeCotizaciones([
      { proveedor: "A", precio_total: "100", eleccion: true },
      { proveedor: "B", precio_total: "80", eleccion: false },
    ]);
    expect(r.masBarata?.proveedor).toBe("B");
    expect(r.seEligioLaMasBarata).toBe(false);
    expect(r.diferencia).toBe(20);
  });

  it("no se rompe sin cotizaciones", () => {
    const r = resumenDeCotizaciones([]);
    expect(r.cantidad).toBe(0);
    expect(r.elegida).toBeNull();
    expect(r.masBarata).toBeNull();
  });

  it("ignora las cotizaciones sin precio legible al buscar la más barata", () => {
    const r = resumenDeCotizaciones([
      { proveedor: "A", precio_total: "a convenir", eleccion: false },
      { proveedor: "B", precio_total: "300", eleccion: false },
    ]);
    expect(r.masBarata?.proveedor).toBe("B");
  });
});

describe("filaParaComparativa", () => {
  const cot = {
    os_number: 16, fecha: "2025-12-03", area: "Mantenimiento",
    sector: "Planta filler 2", equipo_raw: "PY-B1-09 – Molino vertical",
    descripcion: "Eje", proveedor: "Met. Don Alfredo",
    precio_unitario: "1972500", iva: 0.21, precio_total: "2386725",
    vigencia_hasta: null, plazos: "15", condiciones_pago: "20 días F.F",
    otras_especificaciones: null, eleccion: true,
  };

  it("arma las quince columnas de la planilla", () => {
    const fila = filaParaComparativa(cot);
    expect(fila).toHaveLength(15);
    expect(fila[0]).toBe(16);
    expect(fila[6]).toBe("Met. Don Alfredo");
    expect(fila[14]).toBe("TRUE");
  });

  it("escribe la fecha como la escribe la planilla", () => {
    expect(filaParaComparativa(cot)[1]).toBe("3/12/2025");
  });

  it("deja vacío lo que no está", () => {
    expect(filaParaComparativa(cot)[10]).toBe("");
    expect(filaParaComparativa(cot)[13]).toBe("");
  });
});

describe("coincideLaFila", () => {
  const fila = [16, 45994, "Mantenimiento", "Planta filler 2", "", "", "Met. Don Alfredo"];

  it("reconoce la fila de esa cotización", () => {
    expect(coincideLaFila(fila, { os_number: 16, proveedor: "Met. Don Alfredo" })).toBe(true);
  });

  it("ignora mayúsculas y espacios en el proveedor", () => {
    expect(coincideLaFila(fila, { os_number: 16, proveedor: "  met. don alfredo " })).toBe(true);
  });

  it("no reconoce otra fila", () => {
    // Si alguien insertó una fila en el medio, la nuestra se corrió: escribir
    // ahí pisaría la cotización de otro proveedor.
    expect(coincideLaFila(fila, { os_number: 16, proveedor: "CN Mecanizados" })).toBe(false);
    expect(coincideLaFila(fila, { os_number: 18, proveedor: "Met. Don Alfredo" })).toBe(false);
    expect(coincideLaFila([], { os_number: 16, proveedor: "Met. Don Alfredo" })).toBe(false);
  });
});

/**
 * Las pestañas de la comparativa traen miles de filas de plantilla: formato,
 * formulas y textos fijos que no son cotizaciones de nadie. Es la misma trampa
 * que la columna COMPARATIVA de las OS, que dice "LINK" en las mil filas de la
 * pestaña vengan o no con una orden.
 *
 * Por eso contar "filas no vacias" no sirve para nada: da 11.725 cuando las
 * cotizaciones cargadas son 159. Lo que identifica a una cotizacion es tener N°
 * de OS y proveedor —es lo que exige filaDeComparativa—, asi que la fila que
 * vale la pena mirar es la que trae uno de los dos y no el otro: alguien empezo
 * a cargarla y quedo a medias.
 */
describe("que fila de la planilla es una cotizacion a medias", () => {
  const fila = (osNumber: unknown, proveedor: unknown): unknown[] => {
    const f = new Array(15).fill("");
    f[0] = osNumber;
    f[6] = proveedor;
    return f;
  };

  it("con los dos datos parece una cotizacion", () => {
    expect(pareceCotizacion(fila(142, "Candia"))).toBe(true);
  });

  it("con el numero solo tambien: alguien la empezo", () => {
    expect(pareceCotizacion(fila(142, ""))).toBe(true);
  });

  it("con el proveedor solo tambien", () => {
    expect(pareceCotizacion(fila("", "Candia"))).toBe(true);
  });

  it("sin ninguno de los dos es relleno de la planilla, no una fila cargada", () => {
    expect(pareceCotizacion(fila("", ""))).toBe(false);
    expect(pareceCotizacion(new Array(15).fill(""))).toBe(false);
    expect(pareceCotizacion([])).toBe(false);
  });

  it("una fila con otras columnas escritas pero sin OS ni proveedor no cuenta", () => {
    // Es exactamente el caso de las 11.566: traen algo en alguna celda
    // —una formula, un texto fijo— y ninguna es una cotizacion.
    const f = new Array(15).fill("");
    f[8] = "21%";
    f[14] = "LINK";
    expect(pareceCotizacion(f)).toBe(false);
  });

  it("el guion suelto es como se escribe 'aca no va nada'", () => {
    expect(pareceCotizacion(fila("-", "-"))).toBe(false);
  });
});
