import { describe, it, expect } from "vitest";
import {
  formularioQueSeVe,
  queHacerConElGlosario,
  SIN_GLOSARIO,
  tiposQueSeOfrecen,
} from "./glosarioOffline";

const LISTA = [
  { id: "0b6e3a4e-0000-4000-8000-000000000001", nombre: "Caída al mismo nivel" },
  { id: "0b6e3a4e-0000-4000-8000-000000000002", nombre: "Contacto eléctrico" },
];

describe("queHacerConElGlosario", () => {
  it("un 200 con la lista y el permiso se guarda entero", () => {
    expect(queHacerConElGlosario(200, { data: LISTA, puedeCargar: true })).toEqual({
      accion: "guardar",
      glosario: { peligros: LISTA, puedeCargar: true },
    });
  });

  it("un 403 de la ruta borra el permiso y la lista: la tarjeta se esconde", () => {
    // Es la forma exacta que manda la ruta. Alguien a quien le sacaron el módulo
    // tiene que dejar de ver la tarjeta la próxima vez que haya señal.
    expect(
      queHacerConElGlosario(403, { error: "No tenés permiso para cargar condiciones inseguras" }),
    ).toEqual({ accion: "guardar", glosario: SIN_GLOSARIO });
  });

  it("sin permiso anotado, la tarjeta no se muestra", () => {
    expect(SIN_GLOSARIO).toEqual({ peligros: [], puedeCargar: false });
  });

  it("un 403 sin `error` no es de la ruta —un portal de WiFi, un cortafuegos— y no toca nada", () => {
    expect(queHacerConElGlosario(403, {})).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(403, null)).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(403, { error: "  " })).toEqual({ accion: "dejar" });
  });

  it("sin señal, un 401 o un 500 dejan lo que había: no se esconde la tarjeta por una caída", () => {
    expect(queHacerConElGlosario(null, null)).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(401, { error: "No autorizado" })).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(500, { error: "No se pudo leer el glosario" })).toEqual({
      accion: "dejar",
    });
  });

  it("un 200 que no trae lo que manda la ruta tampoco cuenta: es el HTML de otro", () => {
    expect(queHacerConElGlosario(200, {})).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(200, { data: LISTA })).toEqual({ accion: "dejar" });
    expect(queHacerConElGlosario(200, { data: "x", puedeCargar: true })).toEqual({
      accion: "dejar",
    });
    expect(queHacerConElGlosario(200, null)).toEqual({ accion: "dejar" });
  });

  it("de la lista sólo quedan los renglones con id y nombre", () => {
    const r = queHacerConElGlosario(200, {
      data: [LISTA[0], { id: 5, nombre: "x" }, { nombre: "sin id" }, null],
      puedeCargar: true,
    });
    expect(r).toEqual({
      accion: "guardar",
      glosario: { peligros: [LISTA[0]], puedeCargar: true },
    });
  });
});

describe("qué ofrece /cargar según el permiso anotado", () => {
  it("sin permiso, el aviso y la orden como siempre y ninguna tarjeta de condición", () => {
    expect(tiposQueSeOfrecen(false)).toEqual(["aviso", "orden"]);
  });

  it("con permiso, se suma la condición al final", () => {
    expect(tiposQueSeOfrecen(true)).toEqual(["aviso", "orden", "condicion"]);
  });

  it("si se retiró el permiso, la pestaña elegida de condición vuelve al aviso", () => {
    expect(formularioQueSeVe("condicion", tiposQueSeOfrecen(false))).toBe("aviso");
    expect(formularioQueSeVe("condicion", tiposQueSeOfrecen(true))).toBe("condicion");
    expect(formularioQueSeVe("orden", tiposQueSeOfrecen(false))).toBe("orden");
  });
});
