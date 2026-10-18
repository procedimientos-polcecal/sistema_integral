import { describe, it, expect } from "vitest";
import {
  clasificarFallo,
  comoContesto,
  despuesDelIntento,
  esperaAntesDeReintentar,
  esperandoDesdeAyer,
  loQueQuedoPendiente,
  paradas,
  proximaAMandar,
  puedeEmpujarla,
  puedeMandarse,
  queHacerConLaNueva,
  tomarLaCarga,
  MINUTOS_PARA_SOLTAR,
} from "@/public/cola/colaOffline.js";

const AHORA = new Date("2026-10-18T12:00:00.000Z");

/** Minutos antes de AHORA, como texto ISO. */
function haceMinutos(minutos: number): string {
  return new Date(AHORA.getTime() - minutos * 60_000).toISOString();
}

function carga(cambios: Record<string, unknown> = {}) {
  return {
    clave: "clave-1",
    tipo: "aviso" as const,
    cuerpo: {},
    usuarioId: "ana",
    creadaEn: haceMinutos(30),
    tomadaEn: null as string | null,
    intentos: 0,
    ultimoError: null as string | null,
    estado: "esperando" as "esperando" | "parada",
    ...cambios,
  };
}

describe("clasificarFallo", () => {
  it("un 400 y un 403 son definitivos: reintentar no cambia nada", () => {
    expect(clasificarFallo(400)).toBe("definitivo");
    expect(clasificarFallo(403)).toBe("definitivo");
  });

  it("un 409 es definitivo: la clave quedó reservada y reintentar sólo daría otro 409", () => {
    expect(clasificarFallo(409)).toBe("definitivo");
  });

  it("un 401 es PASAJERO: la sesión se vence sola mientras la carga espera", () => {
    expect(clasificarFallo(401)).toBe("pasajero");
  });

  it("un 502 es pasajero: así reporta la ruta que Google no contestó", () => {
    expect(clasificarFallo(502)).toBe("pasajero");
  });

  it("no haber llegado a hablar con el servidor es pasajero", () => {
    expect(clasificarFallo(null)).toBe("pasajero");
  });
});

describe("puedeMandarse", () => {
  it("una carga esperando, propia y sin tomar se manda", () => {
    expect(puedeMandarse(carga(), "ana", AHORA)).toBe(true);
  });

  it("no se manda una carga de otro: firmaría la planilla con quien no la hizo", () => {
    expect(puedeMandarse(carga({ usuarioId: "ana" }), "beto", AHORA)).toBe(false);
  });

  it("no se manda una carga parada", () => {
    expect(puedeMandarse(carga({ estado: "parada" }), "ana", AHORA)).toBe(false);
  });

  it("no se manda una carga que otro disparo tomó recién", () => {
    const tomada = carga({ tomadaEn: haceMinutos(1) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(false);
  });

  it("una carga tomada hace más de MINUTOS_PARA_SOLTAR se suelta: el disparo anterior murió", () => {
    const tomada = carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR + 1) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });

  it("el límite es exacto: a los MINUTOS_PARA_SOLTAR justos todavía está tomada", () => {
    const justo = carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR) });
    expect(puedeMandarse(justo, "ana", AHORA)).toBe(false);
    const pasado = carga({ tomadaEn: new Date(AHORA.getTime() - MINUTOS_PARA_SOLTAR * 60_000 - 1).toISOString() });
    expect(puedeMandarse(pasado, "ana", AHORA)).toBe(true);
  });

  it("sin sesión conocida no se manda nada", () => {
    expect(puedeMandarse(carga(), null, AHORA)).toBe(false);
  });

  it("un usuario actual undefined o vacío tampoco manda nada, aunque la carga no tenga dueño", () => {
    // El service worker es JavaScript sin chequeo de tipos: ahí llega lo que llegue.
    const sinDuenio = carga({ usuarioId: undefined });
    expect(puedeMandarse(sinDuenio, undefined as unknown as null, AHORA)).toBe(false);
    expect(puedeMandarse(carga({ usuarioId: "" }), "", AHORA)).toBe(false);
  });

  it("una carga sin usuarioId no se manda nunca: no hay a quién firmar", () => {
    expect(puedeMandarse(carga({ usuarioId: undefined }), "ana", AHORA)).toBe(false);
    expect(puedeMandarse(carga({ usuarioId: "" }), "ana", AHORA)).toBe(false);
  });

  it("una marca de toma en el futuro no traba la carga para siempre", () => {
    const tomada = carga({ tomadaEn: haceMinutos(-600) });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });

  it("una marca de toma ilegible no traba la carga para siempre", () => {
    const tomada = carga({ tomadaEn: "no es una fecha" });
    expect(puedeMandarse(tomada, "ana", AHORA)).toBe(true);
  });
});

describe("proximaAMandar", () => {
  it("manda la más vieja primero", () => {
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(120) });
    const media = carga({ clave: "media", creadaEn: haceMinutos(60) });
    expect(proximaAMandar([nueva, vieja, media], "ana", AHORA)?.clave).toBe("vieja");
  });

  it("salta las que no puede mandar", () => {
    const deBeto = carga({ clave: "de-beto", usuarioId: "beto", creadaEn: haceMinutos(120) });
    const parada = carga({ clave: "parada", estado: "parada", creadaEn: haceMinutos(90) });
    const propia = carga({ clave: "propia", creadaEn: haceMinutos(10) });
    expect(proximaAMandar([deBeto, parada, propia], "ana", AHORA)?.clave).toBe("propia");
  });

  it("devuelve null si no hay ninguna para mandar", () => {
    expect(proximaAMandar([], "ana", AHORA)).toBeNull();
    expect(proximaAMandar([carga()], null, AHORA)).toBeNull();
  });

  it("no reordena el arreglo que recibe", () => {
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(120) });
    const cargas = [nueva, vieja];
    proximaAMandar(cargas, "ana", AHORA);
    expect(cargas.map((c) => c.clave)).toEqual(["nueva", "vieja"]);
  });

  it("una creadaEn ilegible va al final: nunca le pasa por delante a una con fecha", () => {
    const rota = carga({ clave: "rota", creadaEn: "no es una fecha" });
    const nueva = carga({ clave: "nueva", creadaEn: haceMinutos(10) });
    expect(proximaAMandar([rota, nueva], "ana", AHORA)?.clave).toBe("nueva");
    expect(proximaAMandar([nueva, rota], "ana", AHORA)?.clave).toBe("nueva");
  });

  it("si sólo queda una con creadaEn ilegible, se manda igual", () => {
    const rota = carga({ clave: "rota", creadaEn: "no es una fecha" });
    expect(proximaAMandar([rota], "ana", AHORA)?.clave).toBe("rota");
  });

  it("entre dos con creadaEn ilegible conserva el orden en que llegaron", () => {
    const a = carga({ clave: "a", creadaEn: "x" });
    const b = carga({ clave: "b", creadaEn: "y" });
    expect(proximaAMandar([a, b], "ana", AHORA)?.clave).toBe("a");
    expect(proximaAMandar([b, a], "ana", AHORA)?.clave).toBe("b");
  });
});

describe("esperandoDesdeAyer", () => {
  it("devuelve las que llevan más de 24 horas esperando", () => {
    const vieja = carga({ clave: "vieja", creadaEn: haceMinutos(24 * 60 + 1) });
    const reciente = carga({ clave: "reciente", creadaEn: haceMinutos(23 * 60) });
    const resultado = esperandoDesdeAyer([vieja, reciente], AHORA);
    expect(resultado.map((c) => c.clave)).toEqual(["vieja"]);
  });

  it("ignora una carga con fecha futura: el reloj del teléfono puede estar mal", () => {
    // 48 horas y no 24: con un valor absoluto de la diferencia, −24 h también daría "más de 24".
    const futura = carga({ creadaEn: haceMinutos(-48 * 60) });
    expect(esperandoDesdeAyer([futura], AHORA)).toEqual([]);
  });

  it("ignora una carga con fecha ilegible: no se puede afirmar que lleve esperando nada", () => {
    const rota = carga({ creadaEn: "no es una fecha" });
    expect(esperandoDesdeAyer([rota], AHORA)).toEqual([]);
  });

  it("no incluye las paradas: esas las devuelve paradas()", () => {
    const parada = carga({ estado: "parada", creadaEn: haceMinutos(48 * 60) });
    expect(esperandoDesdeAyer([parada], AHORA)).toEqual([]);
  });
});

describe("paradas", () => {
  it("devuelve las que están paradas, sin importar cuánto llevan", () => {
    const reciente = carga({ clave: "reciente", estado: "parada", creadaEn: haceMinutos(2) });
    const vieja = carga({ clave: "vieja", estado: "parada", creadaEn: haceMinutos(72 * 60) });
    const esperando = carga({ clave: "esperando" });
    expect(paradas([esperando, reciente, vieja]).map((c) => c.clave)).toEqual(["reciente", "vieja"]);
  });

  it("sin paradas devuelve una lista vacía", () => {
    expect(paradas([carga(), carga({ clave: "otra" })])).toEqual([]);
    expect(paradas([])).toEqual([]);
  });
});

describe("esperaAntesDeReintentar", () => {
  it("el primer reintento es casi inmediato: medio minuto", () => {
    expect(esperaAntesDeReintentar(0)).toBe(0.5);
    expect(esperaAntesDeReintentar(1)).toBe(0.5);
  });

  it("la espera se duplica con los intentos", () => {
    expect(esperaAntesDeReintentar(2)).toBe(1);
    expect(esperaAntesDeReintentar(3)).toBe(2);
    expect(esperaAntesDeReintentar(6)).toBe(16);
  });

  it("tiene techo: 50 intentos no dan días", () => {
    expect(esperaAntesDeReintentar(50)).toBe(60);
    expect(esperaAntesDeReintentar(500)).toBe(60);
  });

  it("un número de intentos infinito da el techo, no el primer reintento", () => {
    expect(esperaAntesDeReintentar(Infinity)).toBe(60);
  });

  it("un dato raro no da una espera rara", () => {
    expect(esperaAntesDeReintentar(-3)).toBe(0.5);
    expect(esperaAntesDeReintentar(-Infinity)).toBe(0.5);
    expect(esperaAntesDeReintentar(Number.NaN)).toBe(0.5);
  });
});

describe("puedeEmpujarla", () => {
  it("una parada SÍ se puede empujar a mano: que no se reintente sola no es que nadie pueda", () => {
    expect(puedeEmpujarla(carga({ estado: "parada" }), "ana", AHORA)).toBe(true);
    expect(puedeMandarse(carga({ estado: "parada" }), "ana", AHORA)).toBe(false);
  });

  it("no relaja de quién es: una carga ajena no sale ni empujándola", () => {
    expect(puedeEmpujarla(carga({ usuarioId: "beto" }), "ana", AHORA)).toBe(false);
    expect(puedeEmpujarla(carga({ usuarioId: "beto", estado: "parada" }), "ana", AHORA)).toBe(
      false,
    );
  });

  it("no relaja la marca de tomada: no le pisa el envío a otra pestaña", () => {
    expect(puedeEmpujarla(carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR - 1) }), "ana", AHORA))
      .toBe(false);
    expect(puedeEmpujarla(carga({ tomadaEn: haceMinutos(MINUTOS_PARA_SOLTAR + 1) }), "ana", AHORA))
      .toBe(true);
  });

  it("sin sesión conocida no se empuja nada", () => {
    expect(puedeEmpujarla(carga(), null, AHORA)).toBe(false);
  });
});

describe("comoContesto", () => {
  const contestacion = (cambios: Record<string, unknown> = {}) => ({
    status: 200 as number | null,
    redirigida: false,
    cuerpo: {} as Record<string, unknown>,
    ...cambios,
  });

  it("un 200 con número es el éxito, y trae el número tal cual", () => {
    expect(comoContesto("aviso", contestacion({ cuerpo: { oa_number: "A139" } }))).toEqual({
      ok: true,
      numero: "A139",
      advertencia: null,
    });
  });

  it("cada tipo busca su campo, y el de la orden es un número que viaja como texto", () => {
    expect(comoContesto("orden", contestacion({ cuerpo: { ot_number: 2796 } }))).toEqual({
      ok: true,
      numero: "2796",
      advertencia: null,
    });
  });

  it("el campo del otro tipo no cuenta: un aviso con ot_number no se da por cargado", () => {
    expect(comoContesto("aviso", contestacion({ cuerpo: { ot_number: 2796 } })).ok).toBe(false);
  });

  // Éste es el camino que rompía, y no es teórico: el HTML del login llega con
  // un 200 redondo cada vez que la sesión se venció.
  it("UN 200 SIN NÚMERO NO ES UN ÉXITO: eso no salió de la ruta de carga", () => {
    expect(comoContesto("aviso", contestacion()).ok).toBe(false);
  });

  it("y es PASAJERO, así que la carga se queda esperando en vez de borrarse", () => {
    const r = comoContesto("aviso", contestacion());
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(clasificarFallo(r.status)).toBe("pasajero");
    expect(despuesDelIntento(r)).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: r.error, estado: "esperando" },
    });
  });

  it("si vino de un redirect lo dice: la sesión se venció y hay que volver a entrar", () => {
    const r = comoContesto("aviso", contestacion({ redirigida: true }));
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(r.error).toContain("login");
  });

  it("un número vacío o nulo tampoco alcanza, pero el cero es un número", () => {
    expect(comoContesto("aviso", contestacion({ cuerpo: { oa_number: "" } })).ok).toBe(false);
    expect(comoContesto("aviso", contestacion({ cuerpo: { oa_number: null } })).ok).toBe(false);
    expect(comoContesto("orden", contestacion({ cuerpo: { ot_number: 0 } })).ok).toBe(true);
  });

  it("un 400 devuelve lo que dijo la ruta, sin traducir", () => {
    const r = comoContesto(
      "aviso",
      contestacion({ status: 400, cuerpo: { error: "Contá qué pasa" } }),
    );
    expect(r).toEqual({ ok: false, status: 400, error: "Contá qué pasa" });
  });

  it("un fallo mudo dice el código, que es lo único que se sabe", () => {
    const r = comoContesto("aviso", contestacion({ status: 502 }));
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(r.error).toContain("502");
  });

  it("sin status —ni se habló con el servidor— no se inventa un código", () => {
    const r = comoContesto("aviso", contestacion({ status: null }));
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(r.status).toBe(null);
    expect(clasificarFallo(r.status)).toBe("pasajero");
  });

  it("un 200 con número trae además lo que quedó a medias: es lo que evita el duplicado", () => {
    expect(
      comoContesto(
        "aviso",
        contestacion({
          cuerpo: {
            oa_number: "A139",
            ya_estaba: true,
            advertencia: "El aviso A139 está escrito en la planilla.",
          },
        }),
      ),
    ).toEqual({
      ok: true,
      numero: "A139",
      advertencia: "El aviso A139 está escrito en la planilla.",
    });
  });
});

describe("loQueQuedoPendiente", () => {
  it("sin nada a medias no dice nada", () => {
    expect(loQueQuedoPendiente({})).toBe(null);
    expect(
      loQueQuedoPendiente({ advertencia: null, clave_error: "", planilla_error: null }),
    ).toBe(null);
  });

  it("la advertencia va tal cual: es la que dice que la carga ya está en la planilla", () => {
    expect(loQueQuedoPendiente({ advertencia: "Ya estaba." })).toBe("Ya estaba.");
  });

  it("los cuatro salen juntos: decir uno dejaría los otros sin que nadie se entere", () => {
    const texto = loQueQuedoPendiente({
      advertencia: "Ya estaba.",
      clave_error: "no estaba reservada",
      planilla_error: "429 de Google",
      aviso_error: "El aviso quedó sin el enlace.",
    });
    expect(texto).toContain("Ya estaba.");
    expect(texto).toContain("no estaba reservada");
    expect(texto).toContain("429 de Google");
    expect(texto).toContain("El aviso quedó sin el enlace.");
  });

  it("un campo que no es texto no se imprime como objeto", () => {
    expect(loQueQuedoPendiente({ advertencia: { a: 1 }, aviso_error: 7 })).toBe(null);
  });
});

describe("queHacerConLaNueva", () => {
  it("sin intento —no había señal— va a la cola sin ningún fallo en contra", () => {
    expect(queHacerConLaNueva(null)).toEqual({
      accion: "encolar",
      intentos: 0,
      ultimoError: null,
    });
  });

  it("salió bien: trae el número y la advertencia, así nadie tiene que volver a decidir", () => {
    expect(queHacerConLaNueva({ ok: true, numero: "A139", advertencia: null })).toEqual({
      accion: "listo",
      numero: "A139",
      advertencia: null,
    });
  });

  it("un fallo definitivo NO se encola: no va a entrar nunca y taparía a las que sí", () => {
    expect(queHacerConLaNueva({ ok: false, status: 400, error: "Contá qué pasa" })).toEqual({
      accion: "rechazar",
      error: "Contá qué pasa",
    });
  });

  it("un fallo pasajero se encola con el intento contado y lo que dijo el servidor", () => {
    expect(queHacerConLaNueva({ ok: false, status: 502, error: "Google no contestó" })).toEqual({
      accion: "encolar",
      intentos: 1,
      ultimoError: "Google no contestó",
    });
  });

  it("un 401 se encola: la sesión se vence sola y la carga sigue siendo buena", () => {
    expect(
      queHacerConLaNueva({ ok: false, status: 401, error: "No autorizado" }).accion,
    ).toBe("encolar");
  });
});

describe("tomarLaCarga", () => {
  it("marca cuándo se tomó y suma el intento", () => {
    expect(tomarLaCarga(carga({ intentos: 2 }), AHORA)).toEqual({
      tomadaEn: AHORA.toISOString(),
      intentos: 3,
    });
  });

  it("un contador roto no se propaga: arranca de cero", () => {
    expect(tomarLaCarga(carga({ intentos: Number.NaN }), AHORA).intentos).toBe(1);
  });
});

describe("despuesDelIntento", () => {
  it("sale de la cola SÓLO cuando salió bien de verdad", () => {
    expect(despuesDelIntento({ ok: true, numero: "A139", advertencia: null })).toEqual({
      accion: "borrar",
    });
  });

  it("un fallo definitivo la para: necesita que una persona la mire", () => {
    expect(despuesDelIntento({ ok: false, status: 409, error: "en duda" })).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: "en duda", estado: "parada" },
    });
  });

  it("un fallo pasajero la deja esperando, y suelta la marca de tomada", () => {
    expect(despuesDelIntento({ ok: false, status: 500, error: "se cayó" })).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: "se cayó", estado: "esperando" },
    });
  });
});
