import { describe, expect, it } from "vitest";
import {
  aplicacionDelRenglon,
  lecturaDeLaSalida,
  ordenesQueDeclararon,
  salidasCandidatas,
  type SalidaDelPanol,
} from "./salidasDelRepuesto";

function salida(id: string, fecha: string | null, extra: Partial<SalidaDelPanol> = {}): SalidaDelPanol {
  return {
    id,
    articulo_id: "a1",
    fecha,
    cantidad: 1,
    solicitante: null,
    sector_raw: null,
    equipo_raw: null,
    tipo: "salida",
    ...extra,
  };
}

function entrada(fecha: string | null, articulo_id: string | null = "a1") {
  return { articulo_id, fecha };
}

// Suma `n` dias a una fecha AAAA-MM-DD sin pasar por la zona horaria.
function mas(fecha: string, n: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("que salidas son candidatas de una entrada", () => {
  it("entran las del mismo articulo posteriores a la entrada, la mas nueva primero", () => {
    const salidas = [
      salida("primera", "2026-11-18"),
      salida("ultima", "2026-11-25"),
      salida("media", "2026-11-20"),
      salida("anterior", "2026-11-10"),
      salida("otro-articulo", "2026-11-22", { articulo_id: "a2" }),
    ];
    const r = salidasCandidatas(entrada("2026-11-17"), salidas);
    expect(r.map((s) => s.id)).toEqual(["ultima", "media", "primera"]);
  });

  it("las que no son salida no cuentan", () => {
    const r = salidasCandidatas(entrada("2026-11-17"), [
      salida("e", "2026-11-18", { tipo: "entrada" }),
      salida("s", "2026-11-18"),
    ]);
    expect(r.map((s) => s.id)).toEqual(["s"]);
  });

  it("el mismo dia cuenta", () => {
    // La fecha es un `date`: dentro de un dia no hay orden, y "llego y se uso
    // hoy" es el caso tipico del repuesto que se compra para arreglar algo.
    expect(salidasCandidatas(entrada("2026-11-17"), [salida("s1", "2026-11-17")]))
      .toHaveLength(1);
  });

  it("corta a los 90 dias", () => {
    const base = "2026-01-01";
    const r = salidasCandidatas(entrada(base), [
      salida("a90", mas(base, 90)),
      salida("a91", mas(base, 91)),
    ]);
    expect(r.map((s) => s.id)).toEqual(["a90"]);
  });

  it("muestra 10 como mucho", () => {
    // Medido: el maximo real es 454 salidas posteriores. (Review Focus 3.)
    const cien = Array.from({ length: 100 }, (_, i) => salida(`s${i}`, mas("2026-01-02", i)));
    const r = salidasCandidatas(entrada("2026-01-01"), cien, { dias: 10_000 });
    expect(r).toHaveLength(10);
    // El tope corta despues de ordenar: quedan las 10 mas nuevas.
    expect(r[0].id).toBe("s99");
    expect(r[9].id).toBe("s90");
  });

  it("una entrada sin fecha no lista nada", () => {
    expect(salidasCandidatas(entrada(null), [salida("s1", "2026-11-17")])).toEqual([]);
  });

  it("una salida sin fecha no es candidata", () => {
    expect(salidasCandidatas(entrada("2026-11-17"), [salida("s1", null)])).toEqual([]);
  });

  it("una entrada sin articulo no lista nada", () => {
    // Sin pieza no hay que comparar: dos articulo_id null no son la misma pieza.
    expect(
      salidasCandidatas(entrada("2026-11-17", null), [
        salida("s1", "2026-11-18", { articulo_id: null }),
      ]),
    ).toEqual([]);
  });
});

describe("que dice un vinculo", () => {
  it("sin movimiento, sin justificar", () => {
    expect(aplicacionDelRenglon({ articulo_id: "a1", movimiento_id: null }, null).estado)
      .toBe("sin-justificar");
    // La forma real de hoy: 0 de 37 renglones tienen articulo.
    expect(aplicacionDelRenglon({ articulo_id: null, movimiento_id: null }, null).estado)
      .toBe("sin-justificar");
  });

  it("hay vinculo y el movimiento no se pudo leer: sin-ver, no otra-pieza", () => {
    // Quien mira sin acceso a Inventario recibe null sin error.
    expect(aplicacionDelRenglon({ articulo_id: "a1", movimiento_id: "m1" }, null).estado)
      .toBe("sin-ver");
  });

  it("con movimiento del mismo articulo, aplicado", () => {
    expect(
      aplicacionDelRenglon({ articulo_id: "a1", movimiento_id: "m1" }, salida("m1", "2026-11-18"))
        .estado,
    ).toBe("aplicado");
  });

  it("si el articulo no coincide, no dice aplicado", () => {
    // Pasa si le sacan el articulo al renglon despues de declarar, o si el
    // kardex reuso una `sheets_fila`. Afirmar "aplicado" ahi es el
    // anti-objetivo del diseno. (Review Focus 2.)
    expect(aplicacionDelRenglon({ articulo_id: "a1", movimiento_id: "m1" },
      { ...salida("m1", "2026-11-18"), articulo_id: "a2" }).estado).toBe("otra-pieza");
  });

  it("un renglon sin articulo con movimiento puesto tampoco dice aplicado", () => {
    const r = aplicacionDelRenglon({ articulo_id: null, movimiento_id: "m1" }, salida("m1", "2026-11-18"));
    expect(r.estado).toBe("otra-pieza");
  });

  it("renglon sin articulo y movimiento sin articulo: null no es igual a null", () => {
    // Sin el guard, null === null diria "aplicado".
    const r = aplicacionDelRenglon(
      { articulo_id: null, movimiento_id: "m1" },
      salida("m1", "2026-11-18", { articulo_id: null }),
    );
    expect(r.estado).toBe("otra-pieza");
  });
});

describe("que ordenes declararon una salida", () => {
  it("una misma salida puede estar declarada por dos ordenes, y se nombran las dos", () => {
    // Una entrega de 10 puede cubrir dos ordenes, y nada lo impide: el vinculo
    // vive en el renglon, no en el movimiento. La ficha no puede mostrar una
    // sola.
    expect(ordenesQueDeclararon("m1", [
      { movimiento_id: "m1", ot_number: 2983 }, { movimiento_id: "m1", ot_number: 3001 },
      { movimiento_id: "m2", ot_number: 2999 },
    ])).toEqual([2983, 3001]);
  });

  it("una orden con dos renglones que apuntan a la misma salida se nombra una vez", () => {
    expect(ordenesQueDeclararon("m1", [
      { movimiento_id: "m1", ot_number: 2983 }, { movimiento_id: "m1", ot_number: 2983 },
    ])).toEqual([2983]);
  });

  it("sin renglones que la declaren, la lista es vacia", () => {
    expect(ordenesQueDeclararon("m1", [{ movimiento_id: "m2", ot_number: 2999 }])).toEqual([]);
  });
});

describe("como lee la ficha una salida", () => {
  const s = salida("m1", "2026-11-18");

  it("sin ningun renglon que la declare, no hay ni orden ni aviso", () => {
    expect(lecturaDeLaSalida(s, [{ articulo_id: "a1", movimiento_id: "m2", ot_number: 2999 }]))
      .toEqual({ aplicadoA: [], otraPieza: [] });
  });

  it("un renglon del mismo articulo la aplica a su orden", () => {
    expect(lecturaDeLaSalida(s, [{ articulo_id: "a1", movimiento_id: "m1", ot_number: 2983 }]))
      .toEqual({ aplicadoA: [2983], otraPieza: [] });
  });

  it("un renglon de otro articulo no dice aplicado: avisa, y nombra la orden", () => {
    expect(lecturaDeLaSalida(s, [{ articulo_id: "a2", movimiento_id: "m1", ot_number: 2983 }]))
      .toEqual({ aplicadoA: [], otraPieza: [2983] });
  });

  it("dos ordenes la declaran y una es de otra pieza: salen las dos lecturas", () => {
    expect(lecturaDeLaSalida(s, [
      { articulo_id: "a1", movimiento_id: "m1", ot_number: 3001 },
      { articulo_id: null, movimiento_id: "m1", ot_number: 2983 },
    ])).toEqual({ aplicadoA: [3001], otraPieza: [2983] });
  });
});
