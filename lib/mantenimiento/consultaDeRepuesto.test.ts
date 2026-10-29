import { describe, it, expect } from "vitest";
import {
  TIPOS_DE_NOTA, preguntasAbiertas, tieneRespuesta, preguntaAbiertaDelRepuesto,
  type NotaDeLaOT,
} from "./consultaDeRepuesto";

const pregunta = (p: Partial<NotaDeLaOT> = {}): NotaDeLaOT => ({
  id: "n1", tipo: "PREGUNTA", texto: "¿Qué pasa con el rodamiento?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "u1",
  repuesto_id: "r1", responde_a: null, ...p,
});

/**
 * Una RESPUESTA como la escribe Compras: de otra persona (`u2`, y no `u1`, que es
 * quien pregunta) y sin repuesto, porque el repuesto es de la pregunta. Que no lo
 * lleve, ni sea del mismo autor, no tiene que impedirle cerrarla.
 */
const respuesta = (p: Partial<NotaDeLaOT> = {}): NotaDeLaOT =>
  pregunta({
    tipo: "RESPUESTA", texto: "Lo entrega el jueves", creado_por: "u2",
    repuesto_id: null, ...p,
  });

/** Todas las formas de ordenar una lista: para cuatro elementos son 24. */
function* permutaciones<T>(xs: readonly T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield [...xs];
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    const resto = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutaciones(resto)) yield [xs[i], ...p];
  }
}

/** El orden de una lista de notas, para que un test que falla diga con cuál. */
const ordenDe = (notas: readonly NotaDeLaOT[]) => `orden ${notas.map((n) => n.id).join(" ")}`;

describe("que pregunta sigue abierta", () => {
  it("una pregunta sin respuesta, sobre una OT abierta, esta abierta", () => {
    expect(preguntasAbiertas([pregunta()], "POR_HACER"))
      .toHaveLength(1);
  });

  it("con una respuesta deja de estar abierta", () => {
    const r = pregunta({ id: "n2", tipo: "RESPUESTA", responde_a: "n1" });
    expect(preguntasAbiertas([pregunta(), r], "POR_HACER"))
      .toEqual([]);
  });

  // Review Focus 3: dos respuestas no rompen ni duplican.
  it("dos respuestas a la misma pregunta la cierran una sola vez", () => {
    const r1 = pregunta({ id: "n2", tipo: "RESPUESTA", responde_a: "n1" });
    const r2 = pregunta({ id: "n3", tipo: "RESPUESTA", responde_a: "n1" });
    expect(preguntasAbiertas([pregunta(), r1, r2], "ATRASADO"))
      .toEqual([]);
  });

  // Review Focus 4: la OT realizada ya no espera nada.
  it("una OT realizada no tiene preguntas abiertas", () => {
    expect(preguntasAbiertas([pregunta()], "REALIZADO"))
      .toEqual([]);
  });

  // `repuesto_id` en null en una PREGUNTA significa que sacaron ese repuesto:
  // la FK es `on delete set null`, y T5 exige el id al preguntar.
  it("si sacaron el repuesto, la pregunta deja de estar abierta", () => {
    expect(preguntasAbiertas([pregunta({ repuesto_id: null })], "POR_HACER")).toEqual([]);
  });

  it("una justificacion no es una pregunta", () => {
    expect(preguntasAbiertas([pregunta({ tipo: "JUSTIFICACION" })], "POR_HACER"))
      .toEqual([]);
  });

  // Conflicto 2 del barrido previo: el hilo que agrega T5 no puede dejar dos
  // abiertas diciendo lo mismo en la bandeja de Facundo.
  it("una pregunta superada por otra del mismo hilo no esta abierta", () => {
    const seguimiento = pregunta({ id: "n2", tipo: "PREGUNTA", responde_a: "n1" });
    expect(preguntasAbiertas([pregunta(), seguimiento], "POR_HACER").map((p) => p.id))
      .toEqual(["n2"]);
  });

  // Hasta acá, los casos del plan. Lo que sigue fija las reglas que el docstring
  // del módulo promete y que esos casos no alcanzan a tocar.

  // El seguimiento apunta a la pregunta que estaba abierta y no a la primera del
  // hilo: así cada eslabón supera al anterior y queda uno solo. Dos seguimientos
  // apuntando a la primera dejarían los dos abiertos.
  it("un hilo de tres preguntas deja abierta sólo la última", () => {
    const segunda = pregunta({ id: "n2", responde_a: "n1" });
    const tercera = pregunta({ id: "n3", responde_a: "n2" });
    expect(preguntasAbiertas([pregunta(), segunda, tercera], "POR_HACER").map((p) => p.id))
      .toEqual(["n3"]);
  });

  it("contestar la última pregunta de un hilo lo cierra entero", () => {
    const segunda = pregunta({ id: "n2", responde_a: "n1" });
    const r = respuesta({ id: "n3", responde_a: "n2" });
    expect(preguntasAbiertas([pregunta(), segunda, r], "POR_HACER")).toEqual([]);
  });

  // El «ya llegó» es una RESPUESTA escrita por quien preguntó (`u1`) y la de
  // Compras la escribe otra persona (`u2`): la misma fila, y nada mira quién la
  // escribió. Van los dos lados, y un autor borrado (`creado_por` null), porque
  // una implementación que compare autores falla en alguno de los tres.
  it("cierra igual la respuesta de Compras, el «ya llegó» de quien preguntó y la de un autor borrado", () => {
    for (const autor of ["u2", "u1", null]) {
      const r = respuesta({ id: "n2", responde_a: "n1", creado_por: autor });
      expect(preguntasAbiertas([pregunta({ creado_por: "u1" }), r], "POR_HACER"), `autor ${autor}`)
        .toEqual([]);
    }
  });

  // Una OT puede esperar dos piezas de dos pedidos: cada pregunta se cierra por
  // su cuenta.
  it("una respuesta cierra sólo su pregunta: la de otro repuesto sigue abierta", () => {
    const deOtroRepuesto = pregunta({ id: "n2", repuesto_id: "r2" });
    const r = respuesta({ id: "n3", responde_a: "n1" });
    expect(preguntasAbiertas([pregunta(), deOtroRepuesto, r], "POR_HACER").map((p) => p.id))
      .toEqual(["n2"]);
  });

  // Nada impide que una nota de otro tipo traiga `responde_a`. Apuntar a una
  // pregunta no es contestarla ni seguirla, y darla por superada la escondería.
  it("una justificación que apunta a la pregunta no la cierra", () => {
    const nota = pregunta({ id: "n2", tipo: "JUSTIFICACION", responde_a: "n1" });
    expect(preguntasAbiertas([pregunta(), nota], "POR_HACER").map((p) => p.id))
      .toEqual(["n1"]);
  });

  // Una columna que el `select` de una ruta no pidió llega como `undefined`, no
  // como null: la fila sale sin la propiedad. Mostrar una pregunta de más se nota;
  // esconder una viva, no.
  it("un repuesto_id que no vino en la fila no cierra la pregunta", () => {
    const fila: Partial<NotaDeLaOT> = pregunta();
    delete fila.repuesto_id;
    expect(preguntasAbiertas([fila as NotaDeLaOT], "POR_HACER")).toHaveLength(1);
  });

  // Una suspendida no espera nada de nadie, igual que una realizada: son los dos
  // estados de `CERRADAS_GUT`, la lista con la que el GUT las manda al final.
  it("una OT suspendida tampoco tiene preguntas abiertas", () => {
    expect(preguntasAbiertas([pregunta()], "SUSPENDIDA"))
      .toEqual([]);
  });

  // Con cualquier otro estado sigue abierta, y con uno que no conocemos también:
  // esconder una pregunta es peor que mostrar una de más, porque la OT queda
  // esperando una respuesta que nadie ve.
  it("cualquier estado que no sea REALIZADO ni SUSPENDIDA la deja abierta, conocido o no", () => {
    for (const estado of ["POR_HACER", "ATRASADO", "EN_PROCESO", "CUALQUIER_COSA", "", null]) {
      expect(preguntasAbiertas([pregunta()], estado)).toHaveLength(1);
    }
  });

  it("el estado se lee sin importar mayúsculas ni espacios", () => {
    for (const estado of ["realizado", "Realizado", " REALIZADO ", "suspendida", " Suspendida "]) {
      expect(preguntasAbiertas([pregunta()], estado)).toEqual([]);
    }
  });

  it("sin notas no hay preguntas", () => {
    expect(preguntasAbiertas([], "POR_HACER")).toEqual([]);
  });

  // La función filtra: no ordena ni toca lo que recibe. La lista congelada hace
  // que un `sort` en el lugar tire en vez de pasar. Quien las quiera por
  // antigüedad las ordena él.
  it("devuelve las abiertas en el orden en que vinieron y no toca la lista", () => {
    const notas = Object.freeze([
      pregunta({ id: "n3", creado_en: "2026-10-29T12:00:00Z", repuesto_id: "r3" }),
      pregunta({ id: "n1", creado_en: "2026-10-29T10:00:00Z" }),
      pregunta({ id: "n2", creado_en: "2026-10-29T11:00:00Z", repuesto_id: "r2" }),
    ]);
    expect(preguntasAbiertas(notas, "POR_HACER").map((p) => p.id)).toEqual(["n3", "n1", "n2"]);
    expect(notas.map((n) => n.id)).toEqual(["n3", "n1", "n2"]);
  });
});

describe("si una pregunta tiene respuesta", () => {
  it("la tiene cuando una RESPUESTA la apunta", () => {
    expect(tieneRespuesta(pregunta(), [pregunta(), respuesta({ id: "n2", responde_a: "n1" })]))
      .toBe(true);
  });

  it("no la tiene sin ninguna", () => {
    expect(tieneRespuesta(pregunta(), [pregunta()])).toBe(false);
  });

  // `responde_a` no nulo no quiere decir «tiene respuesta»: eso lo dice el tipo.
  // Un seguimiento también apunta a la anterior y no la contesta; la supera, que
  // es otra cosa y la resuelve `preguntasAbiertas`.
  it("un seguimiento que la apunta no es una respuesta", () => {
    const seguimiento = pregunta({ id: "n2", responde_a: "n1" });
    expect(tieneRespuesta(pregunta(), [pregunta(), seguimiento])).toBe(false);
  });

  it("una justificación que la apunta tampoco", () => {
    const nota = pregunta({ id: "n2", tipo: "JUSTIFICACION", responde_a: "n1" });
    expect(tieneRespuesta(pregunta(), [pregunta(), nota])).toBe(false);
  });

  it("una respuesta a otra pregunta no cuenta", () => {
    const deOtra = respuesta({ id: "n3", responde_a: "n2" });
    expect(tieneRespuesta(pregunta(), [pregunta(), pregunta({ id: "n2" }), deOtra]))
      .toBe(false);
  });
});

describe("la pregunta abierta de un repuesto", () => {
  // Una pregunta abierta por repuesto: el boton no abre la segunda.
  it("dice si ese repuesto ya tiene una pregunta esperando", () => {
    expect(preguntaAbiertaDelRepuesto([pregunta()], "r1", "POR_HACER"))
      .toMatchObject({ id: "n1" });
    expect(preguntaAbiertaDelRepuesto([pregunta()], "r2", "POR_HACER")).toBeNull();
  });

  // Que haya una pregunta sobre el repuesto no alcanza: tiene que estar abierta.
  // Respondida, el botón vuelve a poder abrir una nueva.
  it("una pregunta ya respondida no cuenta", () => {
    const r = respuesta({ id: "n2", responde_a: "n1" });
    expect(preguntaAbiertaDelRepuesto([pregunta(), r], "r1", "POR_HACER")).toBeNull();
  });

  it("en una OT realizada no hay ninguna", () => {
    expect(preguntaAbiertaDelRepuesto([pregunta()], "r1", "REALIZADO")).toBeNull();
  });

  // Es a la que tiene que apuntar el seguimiento siguiente: la primera ya fue
  // superada.
  it("con un seguimiento, la abierta es el seguimiento y no la primera", () => {
    const seguimiento = pregunta({ id: "n2", responde_a: "n1" });
    expect(preguntaAbiertaDelRepuesto([pregunta(), seguimiento], "r1", "POR_HACER")?.id)
      .toBe("n2");
  });

  // Nada en la base impide que dos personas con la misma OT abierta pregunten por
  // la misma pieza. Devuelve la de `creado_en` más reciente, las traigan como las
  // traigan: la ruta de notas las entrega de la más nueva a la más vieja, y otro
  // lugar las puede traer al revés. Con la misma fecha exacta no hay «más
  // reciente»: gana la última que vino, como en `laUltimaNota`, y ahí el orden
  // sí cuenta.
  it("con dos abiertas del mismo repuesto, de fecha distinta, devuelve la más reciente venga como venga", () => {
    const vieja = pregunta({ id: "n1", creado_en: "2026-10-29T10:00:00Z" });
    const nueva = pregunta({ id: "n2", creado_en: "2026-10-29T11:00:00Z" });
    expect(preguntaAbiertaDelRepuesto([vieja, nueva], "r1", "POR_HACER")?.id).toBe("n2");
    expect(preguntaAbiertaDelRepuesto([nueva, vieja], "r1", "POR_HACER")?.id).toBe("n2");
  });
});

// En qué orden llegan las notas y quién las escribió: las dos cosas que la ruta de
// notas pone en juego y que los casos de arriba, con la pregunta siempre primero,
// sólo rozan.
describe("el orden de las notas y quién las escribió no cambian qué está abierto", () => {
  // Cuatro autores distintos, a propósito: quien pregunta (`u1`), otro técnico que
  // sigue el hilo (`u3`), Compras que contesta (`u2`) y quien pregunta por otra
  // pieza (`u4`). Que conteste otra persona es el caso central de la
  // funcionalidad, y los casos del plan arman la respuesta con el mismo autor que
  // la pregunta: acá ninguno se repite.
  const hilo = [
    pregunta({ id: "n1", creado_por: "u1", creado_en: "2026-10-29T10:00:00Z" }),
    pregunta({ id: "n2", creado_por: "u3", responde_a: "n1", creado_en: "2026-10-29T11:00:00Z" }),
    respuesta({ id: "n3", creado_por: "u2", responde_a: "n2", creado_en: "2026-10-29T12:00:00Z" }),
    pregunta({ id: "n4", creado_por: "u4", repuesto_id: "r2", creado_en: "2026-10-29T13:00:00Z" }),
  ];

  // La ruta de notas las entrega de la más nueva a la más vieja (`order creado_en
  // desc`), así que la respuesta llega ANTES que su pregunta. Un recorrido que sólo
  // mira hacia adelante pasa todos los tests de arriba, que ponen la pregunta
  // primero, y falla recién con datos reales: mostraría abierta toda pregunta que
  // ya se contestó.
  it("de cualquier orden, sólo queda abierta la pregunta de r2", () => {
    let vistas = 0;
    for (const notas of permutaciones(hilo)) {
      expect(preguntasAbiertas(notas, "POR_HACER").map((p) => p.id), ordenDe(notas))
        .toEqual(["n4"]);
      vistas++;
    }
    expect(vistas).toBe(24);
  });

  it("tieneRespuesta tampoco depende del orden ni de quién escribió", () => {
    for (const notas of permutaciones(hilo)) {
      expect(tieneRespuesta(hilo[1], notas), ordenDe(notas)).toBe(true);
      expect(tieneRespuesta(hilo[0], notas), ordenDe(notas)).toBe(false);
    }
  });

  it("la abierta de un repuesto es la misma de cualquier orden", () => {
    for (const notas of permutaciones(hilo)) {
      expect(preguntaAbiertaDelRepuesto(notas, "r2", "POR_HACER")?.id, ordenDe(notas))
        .toBe("n4");
      expect(preguntaAbiertaDelRepuesto(notas, "r1", "POR_HACER"), ordenDe(notas))
        .toBeNull();
    }
  });
});

describe("los tipos de nota", () => {
  // Este test no mira ninguna migración: repite los tres literales del `check` de
  // `ordenes_trabajo_notas.tipo` (migración 20261029082249), como `gut.test.ts`
  // repite el 27. Es una señal de alerta y nada más: la lista está escrita acá y en
  // la base sin que nada las compare, así que tocar una sin la otra no rompe
  // nada, y lo único que obliga a enterarse es que este test falle. Agregar un
  // cuarto valor pide una migración nueva: una aplicada no se edita.
  it("avisa si alguien cambia la lista: el check de la base tiene que cambiar con ella", () => {
    expect(TIPOS_DE_NOTA).toEqual(["JUSTIFICACION", "PREGUNTA", "RESPUESTA"]);
  });
});
