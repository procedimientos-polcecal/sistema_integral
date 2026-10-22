import { describe, it, expect } from "vitest";
import {
  filaDeAviso, prioridadDeUrgencia, URGENCIAS,
  proximoNumeroDeAviso, filaParaLaPlanilla, COLUMNA_OT_ASIGNADA,
  fechaDeLaCarga,
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

  it("la foto va a la columna K y no corre de lugar a las observaciones", () => {
    const fila = filaParaLaPlanilla({
      oa_number: "A185",
      descripcion: "pierde aceite",
      observaciones: "avisado al jefe",
      reference_photos: ["https://ejemplo/foto.jpg"],
    });
    expect(fila[10]).toBe("https://ejemplo/foto.jpg"); // COL.imagen = K
    expect(fila[11]).toBe("avisado al jefe"); // COL.observaciones = L
  });

  it("sin foto, la K queda vacía", () => {
    expect(filaParaLaPlanilla({ oa_number: "A186" })[10]).toBe("");
  });

  // `agregarFila()` escribe con USER_ENTERED: lo que entra lo interpreta la
  // planilla de producción, y estos tres campos los escribe cualquier usuario.
  it("un texto que empieza con = no llega como fórmula", () => {
    const f = filaParaLaPlanilla({
      oa_number: "A187",
      descripcion: "=IMPORTRANGE(\"https://x\";\"A1\")",
      observaciones: "=1+1",
      quien_aviso: "=HYPERLINK(\"http://x\")",
    });
    expect(f[4]).toBe("'=IMPORTRANGE(\"https://x\";\"A1\")");
    expect(f[11]).toBe("'=1+1");
    expect(f[6]).toBe("'=HYPERLINK(\"http://x\")");
  });

  it("un texto que empieza con -, + o @ tampoco", () => {
    expect(filaParaLaPlanilla({ oa_number: "A188", descripcion: "- pierde aceite" })[4])
      .toBe("'- pierde aceite");
    expect(filaParaLaPlanilla({ oa_number: "A188", descripcion: "+54 9 381" })[4])
      .toBe("'+54 9 381");
    expect(filaParaLaPlanilla({ oa_number: "A188", observaciones: "@jefe" })[11])
      .toBe("'@jefe");
  });

  it("un texto normal no cambia, ni siquiera con un = en el medio", () => {
    const f = filaParaLaPlanilla({
      oa_number: "A189",
      descripcion: "pierde aceite a=3 - mucho",
      observaciones: "avisado",
      quien_aviso: "Martín Sandoval",
    });
    expect(f[4]).toBe("pierde aceite a=3 - mucho");
    expect(f[11]).toBe("avisado");
    expect(f[6]).toBe("Martín Sandoval");
  });
});

describe("fechaDeLaCarga", () => {
  // Los cuatro primeros son los del plan, con una diferencia pedida: lo que no
  // sirve ya no cae a hoy, se rechaza. Corregir la fecha en silencio deja la
  // carga fechada un día que nadie eligió y nadie se entera.
  it("sin fecha en el cuerpo no hay nada que decidir: la ruta pone hoy, como hasta ahora", () => {
    expect(fechaDeLaCarga(undefined, "2026-10-19")).toEqual({ estado: "ausente" });
    expect(fechaDeLaCarga("", "2026-10-19")).toEqual({ estado: "ausente" });
    expect(fechaDeLaCarga(null, "2026-10-19")).toEqual({ estado: "ausente" });
  });

  it("con la fecha del viernes la respeta, aunque entre el lunes", () => {
    expect(fechaDeLaCarga("2026-10-16", "2026-10-19")).toEqual({
      estado: "sirve", fecha: "2026-10-16",
    });
  });

  it("una fecha que no es una fecha no entra, y no se corrige a hoy", () => {
    const r = fechaDeLaCarga("el viernes", "2026-10-19");
    expect(r.estado).toBe("no-sirve");
  });

  it("una fecha futura no entra: el reloj del teléfono puede estar mal", () => {
    const r = fechaDeLaCarga("2026-11-30", "2026-10-19");
    expect(r.estado).toBe("no-sirve");
  });

  it("el motivo nombra lo que vino: es lo primero que busca en su pantalla quien lo lee", () => {
    const basura = fechaDeLaCarga("el viernes", "2026-10-19");
    expect(basura.estado === "no-sirve" && basura.motivo).toContain("el viernes");

    const futura = fechaDeLaCarga("2026-11-30", "2026-10-19");
    // Como la escribe una persona, que es como la eligió en la pantalla.
    expect(futura.estado === "no-sirve" && futura.motivo).toContain("30/11/2026");
  });

  it("acepta hoy mismo, que es el caso de siempre", () => {
    expect(fechaDeLaCarga("2026-10-19", "2026-10-19")).toEqual({
      estado: "sirve", fecha: "2026-10-19",
    });
  });

  it("una fecha que no existe no entra y no rueda al día siguiente", () => {
    // El 31 de febrero no se convierte en 3 de marzo: `fechaDeTexto` lo
    // descarta, y acá eso tiene que terminar en un rechazo.
    expect(fechaDeLaCarga("2026-02-31", "2026-10-19").estado).toBe("no-sirve");
  });

  it("lee d/m como las planillas y no al revés", () => {
    expect(fechaDeLaCarga("05/10/2026", "2026-10-19")).toEqual({
      estado: "sirve", fecha: "2026-10-05",
    });
  });

  /*
   * El tope para atrás, que es el agujero gemelo del de la fecha futura y el
   * peor de los dos: una futura se nota, una de 2019 se mete en el medio de la
   * serie del equipo y ahí se queda. Pasa con el reloj perdido —la pila que se
   * agotó, el aparato que vuelve a la fecha de fábrica—, y la carga sin señal
   * es justamente donde la fecha la pone el reloj y no la mira nadie.
   */
  it("una fecha de hace años no entra: el reloj del teléfono se perdió", () => {
    const r = fechaDeLaCarga("2019-03-04", "2026-10-19");
    expect(r.estado).toBe("no-sirve");
    expect(r.estado === "no-sirve" && r.motivo).toContain("04/03/2019");
    expect(r.estado === "no-sirve" && r.motivo).toContain("más de un año");
  });

  it("hasta un año para atrás sí entra: cargar trabajo viejo es legítimo", () => {
    // El tope es un año y no un mes a propósito: estas rutas también reciben
    // trabajo ya hecho que se carga tarde, y rechazarlo sería trabar una carga
    // que no tiene nada mal.
    expect(fechaDeLaCarga("2025-10-19", "2026-10-19")).toEqual({
      estado: "sirve", fecha: "2025-10-19",
    });
    expect(fechaDeLaCarga("2025-10-20", "2026-10-19")).toEqual({
      estado: "sirve", fecha: "2025-10-20",
    });
    expect(fechaDeLaCarga("2025-10-18", "2026-10-19").estado).toBe("no-sirve");
  });

  it("el tope se corre con el año bisiesto sin romperse", () => {
    // El 29 de febrero menos un año da un día que no existe; acá nunca se
    // construye una fecha con eso, sólo se compara texto, así que el orden
    // sigue siendo el correcto.
    expect(fechaDeLaCarga("2027-03-01", "2028-02-29").estado).toBe("sirve");
    expect(fechaDeLaCarga("2027-02-28", "2028-02-29").estado).toBe("no-sirve");
  });
});
