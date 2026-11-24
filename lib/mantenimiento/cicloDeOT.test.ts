import { describe, it, expect } from "vitest";
import {
  queSigueEnElCiclo, elCorteQueSigue, caraDeLaVuelta, descripcionDeLaOT,
  type CicloParaDecidir, type OTDelCiclo,
} from "./cicloDeOT";

const CICLO: CicloParaDecidir = {
  id: "c1", repeticiones: 3, periodo_dias: 3,
  desde: "2026-11-03", vuelta_desde: 0,
};

const ot = (p: Partial<OTDelCiclo>): OTDelCiclo => ({
  ot_number: 1, ciclo_vuelta: 1, estado: "POR_HACER",
  fecha_cierre: null, fecha_ejecucion: "2026-11-06",
  created_at_app: "2026-11-03T12:00:00Z", ...p,
});

describe("queSigueEnElCiclo", () => {
  it("sin arranque no hace nada", () => {
    expect(queSigueEnElCiclo({ ...CICLO, desde: null, vuelta_desde: null }, []))
      .toEqual({ que: "sin_arrancar" });
  });

  it("sin OT propias arranca en la vuelta siguiente a la cargada", () => {
    expect(queSigueEnElCiclo(CICLO, []))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  // Review Focus 3: el caso de Filler 2, que hoy está en 4ª cara.
  it("con la ultima vuelta hecha, lo que sigue es la madre", () => {
    expect(queSigueEnElCiclo({ ...CICLO, vuelta_desde: 3 }, []))
      .toEqual({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-11-06" });
  });

  it("una hija cerrada genera la siguiente desde su cierre", () => {
    const filas = [ot({ ot_number: 10, ciclo_vuelta: 1, estado: "REALIZADO", fecha_cierre: "2026-11-07" })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("la ultima hija cerrada genera la madre", () => {
    const filas = [ot({ ot_number: 10, ciclo_vuelta: 3, estado: "REALIZADO", fecha_cierre: "2026-11-07" })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-11-10" });
  });

  it("la madre cerrada no genera: el corte lo mueve quien la ve cerrada", () => {
    const filas = [ot({ ot_number: 11, ciclo_vuelta: 0, estado: "REALIZADO", fecha_cierre: "2026-11-05" })];
    expect(queSigueEnElCiclo(CICLO, filas)).toEqual({ que: "esperar", ot: 11 });
  });

  it("una OT abierta hace esperar", () => {
    expect(queSigueEnElCiclo(CICLO, [ot({ ot_number: 12 })]))
      .toEqual({ que: "esperar", ot: 12 });
  });

  it("una ATRASADA tambien hace esperar: sigue abierta", () => {
    expect(queSigueEnElCiclo(CICLO, [ot({ ot_number: 19, estado: "ATRASADO" })]))
      .toEqual({ que: "esperar", ot: 19 });
  });

  // El corte. Es lo que hace que el botón de reinicio no reviva la orden que
  // acaba de suspender.
  it("ignora las OT creadas antes de desde", () => {
    const filas = [ot({
      ot_number: 13, ciclo_vuelta: 2, estado: "REALIZADO",
      fecha_cierre: "2026-10-30", created_at_app: "2026-10-25T12:00:00Z",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  it("una creada el mismo dia que desde si cuenta", () => {
    const filas = [ot({
      ot_number: 20, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: "2026-11-07", created_at_app: "2026-11-03T23:30:00Z",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  // Review Focus 1
  it("sin periodo_dias queda trabado y lo dice", () => {
    const d = queSigueEnElCiclo({ ...CICLO, periodo_dias: null }, []);
    expect(d.que).toBe("trabado");
    expect(d.que === "trabado" && d.porque).toContain("cada cuántos días");
  });

  // Review Focus 2
  it("REALIZADO sin fecha de cierre usa la de ejecucion", () => {
    const filas = [ot({
      ot_number: 14, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: "2026-11-07",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("REALIZADO sin ninguna fecha queda trabado", () => {
    const filas = [ot({
      ot_number: 15, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: null,
    })];
    expect(queSigueEnElCiclo(CICLO, filas).que).toBe("trabado");
  });

  /**
   * Era `SUSPENDIDA`, que salió del vocabulario el 16/11/2026. Lo que hace
   * caro el cambio no es la palabra: sin esta rama, una cancelada caía en el
   * `esperar` de la función y el ciclo se quedaba esperando para siempre una
   * orden que nadie iba a hacer.
   */
  it("una CANCELADA detiene el ciclo", () => {
    const filas = [ot({ ot_number: 16, estado: "CANCELADA" })];
    const d = queSigueEnElCiclo(CICLO, filas);
    expect(d.que).toBe("trabado");
    expect(d.que === "trabado" && d.porque).toContain("cancelada");
  });

  /** Y no «esperar», que es dónde caía antes y es lo que congelaba el ciclo. */
  it("una CANCELADA no deja el ciclo esperándola", () => {
    const filas = [ot({ ot_number: 16, estado: "CANCELADA" })];
    expect(queSigueEnElCiclo(CICLO, filas).que).not.toBe("esperar");
  });

  // Review Focus 4
  it("con dos abiertas no crea una tercera", () => {
    const filas = [ot({ ot_number: 17, ciclo_vuelta: 1 }), ot({ ot_number: 18, ciclo_vuelta: 2 })];
    expect(queSigueEnElCiclo(CICLO, filas).que).toBe("esperar");
  });

  /**
   * ── LA VUELTA AL PRINCIPIO: 426 OT EN CUATRO DÍAS ──────────────────────────
   *
   * Lo que pasó en producción con PO-C1-04 (Hidratación) entre el 20 y el
   * 24/11/2026. El ciclo completó sus tres rotaciones —OT 3122, 3152 y 3162—,
   * la 3162 se cerró, y de ahí salió la madre 3166. Y después otras 425,
   * **una cada diez minutos**, hasta la 3594.
   *
   * La causa es el orden de `laUltimaEnRango`: ordenaba por `ciclo_vuelta`
   * ascendente y tomaba la última, lo cual es correcto mientras el ciclo avanza
   * 1 → 2 → 3 y deja de serlo justo cuando **vuelve a la madre**. La madre es
   * la vuelta 0, así que recién creada ordenaba **primera** y no última: la
   * «última» seguía siendo la hija 3, cerrada, y la corrida siguiente volvía a
   * decidir «crear la madre». Para siempre.
   *
   * La vuelta 0 no es el principio de la lista: es **el final del ciclo**.
   *
   * Ninguno de los tests de `elCorteQueSigue` lo podía ver porque todos pasan
   * **una sola OT**, y éste necesita la madre y una hija de vuelta mayor juntas
   * en el rango.
   */
  it("la madre recién creada es la última, aunque su vuelta sea 0", () => {
    const filas = [
      ot({ ot_number: 3122, ciclo_vuelta: 1, estado: "REALIZADO", fecha_cierre: "2026-11-18", created_at_app: "2026-11-18T12:00:00Z" }),
      ot({ ot_number: 3152, ciclo_vuelta: 2, estado: "REALIZADO", fecha_cierre: "2026-11-19", created_at_app: "2026-11-19T12:00:00Z" }),
      ot({ ot_number: 3162, ciclo_vuelta: 3, estado: "REALIZADO", fecha_cierre: "2026-11-20", created_at_app: "2026-11-20T12:00:00Z" }),
      ot({ ot_number: 3166, ciclo_vuelta: 0, estado: "POR_HACER", fecha_cierre: null, created_at_app: "2026-11-20T18:00:00Z" }),
    ];
    expect(queSigueEnElCiclo({ ...CICLO, desde: "2026-11-17" }, filas))
      .toEqual({ que: "esperar", ot: 3166 });
  });

  /** La misma foto, dicha como lo que importa: no nace una segunda madre. */
  it("con la madre ya creada no crea otra", () => {
    const filas = [
      ot({ ot_number: 3162, ciclo_vuelta: 3, estado: "REALIZADO", fecha_cierre: "2026-11-20", created_at_app: "2026-11-20T12:00:00Z" }),
      ot({ ot_number: 3166, ciclo_vuelta: 0, estado: "POR_HACER", fecha_cierre: null, created_at_app: "2026-11-20T18:00:00Z" }),
    ];
    expect(queSigueEnElCiclo({ ...CICLO, desde: "2026-11-17" }, filas).que).not.toBe("crear");
  });
});

/**
 * El corte lo mueven tres puntas: la madre al cerrarse, el botón y la carga
 * inicial. Ésta es la primera. Sin ella el ciclo se detiene para siempre
 * después del primer cambio: `queSigueEnElCiclo` devuelve `esperar` sobre una
 * madre cerrada, y nadie la saca nunca del rango.
 */
describe("elCorteQueSigue", () => {
  it("la madre cerrada mueve el corte a su fecha de cierre", () => {
    const filas = [ot({ ot_number: 30, ciclo_vuelta: 0, estado: "REALIZADO", fecha_cierre: "2026-11-20" })];
    expect(elCorteQueSigue(CICLO, filas)).toEqual({ desde: "2026-11-20", vuelta_desde: 0 });
  });

  it("una hija cerrada no mueve nada", () => {
    const filas = [ot({ ot_number: 31, ciclo_vuelta: 1, estado: "REALIZADO", fecha_cierre: "2026-11-07" })];
    expect(elCorteQueSigue(CICLO, filas)).toBeNull();
  });

  it("una madre abierta no mueve nada", () => {
    expect(elCorteQueSigue(CICLO, [ot({ ot_number: 32, ciclo_vuelta: 0 })])).toBeNull();
  });

  it("una madre cerrada sin fecha de cierre usa la de ejecucion", () => {
    const filas = [ot({
      ot_number: 33, ciclo_vuelta: 0, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: "2026-11-19",
    })];
    expect(elCorteQueSigue(CICLO, filas)).toEqual({ desde: "2026-11-19", vuelta_desde: 0 });
  });

  it("una madre cerrada sin ninguna fecha no mueve nada", () => {
    const filas = [ot({
      ot_number: 34, ciclo_vuelta: 0, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: null,
    })];
    expect(elCorteQueSigue(CICLO, filas)).toBeNull();
  });

  it("una madre de antes del corte no lo mueve de nuevo", () => {
    const filas = [ot({
      ot_number: 35, ciclo_vuelta: 0, estado: "REALIZADO",
      fecha_cierre: "2026-10-28", created_at_app: "2026-10-20T12:00:00Z",
    })];
    expect(elCorteQueSigue(CICLO, filas)).toBeNull();
  });

  it("un ciclo sin arrancar no mueve nada", () => {
    expect(elCorteQueSigue({ ...CICLO, desde: null, vuelta_desde: null }, [])).toBeNull();
  });

  /**
   * La otra mitad del mismo defecto, y la que lo volvía **permanente**.
   *
   * Todos los tests de arriba pasan una sola OT, así que la madre siempre era
   * «la última» por falta de competencia. Con las hijas de la vuelta en el
   * rango —que es la situación real— la madre nunca llegaba a serlo, y como
   * esta función exige `ciclo_vuelta === 0` para mover el corte, **el corte no
   * se movía nunca**: el ciclo quedaba atrapado creando madres sin poder
   * cerrar la vuelta. Las dos mitades se arreglan con el mismo orden.
   */
  /**
   * El caso vecino, que el defecto de arriba tapaba: cuando el corte se mueve
   * a la fecha de cierre de la madre, ¿la madre queda dentro del rango nuevo?
   *
   * Normalmente no —se creó antes de cerrarse—, pero si se cerró **el mismo
   * día** que nació, su `created_at_app` empata con el corte y vuelve a ser la
   * última. Y una madre cerrada devuelve `esperar`, así que el ciclo se
   * congelaría para siempre: el modo de falla silencioso que una OT que no
   * nace no puede denunciar.
   */
  it("la madre cerrada el mismo día que nació no queda trabando el rango nuevo", () => {
    const madre = ot({
      ot_number: 40, ciclo_vuelta: 0, estado: "REALIZADO",
      fecha_cierre: "2026-11-20", created_at_app: "2026-11-20T09:00:00Z",
    });
    const corte = elCorteQueSigue({ ...CICLO, desde: "2026-11-17" }, [madre]);
    expect(corte).toEqual({ desde: "2026-11-20", vuelta_desde: 0 });
    // Con el corte ya movido, lo que sigue es la hija 1 y no una espera eterna.
    expect(queSigueEnElCiclo({ ...CICLO, ...corte! }, [madre]))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-23" });
  });

  it("la madre cerrada mueve el corte aunque haya hijas de la misma vuelta", () => {
    const filas = [
      ot({ ot_number: 3122, ciclo_vuelta: 1, estado: "REALIZADO", fecha_cierre: "2026-11-18", created_at_app: "2026-11-18T12:00:00Z" }),
      ot({ ot_number: 3162, ciclo_vuelta: 3, estado: "REALIZADO", fecha_cierre: "2026-11-20", created_at_app: "2026-11-20T12:00:00Z" }),
      ot({ ot_number: 3166, ciclo_vuelta: 0, estado: "REALIZADO", fecha_cierre: "2026-11-26", created_at_app: "2026-11-20T18:00:00Z" }),
    ];
    expect(elCorteQueSigue({ ...CICLO, desde: "2026-11-17" }, filas))
      .toEqual({ desde: "2026-11-26", vuelta_desde: 0 });
  });
});

describe("caraDeLaVuelta", () => {
  it("la vuelta n lleva a la cara n+1", () => {
    expect([1, 2, 3].map(caraDeLaVuelta)).toEqual(["2ª", "3ª", "4ª"]);
  });
});

describe("descripcionDeLaOT", () => {
  it("la hija dice la cara, la vuelta y cuando se cambiaron", () => {
    expect(descripcionDeLaOT({
      tarea: "Rotación de Martillos", componente: "Martillos",
      vuelta: 2, repeticiones: 3, ultimoCambio: "2026-10-23",
    })).toBe("Rotación de Martillos — a 3ª cara (2 de 3). Martillos cambiados el 23/10/2026.");
  });

  it("sin fecha de cambio no inventa la frase", () => {
    expect(descripcionDeLaOT({
      tarea: "Rotación de Martillos", componente: "Martillos",
      vuelta: 1, repeticiones: 3, ultimoCambio: null,
    })).toBe("Rotación de Martillos — a 2ª cara (1 de 3).");
  });

  it("la madre dice que las vueltas estan hechas", () => {
    expect(descripcionDeLaOT({
      tarea: "Cambio de Martillos", componente: "Martillos",
      vuelta: 0, repeticiones: 3, ultimoCambio: "2026-10-17",
    })).toBe("Cambio de Martillos — las 3 rotaciones están hechas. Martillos cambiados el 17/10/2026.");
  });
});
