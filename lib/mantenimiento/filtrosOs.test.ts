import { describe, it, expect } from "vitest";
import {
  FILTROS_OS_VACIOS, SIN_CARGAR, filtrarOrdenesDeServicio, opcionesDeLasOrdenes,
  cuantosFiltrosPuestos, tieneNumeroDeOrdenDeCompra, sectorDeLaOS, equipoDeLaOS,
  type FiltrosOs,
} from "./filtrosOs";
import { ESTADOS_OS, PRIORIDADES_OS } from "./os";
import type { OrdenServicio } from "./types";

/** Una OS con lo mínimo, para que cada test diga sólo lo que le importa. */
function os(cambios: Partial<OrdenServicio> = {}): OrdenServicio {
  return {
    id: cambios.os_number ? `id-${cambios.os_number}` : "id",
    os_number: 1,
    fecha: "2026-03-01",
    area: "Mantenimiento",
    sector_raw: "Planta filler 1",
    sector_id: "sec-1",
    equipo_raw: "PY-B1-09 – Molino vertical",
    equipo_code: "PY-B1-09",
    equipment_id: "eq-1",
    descripcion: "Reparación de molino",
    fecha_requerimiento: null,
    detalle_extra: null,
    imagen: null,
    prioridad: "NORMAL",
    empresa: "Polcecal",
    comparativa: "LINK",
    proveedor_elegido: "Candia Rubén Horacio",
    estado: "ACEPTADO",
    cuit: null,
    tiene_orden_compra: null,
    costo: 100000,
    fecha_pedido: null,
    fecha_realizacion: null,
    observaciones: null,
    motivo_rechazo: null,
    app_created: false,
    sheets_tab: "MANTENIMIENTO",
    sheets_row: 2,
    synced_at: null,
    created_at: "2026-03-01T00:00:00Z",
    ...cambios,
  };
}

const filtrar = (ordenes: OrdenServicio[], f: Partial<FiltrosOs>, cot: Record<number, number> = {}) =>
  filtrarOrdenesDeServicio(ordenes, { ...FILTROS_OS_VACIOS, ...f }, cot);

describe("sin filtros", () => {
  it("no saca nada", () => {
    const todas = [os({ os_number: 1 }), os({ os_number: 2 }), os({ os_number: 3 })];
    expect(filtrar(todas, {})).toHaveLength(3);
  });
});

describe("los filtros de lista", () => {
  const ordenes = [
    os({ os_number: 1, prioridad: "URGENTE", empresa: "Polysan" }),
    os({ os_number: 2, prioridad: "NORMAL", empresa: "Polcecal" }),
    os({ os_number: 3, prioridad: "1 SEMANA", empresa: "Polysan" }),
    os({ os_number: 4, prioridad: null, empresa: null }),
  ];

  it("dentro de un filtro los valores suman", () => {
    const quedan = filtrar(ordenes, { prioridad: ["URGENTE", "1 SEMANA"] });
    expect(quedan.map((o) => o.os_number)).toEqual([1, 3]);
  });

  it("entre filtros se recortan", () => {
    const quedan = filtrar(ordenes, { prioridad: ["URGENTE", "1 SEMANA"], empresa: ["Polysan"] });
    expect(quedan.map((o) => o.os_number)).toEqual([1, 3]);
    expect(filtrar(ordenes, { prioridad: ["NORMAL"], empresa: ["Polysan"] })).toHaveLength(0);
  });

  it("deja preguntar por lo que está vacío", () => {
    const quedan = filtrar(ordenes, { prioridad: [SIN_CARGAR] });
    expect(quedan.map((o) => o.os_number)).toEqual([4]);
  });

  it("el vacío se puede sumar a un valor", () => {
    const quedan = filtrar(ordenes, { prioridad: ["URGENTE", SIN_CARGAR] });
    expect(quedan.map((o) => o.os_number)).toEqual([1, 4]);
  });
});

describe("el sector y el equipo se filtran por lo que muestra la tabla", () => {
  // La columna muestra el nombre del catálogo cuando está enlazado y el texto
  // de la planilla cuando no. El filtro tiene que decir lo mismo.
  const enlazada = os({
    os_number: 1,
    sector_raw: "Planta 02",
    sectores: { nombre: "Planta 0-2 mm" },
    equipo_raw: "PY-C1-06 – Zaranda vibratoria",
    equipos: { name: "Zaranda vibratoria", code: "PY-C1-06" },
  });
  const suelta = os({
    os_number: 2,
    sector_raw: "Otros",
    sector_id: null,
    sectores: null,
    equipo_raw: "Compresor viejo",
    equipment_id: null,
    equipos: null,
  });

  it("usa el nombre del catálogo cuando hay enlace", () => {
    expect(sectorDeLaOS(enlazada)).toBe("Planta 0-2 mm");
    expect(equipoDeLaOS(enlazada)).toBe("Zaranda vibratoria");
    expect(filtrar([enlazada, suelta], { sector: ["Planta 0-2 mm"] })).toHaveLength(1);
    expect(filtrar([enlazada, suelta], { equipo: ["Zaranda vibratoria"] })).toHaveLength(1);
  });

  it("usa el texto de la planilla cuando no lo hay", () => {
    expect(sectorDeLaOS(suelta)).toBe("Otros");
    expect(filtrar([enlazada, suelta], { sector: ["Otros"] })).toHaveLength(1);
  });

  it("el sector enlazado NO se encuentra por el texto viejo de la planilla", () => {
    // Es la consecuencia de la decisión y vale dejarla escrita: "Planta 02" es
    // lo que dice `sector_raw`, pero no es lo que ve quien mira la pantalla.
    expect(filtrar([enlazada], { sector: ["Planta 02"] })).toHaveLength(0);
  });
});

describe("el rango de fechas", () => {
  const ordenes = [
    os({ os_number: 1, fecha: "2026-01-15", fecha_realizacion: "2026-02-20" }),
    os({ os_number: 2, fecha: "2026-06-10", fecha_realizacion: null }),
    os({ os_number: 3, fecha: "2026-11-04", fecha_realizacion: "2026-11-04" }),
  ];

  it("toma los extremos", () => {
    expect(filtrar(ordenes, { desde: "2026-01-15", hasta: "2026-06-10" }).map((o) => o.os_number))
      .toEqual([1, 2]);
  });

  it("anda con una sola punta", () => {
    expect(filtrar(ordenes, { desde: "2026-06-10" }).map((o) => o.os_number)).toEqual([2, 3]);
    expect(filtrar(ordenes, { hasta: "2026-06-10" }).map((o) => o.os_number)).toEqual([1, 2]);
  });

  it("pregunta por la fecha que se le diga, y la respuesta cambia", () => {
    expect(filtrar(ordenes, { campoFecha: "fecha", desde: "2026-02-01", hasta: "2026-02-28" }))
      .toHaveLength(0);
    expect(filtrar(ordenes, { campoFecha: "fecha_realizacion", desde: "2026-02-01", hasta: "2026-02-28" }))
      .toHaveLength(1);
  });

  it("la que no tiene esa fecha queda afuera del rango", () => {
    const quedan = filtrar(ordenes, { campoFecha: "fecha_realizacion", desde: "2026-01-01" });
    expect(quedan.map((o) => o.os_number)).toEqual([1, 3]);
  });
});

describe("el rango de costo", () => {
  const ordenes = [
    os({ os_number: 1, costo: 0 }),
    os({ os_number: 2, costo: 500000 }),
    os({ os_number: 3, costo: 41500000 }),
    os({ os_number: 4, costo: null }),
  ];

  it("toma los extremos", () => {
    expect(filtrar(ordenes, { costoDesde: "0", costoHasta: "500000" }).map((o) => o.os_number))
      .toEqual([1, 2]);
  });

  it("un cero en el desde es un filtro y no un campo vacío", () => {
    // `Number("")` es 0, así que mirar el número en vez del texto dejaría a
    // "sin mínimo" y "mínimo cero" indistinguibles — y a la de costo null
    // afuera sin que nadie hubiera pedido nada.
    expect(filtrar(ordenes, { costoDesde: "0" }).map((o) => o.os_number)).toEqual([1, 2, 3]);
    expect(filtrar(ordenes, { costoDesde: "" })).toHaveLength(4);
  });

  it("la que no tiene costo queda afuera del rango", () => {
    expect(filtrar(ordenes, { costoHasta: "99999999" }).map((o) => o.os_number)).toEqual([1, 2, 3]);
  });

  it("se puede preguntar por las que no tienen costo", () => {
    expect(filtrar(ordenes, { costo: "no" }).map((o) => o.os_number)).toEqual([4]);
    expect(filtrar(ordenes, { costo: "si" })).toHaveLength(3);
  });
});

describe("los sí o no", () => {
  const ordenes = [
    os({ os_number: 1, tiene_orden_compra: "2073", imagen: "https://drive/x" }),
    os({ os_number: 2, tiene_orden_compra: "Hacer orden de compra", imagen: null }),
    os({ os_number: 3, tiene_orden_compra: null, imagen: null }),
  ];
  const cotizaciones = { 1: 3, 3: 1 };

  it('"Hacer orden de compra" no es tener una orden de compra', () => {
    expect(tieneNumeroDeOrdenDeCompra("2073")).toBe(true);
    expect(tieneNumeroDeOrdenDeCompra("Hacer orden de compra")).toBe(false);
    expect(tieneNumeroDeOrdenDeCompra(null)).toBe(false);
    expect(filtrar(ordenes, { ordenCompra: "si" }).map((o) => o.os_number)).toEqual([1]);
    expect(filtrar(ordenes, { ordenCompra: "no" }).map((o) => o.os_number)).toEqual([2, 3]);
  });

  it("cuenta las cotizaciones de la otra tabla", () => {
    expect(filtrar(ordenes, { cotizaciones: "si" }, cotizaciones).map((o) => o.os_number))
      .toEqual([1, 3]);
    expect(filtrar(ordenes, { cotizaciones: "no" }, cotizaciones).map((o) => o.os_number))
      .toEqual([2]);
  });

  it("filtra por foto", () => {
    expect(filtrar(ordenes, { foto: "si" }).map((o) => o.os_number)).toEqual([1]);
  });

  it("vacío no pregunta nada", () => {
    expect(filtrar(ordenes, { ordenCompra: "", foto: "", cotizaciones: "" })).toHaveLength(3);
  });
});

describe("lo que falta enlazar", () => {
  const ordenes = [
    os({ os_number: 1 }),
    os({ os_number: 2, equipment_id: null }),
    os({ os_number: 3, sector_id: null }),
    os({ os_number: 4, equipo_raw: null, equipment_id: null }),
  ];

  it("separa equipo de sector", () => {
    expect(filtrar(ordenes, { enlace: "equipo" }).map((o) => o.os_number)).toEqual([2]);
    expect(filtrar(ordenes, { enlace: "sector" }).map((o) => o.os_number)).toEqual([3]);
    expect(filtrar(ordenes, { enlace: "alguno" }).map((o) => o.os_number)).toEqual([2, 3]);
  });

  it("una OS sin equipo nombrado no es una OS con el equipo sin enlazar", () => {
    // No hay nada que enlazar: meterla ahí le daría trabajo a quien revisa los
    // enlaces sobre una fila donde no se puede hacer nada.
    expect(filtrar(ordenes, { enlace: "equipo" }).map((o) => o.os_number)).not.toContain(4);
  });
});

describe("el buscador", () => {
  const ordenes = [
    os({ os_number: 14, descripcion: "Reparación de molino" }),
    os({
      os_number: 2109, descripcion: "Alambrado de cantera",
      detalle_extra: "ADJUNTO FOTOS Y COTIZACION PEDIDA HACE 2 MESES",
    }),
    os({ os_number: 3, descripcion: "Pintura", tiene_orden_compra: "2073", cuit: "30712296743" }),
  ];

  it("ignora los acentos", () => {
    expect(filtrar(ordenes, { busqueda: "reparacion" }).map((o) => o.os_number)).toEqual([14]);
    expect(filtrar(ordenes, { busqueda: "REPARACIÓN" }).map((o) => o.os_number)).toEqual([14]);
  });

  it("acepta las palabras en cualquier orden", () => {
    expect(filtrar(ordenes, { busqueda: "cantera alambrado" }).map((o) => o.os_number)).toEqual([2109]);
  });

  it("encuentra por el detalle extra, que antes no se podía", () => {
    expect(filtrar(ordenes, { busqueda: "cotizacion pedida" }).map((o) => o.os_number)).toEqual([2109]);
  });

  it("encuentra por N° de OS, de orden de compra, CUIT y código de equipo", () => {
    expect(filtrar(ordenes, { busqueda: "2109" }).map((o) => o.os_number)).toEqual([2109]);
    expect(filtrar(ordenes, { busqueda: "2073" }).map((o) => o.os_number)).toEqual([3]);
    expect(filtrar(ordenes, { busqueda: "30712296743" }).map((o) => o.os_number)).toEqual([3]);
    expect(filtrar(ordenes, { busqueda: "py-b1-09" })).toHaveLength(3);
  });

  it("no busca en el área ni en el estado, que tienen su desplegable", () => {
    // Las 276 son de ocho áreas: si el área entrara acá, buscar "cantera"
    // devolvería además las 220 de Mantenimiento.
    expect(filtrar(ordenes, { busqueda: "mantenimiento" })).toHaveLength(0);
    expect(filtrar(ordenes, { busqueda: "aceptado" })).toHaveLength(0);
  });

  it("se recorta con los demás filtros", () => {
    expect(filtrar(ordenes, { busqueda: "a", empresa: ["Polysan"] })).toHaveLength(0);
  });
});

describe("las opciones de los desplegables", () => {
  const ordenes = [
    os({ os_number: 1, estado: "ACEPTADO", prioridad: "URGENTE", area: "Taller Vial" }),
    os({ os_number: 2, estado: null, prioridad: null, area: "Mantenimiento" }),
    os({ os_number: 3, estado: "LO QUE SEA", prioridad: "URGENTE", area: "Mantenimiento" }),
  ];
  const opciones = opcionesDeLasOrdenes(ordenes);

  it("el vocabulario va entero y en su orden, aunque no tenga filas", () => {
    const estados = opciones.estado.map(([v]) => v);
    expect(estados.slice(0, ESTADOS_OS.length)).toEqual([...ESTADOS_OS]);
    expect(estados).toContain("DENEGADO");
    expect(opciones.prioridad.map(([v]) => v).slice(0, PRIORIDADES_OS.length))
      .toEqual([...PRIORIDADES_OS]);
  });

  it("lo que está cargado fuera del vocabulario se suma al final", () => {
    const estados = opciones.estado.map(([v]) => v);
    expect(estados[ESTADOS_OS.length]).toBe("LO QUE SEA");
    expect(filtrar(ordenes, { estado: ["LO QUE SEA"] }).map((o) => o.os_number)).toEqual([3]);
  });

  it("la opción de vacío aparece sólo si hay alguna vacía", () => {
    expect(opciones.estado.at(-1)).toEqual([SIN_CARGAR, "Sin estado"]);
    expect(opciones.area.some(([v]) => v === SIN_CARGAR)).toBe(false);
  });

  it("las columnas libres salen sin repetir y ordenadas", () => {
    expect(opciones.area.map(([v]) => v)).toEqual(["Mantenimiento", "Taller Vial"]);
  });
});

describe("cuántos filtros hay puestos", () => {
  it("cuenta cero cuando no hay ninguno", () => {
    expect(cuantosFiltrosPuestos(FILTROS_OS_VACIOS)).toBe(0);
  });

  it("un rango cuenta uno aunque tenga dos campos", () => {
    expect(cuantosFiltrosPuestos({ ...FILTROS_OS_VACIOS, desde: "2026-01-01", hasta: "2026-12-31" })).toBe(1);
    expect(cuantosFiltrosPuestos({ ...FILTROS_OS_VACIOS, costoDesde: "1", costoHasta: "2" })).toBe(1);
  });

  it("un buscador con espacios no cuenta", () => {
    expect(cuantosFiltrosPuestos({ ...FILTROS_OS_VACIOS, busqueda: "   " })).toBe(0);
    expect(cuantosFiltrosPuestos({ ...FILTROS_OS_VACIOS, busqueda: "molino" })).toBe(1);
  });

  it("suma los de lista, los sí o no y el enlace", () => {
    expect(cuantosFiltrosPuestos({
      ...FILTROS_OS_VACIOS,
      area: ["Mantenimiento"], prioridad: ["URGENTE", "LEVE"],
      foto: "si", enlace: "alguno",
    })).toBe(4);
  });
});
