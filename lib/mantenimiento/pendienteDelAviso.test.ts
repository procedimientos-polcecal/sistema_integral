import { describe, it, expect } from "vitest";
import {
  camposDelPendiente, celdasDelAviso, elIntentoDelAviso, comoSeGuardanLosCampos,
} from "@/lib/mantenimiento/pendienteDelAviso";

/** Las dos columnas, contando desde A = 0: J y L. */
const COL_OT = 9, COL_OBS = 11;

describe("camposDelPendiente", () => {
  it("lee los campos anotados", () => {
    expect(camposDelPendiente("ot_asignada")).toEqual(["ot_asignada"]);
    expect(camposDelPendiente("ot_asignada,observaciones")).toEqual([
      "ot_asignada", "observaciones",
    ]);
    expect(camposDelPendiente(" observaciones , ot_asignada ")).toEqual([
      "observaciones", "ot_asignada",
    ]);
  });

  it("descarta lo que no reconoce en vez de caerse", () => {
    // Es una columna de texto: un valor viejo o escrito a mano no puede tirar
    // abajo el drenaje entero de los avisos.
    expect(camposDelPendiente("urgencia,ot_asignada")).toEqual(["ot_asignada"]);
    expect(camposDelPendiente("cualquier cosa")).toEqual([]);
    expect(camposDelPendiente(null)).toEqual([]);
    expect(camposDelPendiente("")).toEqual([]);
  });
});

describe("celdasDelAviso", () => {
  const aviso = { ot_asignada: "2896", observaciones: "Desestimado el 29/10 por Ana: no corresponde" };

  it("arma sólo la celda del campo que falló", () => {
    expect(celdasDelAviso(aviso, ["ot_asignada"])).toEqual([
      { columna: COL_OT, valor: "2896" },
    ]);
    expect(celdasDelAviso(aviso, ["observaciones"])).toEqual([
      { columna: COL_OBS, valor: aviso.observaciones },
    ]);
  });

  it("NO toca la otra columna, que es todo el motivo de guardar el campo", () => {
    // `OT ASIGNADA` la escriben a mano —182 de 186—. Si un fallo de
    // OBSERVACIONES reescribiera las dos, podría vaciar un número que alguien
    // acaba de tipear y el sync todavía no importó.
    const celdas = celdasDelAviso({ ot_asignada: null, observaciones: "algo" }, ["observaciones"]);
    expect(celdas).toEqual([{ columna: COL_OBS, valor: "algo" }]);
    expect(celdas!.some((c) => c.columna === COL_OT)).toBe(false);
  });

  it("acá lo vacío SÍ viaja: vaciar es la mitad de los caminos", () => {
    // Desenlazar una OT y retomar un aviso desestimado son justamente vaciar.
    // Con la regla de las OT —lo vacío no viaja— no se podrían encolar nunca.
    expect(celdasDelAviso({ ot_asignada: null, observaciones: null }, ["ot_asignada"])).toEqual([
      { columna: COL_OT, valor: "" },
    ]);
  });

  it("una columna por campo, aunque venga repetido", () => {
    expect(celdasDelAviso(aviso, ["ot_asignada", "ot_asignada"])).toEqual([
      { columna: COL_OT, valor: "2896" },
    ]);
  });

  it("null sin campos: una cola con filas que no hacen nada deja de decir si algo está trabado", () => {
    expect(celdasDelAviso(aviso, [])).toBeNull();
  });
});

describe("elIntentoDelAviso", () => {
  it("con error anota el motivo y qué campo", () => {
    const i = elIntentoDelAviso("The caller does not have permission (403)", ["observaciones"]);
    expect(i.sheets_pendiente).toBe("The caller does not have permission (403)");
    expect(i.sheets_pendiente_campos).toBe("observaciones");
  });

  it("sin error limpia la marca", () => {
    const i = elIntentoDelAviso(null, ["observaciones"]);
    expect(i).toMatchObject({ sheets_pendiente: null, sheets_pendiente_campos: null });
  });

  it("un éxito NO le borra el pendiente al otro campo", () => {
    // Si `ot_asignada` venía fallando y ahora sale bien `observaciones`,
    // limpiar todo diría que está exportado algo que no se escribió.
    const i = elIntentoDelAviso(null, ["observaciones"], ["ot_asignada"]);
    expect(i.sheets_pendiente_campos).toBe("ot_asignada");
    expect(i.sheets_pendiente).toContain("intento anterior");
  });

  it("un éxito del mismo campo sí lo cierra", () => {
    const i = elIntentoDelAviso(null, ["observaciones"], ["observaciones"]);
    expect(i).toMatchObject({ sheets_pendiente: null, sheets_pendiente_campos: null });
  });

  it("un fallo nuevo se suma al que ya estaba, sin repetirlo", () => {
    const i = elIntentoDelAviso("se cayó", ["observaciones"], ["ot_asignada", "observaciones"]);
    expect(i.sheets_pendiente_campos).toBe("ot_asignada,observaciones");
  });

  it("siempre deja cuándo se intentó, salga o no", () => {
    // Sirve para ver si una cola dejó de avanzar, que es distinto de una corta.
    expect(elIntentoDelAviso(null, ["observaciones"]).sheets_intentado_en).toBeTruthy();
    expect(elIntentoDelAviso("falló", ["observaciones"]).sheets_intentado_en).toBeTruthy();
  });
});

describe("comoSeGuardanLosCampos", () => {
  it("texto plano separado por coma, para poder mirarlo con un select", () => {
    expect(comoSeGuardanLosCampos(["ot_asignada", "observaciones"])).toBe(
      "ot_asignada,observaciones"
    );
  });

  it("ida y vuelta", () => {
    const campos = ["observaciones", "ot_asignada"] as const;
    expect(camposDelPendiente(comoSeGuardanLosCampos(campos)).sort()).toEqual(
      [...campos].sort()
    );
  });
});
