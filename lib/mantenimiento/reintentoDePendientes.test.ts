import { describe, it, expect } from "vitest";
import {
  ESPERAS_DEL_REINTENTO, reintentarHastaQueSalga, cualesReintentar,
  hacePocoQueSeDreno, MINIMO_ENTRE_DRENAJES_MS, MINIMO_ENTRE_INTENTOS_MS,
  avisoDelPendiente,
  type PendienteDeOT,
} from "./reintentoDePendientes";

/**
 * EL AGUJERO QUE ESTO CIERRA, MEDIDO EL 21/10/2026.
 *
 * Una OT creada en la app escribe sola las columnas que viven en la hoja de
 * respuestas, pero las que **sólo existen en el master** —K cierre, M estado,
 * N contratista, O horas, P/Q/R operarios— necesitan que la fila del master ya
 * exista, y esa fila llega por `IMPORTRANGE` y tarda. El alta lo intenta **una
 * sola vez, 0,6 segundos después de crear la orden**, cuando todavía no puede
 * estar; de ahí en más quedaba todo en manos de la sincronización completa.
 *
 * Las cinco órdenes que tenían algo que exportar:
 *
 *     OT 2796  creada 16/10 13:53 → escrita 18/10 19:26   53 horas
 *     OT 2826  creada 19/10 13:36 → escrita 19/10 16:35    3 horas
 *     OT 2827  creada 19/10 13:39 → escrita 19/10 16:35    3 horas
 *     OT 2845  creada 21/10 11:44 → todavía sin horas en la planilla
 *     OT 2868  creada 21/10 13:38 → todavía sin operario en la planilla
 *
 * **Cero de cinco salieron en el momento.** Y el reintento tampoco llegaba: el
 * workflow declara un intervalo de quince minutos y las corridas reales son
 * cada 3 a 5 horas —medido sobre los doce workflows del repo, que disparan
 * todos a la misma hora—, así que el intervalo declarado es ficción.
 */

/** Un `intentar` que falla las primeras `n` veces y después sale. */
function fallaLasPrimeras(n: number) {
  let llamadas = 0;
  return {
    get llamadas() { return llamadas; },
    intentar: async () => {
      llamadas++;
      return llamadas <= n
        ? `La OT 2845 todavía no está en la planilla —el master la recibe por IMPORTRANGE y tarda—.`
        : null;
    },
  };
}

/** Un `dormir` que no duerme y anota cuánto le pidieron. */
function relojFalso() {
  const esperas: number[] = [];
  return { esperas, dormir: async (ms: number) => { esperas.push(ms); } };
}

describe("hasta cuándo se insiste", () => {
  /**
   * Cuatro intentos, a los 20 s, 1, 2 y 4 minutos del alta. El total es 4
   * minutos y pico, que entra en los 300 s de `maxDuration` de una función de
   * Vercel con lugar de sobra — si se pasara, la función se corta a la mitad de
   * un intento y el reintento no serviría de nada.
   */
  it("son cuatro esperas y suman menos de los 300 s de la función", () => {
    expect(ESPERAS_DEL_REINTENTO).toHaveLength(4);
    const total = ESPERAS_DEL_REINTENTO.reduce((a, b) => a + b, 0);
    expect(total).toBe(240_000);
    expect(total).toBeLessThan(300_000);
  });

  /** Cada una espera más que la anterior: la fila no aparece antes por insistir. */
  it("cada espera es más larga que la anterior", () => {
    for (let i = 1; i < ESPERAS_DEL_REINTENTO.length; i++) {
      expect(ESPERAS_DEL_REINTENTO[i]).toBeGreaterThan(ESPERAS_DEL_REINTENTO[i - 1]);
    }
  });

  /** Y los momentos en que cae cada intento, que es lo que se promete arriba. */
  it("los intentos caen a los 20 s, 1, 2 y 4 minutos", () => {
    const momentos: number[] = [];
    let acumulado = 0;
    for (const e of ESPERAS_DEL_REINTENTO) { acumulado += e; momentos.push(acumulado / 1000); }
    expect(momentos).toEqual([20, 60, 120, 240]);
  });
});

describe("reintentarHastaQueSalga", () => {
  /** EL CASO QUE ARREGLA: la fila aparece al rato y la escritura sale sola. */
  it("insiste hasta que la fila aparece y entonces para", async () => {
    const quien = fallaLasPrimeras(2);
    const reloj = relojFalso();

    const r = await reintentarHastaQueSalga({ intentar: quien.intentar, dormir: reloj.dormir });

    expect(r.salio).toBe(true);
    expect(r.intentos).toBe(3);
    expect(r.error).toBeNull();
    // Durmió sólo lo que necesitó: no se queda esperando después de salir.
    expect(reloj.esperas).toEqual([20_000, 40_000, 60_000]);
  });

  it("si sale en el primer reintento no hace los otros tres", async () => {
    const quien = fallaLasPrimeras(0);
    const reloj = relojFalso();

    const r = await reintentarHastaQueSalga({ intentar: quien.intentar, dormir: reloj.dormir });

    expect(r).toEqual({ salio: true, intentos: 1, error: null });
    expect(reloj.esperas).toEqual([20_000]);
  });

  /**
   * Y EL CASO QUE NO ARREGLA, QUE TIENE QUE SEGUIR DICIÉNDOSE. Si después de
   * cuatro minutos la fila sigue sin aparecer, se devuelve el último error para
   * que la orden quede anotada en `sheets_pendiente` como hasta ahora. El
   * reintento es una mejora sobre la cola, **no su reemplazo**: sin la cola, una
   * planilla que tarda más de cuatro minutos dejaría la fila incompleta para
   * siempre y sin que nada lo dijera.
   */
  it("se rinde después de los cuatro intentos y devuelve el último error", async () => {
    const quien = fallaLasPrimeras(99);
    const reloj = relojFalso();

    const r = await reintentarHastaQueSalga({ intentar: quien.intentar, dormir: reloj.dormir });

    expect(r.salio).toBe(false);
    expect(r.intentos).toBe(4);
    expect(r.error).toContain("todavía no está en la planilla");
    expect(reloj.esperas).toEqual([...ESPERAS_DEL_REINTENTO]);
  });

  /**
   * Una excepción no es "no salió": es un error que hay que contar igual. Si se
   * escapara, `after()` la perdería en silencio —nadie espera esa promesa— y la
   * orden quedaría con el `sheets_pendiente` del primer intento, que dice algo
   * distinto de lo que pasó.
   */
  it("una excepción se convierte en el error, no se escapa", async () => {
    const reloj = relojFalso();
    const r = await reintentarHastaQueSalga({
      intentar: async () => { throw new Error("Google devolvió 503"); },
      dormir: reloj.dormir,
    });
    expect(r.salio).toBe(false);
    expect(r.error).toBe("Google devolvió 503");
    expect(r.intentos).toBe(4);
  });
});

describe("cuáles de la cola se reintentan", () => {
  const ahora = new Date("2026-10-21T14:00:00Z").getTime();
  const hace = (minutos: number) =>
    new Date(ahora - minutos * 60_000).toISOString();

  const cola: PendienteDeOT[] = [
    { ot_number: 2845, sheets_intentado_en: hace(140) },
    { ot_number: 2868, sheets_intentado_en: hace(22) },
    { ot_number: 2869, sheets_intentado_en: hace(1) },
    { ot_number: 2870, sheets_intentado_en: null },
  ];

  /**
   * POR QUÉ HAY UN FRENO. El drenaje se dispara cuando alguien abre Órdenes, y
   * esa pantalla se abre todo el día. Una orden que no se va a poder escribir
   * nunca —su fila desapareció de la planilla, por ejemplo— haría una lectura de
   * la columna A del master **por cada visita**, para nada. Diez minutos entre
   * intentos deja el reintento rápido donde sirve y acota el costo donde no.
   */
  it("no reintenta una que se intentó recién", () => {
    expect(cualesReintentar(cola, ahora).map((p) => p.ot_number))
      .toEqual([2845, 2868, 2870]);
  });

  /** Una que nunca se intentó entra siempre: no hay de qué esperar. */
  it("la que no tiene intento previo entra", () => {
    expect(cualesReintentar([{ ot_number: 2870, sheets_intentado_en: null }], ahora))
      .toHaveLength(1);
  });

  /** Con la cola vacía no hay nada que hacer, y eso evita hasta la lectura. */
  it("una cola vacía no devuelve nada", () => {
    expect(cualesReintentar([], ahora)).toEqual([]);
  });

  /**
   * Las dos órdenes que estaban trabadas el 21/10 entran las dos: la 2845
   * llevaba 2 h 16 min esperando y la 2868, 22 minutos. Son el caso real que
   * este drenaje viene a destrabar.
   */
  it("las dos que estaban trabadas el 21/10 entran", () => {
    const quienes = cualesReintentar(cola, ahora).map((p) => p.ot_number);
    expect(quienes).toContain(2845);
    expect(quienes).toContain(2868);
  });

  /** Una fecha que no es fecha no traba la cola: se reintenta. */
  it("un intentado_en ilegible no deja la orden afuera para siempre", () => {
    expect(cualesReintentar([{ ot_number: 1, sheets_intentado_en: "cualquier cosa" }], ahora))
      .toHaveLength(1);
  });
});

describe("qué se le dice a quien creó la orden", () => {
  /** Sin problema no hay nada que decir: no se avisa de lo que salió bien. */
  it("si salió, no dice nada", () => {
    expect(avisoDelPendiente(null, false)).toBeNull();
    expect(avisoDelPendiente("", true)).toBeNull();
  });

  /**
   * MIENTRAS SE REINTENTA NO ES UN ERROR, y decirlo como error era una falsa
   * alarma: la fila se completa sola en minutos. Antes una de las tres
   * pantallas prometía «lo escribe la próxima sincronización», que en la
   * práctica son 3 a 5 horas.
   */
  it("mientras reintenta lo cuenta como lo que es y no como un fallo", () => {
    const a = avisoDelPendiente("La OT 2845 todavía no está en la planilla", true)!;
    expect(a).toContain("columna K en adelante");
    expect(a).toContain("reintenta solo");
    expect(a).not.toContain("no se pudo");
    expect(a).not.toContain("sincronización");
  });

  /** Cuando ya no se reintenta sí es un aviso, y lleva lo que dijo Google. */
  it("si ya no reintenta, dice el problema tal cual", () => {
    expect(avisoDelPendiente("Google devolvió 503", false))
      .toBe("El estado y las horas todavía no llegaron a la planilla (Google devolvió 503).");
  });
});

describe("el freno de la ráfaga", () => {
  const t = 1_000_000;

  /**
   * POR QUÉ EXISTE: abrir Órdenes dispara **seis** consultas al listado —la
   * lista y los cinco contadores por estado—, y salen juntas. Las seis leerían
   * la misma `sheets_intentado_en`, todavía vieja, así que el freno por orden no
   * las pararía: serían seis lecturas del master y seis escrituras iguales.
   */
  it("la primera pasa y las de la misma ráfaga no", () => {
    expect(hacePocoQueSeDreno(null, t)).toBe(false);
    expect(hacePocoQueSeDreno(t, t)).toBe(true);
    expect(hacePocoQueSeDreno(t, t + 200)).toBe(true);
    expect(hacePocoQueSeDreno(t, t + 29_999)).toBe(true);
  });

  it("pasados los treinta segundos vuelve a pasar", () => {
    expect(hacePocoQueSeDreno(t, t + MINIMO_ENTRE_DRENAJES_MS)).toBe(false);
    expect(hacePocoQueSeDreno(t, t + 60_000)).toBe(false);
  });

  /**
   * Es más corto que `MINIMO_ENTRE_INTENTOS_MS` a propósito: éste sólo corta la
   * ráfaga de una visita, y el que de verdad acota el costo es el de por orden.
   * Si fueran al revés, una orden recién encolada esperaría el más largo de los
   * dos para su primer reintento desde la pantalla.
   */
  it("corta más corto que el freno por orden", () => {
    expect(MINIMO_ENTRE_DRENAJES_MS).toBeLessThan(MINIMO_ENTRE_INTENTOS_MS);
  });
});
