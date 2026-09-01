import { describe, it, expect } from "vitest";
import {
  fechaEnArgentina, hoyEnArgentina, diaEnArgentina,
  sumarDias, diaDeLaSemana, semanaDe, comoSeLee, fechaDeTexto,
} from "./fechas";

/**
 * La franja de las nueve de la noche.
 *
 * Es donde estaba el bug y donde se usa la pantalla del remis: a las 21:00 de
 * Argentina ya son las 00:00 UTC del día siguiente, asi que
 * `toISOString().slice(0,10)` devolvia mañana.
 */
const ART = (iso: string) => new Date(`${iso}-03:00`);

describe("fechaEnArgentina", () => {
  it("de dia da el dia", () => {
    expect(fechaEnArgentina(ART("2026-09-01T10:00:00"))).toBe("2026-09-01");
  });

  it("a las nueve de la noche sigue siendo hoy, no mañana", () => {
    expect(fechaEnArgentina(ART("2026-09-01T21:00:00"))).toBe("2026-09-01");
    expect(fechaEnArgentina(ART("2026-09-01T23:59:59"))).toBe("2026-09-01");
  });

  it("pasada la medianoche ya es el dia siguiente", () => {
    expect(fechaEnArgentina(ART("2026-09-02T00:00:00"))).toBe("2026-09-02");
    expect(fechaEnArgentina(ART("2026-09-02T00:00:01"))).toBe("2026-09-02");
  });

  /** El caso que se veia mal en produccion, dicho con el instante UTC crudo. */
  it("el mismo instante que UTC llama 2026-09-02 en Argentina es el 1", () => {
    const instante = new Date("2026-09-02T00:30:00Z");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-02"); // lo que hacia antes
    expect(fechaEnArgentina(instante)).toBe("2026-09-01");          // lo que corresponde
  });

  it("cruza el fin de mes y el fin de año sin perderse", () => {
    expect(fechaEnArgentina(ART("2026-08-31T22:00:00"))).toBe("2026-08-31");
    expect(fechaEnArgentina(ART("2026-12-31T23:30:00"))).toBe("2026-12-31");
  });

  it("hoyEnArgentina sin argumento no revienta y da una fecha", () => {
    expect(hoyEnArgentina()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("diaEnArgentina", () => {
  it("mañana y ayer se cuentan sobre la fecha, no sobre el instante", () => {
    expect(diaEnArgentina(1, ART("2026-09-01T21:30:00"))).toBe("2026-09-02");
    expect(diaEnArgentina(-1, ART("2026-09-01T21:30:00"))).toBe("2026-08-31");
    expect(diaEnArgentina(0, ART("2026-09-01T21:30:00"))).toBe("2026-09-01");
  });

  /**
   * El cron de notificaciones corre a las 22:00 UTC —19:00 de Argentina— y
   * avisa el remis "de mañana". Antes daba el dia correcto por casualidad,
   * porque a esa hora todavia no habia cruzado la medianoche UTC. Si alguien
   * movia el cron dos horas, empezaba a notificar el dia equivocado.
   */
  it("el cron de las 22:00 UTC pide mañana y le dan mañana", () => {
    expect(diaEnArgentina(1, new Date("2026-09-01T22:00:00Z"))).toBe("2026-09-02");
  });

  it("y a una hora a la que antes fallaba, tambien", () => {
    // 01:00 UTC del 2 = 22:00 ART del 1. Mañana es el 2, no el 3.
    expect(diaEnArgentina(1, new Date("2026-09-02T01:00:00Z"))).toBe("2026-09-02");
  });
});

describe("sumarDias", () => {
  it("suma y resta sin tocar husos", () => {
    expect(sumarDias("2026-09-01", 1)).toBe("2026-09-02");
    expect(sumarDias("2026-09-01", -1)).toBe("2026-08-31");
    expect(sumarDias("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("cruza meses, años y un 29 de febrero bisiesto", () => {
    expect(sumarDias("2026-08-31", 1)).toBe("2026-09-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("diaDeLaSemana", () => {
  it("0 es domingo", () => {
    expect(diaDeLaSemana("2026-08-30")).toBe(0); // domingo
    expect(diaDeLaSemana("2026-08-31")).toBe(1); // lunes
    expect(diaDeLaSemana("2026-09-05")).toBe(6); // sabado
  });
});

describe("semanaDe", () => {
  it("arranca el lunes", () => {
    const s = semanaDe("2026-09-02"); // miercoles
    expect(s).toHaveLength(7);
    expect(s[0]).toBe("2026-08-31");  // lunes
    expect(s[6]).toBe("2026-09-06");  // domingo
    expect(s).toContain("2026-09-02");
  });

  /** Domingo cierra la semana: no la abre. */
  it("un domingo pertenece a la semana que termina, no a la que empieza", () => {
    expect(semanaDe("2026-09-06")[0]).toBe("2026-08-31");
  });

  it("el corrimiento mueve semanas enteras", () => {
    expect(semanaDe("2026-09-02", -1)[0]).toBe("2026-08-24");
    expect(semanaDe("2026-09-02", 1)[0]).toBe("2026-09-07");
  });
});

describe("comoSeLee", () => {
  it("da vuelta la fecha para mostrarla", () => {
    expect(comoSeLee("2026-08-24")).toBe("24/08/2026");
  });
});

/**
 * Habia dos implementaciones de esto. La de `compras/sheets.ts` validaba los
 * rangos y tenia tests; la de `compras/comparativa.ts` no validaba nada, asi
 * que "05/13/2026" salia como "2026-13-05" y hacia fallar el INSERT de la
 * comparativa entera por una celda.
 */
describe("fechaDeTexto", () => {
  it("lee d/m/aaaa, que es como lo escriben las planillas", () => {
    expect(fechaDeTexto("12/08/2026")).toBe("2026-08-12");
    expect(fechaDeTexto("01/09/2026")).toBe("2026-09-01");
    expect(fechaDeTexto("31/12/2025")).toBe("2025-12-31");
  });

  it("acepta un solo digito, el año de dos y el guion como separador", () => {
    expect(fechaDeTexto("5/3/26")).toBe("2026-03-05");
    expect(fechaDeTexto("5-3-2026")).toBe("2026-03-05");
  });

  /** El año de cuatro digitos va primero en la alternancia de la regex. */
  it("un año de cuatro digitos no se lee como uno de dos", () => {
    expect(fechaDeTexto("12/08/2026")).not.toBe("2020-08-12");
  });

  it("tolera que la celda traiga tambien la hora", () => {
    expect(fechaDeTexto("12/08/2026 14:30:05")).toBe("2026-08-12");
  });

  it("acepta la forma ISO sin confundirla con d/m", () => {
    expect(fechaDeTexto("2026-08-12")).toBe("2026-08-12");
    expect(fechaDeTexto("2026-08-12T00:00:00+00:00")).toBe("2026-08-12");
  });

  /** Este es el que hacia fallar el insert. */
  it("un mes fuera de rango es null, no '2026-13-05'", () => {
    expect(fechaDeTexto("05/13/2026")).toBeNull();
    expect(fechaDeTexto("2026-13-05")).toBeNull();
  });

  it("un dia fuera de rango tampoco pasa", () => {
    expect(fechaDeTexto("32/08/2026")).toBeNull();
    expect(fechaDeTexto("00/08/2026")).toBeNull();
    expect(fechaDeTexto("2026-08-45")).toBeNull();
  });

  /**
   * `new Date` haria rodar el 31 de febrero al 3 de marzo. Eso esconde el
   * problema: la comprobacion es de ida y vuelta.
   */
  it("un dia que no existe en ese mes se descarta, no rueda al siguiente", () => {
    expect(fechaDeTexto("31/02/2026")).toBeNull();
    expect(fechaDeTexto("29/02/2026")).toBeNull();   // 2026 no es bisiesto
    expect(fechaDeTexto("29/02/2028")).toBe("2028-02-29"); // 2028 si
    expect(fechaDeTexto("31/04/2026")).toBeNull();
  });

  it("lo que no es una fecha no inventa una", () => {
    expect(fechaDeTexto("")).toBeNull();
    expect(fechaDeTexto(null)).toBeNull();
    expect(fechaDeTexto(undefined)).toBeNull();
    expect(fechaDeTexto("s/d")).toBeNull();
    expect(fechaDeTexto("12/2026")).toBeNull();
  });
});
