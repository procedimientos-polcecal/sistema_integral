import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TIPOS_DE_NOTA, preguntasAbiertas, tieneRespuesta, preguntaAbiertaDelRepuesto,
  preguntasSinResponder,
  itemDeLaConsulta, NOMBRE_DE_LA_CONSULTA, URL_DE_LAS_CONSULTAS,
  leerNotaNueva, comprobarNotaNueva, errorDeBorrarNota, queDecirDelAviso,
  encabezadoDeLaPregunta, sePuedePreguntarEn, TEXTO_DE_YA_LLEGO, TEXTO_DEL_SEGUIMIENTO,
  type NotaDeLaOT, type NotaNueva,
} from "./consultaDeRepuesto";
import { celdaDeObservacionPrevia, validarNota } from "./notas";
import { avisarAQuienDecide, textoDeLaInterrupcion } from "@/lib/core/avisoAlInstante";

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

describe("las preguntas que quedaron sin responder", () => {
  const ids = (notas: NotaDeLaOT[], estado: string | null = "POR_HACER") =>
    preguntasSinResponder(notas, estado).map((p) => p.id);

  // El diseño pide que una pregunta que se cierra sola no desaparezca: «queda
  // registrada como "quedó sin responder"». A la que le sacaron el repuesto se la
  // reconoce por el `repuesto_id` en null (la FK es `on delete set null`), y se
  // deriva de las filas como «abierta»: no hay una marca guardada.
  it("una pregunta a cuyo repuesto sacaron, y que nadie contestó, quedó sin responder", () => {
    expect(ids([pregunta({ repuesto_id: null })])).toEqual(["n1"]);
  });

  it("una que todavía espera no quedó sin responder: espera", () => {
    expect(ids([pregunta()])).toEqual([]);
  });

  // La RESPUESTA puede ser la de Compras o el «ya llegó» de quien preguntó: la misma
  // fila. Contestada, la pregunta tuvo su final aunque después le saquen el repuesto.
  it("una contestada no, aunque después le hayan sacado el repuesto", () => {
    const r = respuesta({ id: "n2", responde_a: "n1" });
    expect(ids([pregunta({ repuesto_id: null }), r])).toEqual([]);
  });

  // Un seguimiento la supera: el hilo sigue en la última, y es ésa la que queda sin
  // responder si el hilo termina así. Marcar también a la primera diría dos veces lo
  // mismo sobre una sola conversación.
  it("una superada por un seguimiento no: queda la última del hilo", () => {
    const primera = pregunta({ repuesto_id: null });
    const segunda = pregunta({ id: "n2", responde_a: "n1", repuesto_id: null });
    expect(ids([primera, segunda])).toEqual(["n2"]);
  });

  // La orden que ya no espera cierra sus preguntas por la misma cuenta que
  // `preguntasAbiertas` (los estados de `CERRADAS_GUT`), así que la que nadie había
  // contestado queda sin responder igual que si hubieran sacado el repuesto.
  it("en una orden suspendida o realizada, la que nadie contestó quedó sin responder", () => {
    for (const estado of ["SUSPENDIDA", "REALIZADO"]) {
      expect(ids([pregunta()], estado), estado).toEqual(["n1"]);
    }
  });

  it("y en esa misma orden, la que sí contestaron no", () => {
    const r = respuesta({ id: "n2", responde_a: "n1" });
    expect(ids([pregunta(), r], "SUSPENDIDA")).toEqual([]);
  });

  it("una justificación no es una pregunta", () => {
    expect(ids([pregunta({ tipo: "JUSTIFICACION", repuesto_id: null })])).toEqual([]);
  });

  // Igual que para «abierta»: una columna que el `select` no trajo llega como
  // `undefined`, y esa pregunta tiene que seguir a la vista como abierta, no
  // rotularse «sin responder» por un dato que no está.
  it("un repuesto_id que no vino en la fila no la da por sin responder", () => {
    const fila: Partial<NotaDeLaOT> = pregunta();
    delete fila.repuesto_id;
    expect(ids([fila as NotaDeLaOT])).toEqual([]);
  });

  // Cinco notas en las 120 formas de ordenarlas. `n2` es el final de un hilo que
  // nadie contestó, `n3` espera, `n4` se contestó (`n5`) y `n1` fue superada.
  it("de cualquier orden da lo mismo, y ninguna es a la vez abierta y sin responder", () => {
    const hilo = [
      pregunta({ id: "n1", repuesto_id: null }),
      pregunta({ id: "n2", repuesto_id: null, responde_a: "n1", creado_por: "u3" }),
      pregunta({ id: "n3", repuesto_id: "r2", creado_por: "u4" }),
      pregunta({ id: "n4", repuesto_id: null }),
      respuesta({ id: "n5", responde_a: "n4" }),
    ];
    let vistas = 0;
    for (const notas of permutaciones(hilo)) {
      expect(ids(notas), ordenDe(notas)).toEqual(["n2"]);

      const abiertas = preguntasAbiertas(notas, "POR_HACER").map((p) => p.id);
      expect(abiertas, ordenDe(notas)).toEqual(["n3"]);
      vistas++;
    }
    expect(vistas).toBe(120);
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

// ─────────────────────────────────────────────────────────────────────────────
// Preguntar desde la OT: lo que decide la ruta de notas y lo que dice la
// pantalla. La ruta y los componentes casi no tienen tests —hablan con la base y
// con React—, así que cada decisión que importa vive en una función pura de
// `consultaDeRepuesto.ts` y se prueba acá. Hay dos excepciones, y las dos prueban
// lo único que esto no puede ver: `rutaDeNotas.test.ts` (qué columnas lee la ruta
// y qué hace con lo que rechaza) e `historialDeLaOT.test.ts` (a qué entradas de la
// lista les ofrece «Ya llegó»).
// ─────────────────────────────────────────────────────────────────────────────

describe("lo que se le avisa a quien contesta", () => {
  const orden = { ot_number: 2885 };
  const rodamiento = { nombre: "Rodamiento 6206", codigo: "00473" };

  it("el push nombra la OT y el repuesto", () => {
    expect(itemDeLaConsulta(orden, rodamiento))
      .toEqual({ etiqueta: "OT 2885", descripcion: "Rodamiento 6206 · 00473" });
  });

  it("sin código, la descripción es el nombre solo", () => {
    expect(itemDeLaConsulta(orden, { nombre: "Correa B-75", codigo: null }).descripcion)
      .toBe("Correa B-75");
  });

  // El alta guarda el código recortado o en null, pero una fila que llegue de otro
  // lado con espacios no tiene que dejar «Correa B-75 ·   » en una notificación.
  it("un código en blanco se trata como ausente", () => {
    expect(itemDeLaConsulta(orden, { nombre: "Correa B-75", codigo: "   " }).descripcion)
      .toBe("Correa B-75");
  });

  it("una OT sin número no dice «OT null»", () => {
    expect(itemDeLaConsulta({ ot_number: null }, rodamiento).etiqueta).toBe("OT sin número");
  });

  // La frase sale entera de `NOMBRE_DE_LA_CONSULTA` y no de `avisoAlInstante`: lo
  // único que fija que este push diga «respuesta» y no «aprobación», y que lleve a
  // la bandeja de Compras, es este test. Se compara contra el texto literal, como
  // hacen los de `avisoAlInstante.test.ts`; la ruta usa estas mismas constantes,
  // así que no hay una copia que se pueda separar.
  it("la notificación entera dice lo que tiene que decir", () => {
    expect(
      textoDeLaInterrupcion(
        [itemDeLaConsulta(orden, rodamiento)], NOMBRE_DE_LA_CONSULTA, URL_DE_LAS_CONSULTAS
      )
    ).toEqual({
      title: "Una consulta espera tu respuesta",
      body: "OT 2885 · Rodamiento 6206 · 00473",
      url: "/compras/consultas",
    });
  });

  // El plural es otro `return` de `textoDeLaInterrupcion` y otro par de campos del
  // objeto: con el singular bien escrito y el plural copiado de «pedidos», este
  // test es el único que se entera.
  it("con varias, el plural también habla de consultas y de una respuesta", () => {
    expect(
      textoDeLaInterrupcion(
        [2885, 2886].map((n) => itemDeLaConsulta({ ot_number: n }, rodamiento)),
        NOMBRE_DE_LA_CONSULTA,
        URL_DE_LAS_CONSULTAS
      )
    ).toEqual({
      title: "2 consultas esperan tu respuesta",
      body: "OT 2885 y OT 2886",
      url: "/compras/consultas",
    });
  });

  // Review Focus 2: lo que va a la celda X pasa por textoParaLaCelda. La planilla
  // escribe con USER_ENTERED, y un `=IMPORTRANGE(...)` tipeado en una pregunta es lo
  // que el 19/10 dejó once pestañas de Compras en blanco.
  it("una pregunta que arranca con = no viaja como formula", () => {
    expect(celdaDeObservacionPrevia("=IMPORTRANGE(...)").valor).toMatch(/^'/);
  });

  // Los dos textos que arma el sistema y la persona no tipea. Si alguno arrancara
  // con un carácter que la planilla interpreta, viajaría con el apóstrofo; si dejara
  // de ser una nota válida, el botón «ya llegó» devolvería un 400.
  it("lo que escribe el sistema es una nota válida y va a la planilla tal cual", () => {
    for (const texto of [TEXTO_DE_YA_LLEGO, TEXTO_DEL_SEGUIMIENTO]) {
      expect(validarNota(texto).ok, texto).toBe(true);
      expect(celdaDeObservacionPrevia(texto).valor, texto).toBe(texto);
    }
  });
});

describe("en qué estados se ofrece preguntar", () => {
  it("por hacer y atrasada sí", () => {
    expect(sePuedePreguntarEn("POR_HACER")).toBe(true);
    expect(sePuedePreguntarEn("ATRASADO")).toBe(true);
  });

  // `EN_PROCESO` queda afuera por pedido del diseño, aunque `preguntasAbiertas` la
  // cuente como abierta: una cosa es cuándo se ofrece abrir una pregunta y otra
  // cuándo una pregunta que ya existe deja de esperar.
  it("en proceso, realizada y suspendida no", () => {
    for (const estado of ["EN_PROCESO", "REALIZADO", "SUSPENDIDA"]) {
      expect(sePuedePreguntarEn(estado), estado).toBe(false);
    }
  });

  // Sin estado no se ofrece: es un botón, y un botón que interrumpe a una persona no
  // se muestra «por las dudas». Al revés que esconder una pregunta ya hecha.
  it("sin estado, o con uno que no conocemos, no se ofrece", () => {
    for (const estado of [null, undefined, "", "CUALQUIER_COSA"]) {
      expect(sePuedePreguntarEn(estado), String(estado)).toBe(false);
    }
  });

  it("no distingue mayúsculas ni espacios", () => {
    expect(sePuedePreguntarEn(" por_hacer ")).toBe(true);
    expect(sePuedePreguntarEn("Atrasado")).toBe(true);
  });
});

describe("la pregunta que se escribe", () => {
  const rodamiento = { nombre: "Rodamiento 6206", codigo: "00473" };
  const ri = (...nros: number[]) => nros.map((nro_ri) => ({ nro_ri }));

  it("arranca nombrando el repuesto, con su código", () => {
    expect(encabezadoDeLaPregunta(rodamiento, undefined)).toBe("Rodamiento 6206 (00473): ");
  });

  it("sin código, sólo el nombre", () => {
    expect(encabezadoDeLaPregunta({ nombre: "Correa B-75", codigo: null }, undefined))
      .toBe("Correa B-75: ");
  });

  it("sin ningún RI en curso no inventa uno", () => {
    expect(encabezadoDeLaPregunta(rodamiento, { porCodigo: [], porNombre: [] }))
      .toBe("Rodamiento 6206 (00473): ");
  });

  it("con un RI que coincide por código, lleva su número", () => {
    expect(encabezadoDeLaPregunta(rodamiento, { porCodigo: ri(1842), porNombre: [] }))
      .toBe("Rodamiento 6206 (00473) · RI 1842: ");
  });

  // El 00473 llegó a tener cuatro pedidos en vuelo a la vez. Contestar empieza por
  // saber de cuál se habla, así que van todos y en el orden en que vinieron.
  it("con varios, los lleva todos", () => {
    expect(encabezadoDeLaPregunta(rodamiento, { porCodigo: ri(1860, 1855, 1842), porNombre: [] }))
      .toBe("Rodamiento 6206 (00473) · RI 1860, RI 1855, RI 1842: ");
  });

  // Coincidir por el nombre es texto libre que escribió gente distinta: la pantalla
  // dice «puede que ya esté pedido» y la pregunta tiene que decir lo mismo. «RI
  // 1842» a secas afirmaría un pedido que quien pregunta no sabe que sea ése.
  it("un RI que sólo coincide por el nombre se dice «posible»", () => {
    expect(encabezadoDeLaPregunta(rodamiento, { porCodigo: [], porNombre: ri(1842) }))
      .toBe("Rodamiento 6206 (00473) · posible RI 1842: ");
  });

  it("con los dos, primero el seguro", () => {
    expect(encabezadoDeLaPregunta(rodamiento, { porCodigo: ri(1842), porNombre: ri(1850, 1851) }))
      .toBe("Rodamiento 6206 (00473) · RI 1842 · posible RI 1850, RI 1851: ");
  });

  // La bandeja de Compras muestra la última pregunta de cada hilo, no la primera: un
  // seguimiento tiene que decir de qué pieza habla sin apoyarse en la anterior.
  it("el seguimiento lleva el mismo encabezado y no hace falta repetirlo", () => {
    const encabezado = encabezadoDeLaPregunta(rodamiento, { porCodigo: ri(1842), porNombre: [] });
    expect(`${encabezado}${TEXTO_DEL_SEGUIMIENTO}`)
      .toBe("Rodamiento 6206 (00473) · RI 1842: Sigue sin llegar.");
  });
});

describe("leer el cuerpo de una nota nueva", () => {
  const justificacion = { tipo: "JUSTIFICACION", repuesto_id: null, responde_a: null };

  // Lo que manda hoy `JustificacionOT`: sólo el texto. Tiene que seguir andando
  // igual con el cuerpo viejo.
  it("sin tipo es una justificación, como hasta ahora", () => {
    expect(leerNotaNueva({ texto: "falta el repuesto" })).toEqual({ ok: true, nota: justificacion });
  });

  it("un cuerpo que no es un objeto se lee como el de siempre", () => {
    for (const cuerpo of [null, undefined, "x", 42]) {
      expect(leerNotaNueva(cuerpo), String(cuerpo)).toEqual({ ok: true, nota: justificacion });
    }
  });

  it("un tipo que no es de la lista se rechaza", () => {
    for (const tipo of ["PREGUNTAS", "pregunta", "", 3, {}]) {
      const r = leerNotaNueva({ tipo });
      expect(r.ok, String(tipo)).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.error).toContain("PREGUNTA");
      }
    }
  });

  it("una pregunta lleva el repuesto de que se pregunta", () => {
    expect(leerNotaNueva({ tipo: "PREGUNTA", repuesto_id: "r1" })).toEqual({
      ok: true,
      nota: { tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null },
    });
  });

  // La pregunta nace de un repuesto concreto: de eso depende que se cierre sola
  // cuando lo sacan de la lista. Sin id, `preguntasAbiertas` la daría por cerrada
  // desde que nace —un `repuesto_id` en null es «sacaron el repuesto»—.
  it("una pregunta sin repuesto se rechaza", () => {
    for (const repuesto_id of [undefined, null, "", "   "]) {
      const r = leerNotaNueva({ tipo: "PREGUNTA", repuesto_id });
      expect(r.ok, String(repuesto_id)).toBe(false);
      if (!r.ok) expect(r.error).toContain("repuesto");
    }
  });

  it("un seguimiento es una pregunta que además apunta a otra", () => {
    expect(leerNotaNueva({ tipo: "PREGUNTA", repuesto_id: "r1", responde_a: "n1" })).toEqual({
      ok: true,
      nota: { tipo: "PREGUNTA", repuesto_id: "r1", responde_a: "n1" },
    });
  });

  it("una respuesta apunta a la pregunta que contesta, y no lleva repuesto", () => {
    expect(leerNotaNueva({ tipo: "RESPUESTA", responde_a: "n1" })).toEqual({
      ok: true,
      nota: { tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1" },
    });
  });

  it("una respuesta sin pregunta se rechaza", () => {
    for (const responde_a of [undefined, null, ""]) {
      const r = leerNotaNueva({ tipo: "RESPUESTA", responde_a });
      expect(r.ok, String(responde_a)).toBe(false);
      if (!r.ok) expect(r.error).toContain("pregunta");
    }
  });

  // El repuesto es de la pregunta. Una respuesta que lo repitiera sería un segundo
  // dato para algo que ya está dicho, y se puede separar del de la pregunta.
  it("una respuesta con repuesto se rechaza", () => {
    expect(leerNotaNueva({ tipo: "RESPUESTA", responde_a: "n1", repuesto_id: "r1" }).ok).toBe(false);
  });

  // Una justificación que apunta a otra nota la traba: `responde_a` no borra en
  // cascada, y ese borrado daría 23503 sin que nadie sepa por qué.
  it("una justificación no lleva repuesto ni apunta a otra nota", () => {
    expect(leerNotaNueva({ tipo: "JUSTIFICACION", repuesto_id: "r1" }).ok).toBe(false);
    expect(leerNotaNueva({ tipo: "JUSTIFICACION", responde_a: "n1" }).ok).toBe(false);
    expect(leerNotaNueva({ repuesto_id: "r1" }).ok).toBe(false);
  });

  it("un id que no es un texto se rechaza, y uno con espacios se recorta", () => {
    expect(leerNotaNueva({ tipo: "PREGUNTA", repuesto_id: 7 }).ok).toBe(false);
    expect(leerNotaNueva({ tipo: "PREGUNTA", repuesto_id: "r1", responde_a: {} }).ok).toBe(false);
    expect(leerNotaNueva({ tipo: "PREGUNTA", repuesto_id: "  r1  " }))
      .toMatchObject({ ok: true, nota: { repuesto_id: "r1" } });
  });
});

describe("comprobar una nota nueva contra la orden", () => {
  // Los repuestos de ESTA orden. `r-ajeno` no está: es de otra.
  const repuestos = [
    { id: "r1", nombre: "Rodamiento 6206", codigo: "00473" },
    { id: "r2", nombre: "Correa B-75", codigo: null },
  ];
  const contexto = (notas: NotaDeLaOT[] = [], estadoDeLaOrden: string | null = "POR_HACER") =>
    ({ estadoDeLaOrden, notas, repuestos });
  const preguntar = (n: Partial<NotaNueva> = {}): NotaNueva =>
    ({ tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null, ...n });
  const responder = (responde_a: string): NotaNueva =>
    ({ tipo: "RESPUESTA", repuesto_id: null, responde_a });
  const rechazada = (status: 400 | 409, error: RegExp) =>
    ({ ok: false, status, error: expect.stringMatching(error) });

  describe("una pregunta nueva", () => {
    it("sobre un repuesto de la orden entra, y devuelve el repuesto para el push", () => {
      expect(comprobarNotaNueva(preguntar(), contexto()))
        .toEqual({ ok: true, repuesto: repuestos[0] });
    });

    // Sin esto el id de cualquier repuesto de cualquier orden entraría: la pregunta
    // se guardaría colgando de un repuesto ajeno y la bandeja de Compras nombraría
    // una pieza que esta orden no pidió.
    it("sobre un repuesto que no es de esta orden se rechaza", () => {
      expect(comprobarNotaNueva(preguntar({ repuesto_id: "r-ajeno" }), contexto()))
        .toEqual(rechazada(400, /repuesto/));
    });

    // La regla del diseño, defendida del lado del servidor: la pantalla puede estar
    // vieja, y dos personas con la misma orden abierta abren dos hilos de la misma
    // pieza —dos entradas en la bandeja de Compras que dicen lo mismo—.
    it("con una abierta sobre ese repuesto, otra nueva se rechaza", () => {
      expect(comprobarNotaNueva(preguntar(), contexto([pregunta()])))
        .toEqual(rechazada(409, /ya hay una pregunta abierta/i));
    });

    it("pero sobre otro repuesto de la misma orden sí entra", () => {
      expect(comprobarNotaNueva(preguntar({ repuesto_id: "r2" }), contexto([pregunta()])))
        .toEqual({ ok: true, repuesto: repuestos[1] });
    });

    // Una ya contestada no cuenta: el botón vuelve a poder abrir un hilo nuevo.
    it("si la anterior ya está contestada, entra", () => {
      const r = respuesta({ id: "n2", responde_a: "n1" });
      expect(comprobarNotaNueva(preguntar(), contexto([pregunta(), r])).ok).toBe(true);
    });

    it("sobre una orden realizada o suspendida se rechaza: nace cerrada", () => {
      for (const estado of ["REALIZADO", "SUSPENDIDA"]) {
        expect(comprobarNotaNueva(preguntar(), contexto([], estado)), estado)
          .toEqual(rechazada(409, /ya no espera/i));
      }
    });

    // Lo que el servidor rechaza es lo que `preguntasAbiertas` daría por cerrado, y
    // nada más: «por hacer o atrasada» es la regla de lo que se OFRECE (la
    // pantalla), no de lo que está bien o mal guardado.
    it("sobre una orden en proceso entra: ahí la pregunta no nace cerrada", () => {
      expect(comprobarNotaNueva(preguntar(), contexto([], "EN_PROCESO")).ok).toBe(true);
    });
  });

  describe("un seguimiento", () => {
    // El seguimiento apunta a la pregunta que está abierta, no a la primera.
    it("apuntando a la pregunta abierta entra", () => {
      expect(comprobarNotaNueva(preguntar({ responde_a: "n1" }), contexto([pregunta()])))
        .toEqual({ ok: true, repuesto: repuestos[0] });
    });

    // Con tres en un hilo, un seguimiento que apunta a la primera dejaría abiertas
    // a las dos últimas (medido en `preguntasAbiertas`: `["n2","n3"]` y no `["n3"]`).
    // La pantalla apunta bien; esto es lo que lo cuida cuando la pantalla es vieja.
    it("apuntando a la primera de un hilo que ya tiene seguimiento, se rechaza", () => {
      const hilo = [pregunta(), pregunta({ id: "n2", responde_a: "n1" })];
      expect(comprobarNotaNueva(preguntar({ responde_a: "n1" }), contexto(hilo)))
        .toEqual(rechazada(409, /última del hilo/i));
      expect(comprobarNotaNueva(preguntar({ responde_a: "n2" }), contexto(hilo)).ok).toBe(true);
    });

    it("de una pregunta que ya tiene respuesta, se rechaza", () => {
      const hilo = [pregunta(), respuesta({ id: "n2", responde_a: "n1" })];
      expect(comprobarNotaNueva(preguntar({ responde_a: "n1" }), contexto(hilo)))
        .toEqual(rechazada(409, /última del hilo/i));
    });

    // Una nota que apunta a otra orden traba el borrado de esa otra (`23503`), y el
    // borrado de espejo borra OT de a 200: la tanda entera fallaría en cada corrida.
    it("apuntando a una nota que no es de esta orden, se rechaza", () => {
      expect(comprobarNotaNueva(preguntar({ responde_a: "n-de-otra-orden" }), contexto([pregunta()])))
        .toEqual(rechazada(400, /no es de esta orden/i));
    });

    it("apuntando a algo que no es una pregunta, se rechaza", () => {
      const nota = pregunta({ id: "n2", tipo: "JUSTIFICACION" });
      expect(comprobarNotaNueva(preguntar({ responde_a: "n2" }), contexto([nota])))
        .toEqual(rechazada(400, /pregunta/i));
    });
  });

  describe("una respuesta", () => {
    it("a la pregunta abierta entra, y no lleva repuesto para el push", () => {
      expect(comprobarNotaNueva(responder("n1"), contexto([pregunta()])))
        .toEqual({ ok: true, repuesto: null });
    });

    // Review Focus 3, del lado del «ya llegó»: si Compras contestó con una pantalla
    // abierta, la segunda respuesta no duplica el hilo.
    it("a una pregunta que ya tiene respuesta, se rechaza", () => {
      const hilo = [pregunta(), respuesta({ id: "n2", responde_a: "n1" })];
      expect(comprobarNotaNueva(responder("n1"), contexto(hilo)))
        .toEqual(rechazada(409, /ya no está abierta/i));
    });

    // Un «ya llegó» sobre una pregunta superada no cierra el hilo —el seguimiento
    // sigue abierto— y la pantalla no lo ofrece ahí.
    it("a una pregunta superada por un seguimiento, se rechaza", () => {
      const hilo = [pregunta(), pregunta({ id: "n2", responde_a: "n1" })];
      expect(comprobarNotaNueva(responder("n1"), contexto(hilo)))
        .toEqual(rechazada(409, /ya no está abierta/i));
      expect(comprobarNotaNueva(responder("n2"), contexto(hilo)).ok).toBe(true);
    });

    it("en una orden que ya no espera nada, se rechaza", () => {
      for (const estado of ["REALIZADO", "SUSPENDIDA"]) {
        expect(comprobarNotaNueva(responder("n1"), contexto([pregunta()], estado)), estado)
          .toEqual(rechazada(409, /ya no está abierta/i));
      }
    });

    it("a una nota que no es de esta orden, se rechaza", () => {
      expect(comprobarNotaNueva(responder("n-de-otra-orden"), contexto([pregunta()])))
        .toEqual(rechazada(400, /no es de esta orden/i));
    });

    it("a algo que no es una pregunta, se rechaza", () => {
      const nota = pregunta({ id: "n2", tipo: "JUSTIFICACION" });
      expect(comprobarNotaNueva(responder("n2"), contexto([nota])))
        .toEqual(rechazada(400, /pregunta/i));
    });
  });

  // Lo que ya andaba no se toca: una justificación no se refiere a nada, así que no
  // hay nada contra qué comprobarla ni hace falta leer más tablas para escribirla.
  it("una justificación pasa sin mirar nada", () => {
    const justificacion: NotaNueva = { tipo: "JUSTIFICACION", repuesto_id: null, responde_a: null };
    expect(comprobarNotaNueva(justificacion, { estadoDeLaOrden: "REALIZADO", notas: [], repuestos: [] }))
      .toEqual({ ok: true, repuesto: null });
  });

  // La ruta trae las notas con `order creado_en desc`, y otro lugar las puede traer
  // al revés. Las cuatro del hilo, en las 24 formas de ordenarlas: el veredicto es el
  // mismo, porque «abierta» no mira el orden.
  it("el orden en que vienen las notas no cambia el veredicto", () => {
    const hilo = [
      pregunta({ id: "n1", creado_en: "2026-10-29T10:00:00Z" }),
      pregunta({ id: "n2", responde_a: "n1", creado_en: "2026-10-29T11:00:00Z" }),
      respuesta({ id: "n3", responde_a: "n2", creado_en: "2026-10-29T12:00:00Z" }),
      pregunta({ id: "n4", repuesto_id: "r2", creado_en: "2026-10-29T13:00:00Z" }),
    ];
    for (const notas of permutaciones(hilo)) {
      const donde = ordenDe(notas);
      // r1 quedó contestada: se puede abrir un hilo nuevo.
      expect(comprobarNotaNueva(preguntar(), contexto(notas)).ok, donde).toBe(true);
      // r2 tiene la n4 abierta: otra nueva se rechaza, y el seguimiento a ella entra.
      expect(comprobarNotaNueva(preguntar({ repuesto_id: "r2" }), contexto(notas)).ok, donde).toBe(false);
      expect(comprobarNotaNueva(preguntar({ repuesto_id: "r2", responde_a: "n4" }), contexto(notas)).ok, donde)
        .toBe(true);
      // n2 ya está contestada y n4 sigue abierta.
      expect(comprobarNotaNueva(responder("n2"), contexto(notas)).ok, donde).toBe(false);
      expect(comprobarNotaNueva(responder("n4"), contexto(notas)).ok, donde).toBe(true);
    }
  });
});

describe("borrar una nota a la que otra apunta", () => {
  // `responde_a` no borra en cascada: la base se niega con 23503 a borrar una nota a
  // la que otra apunta, y eso es lo que impide que quien preguntó se lleve la
  // respuesta de Compras al borrar su pregunta. Sin traducir, llegaba a la pantalla
  // como el mensaje crudo de Postgres.
  it("el 23503 que devuelve la base es un 409 que se entiende", () => {
    const r = errorDeBorrarNota({
      code: "23503",
      message:
        'update or delete on table "ordenes_trabajo_notas" violates foreign key ' +
        'constraint "ordenes_trabajo_notas_responde_a_fkey" on table "ordenes_trabajo_notas"',
    });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/responde|seguimiento/i);
    expect(r.error).not.toMatch(/foreign key|violates|constraint/i);
  });

  // Cualquier otro error sigue como estaba: el mensaje de la base y un 400. No se
  // traduce lo que no se sabe qué es.
  it("cualquier otro error pasa como estaba", () => {
    expect(errorDeBorrarNota({ code: "42501", message: "permission denied" }))
      .toEqual({ status: 400, error: "permission denied" });
    expect(errorDeBorrarNota({ message: "algo se cortó" }))
      .toEqual({ status: 400, error: "algo se cortó" });
  });
});

describe("lo que se le dice a quien pregunta", () => {
  // Un solo ítem, de un solo repuesto: es lo que manda la ruta.
  const items = [{ etiqueta: "OT 2885", descripcion: "Rodamiento 6206 · 00473" }];
  const MEDIODIA = new Date("2026-10-30T15:00:00Z"); // 12:00 en Argentina
  const MADRUGADA = new Date("2026-10-30T06:00:00Z"); // 03:00 en Argentina

  // `avisarAQuienDecide` lee la lista con `from(lista).select("usuario_id")` y, si
  // está vacía, corta ahí: no toca `push_suscripciones` ni manda nada.
  const sinConsultados = {
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  } as unknown as SupabaseClient;

  const avisar = (ahora: Date) =>
    avisarAQuienDecide(sinConsultados, {
      lista: "compras_consultados",
      items,
      nombre: NOMBRE_DE_LA_CONSULTA,
      url: URL_DE_LAS_CONSULTAS,
      ahora,
    });

  // Review Focus 1. Se prueba con lo que contesta la función de verdad y no con un
  // `motivo` escrito a mano: si alguien cambia la palabra allá, este test lo dice, y
  // no una pantalla que calla justo el caso que el diseño pide que se vea.
  it("con la lista vacía lo dice: se guardó, pero no hay nadie para contestar", async () => {
    const aviso = await avisar(MEDIODIA);
    expect(aviso.motivo).toBe("nadie aprueba");

    const dicho = queDecirDelAviso(aviso);
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("Se guardó, pero no hay nadie configurado para contestar");
  });

  it("de noche lo dice: se guardó, y Compras la ve al abrir sus consultas", async () => {
    const aviso = await avisar(MADRUGADA);
    expect(aviso.motivo).toBe("fuera de hora");

    const dicho = queDecirDelAviso(aviso);
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("Se guardó");
    expect(dicho.texto).toContain("a esta hora no se avisa");
  });

  it("cuando salió el aviso, lo confirma", () => {
    const dicho = queDecirDelAviso({ enviadas: 2, personas: 1 });
    expect(dicho.llego).toBe(true);
    expect(dicho.texto).toContain("quedó guardada");
  });

  it("sin aparatos o con la cuenta dada de baja, dice cuál de las dos", () => {
    expect(queDecirDelAviso({ enviadas: 0, personas: 0, motivo: "nadie suscripto" }).texto)
      .toContain("notificaciones");
    expect(queDecirDelAviso({ enviadas: 0, personas: 0, motivo: "nadie activo" }).texto)
      .toContain("dada de baja");
  });

  // Se intentó y ningún aparato lo recibió: sin `motivo`, pero tampoco es éxito.
  it("si se intentó y no llegó a ningún aparato, no lo da por entregado", () => {
    const dicho = queDecirDelAviso({ enviadas: 0, personas: 1 });
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("ningún aparato");
  });

  // Un fallo de verdad —el push service caído— llega como el mensaje de lo que
  // falló, y se muestra tal cual: un diagnóstico traducido a algo vago es el que
  // costó una tarde en las planillas.
  it("un fallo que no conocemos se muestra tal cual lo dijo", () => {
    const dicho = queDecirDelAviso({ enviadas: 0, personas: 0, motivo: "connect ECONNREFUSED 10.0.0.1:443" });
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("connect ECONNREFUSED 10.0.0.1:443");
  });

  // Una ruta vieja, o una pregunta que no pasó por el aviso: no hay nada que decir
  // del push, pero la pregunta sí se guardó.
  it("sin información del aviso, dice sólo que se guardó", () => {
    for (const aviso of [null, undefined]) {
      const dicho = queDecirDelAviso(aviso);
      expect(dicho.llego).toBe(false);
      expect(dicho.texto).toContain("guardada");
    }
  });

  it("ningún resultado deja un texto vacío", () => {
    const resultados = [
      { enviadas: 1, personas: 1 },
      { enviadas: 0, personas: 1 },
      { enviadas: 0, personas: 0, motivo: "nadie aprueba" },
      { enviadas: 0, personas: 0, motivo: "fuera de hora" },
      { enviadas: 0, personas: 0, motivo: "nadie suscripto" },
      { enviadas: 0, personas: 0, motivo: "nadie activo" },
      { enviadas: 0, personas: 0, motivo: "nada que avisar" },
      { enviadas: 0, personas: 0, motivo: "cualquier otra cosa" },
    ];
    for (const r of resultados) expect(queDecirDelAviso(r).texto.trim().length, JSON.stringify(r)).toBeGreaterThan(10);
  });
});
