import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  puedeResponderConsulta, aQuienAvisarDeLaRespuesta, bandejaDeConsultas,
  preguntasQueEsperan,
  avisoDeLaRespuesta, urlDeLaOrden, queDecirDeLaRespuesta, cambiarRespuesta,
  TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA,
  type NotaDeLaBandeja, type OrdenConsultada, type RepuestoConsultado,
} from "./consultas";
import { TIPOS_DE_NOTA } from "@/lib/mantenimiento/consultaDeRepuesto";
import { avisarAUnaPersona } from "@/lib/core/avisoAUnaPersona";

const pregunta = (p: Partial<NotaDeLaBandeja> = {}): NotaDeLaBandeja => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Qué pasa con el rodamiento?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "u1", autor: { nombre: "Ana" },
  repuesto_id: "r1", responde_a: null, ...p,
});

/** La RESPUESTA de Compras: de otra persona y sin repuesto, que es el de la pregunta. */
const respuesta = (p: Partial<NotaDeLaBandeja> = {}): NotaDeLaBandeja =>
  pregunta({
    id: "n2", tipo: "RESPUESTA", texto: "Lo entrega el jueves", creado_por: "u2",
    autor: { nombre: "Facundo" }, repuesto_id: null, responde_a: "n1", ...p,
  });

const orden = (p: Partial<OrdenConsultada> = {}): OrdenConsultada => ({
  id: "ot1", ot_number: 2885, descripcion: "Pérdida en el filler", estado: "POR_HACER", ...p,
});

const REPUESTOS: RepuestoConsultado[] = [
  { id: "r1", nombre: "Rodamiento 6206", codigo: "00473" },
  { id: "r2", nombre: "Correa B-75", codigo: null },
];

/** Lo más largo que `validarNota` deja escribir: es lo que puede llegar al push. */
const MIL_CARACTERES = 1000;

describe("quién puede contestar", () => {
  it("sin acceso a Compras no se contesta aunque la pregunta esté abierta", () => {
    expect(puedeResponderConsulta({ accesoCompras: false }, { id: "n1" })).toBe(false);
  });

  // La decisión del diseño: contestar NO pide nivel de edición en Mantenimiento.
  it("con acceso a Compras se contesta, sin permiso de Mantenimiento", () => {
    expect(puedeResponderConsulta({ accesoCompras: true }, { id: "n1" })).toBe(true);
  });

  it("una pregunta que ya no está abierta no se vuelve a contestar", () => {
    expect(puedeResponderConsulta({ accesoCompras: true }, null)).toBe(false);
  });
});

describe("a quién se le avisa de la respuesta", () => {
  it("le avisa a quien preguntó", () => {
    expect(aQuienAvisarDeLaRespuesta({ creado_por: "ana" }, { id: "facundo" })).toBe("ana");
  });

  // Alguien con acceso a las dos puntas contesta su propia pregunta: avisarle de lo
  // que acaba de escribir es la notificación que enseña a ignorar las demás.
  it("no se avisa a sí mismo: quien tiene las dos puntas se contesta solo", () => {
    expect(aQuienAvisarDeLaRespuesta({ creado_por: "ana" }, { id: "ana" })).toBe(null);
  });

  // `creado_por` es nullable en la base: sin esto, `avisarAUnaPersona` recibiría null.
  it("una pregunta sin autor no avisa a nadie, y no rompe", () => {
    expect(aQuienAvisarDeLaRespuesta({ creado_por: null }, { id: "facundo" })).toBe(null);
  });

  /*
   * Y el caso que el tipo no alcanza a cubrir: una columna que el `select` no trajo
   * llega `undefined`, no `null`. Con un `=== null` pelado, eso devolvería `undefined`
   * como destinatario y la ruta le mandaría un push a nadie —`avisarAUnaPersona` pide
   * un `string`, así que el error aparecería recién en la consulta a la base, o en
   * silencio—. Es la decisión opuesta a la de `preguntasAbiertas`, que ante una columna
   * que no vino prefiere mostrar de más; acá mostrar de más es interrumpir a alguien.
   */
  it("una pregunta a la que el select no le trajo el autor tampoco avisa", () => {
    const sinLaColumna = {} as { creado_por: string | null };
    expect(aQuienAvisarDeLaRespuesta(sinLaColumna, { id: "facundo" })).toBe(null);
    expect(aQuienAvisarDeLaRespuesta({ creado_por: "" }, { id: "facundo" })).toBe(null);
  });
});

/*
 * Juntar cada nota con SU orden es lo que la bandeja y el conteo del resumen
 * diario tienen en común, y es el único lugar del sistema donde las notas de
 * varias órdenes se miran juntas. Está probado acá, aparte de la bandeja, porque
 * desde el 31/10/2026 lo usan dos: escribirlo una segunda vez para contar habría
 * sido una segunda definición de «abierta», que es justo lo que
 * `consultaDeRepuesto.ts` existe para que no pase.
 */
describe("qué preguntas esperan, de todas las órdenes a la vez", () => {
  it("devuelve cada pregunta abierta con la orden que le toca", () => {
    const esperan = preguntasQueEsperan([pregunta()], [orden()]);

    expect(esperan).toHaveLength(1);
    expect(esperan[0].pregunta.id).toBe("n1");
    expect(esperan[0].orden.ot_number).toBe(2885);
  });

  /*
   * La trampa, y la razón de que esto sea una función: «abierta» depende de las
   * notas de UNA orden y del estado de ESA orden. Con todas las notas y un solo
   * estado, la pregunta de una orden realizada se cuenta como abierta porque otra
   * orden sigue por hacer. No tira ningún error: devuelve un número plausible.
   */
  it("cada orden se juzga con SU estado", () => {
    const notas = [
      pregunta({ id: "n1", orden_id: "porHacer" }),
      pregunta({ id: "n2", orden_id: "realizada" }),
      pregunta({ id: "n3", orden_id: "suspendida" }),
    ];
    const ordenes = [
      orden({ id: "porHacer", estado: "POR_HACER" }),
      orden({ id: "realizada", estado: "REALIZADO" }),
      orden({ id: "suspendida", estado: "SUSPENDIDA" }),
    ];

    expect(preguntasQueEsperan(notas, ordenes).map((e) => e.pregunta.id)).toEqual(["n1"]);
  });

  /*
   * Y la trampa por el otro lado: una pregunta juzgada sola —sin las demás notas de
   * su orden— no la cierra nada nunca, porque su respuesta y su seguimiento están en
   * otras filas. Contando así, el número sube para siempre y el aviso se vuelve ruido.
   */
  it("la respuesta y el seguimiento cierran aunque estén en otras filas", () => {
    const contestada = [pregunta(), respuesta()];
    expect(preguntasQueEsperan(contestada, [orden()])).toEqual([]);

    const conSeguimiento = [pregunta(), pregunta({ id: "n3", responde_a: "n1" })];
    expect(preguntasQueEsperan(conSeguimiento, [orden()]).map((e) => e.pregunta.id)).toEqual(["n3"]);
  });

  it("una nota cuya orden no vino no se cuelga de ninguna", () => {
    expect(preguntasQueEsperan([pregunta({ orden_id: "no-vino" })], [orden()])).toEqual([]);
  });

  it("no toca lo que recibe", () => {
    const notas = [pregunta(), respuesta()];
    const ordenes = [orden()];
    const copiaNotas = notas.map((n) => ({ ...n }));
    const copiaOrdenes = ordenes.map((o) => ({ ...o }));

    preguntasQueEsperan(notas, ordenes);
    expect(notas).toEqual(copiaNotas);
    expect(ordenes).toEqual(copiaOrdenes);
  });
});

describe("la bandeja de Compras", () => {
  it("trae la pregunta abierta con su orden y su repuesto", () => {
    const bandeja = bandejaDeConsultas([pregunta()], [orden()], REPUESTOS);

    expect(bandeja).toHaveLength(1);
    expect(bandeja[0]).toMatchObject({
      id: "n1",
      texto: "¿Qué pasa con el rodamiento?",
      creado_en: "2026-10-29T10:00:00Z",
      autor: "Ana",
      orden: { id: "ot1", ot_number: 2885, descripcion: "Pérdida en el filler" },
      repuesto: { id: "r1", nombre: "Rodamiento 6206", codigo: "00473" },
    });
  });

  /*
   * LA TRAMPA DE ESTA FUNCIÓN, y la razón por la que existe.
   *
   * «Abierta» depende de las notas de UNA orden y del estado de ESA orden
   * —`preguntasAbiertas` lo deja escrito—. La bandeja mira varias a la vez, así que
   * es el único lugar del sistema donde se pueden cruzar: con todas las notas y un
   * solo estado, la pregunta de una orden realizada aparecería abierta porque otra
   * orden sigue por hacer, y la de una orden por hacer desaparecería porque otra se
   * realizó. No tira ningún error: se ve igual que una bandeja correcta.
   */
  it("cada orden se juzga con SU estado y no con el de otra", () => {
    const notas = [
      pregunta({ id: "n1", orden_id: "porHacer" }),
      pregunta({ id: "n2", orden_id: "realizada" }),
    ];
    const ordenes = [
      orden({ id: "porHacer", ot_number: 1, estado: "POR_HACER" }),
      orden({ id: "realizada", ot_number: 2, estado: "REALIZADO" }),
    ];

    expect(bandejaDeConsultas(notas, ordenes, REPUESTOS).map((c) => c.id)).toEqual(["n1"]);
  });

  /*
   * Y la trampa por el otro lado: si cada pregunta se juzgara sola —sin las demás
   * notas de su orden— nada la cerraría nunca, porque su respuesta y su seguimiento
   * están en otras filas. La bandeja quedaría llena de conversaciones terminadas,
   * que es el anti-objetivo del diseño.
   */
  it("una pregunta ya contestada no está en la bandeja", () => {
    expect(bandejaDeConsultas([pregunta(), respuesta()], [orden()], REPUESTOS)).toEqual([]);
  });

  it("de un hilo con seguimiento queda sólo la última", () => {
    const seguimiento = pregunta({ id: "n3", responde_a: "n1", texto: "Sigue sin llegar." });
    const bandeja = bandejaDeConsultas([pregunta(), seguimiento], [orden()], REPUESTOS);

    expect(bandeja.map((c) => c.id)).toEqual(["n3"]);
  });

  // La más vieja arriba: es la que lleva más tiempo esperando, y la razón por la que
  // esta pantalla existe. La más nueva primero escondería justamente la que se olvidó.
  it("las ordena de la que más espera a la que menos", () => {
    const notas = [
      pregunta({ id: "nueva", creado_en: "2026-10-30T10:00:00Z", repuesto_id: "r2" }),
      pregunta({ id: "vieja", creado_en: "2026-10-20T10:00:00Z" }),
    ];

    expect(bandejaDeConsultas(notas, [orden()], REPUESTOS).map((c) => c.id))
      .toEqual(["vieja", "nueva"]);
  });

  /*
   * Una fecha que no se puede leer no puede esconder la fila ni desordenar el resto.
   * Cuenta como la más vieja y va primero: es la que menos se sabe y la que más
   * conviene mirar. Dejarla en `NaN` sería peor que ponerla en cualquier lado —un
   * comparador que devuelve `NaN` deja el orden de los demás librado al motor—, y
   * eso es exactamente lo que el orden fijado acá impide.
   */
  it("una fecha ilegible va primero y no desordena a las demás", () => {
    const notas = [
      pregunta({ id: "buena", creado_en: "2026-10-20T10:00:00Z" }),
      pregunta({ id: "rota", creado_en: "no es una fecha", repuesto_id: "r2" }),
    ];

    expect(bandejaDeConsultas(notas, [orden()], REPUESTOS).map((c) => c.id))
      .toEqual(["rota", "buena"]);
  });

  /*
   * Una nota cuya orden no vino en la lectura no se puede mostrar: no hay número de
   * OT que poner ni estado con el que decidir si todavía espera. Se descarta en vez
   * de inventarle una orden, y por eso la lectura de la ruta tiene que traer las
   * órdenes de TODAS las notas que trajo.
   */
  it("una nota sin su orden no se cuelga de ninguna", () => {
    const notas = [pregunta({ orden_id: "una-que-no-vino" })];
    expect(bandejaDeConsultas(notas, [orden()], REPUESTOS)).toEqual([]);
  });

  // No debería pasar —la FK es `on delete set null`, y un repuesto en null cierra la
  // pregunta—, pero esconder una pregunta que espera es peor que mostrarla sin pieza.
  it("un repuesto que no vino deja la consulta igual, sin pieza", () => {
    const bandeja = bandejaDeConsultas([pregunta({ repuesto_id: "r9" })], [orden()], REPUESTOS);

    expect(bandeja).toHaveLength(1);
    expect(bandeja[0].repuesto).toBeNull();
  });

  it("una pregunta sin autor se muestra igual", () => {
    const bandeja = bandejaDeConsultas([pregunta({ autor: null })], [orden()], REPUESTOS);

    expect(bandeja).toHaveLength(1);
    expect(bandeja[0].autor).toBeNull();
  });

  /*
   * LO QUE SOSTIENE EL FILTRO DEL SERVIDOR.
   *
   * La ruta no trae el historial entero: pide sólo `tipo in (PREGUNTA, RESPUESTA)`,
   * porque una justificación no puede abrir ni cerrar nada. Eso es una afirmación
   * sobre `preguntasAbiertas`, no sobre esta función, y si dejara de valer la bandeja
   * se equivocaría **en silencio** —no hay error posible: las filas simplemente no
   * llegan—. Acá se comprueba: se arma el caso más hostil que existe, una
   * justificación que apunta a la pregunta abierta (cosa que `leerNotaNueva` no deja
   * escribir), y el resultado tiene que ser el mismo con ella y sin ella.
   */
  it("filtrar por PREGUNTA y RESPUESTA, como hace la ruta, no cambia la bandeja", () => {
    const entrometida = pregunta({
      id: "j1", tipo: "JUSTIFICACION", texto: "Esperamos la parada de planta",
      repuesto_id: null, responde_a: "n1",
    });
    const conTodo = [pregunta(), entrometida];
    const comoLoLee = conTodo.filter((n) =>
      (TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA as readonly string[]).includes(n.tipo)
    );

    expect(comoLoLee).toHaveLength(1);
    expect(bandejaDeConsultas(comoLoLee, [orden()], REPUESTOS))
      .toEqual(bandejaDeConsultas(conTodo, [orden()], REPUESTOS));
  });

  it("los tipos que la ruta pide son tipos de nota de verdad", () => {
    for (const tipo of TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA) {
      expect(TIPOS_DE_NOTA).toContain(tipo);
    }
  });

  it("no toca ni ordena la lista que recibe", () => {
    const notas = [
      pregunta({ id: "nueva", creado_en: "2026-10-30T10:00:00Z", repuesto_id: "r2" }),
      pregunta({ id: "vieja", creado_en: "2026-10-20T10:00:00Z" }),
    ];
    const copia = notas.map((n) => ({ ...n }));

    bandejaDeConsultas(notas, [orden()], REPUESTOS);
    expect(notas).toEqual(copia);
  });
});

describe("el push que le llega a quien preguntó", () => {
  const RODAMIENTO = { nombre: "Rodamiento 6206" };

  // El payload es plano: `{title, body, url}`, con la url en el primer nivel. Un
  // `data` anidado dejó un mes de notificaciones abriendo el inicio.
  it("es un Aviso plano con la url en el primer nivel", () => {
    const aviso = avisoDeLaRespuesta({ ot_number: 2885 }, RODAMIENTO, "Lo entrega el jueves");

    expect(Object.keys(aviso).sort()).toEqual(["body", "title", "url"]);
    expect(aviso.url).toBe("/mantenimiento/ordenes?q=2885");
  });

  it("dice de qué orden, de qué pieza y qué contestaron", () => {
    const aviso = avisoDeLaRespuesta({ ot_number: 2885 }, RODAMIENTO, "Lo entrega el jueves");

    expect(aviso.title).toContain("Compras");
    expect(aviso.body).toContain("OT 2885");
    expect(aviso.body).toContain("Rodamiento 6206");
    expect(aviso.body).toContain("Lo entrega el jueves");
  });

  // Una OT sin número no es «OT null», y su enlace no lleva a una búsqueda vacía.
  it("una OT sin número no dice «OT null» ni arma un enlace roto", () => {
    const aviso = avisoDeLaRespuesta({ ot_number: null }, RODAMIENTO, "Llega el lunes");

    expect(aviso.body).not.toContain("null");
    expect(aviso.body).toContain("OT sin número");
    expect(aviso.url).toBe("/mantenimiento/ordenes");
  });

  // El texto de una nota llega hasta 1000 caracteres: entero no entra en un push, y
  // Android lo corta donde quiere.
  it("una respuesta larga se recorta y se avisa que sigue", () => {
    const larga = "x".repeat(MIL_CARACTERES);
    const aviso = avisoDeLaRespuesta({ ot_number: 2885 }, RODAMIENTO, larga);

    expect(aviso.body.length).toBeLessThan(140);
    expect(aviso.body).toContain("…");
  });

  it("sin repuesto no dice «null»: nombra la orden y nada más", () => {
    const aviso = avisoDeLaRespuesta({ ot_number: 2885 }, null, "Llega el lunes");

    expect(aviso.body).not.toContain("null");
    expect(aviso.body).toContain("OT 2885");
    expect(aviso.body).toContain("Llega el lunes");
  });

  // La misma url la usa el enlace de la pantalla: una sola definición, así el push y
  // la bandeja no pueden llevar a dos lugares distintos.
  it("el enlace de la pantalla y el del push son el mismo", () => {
    expect(avisoDeLaRespuesta({ ot_number: 7 }, RODAMIENTO, "ok").url).toBe(urlDeLaOrden(7));
    expect(avisoDeLaRespuesta({ ot_number: null }, RODAMIENTO, "ok").url).toBe(urlDeLaOrden(null));
  });
});

describe("lo que se le dice a quien contesta", () => {
  const MEDIODIA = new Date("2026-10-30T15:00:00Z"); // 12:00 en Argentina
  const MADRUGADA = new Date("2026-10-30T06:00:00Z"); // 03:00 en Argentina
  const AVISO = { title: "t", body: "b", url: "/u" };

  /** Nadie suscripto: `traerTodo` sobre `push_suscripciones` devuelve cero filas. */
  const sinAparatos = {
    from: () => ({
      select: () => ({ eq: () => ({ range: async () => ({ data: [], error: null }) }) }),
    }),
  } as unknown as SupabaseClient;

  /*
   * Los dos motivos que se pueden provocar sin red salen de la función de verdad y no
   * de un texto escrito a mano. Las palabras de `avisarAUnaPersona` y las de este
   * `switch` son dos copias: si allá cambian, acá se tiene que caer un test, y no una
   * pantalla que calla justo el caso que hay que contar.
   */
  it("de noche lo dice: no se avisó, y no se va a avisar después", async () => {
    const aviso = await avisarAUnaPersona(sinAparatos, {
      usuarioId: "u1", aviso: AVISO, ahora: MADRUGADA,
    });
    expect(aviso.motivo).toBe("fuera de hora");

    const dicho = queDecirDeLaRespuesta(aviso);
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("a esta hora no se avisa");
  });

  it("sin aparatos lo dice, y no lo da por entregado", async () => {
    const aviso = await avisarAUnaPersona(sinAparatos, {
      usuarioId: "u1", aviso: AVISO, ahora: MEDIODIA,
    });
    expect(aviso.motivo).toBe("sin aparatos");

    const dicho = queDecirDeLaRespuesta(aviso);
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("notificaciones");
  });

  it("cuando salió el aviso, lo confirma", () => {
    const dicho = queDecirDeLaRespuesta({ enviadas: 1, personas: 1 });
    expect(dicho.llego).toBe(true);
    expect(dicho.texto).toContain("guardada");
  });

  it("con la cuenta dada de baja lo dice", () => {
    expect(queDecirDeLaRespuesta({ enviadas: 0, personas: 0, motivo: "cuenta dada de baja" }).texto)
      .toContain("baja");
  });

  // Se intentó y ningún aparato lo recibió: sin `motivo`, pero tampoco es éxito.
  it("si se intentó y no llegó a ningún aparato, no lo da por entregado", () => {
    const dicho = queDecirDeLaRespuesta({ enviadas: 0, personas: 1 });
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("ningún aparato");
  });

  // Un fallo que no conocemos se muestra tal cual: un diagnóstico traducido a algo
  // vago es el que costó una tarde en las planillas.
  it("un fallo que no conocemos se muestra tal cual lo dijo", () => {
    const dicho = queDecirDeLaRespuesta({
      enviadas: 0, personas: 0, motivo: "connect ECONNREFUSED 10.0.0.1:443",
    });
    expect(dicho.llego).toBe(false);
    expect(dicho.texto).toContain("connect ECONNREFUSED 10.0.0.1:443");
  });

  /*
   * No había a quién avisarle —la pregunta no tenía autor, o la contestó quien la
   * hizo—. La respuesta se guardó igual y eso es lo único que se dice: afirmar que
   * «le llegó el aviso» sería mentir, y callar dejaría a quien contesta creyendo que
   * del otro lado sonó algo.
   */
  it("sin nadie a quien avisar, dice sólo que se guardó", () => {
    for (const aviso of [null, undefined]) {
      const dicho = queDecirDeLaRespuesta(aviso);
      expect(dicho.llego).toBe(false);
      expect(dicho.texto).toContain("guardada");
      expect(dicho.texto).not.toContain("llegó el aviso");
    }
  });

  it("ningún resultado deja un texto vacío", () => {
    const resultados = [
      { enviadas: 1, personas: 1 },
      { enviadas: 0, personas: 1 },
      { enviadas: 0, personas: 0, motivo: "fuera de hora" },
      { enviadas: 0, personas: 0, motivo: "sin aparatos" },
      { enviadas: 0, personas: 0, motivo: "cuenta dada de baja" },
      { enviadas: 0, personas: 0, motivo: "cualquier otra cosa" },
    ];
    for (const r of resultados) {
      expect(queDecirDeLaRespuesta(r).texto.trim().length, JSON.stringify(r)).toBeGreaterThan(10);
    }
  });
});

/*
 * LA CAJA DE CADA CONSULTA.
 *
 * Medido en este mismo repo el 31/10/2026, con las cajas de «Preguntar a Compras»:
 * una sola caja para toda la lista tira en silencio lo que se escribió en la otra, y
 * la mutación que lo reintroduce —`{ [id]: … }` en vez de `{ ...cajas, [id]: … }`—
 * dejaba los 4.464 tests en verde. La bandeja de Compras tiene exactamente la misma
 * forma: varias consultas a la vista, una caja por cada una.
 */
describe("la caja de respuesta de cada consulta", () => {
  it("escribir en una no pisa lo que se escribió en otra", () => {
    const uno = cambiarRespuesta({}, "n1", { texto: "Lo entrega el jueves" });
    const dos = cambiarRespuesta(uno, "n2", { texto: "El proveedor no lo tiene" });

    expect(dos.n1.texto).toBe("Lo entrega el jueves");
    expect(dos.n2.texto).toBe("El proveedor no lo tiene");
  });

  it("una caja que no existía se crea, no se descarta", () => {
    expect(cambiarRespuesta({}, "n1", { texto: "hola" })).toEqual({
      n1: { texto: "hola", error: "" },
    });
  });

  it("un error de una consulta no borra lo que se escribió en ella", () => {
    const con = cambiarRespuesta({}, "n1", { texto: "Lo entrega el jueves" });
    const fallado = cambiarRespuesta(con, "n1", { error: "No se pudo enviar." });

    expect(fallado.n1).toEqual({ texto: "Lo entrega el jueves", error: "No se pudo enviar." });
  });

  it("un error de una consulta no toca la caja de otra", () => {
    const dos = cambiarRespuesta(
      cambiarRespuesta({}, "n1", { texto: "uno" }), "n2", { texto: "dos" }
    );
    const fallado = cambiarRespuesta(dos, "n1", { error: "falló" });

    expect(fallado.n2).toEqual({ texto: "dos", error: "" });
  });

  // Son transiciones, no estado: React compara por identidad.
  it("no toca el registro que recibe", () => {
    const antes = cambiarRespuesta({}, "n1", { texto: "uno" });
    const copia = JSON.parse(JSON.stringify(antes));

    cambiarRespuesta(antes, "n1", { texto: "otra cosa" });
    expect(antes).toEqual(copia);
  });
});
