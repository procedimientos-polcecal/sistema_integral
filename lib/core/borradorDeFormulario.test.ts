import { beforeEach, describe, expect, it } from "vitest";
import {
  claveDelBorrador,
  conElBorrador,
  guardarBorrador,
  hayAlgoEscrito,
  leerBorrador,
  soloLoTocado,
  tirarBorrador,
  vaciarBorradores,
} from "./borradorDeFormulario";

describe("claveDelBorrador", () => {
  it("dos registros distintos no comparten clave", () => {
    expect(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2905 }))
      .not.toBe(claveDelBorrador("registrar-ot", { tipo: "ot", id: 2907 }));
  });

  it("un alta en blanco no comparte clave con una prellenada desde un aviso", () => {
    expect(claveDelBorrador("nueva-ot"))
      .not.toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
  });

  it("dos altas desde el mismo aviso sí comparten clave: es el mismo trabajo", () => {
    expect(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }))
      .toBe(claveDelBorrador("nueva-ot", { tipo: "aviso", id: 5 }));
  });

  it("el número y el texto del mismo id son la misma clave", () => {
    expect(claveDelBorrador("ot", { tipo: "ot", id: 7 }))
      .toBe(claveDelBorrador("ot", { tipo: "ot", id: "7" }));
  });
});

describe("hayAlgoEscrito", () => {
  it("un formulario intacto no tiene nada escrito, aunque nazca con valores", () => {
    const inicial = { horas: "8", contratista: "", operario: null };
    expect(hayAlgoEscrito(inicial, { ...inicial })).toBe(false);
  });

  it("cambiar un valor por omisión cuenta como escrito", () => {
    expect(hayAlgoEscrito({ horas: "8" }, { horas: "9" })).toBe(true);
  });

  it("volver un campo a su valor inicial deja el formulario intacto", () => {
    expect(hayAlgoEscrito({ nota: "" }, { nota: "" })).toBe(false);
  });

  it("un campo anidado que cambió cuenta como escrito", () => {
    expect(hayAlgoEscrito({ repuestos: [{ id: 1 }] }, { repuestos: [{ id: 2 }] })).toBe(true);
  });
});

describe("hayAlgoEscrito: dos decisiones que el código ya tomaba", () => {
  it("un campo undefined y un campo ausente son lo mismo", () => {
    expect(hayAlgoEscrito<Record<string, unknown>>({ nota: "x" }, { nota: "x", extra: undefined })).toBe(false);
  });

  it("dos fechas se comparan por su instante y no por identidad", () => {
    expect(hayAlgoEscrito({ dia: new Date("2026-11-13T00:00:00Z") }, { dia: new Date("2026-11-13T00:00:00Z") })).toBe(false);
    expect(hayAlgoEscrito({ dia: new Date("2026-11-13T00:00:00Z") }, { dia: new Date("2026-11-14T00:00:00Z") })).toBe(true);
  });
});

describe("el almacén de borradores", () => {
  beforeEach(() => vaciarBorradores());

  it("lo guardado vuelve con la misma clave", () => {
    guardarBorrador("k", { horas: "8" });
    expect(leerBorrador("k")).toEqual({ horas: "8" });
  });

  it("una clave que nadie guardó devuelve undefined y no un objeto vacío", () => {
    expect(leerBorrador("nunca")).toBeUndefined();
  });

  it("tirarlo lo saca de verdad", () => {
    guardarBorrador("k", { a: 1 });
    tirarBorrador("k");
    expect(leerBorrador("k")).toBeUndefined();
  });

  it("tirar una clave no toca a las demás", () => {
    guardarBorrador("a", { x: 1 });
    guardarBorrador("b", { y: 2 });
    tirarBorrador("a");
    expect(leerBorrador("b")).toEqual({ y: 2 });
  });
});

describe("el borrador guarda el cambio y no el registro", () => {
  beforeEach(() => vaciarBorradores());

  it("el borrador guarda sólo lo que se tocó, no el registro entero", () => {
    const inicial = { horas: "8", contratista: "PIPARO", operario: "Perez" };
    guardarBorrador("k", soloLoTocado(inicial, { ...inicial, horas: "9" }));
    expect(leerBorrador("k")).toEqual({ horas: "9" });
  });

  it("restaurar sobre un registro que cambió no pisa lo que no se tocó", () => {
    const delServidor = { horas: "8", contratista: "CANDIA", operario: "Perez" };
    expect(conElBorrador(delServidor, { horas: "9" }))
      .toEqual({ horas: "9", contratista: "CANDIA", operario: "Perez" });
  });
});

describe("soloLoTocado", () => {
  it("un formulario intacto no deja ningún campo", () => {
    const inicial = { horas: "8", contratista: "PIPARO" };
    expect(soloLoTocado(inicial, { ...inicial })).toEqual({});
  });

  it("un campo que volvió a su valor inicial no queda en el borrador", () => {
    expect(soloLoTocado({ horas: "8", nota: "" }, { horas: "8", nota: "algo" }))
      .toEqual({ nota: "algo" });
  });

  it("compara en profundidad: una lista igual campo a campo no es un cambio", () => {
    const inicial = { repuestos: [{ id: 1, cantidad: "2" }] };
    expect(soloLoTocado(inicial, { repuestos: [{ id: 1, cantidad: "2" }] })).toEqual({});
    expect(soloLoTocado(inicial, { repuestos: [{ id: 1, cantidad: "3" }] }))
      .toEqual({ repuestos: [{ id: 1, cantidad: "3" }] });
  });

  // `guardarBorrador` guarda la referencia que le dan y `leerBorrador` devuelve
  // esa misma: si el resultado compartiera objeto con `actual`, seguir tipeando
  // reescribiría el borrador ya guardado sin que nadie lo note.
  it("devuelve un objeto nuevo y no el que le pasaron", () => {
    const inicial = { horas: "8" };
    const actual = { horas: "9" };
    const tocado = soloLoTocado(inicial, actual);
    expect(tocado).not.toBe(actual);
    expect(tocado).not.toBe(inicial);
  });
});

describe("conElBorrador", () => {
  it("sin borrador devuelve lo del servidor tal cual", () => {
    const delServidor = { horas: "8", contratista: "CANDIA" };
    expect(conElBorrador(delServidor, undefined)).toEqual(delServidor);
    expect(conElBorrador(delServidor, {})).toEqual(delServidor);
  });

  // Si devolviera el mismo objeto, el formulario escribiría sobre lo que le
  // llegó del servidor y nadie podría volver a compararse contra «como nació».
  it("no devuelve ni el objeto del servidor ni el del borrador", () => {
    const delServidor = { horas: "8" };
    const borrador = { horas: "9" };
    const resultado = conElBorrador(delServidor, borrador);
    expect(resultado).not.toBe(delServidor);
    expect(resultado).not.toBe(borrador);
  });

  it("un campo del borrador con valor vacío sí pisa: borrarlo es haberlo tocado", () => {
    expect(conElBorrador({ nota: "algo" }, { nota: "" })).toEqual({ nota: "" });
  });
});

/*
 * Los dos finales de un formulario, que es lo que decide `tirar()` o
 * `asentar()` en `useBorrador`. El hook no se testea —es de pantalla—, pero la
 * vara contra la que queda comparándose el formulario después sí, y es lo
 * único que separa un guardado bueno de una reversión silenciosa.
 */
describe("después de guardar: contra qué queda comparándose el formulario", () => {
  const comoNacio = { estado: "", proveedor: "ACME", observaciones: "" };
  const guardado = { estado: "PEDIDO", proveedor: "ACME", observaciones: "" };

  it("volver a «cómo nació» con el formulario abierto revierte lo que se acaba de guardar", () => {
    // Esto es `tirar()`: el borrador queda vacío y la pantalla vuelve a lo que
    // decía la OS al abrirla. En un modal que **no** se cierra al guardar, eso
    // deja «Sin estado» en pantalla después de haber guardado «PEDIDO», y un
    // segundo Guardar lo manda encima.
    expect(conElBorrador(comoNacio, {})).toEqual(comoNacio);
    expect(conElBorrador(comoNacio, {}).estado).not.toBe(guardado.estado);
  });

  it("asentar lo guardado no cambia la pantalla y deja el formulario sin tocar", () => {
    expect(conElBorrador(guardado, {})).toEqual(guardado);
    expect(hayAlgoEscrito(guardado, conElBorrador(guardado, {}))).toBe(false);
  });

  // La pantalla no puede guardarse una copia del inicial al lado del borrador
  // para que «Descartar» vuelva a ella: en cuanto la vara del hook se mueve
  // —`asentar()`—, esa copia es la foto de antes de guardar. Pasó en `DetalleOS`.
  it("descartar contra una vara vieja devuelve lo de antes de guardar y deja el formulario tocado", () => {
    const comoAbrio = comoNacio;          // la copia congelada al montar
    const varaDeAhora = guardado;         // la del hook, después de asentar

    const loQueVuelve = conElBorrador(comoAbrio, {});
    expect(loQueVuelve.estado).toBe("");                       // «Sin estado» otra vez
    expect(loQueVuelve.estado).not.toBe(varaDeAhora.estado);
    // Y queda tocado, así que el siguiente «Guardar» manda esto encima.
    expect(hayAlgoEscrito(varaDeAhora, loQueVuelve)).toBe(true);

    // Con una sola vara —la del hook— descartar deja el formulario intacto.
    expect(hayAlgoEscrito(varaDeAhora, conElBorrador(varaDeAhora, {}))).toBe(false);
  });

  it("y lo que se toque después se mide contra lo guardado, no contra lo de antes de editar", () => {
    // Con la vara vieja, volver a poner «PEDIDO» no contaría como un cambio
    // —ya estaba en el borrador— y el formulario figuraría tocado sin estarlo.
    expect(soloLoTocado(guardado, { ...guardado, observaciones: "llegó" }))
      .toEqual({ observaciones: "llegó" });
    expect(soloLoTocado(guardado, { ...guardado })).toEqual({});
  });
});
