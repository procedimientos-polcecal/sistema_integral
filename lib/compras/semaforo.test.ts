import { describe, it, expect } from "vitest";
import {
  esReclamable, colorDelPedido, diasEsperando, rangoDeColor, textoDeEspera,
  ESPERAN_A_COMPRAS,
} from "./semaforo";

describe("esReclamable", () => {
  it("acepta los cuatro estados que esperan a Compras", () => {
    for (const e of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"]) {
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(true);
    }
  });

  it("deja afuera lo ya pedido, lo recibido y lo denegado", () => {
    for (const e of ["PEDIDO", "RECIBIDO", "DENEGADO"]) {
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(false);
    }
  });

  /*
   * Medido el 12/11/2026: 9 de los 10 pedidos más viejos que esperaban a
   * Compras estaban EN_ESPERA. Sin esta línea, lo primero que ve el área
   * arriba de todo son pedidos que alguien congeló a propósito, y el primer
   * reclamo que sale se contesta con «ése está en espera».
   */
  it("deja afuera EN_ESPERA, que es un desvío y no una etapa", () => {
    expect(esReclamable({ estado_compra: "EN_ESPERA", estado_aprobacion: "APROBADA" })).toBe(false);
  });

  /*
   * La pantalla usa `ESPERAN_A_COMPRAS` para su `.in()` de PostgREST. Esto ata
   * las dos puntas: si alguien agrega un estado a la lista sin que
   * `esReclamable` lo acepte —o al revés— el punto del renglón y los chips
   * empiezan a decir cosas distintas y nada más lo nota.
   */
  it("acepta exactamente lo que dice la lista que usa la pantalla", () => {
    for (const e of ESPERAN_A_COMPRAS) {
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(true);
    }
    for (const e of ["PEDIDO", "RECIBIDO", "DENEGADO", "EN_ESPERA"]) {
      expect(ESPERAN_A_COMPRAS).not.toContain(e);
    }
  });

  it("deja afuera lo denegado por gerencia aunque la compra no se haya tocado", () => {
    expect(esReclamable({ estado_compra: "SIN_INICIAR", estado_aprobacion: "DENEGADA" })).toBe(false);
  });
});

describe("colorDelPedido", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");

  it("verde hasta 30 días", () => {
    expect(colorDelPedido("2026-11-12", hoy)).toBe("verde");
    expect(colorDelPedido("2026-10-13", hoy)).toBe("verde");
  });

  it("amarillo de 31 a 90", () => {
    expect(colorDelPedido("2026-10-12", hoy)).toBe("amarillo");
    expect(colorDelPedido("2026-08-14", hoy)).toBe("amarillo");
  });

  it("rojo a partir de 91", () => {
    expect(colorDelPedido("2026-08-13", hoy)).toBe("rojo");
  });

  // Medido: el pedido más nuevo del día tenía -1 día. Una fecha adelantada no
  // puede abrir un cuarto estado ni reventar la cuenta.
  it("una fecha futura es verde y no un cuarto estado", () => {
    expect(colorDelPedido("2026-11-20", hoy)).toBe("verde");
    expect(diasEsperando("2026-11-20", hoy)).toBeLessThan(0);
  });
});

describe("rangoDeColor", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");

  it("el rojo es todo lo anterior al corte de 90", () => {
    expect(rangoDeColor("rojo", hoy)).toEqual({ hastaExclusivo: "2026-08-14" });
  });

  it("el amarillo tiene las dos puntas", () => {
    expect(rangoDeColor("amarillo", hoy)).toEqual({
      desde: "2026-08-14", hastaExclusivo: "2026-10-13",
    });
  });

  it("el verde no tiene tope: una fecha futura entra", () => {
    expect(rangoDeColor("verde", hoy)).toEqual({ desde: "2026-10-13" });
  });

  /*
   * `fecha` es un `timestamptz`, no un `date`: los RI cargados en la app
   * llevan la hora real (medido: `2026-11-12T13:06:59Z`) y los que vienen de
   * la planilla quedan a medianoche.
   *
   * Un borde superior inclusivo los deja afuera de todo. Con `hasta` en
   * `2026-10-12` y un `.lte`, PostgREST compara contra las 00:00 de ese día,
   * así que un pedido de ese mismo día a las 13:00 no entra en amarillo — y
   * tampoco en rojo ni en verde. El punto del renglón lo pinta amarillo y los
   * tres chips lo cuentan en ninguno.
   *
   * Por eso el borde de arriba es **exclusivo y un día después**: así cae del
   * lado correcto venga con hora o sin ella.
   */
  it("el borde de arriba deja adentro un pedido con hora de ese mismo día", () => {
    const { desde, hastaExclusivo } = rangoDeColor("amarillo", hoy);
    const conHora = "2026-10-12T13:06:59.000Z";
    expect(colorDelPedido(conHora, hoy)).toBe("amarillo");
    expect(desde! <= conHora).toBe(true);
    expect(conHora < hastaExclusivo!).toBe(true);
  });

  it("y deja afuera el primer día del color de al lado, también con hora", () => {
    const { hastaExclusivo } = rangoDeColor("amarillo", hoy);
    const verdeConHora = "2026-10-13T13:06:59.000Z";
    expect(colorDelPedido(verdeConHora, hoy)).toBe("verde");
    expect(verdeConHora < hastaExclusivo!).toBe(false);
  });

  /*
   * Los bordes de `rangoDeColor` y los de `colorDelPedido` tienen que ser el
   * mismo día. Si se separan, la franja cuenta un pedido en un color y el
   * punto del renglón lo pinta de otro — y nadie vuelve a confiar en ninguno
   * de los dos.
   */
  it("los bordes coinciden con los de colorDelPedido", () => {
    for (const color of ["verde", "amarillo", "rojo"] as const) {
      const r = rangoDeColor(color, hoy);
      // El de abajo es del color; el de arriba es exclusivo, así que ya NO lo es.
      if (r.desde) expect(colorDelPedido(r.desde, hoy)).toBe(color);
      if (r.hastaExclusivo) expect(colorDelPedido(r.hastaExclusivo, hoy)).not.toBe(color);
    }
  });
});

describe("textoDeEspera", () => {
  it("dice los días", () => expect(textoDeEspera(53)).toBe("53 días"));
  it("en singular con uno", () => expect(textoDeEspera(1)).toBe("1 día"));
  it("hoy no son cero días", () => expect(textoDeEspera(0)).toBe("hoy"));
  // Hay pedidos con la fecha adelantada: «-3 días» en pantalla se lee como un error.
  it("una fecha futura tampoco cuenta días", () => expect(textoDeEspera(-3)).toBe("hoy"));
});
