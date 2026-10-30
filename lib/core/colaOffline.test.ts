import { describe, it, expect } from "vitest";
import {
  clasificarFallo,
  comoContesto,
  comoSeLlama,
  concordado,
  conSuArticulo,
  convieneReintentar,
  cuerpoComoFormData,
  despuesDelIntento,
  esperaAntesDeReintentar,
  esperandoDesdeAyer,
  llevaArchivo,
  loQueQuedoPendiente,
  paradas,
  proximaAMandar,
  puedeEmpujarla,
  puedeMandarse,
  queHacerConLaNueva,
  siNoSePudoAvisar,
  tomarLaCarga,
  CAMPO_DEL_CUERPO,
  CAMPO_DE_LA_FOTO,
  MINUTOS_PARA_SOLTAR,
  RUTA_DE,
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

  // El 413 no lo contesta la ruta: lo contesta la infraestructura, que corta
  // el cuerpo antes de invocar la función. Pero es definitivo igual, porque el
  // próximo intento lleva exactamente los mismos bytes.
  it("un 413 es definitivo: el cuerpo no entra, y el que sigue pesa lo mismo", () => {
    expect(clasificarFallo(413)).toBe("definitivo");
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

  it("un fallo que dice que la fila ya entró lo pasa en `yaEntro`", () => {
    expect(
      comoContesto(
        "condicion",
        contestacion({ status: 502, cuerpo: { error: "faltó la foto", ya_entro: "7" } }),
      ),
    ).toEqual({
      ok: false,
      status: 502,
      deLaRuta: true,
      error: "faltó la foto",
      yaEntro: "7",
    });
  });

  it("y uno que no salió de la ruta no puede afirmar que algo quedó escrito", () => {
    // `ya_entro` lo manda la ruta de alta; una respuesta que no es de ella
    // —un portal de WiFi, el HTML del login— no tiene cómo saberlo, así que
    // ese campo no se lee en esa rama ni aunque venga.
    const r = comoContesto("condicion", contestacion({ status: 500, cuerpo: { ya_entro: "7" } }));
    expect(r).toMatchObject({ ok: false, deLaRuta: false, yaEntro: null });
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
    expect(convieneReintentar(r)).toBe(true);
    expect(despuesDelIntento(r)).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: r.error, estado: "esperando" },
    });
  });

  it("un cuerpo que es literalmente null no tira: en el service worker cortaría el vaciado", () => {
    const r = comoContesto("aviso", contestacion({ cuerpo: null }));
    expect(r.ok).toBe(false);
    expect(comoContesto("orden", { status: 500, redirigida: false, cuerpo: null }).ok).toBe(false);
    expect(comoContesto("orden", contestacion({ cuerpo: "texto suelto" })).ok).toBe(false);
  });

  // Un 400 de un portal cautivo o del cortafuegos de Vercel no dice nada sobre
  // la carga, y darlo por definitivo la dejaría parada para siempre por algo
  // que se arregla saliendo de ese WiFi.
  it("un fallo DEFINITIVO sin `error` en el cuerpo no salió de la ruta, así que se reintenta", () => {
    for (const status of [400, 403, 409]) {
      const r = comoContesto("aviso", contestacion({ status }));
      if (r.ok) throw new Error("tendría que haber fallado");
      expect(r.deLaRuta).toBe(false);
      expect(convieneReintentar(r)).toBe(true);
      expect(despuesDelIntento(r).accion).toBe("actualizar");
      expect(queHacerConLaNueva(r).accion).toBe("encolar");
    }
  });

  it("y uno que sí trae `error` sigue siendo de la ruta y sigue parando la carga", () => {
    const r = comoContesto("aviso", contestacion({ status: 409, cuerpo: { error: "en duda" } }));
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(r.deLaRuta).toBe(true);
    expect(convieneReintentar(r)).toBe(false);
  });

  it("un redirect que termina en 403 también se reintenta, y lo dice como redirect", () => {
    const r = comoContesto("aviso", contestacion({ status: 403, redirigida: true }));
    if (r.ok) throw new Error("tendría que haber fallado");
    expect(convieneReintentar(r)).toBe(true);
    expect(r.error).toContain("login");
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
    // `yaEntro` en null es lo que contestan el aviso y la orden siempre: sólo
    // el alta de una condición manda `ya_entro`, y sólo cuando la fila quedó
    // escrita pese al fallo.
    expect(r).toEqual({
      ok: false,
      status: 400,
      deLaRuta: true,
      error: "Contá qué pasa",
      yaEntro: null,
    });
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
    expect(convieneReintentar(r)).toBe(true);
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
    expect(
      queHacerConLaNueva({ ok: false, status: 400, deLaRuta: true, error: "Contá qué pasa" }),
    ).toEqual({ accion: "rechazar", error: "Contá qué pasa" });
  });

  it("un fallo pasajero se encola con el intento contado y lo que dijo el servidor", () => {
    expect(
      queHacerConLaNueva({ ok: false, status: 502, deLaRuta: true, error: "Google no contestó" }),
    ).toEqual({ accion: "encolar", intentos: 1, ultimoError: "Google no contestó" });
  });

  it("un 401 se encola: la sesión se vence sola y la carga sigue siendo buena", () => {
    expect(
      queHacerConLaNueva({ ok: false, status: 401, deLaRuta: true, error: "No autorizado" })
        .accion,
    ).toBe("encolar");
  });

  it("una carga que entró pero quedó a medias nace sabiendo con qué número entró", () => {
    expect(
      queHacerConLaNueva({
        ok: false,
        status: 502,
        deLaRuta: true,
        error: "La condición entró con el número 7… faltó la foto.",
        yaEntro: "7",
      }),
    ).toEqual({
      accion: "encolar",
      intentos: 1,
      ultimoError: "La condición entró con el número 7… faltó la foto.",
      yaEntro: "7",
    });
  });

  it("y la que no entró no lleva el campo, en vez de llevarlo vacío", () => {
    // Que no esté es inequívoco: la pantalla pregunta por la verdad del campo
    // para decidir si ofrece corregir, y un `yaEntro: null` escrito encima de
    // uno que sí tenía número sería perderlo.
    expect(
      queHacerConLaNueva({ ok: false, status: 502, deLaRuta: true, error: "x", yaEntro: null }),
    ).not.toHaveProperty("yaEntro");
  });
});

describe("convieneReintentar", () => {
  it("lo que salió bien no se reintenta", () => {
    expect(convieneReintentar({ ok: true, numero: "A139", advertencia: null })).toBe(false);
  });

  it("de la ruta, manda el código", () => {
    expect(convieneReintentar({ ok: false, status: 409, deLaRuta: true, error: "x" })).toBe(false);
    expect(convieneReintentar({ ok: false, status: 502, deLaRuta: true, error: "x" })).toBe(true);
  });

  it("si no salió de la ruta, el código no significa nada y se reintenta igual", () => {
    expect(convieneReintentar({ ok: false, status: 409, deLaRuta: false, error: "x" })).toBe(true);
    expect(convieneReintentar({ ok: false, status: null, deLaRuta: false, error: "x" })).toBe(true);
  });

  /*
   * EL 413 ES LA EXCEPCIÓN, Y ES LA QUE EVITA EL LAZO.
   *
   * Vercel corta el cuerpo de un pedido en 4,5 MB **antes de invocar la
   * función**, así que contesta un 413 cuyo cuerpo no es el JSON de la ruta:
   * `comoContesto` no encuentra `error` y lo marca `deLaRuta: false`. Por la
   * regla de arriba eso se reintenta siempre — y como no hay tope de intentos,
   * una foto de 6 MB adentro de una condición se mandaba **para siempre**, con
   * los datos de la planta, mientras el texto guardado le echaba la culpa al
   * WiFi. El próximo intento pesa lo mismo: no hay nada que esperar.
   */
  it("un 413 NO se reintenta, aunque no haya salido de la ruta", () => {
    expect(convieneReintentar({ ok: false, status: 413, deLaRuta: false, error: "x" })).toBe(false);
    expect(convieneReintentar({ ok: false, status: 413, deLaRuta: true, error: "x" })).toBe(false);
  });

  it("y la carga queda parada, con un texto que no culpa al WiFi", () => {
    // Es el camino entero, desde lo que contesta el servidor: lo que lee quien
    // mire la carga tiene que decirle qué hacer, y lo único que se puede hacer
    // es mandarla con una foto más chica o sin foto.
    const resultado = comoContesto("condicion", {
      status: 413,
      redirigida: false,
      cuerpo: null, // Vercel no contesta JSON: es exactamente este caso.
    });
    expect(resultado.ok).toBe(false);
    const parada = despuesDelIntento(resultado);
    expect(parada).toEqual({
      accion: "actualizar",
      cambios: expect.objectContaining({ estado: "parada", tomadaEn: null }),
    });
    const dicho = (parada as { cambios: { ultimoError: string } }).cambios.ultimoError;
    expect(dicho).toContain("demasiado grande");
    expect(dicho).toContain("más chica");
    expect(dicho).not.toContain("WiFi");
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
  it("sale de la cola SÓLO cuando salió bien de verdad, y trae el número", () => {
    expect(despuesDelIntento({ ok: true, numero: "A139", advertencia: null })).toEqual({
      accion: "borrar",
      numero: "A139",
    });
  });

  // Esto es lo que no puede perderse: la advertencia dice que la carga ya está
  // en la planilla y todavía no en el sistema. Si se borrara sin decirla, nadie
  // se enteraría nunca —y en el service worker, menos—.
  it("si quedó algo a medias, el veredicto se llama DISTINTO y trae la advertencia", () => {
    expect(
      despuesDelIntento({ ok: true, numero: "A139", advertencia: "Está en la planilla." }),
    ).toEqual({
      accion: "borrar-y-avisar",
      numero: "A139",
      advertencia: "Está en la planilla.",
    });
  });

  it("nunca borra en silencio algo que tenía advertencia", () => {
    const conAdvertencia = despuesDelIntento({
      ok: true,
      numero: "A139",
      advertencia: "Está en la planilla.",
    });
    expect(conAdvertencia.accion).not.toBe("borrar");
  });

  it("un fallo definitivo la para: necesita que una persona la mire", () => {
    expect(
      despuesDelIntento({ ok: false, status: 409, deLaRuta: true, error: "en duda" }),
    ).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: "en duda", estado: "parada" },
    });
  });

  // La foto es el único campo de una condición que no se recupera después: se
  // saca parado frente al cardán sin protección, y cuando el cardán se protege
  // ya no hay nada que fotografiar. Así que cuando la ruta la rechaza —pesa 14
  // MB, es un PDF— lo que tiene que quedar guardado es **lo que dijo la ruta**,
  // sin traducir: es lo único que va a leer quien mire la carga parada y tenga
  // que decidir si vuelve a sacarla.
  it("una foto rechazada deja la carga parada con lo que dijo la ruta", () => {
    const r = despuesDelIntento({
      ok: false,
      status: 400,
      deLaRuta: true,
      error: "La foto pesa 14 MB y el máximo son 10.",
    });
    expect(r).toEqual({
      accion: "actualizar",
      cambios: {
        tomadaEn: null,
        ultimoError: "La foto pesa 14 MB y el máximo son 10.",
        estado: "parada",
      },
    });
  });

  /*
   * LA PRIMERA CARGA DE ESTE SISTEMA QUE SIGUE EN LA COLA CON SU FILA YA
   * ESCRITA. Pasa con la condición insegura cuya foto no se pudo guardar: se
   * contesta un error a propósito, para no perder el `Blob`. El número tiene
   * que llegar hasta la carga, porque es lo que le saca a la pantalla el botón
   * de corregir —que le daría una clave nueva y crearía una segunda condición—.
   */
  it("lo que ya entró viaja hasta la carga, para que no se la corrija y se duplique", () => {
    expect(
      despuesDelIntento({
        ok: false,
        status: 502,
        deLaRuta: true,
        error: "La condición entró con el número 7… faltó la foto.",
        yaEntro: "7",
      }),
    ).toEqual({
      accion: "actualizar",
      cambios: {
        tomadaEn: null,
        ultimoError: "La condición entró con el número 7… faltó la foto.",
        estado: "esperando",
        yaEntro: "7",
      },
    });
  });

  it("y un intento que no dice nada de eso no lo pisa con null", () => {
    // Los `cambios` se aplican con un spread sobre la fila guardada, así que
    // un `yaEntro: null` acá borraría el número de una carga que **sí** entró.
    // Lo que entró no se des-entra.
    const cambios = despuesDelIntento({
      ok: false,
      status: 500,
      deLaRuta: true,
      error: "se cayó",
    });
    expect((cambios as { cambios: object }).cambios).not.toHaveProperty("yaEntro");
  });

  it("un fallo pasajero la deja esperando, y suelta la marca de tomada", () => {
    expect(
      despuesDelIntento({ ok: false, status: 500, deLaRuta: true, error: "se cayó" }),
    ).toEqual({
      accion: "actualizar",
      cambios: { tomadaEn: null, ultimoError: "se cayó", estado: "esperando" },
    });
  });
});

describe("cómo se nombra una carga", () => {
  it("son dos formas y no tres, y las dos dicen «orden de trabajo»", () => {
    // El bug que esto cierra: la misma carga se llamaba «Orden de trabajo» en
    // la lista, «la orden» en el formulario y «la orden de trabajo» en la
    // notificación, o sea que cambiaba de nombre según si entró con la app
    // abierta o cerrada.
    expect(comoSeLlama("aviso")).toBe("Aviso");
    expect(comoSeLlama("orden")).toBe("Orden de trabajo");
    expect(conSuArticulo("aviso")).toBe("el aviso");
    expect(conSuArticulo("orden")).toBe("la orden de trabajo");
  });

  it("lo que concuerda con el artículo lleva su género: «el aviso … parado», «la orden … parada»", () => {
    // El bug que esto cierra: el cartel de /cargar decía «el aviso que quedó
    // parada». Un participio escrito a mano en la pantalla sólo acierta con uno
    // de los dos tipos.
    expect(`${conSuArticulo("aviso")} que quedó ${concordado("aviso", "parad")}`).toBe(
      "el aviso que quedó parado",
    );
    expect(`${conSuArticulo("orden")} que quedó ${concordado("orden", "parad")}`).toBe(
      "la orden de trabajo que quedó parada",
    );
  });
});

describe("el tercer tipo de carga: la condición insegura", () => {
  // Hasta que entró la condición, `comoSeLlama`, `conSuArticulo` y `concordado`
  // eran `tipo === "aviso" ? x : y`: un tercer tipo caía en la rama de «orden»
  // por accidente, y en dos de los tres casos daba una frase que suena bien. Estos
  // tests fijan lo que dice cada una para el tercero. Que un cuarto tipo no se
  // olvide de ninguna lo cubre el test de más abajo, no `tsc`: los mapas de
  // `colaOffline.js` no se comprueban (`allowJs` sin `checkJs`).
  it("la condición tiene su nombre, su artículo y su concordancia", () => {
    expect(comoSeLlama("condicion")).toBe("Condición insegura");
    expect(conSuArticulo("condicion")).toBe("la condición insegura");
    expect(concordado("condicion", "parad")).toBe("parada");
  });

  it("todos los tipos tienen su nombre, su artículo, su vocal y su campo", () => {
    // `RUTA_DE` es la lista de los tipos que existen. Un cuarto tipo que se
    // agregue ahí y se olvide en cualquiera de los otros cuatro mapas falla acá,
    // que es la única garantía real: `tsc` no mira ese archivo.
    const tipos = Object.keys(RUTA_DE) as Array<keyof typeof RUTA_DE>;
    expect(tipos.length).toBeGreaterThanOrEqual(3);
    // Un cuerpo con todos los campos de número que existen: `comoContesto` lo da
    // por cargado sólo si el tipo tiene el suyo definido.
    const cuerpo = { oa_number: "1", ot_number: "1", numero: "1" };
    for (const tipo of tipos) {
      expect(comoSeLlama(tipo), tipo).toEqual(expect.any(String));
      expect(conSuArticulo(tipo), tipo).toEqual(expect.any(String));
      expect(comoSeLlama(tipo).trim(), tipo).not.toBe("");
      expect(conSuArticulo(tipo).trim(), tipo).not.toBe("");
      expect(concordado(tipo, "parad"), tipo).toMatch(/^parad[oa]$/);
      expect(comoContesto(tipo, { status: 200, redirigida: false, cuerpo }).ok, tipo).toBe(true);
      // `llevaArchivo` es el quinto mapa y se comprueba igual que los otros
      // cuatro. Se mira el **tipo** y no la verdad: un tipo sin entrada
      // devuelve `undefined`, que es falso y por lo tanto seguro —sale como
      // JSON, igual que hoy—, pero sigue siendo un mapa incompleto.
      expect(typeof llevaArchivo(tipo), tipo).toBe("boolean");
    }
  });

  it("sólo la condición lleva archivo", () => {
    // Es lo que decide si el pedido sale como JSON o como `FormData`, y por eso
    // es un mapa y no un `tipo === "condicion"`: las dos cargas de
    // Mantenimiento tienen que salir **byte por byte** como salían antes.
    expect(llevaArchivo("aviso")).toBe(false);
    expect(llevaArchivo("orden")).toBe(false);
    expect(llevaArchivo("condicion")).toBe(true);
  });

  it("la condición va a su ruta de alta", () => {
    expect(RUTA_DE.condicion).toBe("/api/seguridad-higiene/condiciones");
  });

  it("lee el número de la condición del campo que devuelve su ruta", () => {
    const r = comoContesto("condicion", {
      status: 200,
      redirigida: false,
      cuerpo: { numero: "CI-45" },
    });
    expect(r).toMatchObject({ ok: true, numero: "CI-45" });
  });

  it("y los otros dos no leen ese campo: un aviso con `numero` no se da por cargado", () => {
    const contestacion = { status: 200, redirigida: false, cuerpo: { numero: "CI-45" } };
    expect(comoContesto("aviso", contestacion).ok).toBe(false);
    expect(comoContesto("orden", contestacion).ok).toBe(false);
  });
});

describe("cuerpoComoFormData", () => {
  const foto = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

  it("el cuerpo viaja como un solo campo de JSON, y la foto aparte", () => {
    // El cuerpo entero en un campo y no un campo por clave: así la ruta valida
    // **exactamente el mismo objeto** que valida en el camino JSON, sin tener
    // que volver a convertir «2» en 2 ni «null» en null. Un número que
    // atravesara el multipart como texto rebotaría con un 400 que sólo le pasa
    // a la carga con foto.
    const forma = cuerpoComoFormData({ descripcion: "falta la guarda", prioridad: 2, foto });
    expect(JSON.parse(String(forma.get(CAMPO_DEL_CUERPO)))).toEqual({
      descripcion: "falta la guarda",
      prioridad: 2,
    });
  });

  it("la foto no va adentro del JSON: iría como `{}`", () => {
    const forma = cuerpoComoFormData({ descripcion: "x", prioridad: 1, foto });
    expect(JSON.parse(String(forma.get(CAMPO_DEL_CUERPO)))).not.toHaveProperty("foto");
    expect(forma.get(CAMPO_DE_LA_FOTO)).toBeInstanceOf(Blob);
  });

  it("sin foto no se manda el campo de la foto, en vez de mandarlo vacío", () => {
    // Un campo vacío llegaría como el texto "null" o como un archivo de cero
    // bytes, y la ruta tendría que distinguir «no sacó foto» de «la foto se
    // rompió en el camino». Que no esté es inequívoco.
    const forma = cuerpoComoFormData({ descripcion: "x", prioridad: 1, foto: null });
    expect(forma.has(CAMPO_DE_LA_FOTO)).toBe(false);
    expect(JSON.parse(String(forma.get(CAMPO_DEL_CUERPO)))).toEqual({
      descripcion: "x",
      prioridad: 1,
    });
  });

  it("la foto viaja con un nombre, que es de donde la ruta saca la extensión", () => {
    const forma = cuerpoComoFormData({ foto });
    const archivo = forma.get(CAMPO_DE_LA_FOTO);
    expect(archivo).toBeInstanceOf(Blob);
    // En `FormData` un `Blob` sin nombre viaja como "blob" y se pierde el tipo
    // del archivo. Lo que importa es que llegue con algo: la ruta decide la
    // extensión por el `type`, no por el nombre.
    expect((archivo as File).name).not.toBe("");
  });
});

describe("siNoSePudoAvisar", () => {
  const VEREDICTO = { numero: "OA-77", advertencia: "Quedó en la planilla." };

  it("la para, porque ya entró y no tiene que volver a salir sola", () => {
    const { accion, cambios } = siNoSePudoAvisar(VEREDICTO, "aviso");
    expect(accion).toBe("actualizar");
    expect(cambios.estado).toBe("parada");
    // La marca de tomada se suelta: el intento terminó.
    expect(cambios.tomadaEn).toBeNull();
  });

  it("el texto dice primero que entró y con qué número", () => {
    // Es la única carga `parada` que sí entró. Lo primero que quien la mire
    // tiene que saber es que esto NO hay que volver a cargarlo.
    const { cambios } = siNoSePudoAvisar(VEREDICTO, "aviso");
    expect(cambios.ultimoError).toMatch(/^Entró/);
    expect(cambios.ultimoError).toContain("OA-77");
    expect(cambios.ultimoError).toContain("no hay que volver a cargarlo");
    expect(cambios.ultimoError).toContain("Quedó en la planilla.");
  });

  it("nombra la carga como la nombra todo el resto del sistema", () => {
    expect(siNoSePudoAvisar({ numero: "OT-12", advertencia: "x" }, "orden").cambios.ultimoError)
      .toContain("la orden de trabajo OT-12");
  });

  it("lo que devuelve es ejecutable sin volver a decidir nada", () => {
    // Misma forma que el `actualizar` de `despuesDelIntento`: quien llama hace
    // `actualizarCarga(clave, cambios)` y nada más.
    const falla = despuesDelIntento({ ok: false, status: 500, deLaRuta: true, error: "x" });
    expect(Object.keys(siNoSePudoAvisar(VEREDICTO, "aviso"))).toEqual(Object.keys(falla));
  });
});
