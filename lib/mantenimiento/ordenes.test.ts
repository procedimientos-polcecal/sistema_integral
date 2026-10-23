import { describe, it, expect } from "vitest";
import {
  estadoDeTexto, filaDeOrden, celdasParaRegistrar,
  repartirRegistroDeOT,
  esEstadoDeOT,
  ESTADOS_DE_OT,
} from "./ordenes";

/**
 * Los cuatro estados que usa la planilla, verificados contra ella:
 * Realizado | Atrasado | Por hacer | En proceso.
 */
describe("estado de la planilla", () => {
  it("traduce los cuatro que se usan", () => {
    expect(estadoDeTexto("Realizado")).toBe("REALIZADO");
    expect(estadoDeTexto("En proceso")).toBe("EN_PROCESO");
    expect(estadoDeTexto("Atrasado")).toBe("ATRASADO");
    expect(estadoDeTexto("Por hacer")).toBe("POR_HACER");
  });

  it("no depende de mayusculas ni espacios", () => {
    expect(estadoDeTexto("  REALIZADO ")).toBe("REALIZADO");
    expect(estadoDeTexto("en Proceso")).toBe("EN_PROCESO");
  });

  /**
   * Una OT que la planilla no clasifica todavia es una OT por hacer: es el
   * estado del que se parte, no un dato faltante.
   */
  it("lo que no reconoce queda por hacer", () => {
    expect(estadoDeTexto("")).toBe("POR_HACER");
    expect(estadoDeTexto(null)).toBe("POR_HACER");
    expect(estadoDeTexto("cualquier cosa")).toBe("POR_HACER");
  });
});

describe("una fila de la planilla como orden de trabajo", () => {
  /**
   * Fila real de la planilla OT. La columna L —"Column 19"— es un "Atrasado /
   * al dia" calculado y NO es el estado: el estado esta en M.
   */
  const fila = [
    623, 45992.40406341436, "Planta de trituración 1", "PO-A1-07 – Rompedora de cono",
    "MECÁNICO", "PROGRAMADO", "INTERNO", "Cambio de rodamientos del eje",
    "Dos rodamientos 32222", 45992, 45994, "Atrasado", "Realizado", "-", "-",
  ];

  it("lee cada columna por su posicion", () => {
    const o = filaDeOrden(fila, 3);
    expect(o).not.toBeNull();
    if (!o) return;
    expect(o.ot_number).toBe(623);
    expect(o.fecha).toBe("2025-12-01");
    expect(o.sector_raw).toBe("Planta de trituración 1");
    expect(o.equipo_raw).toBe("PO-A1-07 – Rompedora de cono");
    expect(o.equipo_code).toBe("PO-A1-07");
    expect(o.especialidad).toBe("MECÁNICO");
    expect(o.tipo).toBe("PROGRAMADO");
    expect(o.descripcion).toBe("Cambio de rodamientos del eje");
    expect(o.fecha_ejecucion).toBe("2025-12-01");
    expect(o.fecha_cierre).toBe("2025-12-03");
    expect(o.sheets_row).toBe(3);
  });

  it("el estado sale de M, no de la columna calculada de al lado", () => {
    expect(filaDeOrden(fila, 3)?.estado).toBe("REALIZADO");
  });

  it("una fila sin numero de OT no es una orden", () => {
    expect(filaDeOrden(["", 45992], 4)).toBeNull();
    expect(filaDeOrden(["texto", 45992], 5)).toBeNull();
    expect(filaDeOrden([], 6)).toBeNull();
  });

  it("las horas se leen como numero, y lo que no lo es queda en null", () => {
    const conHoras = [...fila]; conHoras[14] = "3,5";
    expect(filaDeOrden(conHoras, 3)?.horas).toBe(3.5);
    const sinHoras = [...fila]; sinHoras[14] = "-";
    expect(filaDeOrden(sinHoras, 3)?.horas).toBeNull();
  });

  it("un guion en un campo de texto es vacio, no un guion", () => {
    const o = filaDeOrden(fila, 3);
    expect(o?.contratista).toBeNull();
    expect(o?.operario_1).toBeNull();
  });
});

describe("celdasParaRegistrar", () => {
  const registro = {
    estado: "REALIZADO",
    fecha_cierre: "2026-08-25",
    horas: 3.5,
    contratista: "ConMet",
    operario_1: "Pérez",
    operario_2: null,
    operario_3: null,
    observaciones: "Se cambió el rodamiento",
    foto_url: null,
  };

  it("manda cada dato a su columna", () => {
    const celdas = celdasParaRegistrar(registro);
    const de = (letra: string) => celdas.find((c) => c.letra === letra)?.valor;

    // Verificado contra la planilla: M estado, K cierre, O horas, W observaciones.
    expect(de("M")).toBe("Realizado");
    expect(de("K")).toBe("25/08/2026");
    expect(de("O")).toBe("3.5");
    expect(de("N")).toBe("ConMet");
    expect(de("P")).toBe("Pérez");
    expect(de("W")).toBe("Se cambió el rodamiento");
  });

  it("no escribe la columna L, que es una fórmula", () => {
    // "Column 19" calcula atrasado/al día. Pisarla rompería el cálculo de
    // toda la planilla.
    expect(celdasParaRegistrar(registro).map((c) => c.letra)).not.toContain("L");
  });

  it("escribe el estado como lo escribe la planilla, no como lo guarda la app", () => {
    expect(celdasParaRegistrar({ estado: "EN_PROCESO" }).find((c) => c.letra === "M")?.valor)
      .toBe("En proceso");
    expect(celdasParaRegistrar({ estado: "POR_HACER" }).find((c) => c.letra === "M")?.valor)
      .toBe("Por hacer");
  });

  it("sólo manda lo que se pasó", () => {
    const celdas = celdasParaRegistrar({ observaciones: "sólo esto" });
    expect(celdas).toHaveLength(1);
    expect(celdas[0].letra).toBe("W");
  });

  it("vaciar un campo lo vacía en la planilla", () => {
    // Distinto de no pasarlo: pasarlo en null es "sacá lo que había".
    expect(celdasParaRegistrar({ contratista: null })).toEqual([
      { letra: "N", columna: 13, valor: "" },
    ]);
  });
});


/**
 * `ordenes_trabajo` no tiene columna de observaciones ni de foto: en el sistema
 * viven en la ejecucion, y en la planilla en la W y la V. Meterlas en el update
 * de la tabla hacia fallar el PATCH entero con "Could not find the
 * 'observaciones' column" justo despues de guardar la ejecucion, y la OT
 * quedaba sin cerrar con el trabajo ya registrado.
 */
describe("repartir lo que se registra entre la tabla y la planilla", () => {
  it("las observaciones van solo a la planilla", () => {
    const { update, registro } = repartirRegistroDeOT({ observaciones: "Se cambio el rodamiento" });
    expect(update).toEqual({});
    expect(registro.observaciones).toBe("Se cambio el rodamiento");
  });

  it("la foto tampoco toca la tabla", () => {
    const { update, registro } = repartirRegistroDeOT({ foto_url: "https://drive/x" });
    expect(update).toEqual({});
    expect(registro.foto_url).toBe("https://drive/x");
  });

  it("el contratista y los operarios van a los dos lados", () => {
    const { update, registro } = repartirRegistroDeOT({
      contratista: " Candia ", operario_1: "Lopez", operario_2: "", operario_3: null,
    });
    expect(update).toEqual({
      contratista: "Candia", operario_1: "Lopez", operario_2: null, operario_3: null,
    });
    expect(registro.contratista).toBe("Candia");
    expect(registro.operario_2).toBeNull();
  });

  it("las horas se guardan como numero, y lo ilegible como vacio", () => {
    expect(repartirRegistroDeOT({ horas: "4.5" }).update.horas).toBe(4.5);
    expect(repartirRegistroDeOT({ horas: "" }).update.horas).toBeNull();
    expect(repartirRegistroDeOT({ horas: "s/d" }).update.horas).toBeNull();
  });

  /** No pasar un campo es "no lo toques"; pasarlo en null es "vacialo". */
  it("lo que no se paso no aparece de ningun lado", () => {
    const { update, registro } = repartirRegistroDeOT({ estado: "REALIZADO" });
    expect(update).toEqual({ estado: "REALIZADO" });
    expect(registro).toEqual({ estado: "REALIZADO" });
    expect("observaciones" in registro).toBe(false);
    expect("horas" in update).toBe(false);
  });

  it("un campo que no esta en la lista blanca no llega a la base", () => {
    const { update } = repartirRegistroDeOT({ ot_number: 9999, descripcion: "otra cosa" });
    expect(update).toEqual({});
  });

  /**
   * El caso que fallaba: registrar el trabajo manda las dos cosas juntas. Lo de
   * la tabla tiene que quedar limpio de observaciones.
   */
  it("al registrar el trabajo, el update no lleva observaciones", () => {
    const { update, registro } = repartirRegistroDeOT({
      estado: "REALIZADO",
      fecha_cierre: "2026-08-31",
      horas: 3,
      operario_1: "Lopez",
      observaciones: "Rotacion de martillo",
      foto_url: "https://drive/foto",
    });

    expect(Object.keys(update).sort()).toEqual(["estado", "fecha_cierre", "horas", "operario_1"]);
    expect(registro.observaciones).toBe("Rotacion de martillo");
    expect(registro.foto_url).toBe("https://drive/foto");
  });
});

describe("esEstadoDeOT", () => {
  it("acepta los cinco del vocabulario", () => {
    for (const e of ESTADOS_DE_OT) expect(esEstadoDeOT(e)).toBe(true);
  });

  /**
   * La lista estaba exportada y no la usaba nadie: la ruta tenia su propia
   * copia y solo el PATCH validaba. El POST escribia el texto crudo a la base
   * y de ahi a la planilla.
   */
  it("rechaza cualquier otra cosa", () => {
    expect(esEstadoDeOT("realizado")).toBe(false);   // distingue mayusculas
    expect(esEstadoDeOT("TERMINADO")).toBe(false);
    expect(esEstadoDeOT("")).toBe(false);
    expect(esEstadoDeOT(null)).toBe(false);
    expect(esEstadoDeOT(undefined)).toBe(false);
    expect(esEstadoDeOT(1)).toBe(false);
  });
});

/*
 * `escribirCeldas` manda `USER_ENTERED`, asi que la planilla de produccion
 * interpreta lo que llega. El 19/10/2026 un lazo de IMPORTRANGE dejo las once
 * pestanas de Compras en blanco todo el dia, y una descripcion tipeada hace
 * lo mismo a mano. El nucleo lo resuelve con `textoParaLaCelda`; aca se fija
 * que el registro de la ejecucion la use, y que NO la use donde rompe.
 */
describe("el registro no deja entrar una formula", () => {
  it("escapa los cinco campos que tipea una persona", () => {
    const celdas = celdasParaRegistrar({
      contratista: "=HYPERLINK(\"http://x\")",
      operario_1: "-Perez",
      operario_2: "+Gomez",
      operario_3: "@Lopez",
      observaciones: "=IMPORTRANGE(\"https://x\";\"A1\")",
    });
    const de = (letra: string) => celdas.find((c) => c.letra === letra)?.valor;

    expect(de("N")).toBe("'=HYPERLINK(\"http://x\")");
    expect(de("P")).toBe("'-Perez");
    expect(de("Q")).toBe("'+Gomez");
    expect(de("R")).toBe("'@Lopez");
    expect(de("W")).toBe("'=IMPORTRANGE(\"https://x\";\"A1\")");
  });

  it("un texto normal no cambia", () => {
    const celdas = celdasParaRegistrar({
      contratista: "ConMet",
      observaciones: "Se cambio el rodamiento a=3 - quedo bien",
    });
    const de = (letra: string) => celdas.find((c) => c.letra === letra)?.valor;

    expect(de("N")).toBe("ConMet");
    expect(de("W")).toBe("Se cambio el rodamiento a=3 - quedo bien");
  });

  /*
   * La otra mitad de la regla, y la que se olvida: prefijar un numero lo
   * convierte en texto. Las horas se suman en la planilla y la fecha de
   * cierre alimenta la columna de atrasado/al dia.
   */
  it("las horas y la fecha siguen entrando como numero y como fecha", () => {
    const celdas = celdasParaRegistrar({ horas: 3.5, fecha_cierre: "2026-08-25" });
    const de = (letra: string) => celdas.find((c) => c.letra === letra)?.valor;

    expect(de("O")).toBe("3.5");
    expect(de("K")).toBe("25/08/2026");
  });
});
