import { describe, it, expect } from "vitest";
import {
  estaEnVuelo, mismoRepuesto, risDelRepuesto, hayAlgunRi, COMPRA_TERMINADA,
  type RiPosible,
} from "./riDelRepuesto";

/** Un RI en curso, al que cada test le cambia lo que le importa. */
const ri = (p: Partial<RiPosible> = {}): RiPosible => ({
  nro_ri: 2051,
  descripcion: "RODAMIENTO 6206 SKF",
  codigo: "00473",
  estado_aprobacion: "APROBADA",
  estado_compra: "PEDIDO",
  ...p,
});

describe("cuales siguen en curso", () => {
  /**
   * EL NUMERO QUE DECIDE ESTO, medido el 26/10/2026 sobre 2.198 RI: 1.646 estan
   * RECIBIDO, o sea el 75%. Contarlos haria que el aviso salga casi siempre y
   * nadie lo mire — los guantes 00473 se pidieron 22 veces en un año y todas
   * llegaron. Lo que importa es el que todavia esta en vuelo: ese mismo codigo
   * tenia dos SIN_INICIAR y dos PEDIDO conviviendo.
   */
  it("un recibido ya no es un pedido pendiente", () => {
    expect(estaEnVuelo(ri({ estado_compra: "RECIBIDO" }))).toBe(false);
  });

  /** Denegado por quien aprueba y denegado por Compras son dos columnas. */
  it("lo denegado no va a traer nada, de los dos lados", () => {
    expect(estaEnVuelo(ri({ estado_aprobacion: "DENEGADA" }))).toBe(false);
    expect(estaEnVuelo(ri({ estado_compra: "DENEGADO" }))).toBe(false);
  });

  it("los seis estados en curso cuentan", () => {
    for (const e of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO", "EN_ESPERA"]) {
      expect(estaEnVuelo(ri({ estado_compra: e }))).toBe(true);
    }
  });

  /** Un estado que nadie previo cuenta como en curso: mejor avisar de mas. */
  it("un estado desconocido no se descarta", () => {
    expect(estaEnVuelo(ri({ estado_compra: "LO_QUE_SEA" }))).toBe(true);
    expect(estaEnVuelo(ri({ estado_compra: null }))).toBe(true);
  });

  it("los terminados son dos y estan nombrados", () => {
    expect([...COMPRA_TERMINADA].sort()).toEqual(["DENEGADO", "RECIBIDO"]);
  });
});

describe("si dos descripciones son el mismo repuesto", () => {
  it("el mismo con una marca de mas es el mismo", () => {
    expect(mismoRepuesto("Rodamiento 6206", "RODAMIENTO 6206 SKF")).toBe(true);
  });

  it("ignora acentos y mayusculas, y acepta otro orden", () => {
    expect(mismoRepuesto("válvula esférica", "VALVULA ESFERICA 2 PULGADAS")).toBe(true);
    expect(mismoRepuesto("6206 rodamiento", "Rodamiento 6206")).toBe(true);
  });

  /** Un numero de pieza distinto es otra pieza, por parecido que se lea. */
  it("dos medidas distintas no son el mismo", () => {
    expect(mismoRepuesto("Correa B-75", "Correa B-65")).toBe(false);
    expect(mismoRepuesto("Rodamiento 6206", "Rodamiento 6207")).toBe(false);
  });

  /**
   * EL FRENO QUE NO ES OBVIO. «Eje» esta adentro de media planta, asi que una
   * sola palabra generica no alcanza para decir que es el mismo repuesto. Un
   * numero de pieza si: «6206» distingue.
   */
  it("con una sola palabra no alcanza, salvo que sea un numero de pieza", () => {
    expect(mismoRepuesto("Eje", "Eje de transmision del molino")).toBe(false);
    expect(mismoRepuesto("Rodamiento", "Rodamiento 6206")).toBe(false);
    expect(mismoRepuesto("6206", "Rodamiento 6206")).toBe(true);
    expect(mismoRepuesto("B-75", "Correa B-75 reforzada")).toBe(true);
  });

  /** Las palabras de dos letras no cuentan: "de", "x", "mm" no distinguen. */
  it("las palabras cortas no deciden", () => {
    expect(mismoRepuesto("Guantes de vaqueta", "00473 GUANTES DE VAQUETA")).toBe(true);
  });

  it("sin texto de un lado no hay coincidencia", () => {
    expect(mismoRepuesto("", "Rodamiento 6206")).toBe(false);
    expect(mismoRepuesto(null, null)).toBe(false);
    expect(mismoRepuesto("Rodamiento 6206", "   ")).toBe(false);
  });
});

describe("los RI que podrian ser este repuesto", () => {
  it("el del mismo codigo es el mismo articulo", () => {
    const r = risDelRepuesto(
      { nombre: "Guantes", codigo: "00473" },
      [ri({ nro_ri: 2051, codigo: "00473", descripcion: "GUANTES DE VAQUETA" })]
    );
    expect(r.porCodigo.map((x) => x.nro_ri)).toEqual([2051]);
    expect(r.porNombre).toEqual([]);
  });

  /**
   * Y NO SE REPITE EN LOS DEL NOMBRE. Es el mismo pedido: listarlo dos veces
   * haria pensar que hay dos en curso, que es justo lo que esto viene a contar
   * bien.
   */
  it("el que coincide por codigo no se cuenta tambien por nombre", () => {
    const r = risDelRepuesto(
      { nombre: "Rodamiento 6206", codigo: "00473" },
      [ri({ nro_ri: 2051, codigo: "00473", descripcion: "RODAMIENTO 6206 SKF" })]
    );
    expect(r.porCodigo).toHaveLength(1);
    expect(r.porNombre).toHaveLength(0);
  });

  /** Sin codigo en el repuesto, queda lo que diga el nombre. */
  it("sin codigo busca por nombre y lo dice aparte", () => {
    const r = risDelRepuesto(
      { nombre: "Rodamiento 6206", codigo: null },
      [ri({ nro_ri: 2051, codigo: "00999", descripcion: "RODAMIENTO 6206 SKF" })]
    );
    expect(r.porCodigo).toEqual([]);
    expect(r.porNombre.map((x) => x.nro_ri)).toEqual([2051]);
  });

  /** Los recibidos no entran por ningun lado, ni por codigo. */
  it("un recibido del mismo codigo no se muestra", () => {
    const r = risDelRepuesto(
      { nombre: "Guantes de vaqueta", codigo: "00473" },
      [ri({ codigo: "00473", estado_compra: "RECIBIDO" })]
    );
    expect(hayAlgunRi(r)).toBe(false);
  });

  /** El caso real del 26/10: cuatro en vuelo del mismo codigo. */
  it("junta todos los que estan en vuelo", () => {
    const r = risDelRepuesto({ nombre: "Guantes", codigo: "00473" }, [
      ri({ nro_ri: 1790, estado_compra: "SIN_INICIAR" }),
      ri({ nro_ri: 2046, estado_compra: "SIN_INICIAR" }),
      ri({ nro_ri: 2051, estado_compra: "PEDIDO" }),
      ri({ nro_ri: 1693, estado_compra: "PEDIDO" }),
      ri({ nro_ri: 741, estado_compra: "RECIBIDO" }),
    ]);
    expect(r.porCodigo.map((x) => x.nro_ri)).toEqual([1790, 2046, 2051, 1693]);
  });

  it("sin nada parecido no hay nada que mostrar", () => {
    const r = risDelRepuesto(
      { nombre: "Correa B-75", codigo: "00111" },
      [ri({ codigo: "00999", descripcion: "RODAMIENTO 6206" })]
    );
    expect(hayAlgunRi(r)).toBe(false);
  });

  it("sin requerimientos no se rompe", () => {
    expect(hayAlgunRi(risDelRepuesto({ nombre: "Correa", codigo: null }, []))).toBe(false);
  });
});
