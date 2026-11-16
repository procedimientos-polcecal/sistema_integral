import { describe, it, expect, beforeEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";
import { cuentaDeUnRepuesto, cantidadDelRenglon, leerNroRi } from "./cuentaDeUnRepuesto";
import { risDelRepuesto } from "./riDelRepuesto";

/**
 * Lo que `cuentaDeUnRepuesto` le da a `repartir`.
 *
 * `repartir` es aritmética pura y está probada sola (`loQueViene.test.ts`), pero
 * **reparte lo que le dan**. Las dos reglas que ella no puede proteger —que entren
 * sólo los RI pegados a mano, nunca los que adivina el cruce por nombre, y sólo
 * órdenes abiertas— se arman acá, y se prueban acá: la función recibe el cliente
 * como argumento y toma el Supabase de mentira directo, sin pasar por ninguna ruta.
 */

const base = supabaseDeMentira();
const cliente = base.admin as unknown as Parameters<typeof cuentaDeUnRepuesto>[0];

const ri = (nro_ri: number, extra: Fila = {}): Fila => ({
  nro_ri, cantidad: 10, cantidad_recibida: 0,
  estado_compra: "PEDIDO", estado_aprobacion: "APROBADA", descripcion: null, codigo: null, ...extra,
});
const orden = (n: number, extra: Fila = {}): Fila => ({
  id: `o${n}`, ot_number: 3000 + n, fecha: "2026-11-01", estado: "PENDIENTE", ...extra,
});
const renglon = (n: number, extra: Fila = {}): Fila => ({
  id: `r${n}`, work_order_id: `o${n}`, nombre: "Martillo", articulo_id: "A", cantidad: "10", ...extra,
});
const de = (n: number) => ({ id: `r${n}`, work_order_id: `o${n}`, articulo_id: "A" as string | null });

beforeEach(() => {
  base.reiniciar({
    ordenes_trabajo: [orden(1)],
    ordenes_trabajo_repuestos: [renglon(1)],
    compras_requerimientos: [ri(500)],
    mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null }],
  });
});

describe("la cuenta de un repuesto", () => {
  it("con más de 200 órdenes pidiendo lo mismo, pide de a lotes", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: Array.from({ length: 250 }, (_, i) => orden(i + 1)),
      ordenes_trabajo_repuestos: Array.from({ length: 250 }, (_, i) => renglon(i + 1)),
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(1));
    expect(cuenta.partes).toHaveLength(250);
  });

  it("una OT realizada no entra en el reparto", async () => {
    // La 1 es la más vieja pero está REALIZADA: si entrara se llevaría los 10 y la 2 quedaría sin nada.
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: [orden(1, { estado: "REALIZADO", fecha: "2026-10-01" }), orden(2)],
      ordenes_trabajo_repuestos: [renglon(1), renglon(2)],
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(2));
    expect(cuenta.partes.map((p) => p.orden_id)).toEqual(["o2"]);
    expect(cuenta.estaOrden).toMatchObject({ orden_id: "o2", cubiertas: 10 });
  });

  it("una OT suspendida tampoco: usa la misma definición de cerrada que el resto de Mantenimiento", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: [orden(1, { estado: "SUSPENDIDA", fecha: "2026-10-01" }), orden(2)],
      ordenes_trabajo_repuestos: [renglon(1), renglon(2)],
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(2));
    expect(cuenta.partes.map((p) => p.orden_id)).toEqual(["o2"]);
  });

  it("la orden realizada de este mismo renglón no tiene parte", async () => {
    base.reiniciar({ ...base.estado.tablas, ordenes_trabajo: [orden(1, { estado: "REALIZADO" })] });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(1));
    expect(cuenta.estaOrden).toBeNull();
  });

  it("un RI que sólo encontró el cruce por nombre no entra en la cuenta", async () => {
    // El 600 NO está pegado: lo único que lo une al repuesto es el nombre.
    const repuesto = { nombre: "Martillo 6206", codigo: null };
    const delCruce = ri(600, { cantidad: 100, descripcion: "Martillo de molino 6206" });
    // Premisa: el cruce por nombre de verdad lo encuentra. Si no, el test no puede fallar.
    expect(
      risDelRepuesto(repuesto, [delCruce as unknown as Parameters<typeof risDelRepuesto>[1][number]]).porNombre
    ).toHaveLength(1);

    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo_repuestos: [renglon(1, { nombre: repuesto.nombre })],
      compras_requerimientos: [ri(500, { cantidad: 4 }), delCruce],
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(1));
    expect(cuenta.ris.map((x) => x.nro_ri)).toEqual([500]);
    expect(cuenta.estaOrden).toMatchObject({ pide: 10, cubiertas: 4, faltaPedir: 6 });
  });

  it("el mismo RI en el artículo y en un renglón de ese artículo se cuenta una sola vez", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [
        { id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null },
        { id: "m2", nro_ri: 500, articulo_id: null, repuesto_id: "r1" },
      ],
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, de(1));
    expect(cuenta.ris).toHaveLength(1);
    expect(cuenta.estaOrden).toMatchObject({ pide: 10, cubiertas: 10 });
  });

  it("un renglón sin artículo cuenta sólo sus RI y sólo él", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: [orden(1), orden(2)],
      ordenes_trabajo_repuestos: [renglon(1, { articulo_id: null }), renglon(2, { articulo_id: null })],
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: null, repuesto_id: "r2" }],
    });
    const cuenta = await cuentaDeUnRepuesto(cliente, { ...de(1), articulo_id: null });
    expect(cuenta.partes.map((p) => p.orden_id)).toEqual(["o1"]);
    expect(cuenta.ris).toEqual([]);
    expect(cuenta.estaOrden?.cubiertas).toBe(0);
  });
});

describe("cantidadDelRenglon", () => {
  it("lee enteros, decimales con coma o punto, y espacios", () => {
    expect(cantidadDelRenglon("10")).toBe(10);
    expect(cantidadDelRenglon(" 2,5 ")).toBe(2.5);
    expect(cantidadDelRenglon("2.5")).toBe(2.5);
  });
  it("lo que no es un número positivo no es una cantidad", () => {
    for (const v of ["", null, undefined, "abc", "0", "-3", "10 unidades"]) {
      expect(cantidadDelRenglon(v as string | null | undefined)).toBeNull();
    }
  });
});

describe("leerNroRi", () => {
  it("acepta un entero positivo, como número o como texto de la URL", () => {
    expect(leerNroRi(500)).toEqual({ ok: true, nro_ri: 500 });
    expect(leerNroRi("500")).toEqual({ ok: true, nro_ri: 500 });
  });
  it("lo que falta es «falta», y no se convierte en 0", () => {
    for (const v of [undefined, null, "", "  "]) {
      expect(leerNroRi(v)).toEqual({ ok: false, error: "Falta el número de RI" });
    }
  });
  it("lo que está mal dice lo que es verdad, en castellano", () => {
    for (const v of [0, -1, 2.5, "abc", "2.5", NaN, true, "0x10", "1e3", "-5", "+5", "5 6", 2147483648, "99999999999"]) {
      const r = leerNroRi(v);
      expect(r).toEqual({ ok: false, error: "El número de RI tiene que ser un entero mayor que cero" });
    }
  });
});
