import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";

/**
 * La ruta de notas de una OT, con un Supabase de mentira.
 *
 * **Fue el primer test de una ruta del repo, y no es una plantilla.** Las rutas
 * siguen sin tener tests, y la lógica que decide sigue sacándose a `lib/` y
 * probándose ahí: `consultaDeRepuesto.test.ts` tiene qué pregunta es válida, qué se
 * rechaza y por qué, y qué se le dice a quien preguntó. Acá no se repite nada de
 * eso. Lo propio de este archivo es lo que pasa *entre* la ruta y la base y `lib/`
 * no puede ver: qué tablas lee, qué inserta, qué escribe en la planilla y a quién
 * avisa —y que lo que se rechaza no inserta, no escribe la planilla y no avisa—.
 * Quien tenga otra ruta con una regla para probar, que la saque a `lib/`.
 *
 * **Las columnas de los `select` ya no se afirman acá.** Nació por eso: sin `tipo`,
 * `repuesto_id` o `responde_a`, `preguntasAbiertas` devuelve `[]` para todo y no hay
 * un solo error. Pero la guarda era una lista escrita a mano, una por ruta, y la
 * segunda vez que se usó —en `lib/compras/rutaDeConsultas.test.ts`— le faltó
 * `creado_en`. Desde el 31/10/2026 eso lo comprueba
 * `lib/mantenimiento/selectsDeLasNotas.test.ts` leyendo el **texto** de todas las
 * rutas, incluida la que nadie escribió todavía. Acá quedó lo que el texto no puede
 * ver.
 *
 * El cliente falso entrega sólo las columnas que se le piden, como PostgREST, y vive
 * en `lib/core/supabaseDeMentira.ts` porque los dos tests de ruta lo comparten: las
 * dos copias a mano ya habían empezado a separarse.
 *
 * Lo que este test NO prueba, y conviene no creerle: que las tablas y columnas
 * existan con esos nombres, ni las claves foráneas. Para eso hace falta la base, y
 * la migración 20261029082249 todavía no estaba aplicada cuando se escribió.
 */

const base = supabaseDeMentira({
  nombres: { u1: "Ana", u2: "Facundo", u9: "Otro" },
  /*
   * `responde_a` no borra en cascada: la base se niega a borrar una nota a la que
   * otra apunta, con el 23503 que Postgres devuelve. Es lo que impide que quien
   * preguntó se lleve puesta la respuesta de Compras.
   */
  alBorrar: (tabla, fila, filas) =>
    tabla === "ordenes_trabajo_notas" && filas.some((o) => o.responde_a === fila.id)
      ? {
          code: "23503",
          message:
            'update or delete on table "ordenes_trabajo_notas" violates foreign key ' +
            'constraint "ordenes_trabajo_notas_responde_a_fkey" on table "ordenes_trabajo_notas"',
        }
      : null,
});

/** Quién mira y qué puede. Lo leen los mocks, así que cada test lo puede cambiar. */
const sesion = { usuario: { id: "u1" } as { id: string } | null, edita: true };

const avisar = vi
  .fn<(admin: unknown, opciones: unknown) => Promise<{ enviadas: number; personas: number; motivo?: string }>>()
  .mockResolvedValue({ enviadas: 1, personas: 1 });

/** Lo que se mandó a la columna X de la planilla. */
const planilla: unknown[] = [];
const escribirPlanilla = vi.fn(async (_orden: unknown, celdas: unknown): Promise<string | null> => {
  planilla.push(celdas);
  return null;
});

/*
 * Los factories se evalúan al importar la ruta, que es antes que las constantes de
 * arriba; por eso cada uno lee lo suyo **adentro de una función** y nunca en el
 * cuerpo del factory. Es lo que permite no usar `vi.hoisted` y poder compartir el
 * fake con el otro test de ruta.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sesion.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));
vi.mock("@/lib/mantenimiento/auth", () => ({
  puedeEditarMantenimiento: async () => sesion.edita,
  puedeVerMantenimiento: async () => true,
}));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({
  escribirEnLaFilaDeLaOT: (orden: unknown, celdas: unknown) => escribirPlanilla(orden, celdas),
}));
// Lo único que se cambia es quién manda el push: el texto, la lista y la hora ya
// tienen sus tests en `avisoAlInstante.test.ts`. Acá interesa a quién se le pide.
vi.mock("@/lib/core/avisoAlInstante", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/core/avisoAlInstante")>()),
  avisarAQuienDecide: (admin: unknown, opciones: unknown) => avisar(admin, opciones),
}));

import { GET, POST, DELETE } from "@/app/api/mantenimiento/ordenes/[id]/notas/route";

const params = { params: Promise.resolve({ id: "ot1" }) };
const get = () => GET(new Request("http://prueba/api"), params);
const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }), params);
const borrar = (nota: string) =>
  DELETE(new Request(`http://prueba/api?nota=${nota}`, { method: "DELETE" }), params);

/** Una PREGUNTA de u1 sobre el rodamiento, como la deja la base. */
const pregunta = (p: Fila = {}): Fila => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "u1",
  repuesto_id: "r1", responde_a: null, ...p,
});
/** La RESPUESTA a n1, de otra persona y sin repuesto, como la escribe Compras. */
const respuestaAN1 = (p: Fila = {}): Fila =>
  pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "u2", ...p });

beforeEach(() => {
  sesion.usuario = { id: "u1" };
  sesion.edita = true;
  planilla.length = 0;
  base.reiniciar({
    ordenes_trabajo: [{ id: "ot1", ot_number: 2885, sheets_row: 5, estado: "POR_HACER" }],
    ordenes_trabajo_repuestos: [
      { id: "r1", work_order_id: "ot1", nombre: "Rodamiento 6206", codigo: "00473" },
      { id: "r2", work_order_id: "ot1", nombre: "Correa B-75", codigo: null },
      { id: "r-ajeno", work_order_id: "otra-ot", nombre: "Chumacera", codigo: null },
    ],
    ordenes_trabajo_notas: [],
  });
  avisar.mockClear();
  escribirPlanilla.mockClear();
});

describe("leer el historial", () => {
  it("trae cada entrada con lo que es: su tipo, su repuesto y a qué responde", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()];
    const res = await get();
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toHaveLength(2);
    expect(data.find((n: { id: string }) => n.id === "n1")).toMatchObject({
      tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null,
    });
    expect(data.find((n: { id: string }) => n.id === "n2")).toMatchObject({
      tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1",
    });
  });
});

describe("escribir una justificación, como siempre", () => {
  it("guarda, escribe la planilla, no avisa, y no lee más que la orden", async () => {
    const res = await post({ texto: "falta el repuesto" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts[0]).toMatchObject({
      tipo: "JUSTIFICACION", repuesto_id: null, responde_a: null, creado_por: "u1",
    });
    expect(planilla).toEqual([[{ columna: 23, valor: "falta el repuesto" }]]);
    expect(avisar).not.toHaveBeenCalled();
    expect(cuerpo.aviso).toBeNull();

    // Lo único que se lee es la orden: una justificación no se refiere a nada y no
    // tiene por qué costar tres consultas más.
    expect(base.estado.lecturas.filter((t) => t !== "ordenes_trabajo")).toEqual([]);
  });
});

describe("preguntarle a Compras", () => {
  it("guarda, escribe la celda, y avisa a la lista de consultados", async () => {
    const res = await post({ texto: "¿Llega antes del jueves?", tipo: "PREGUNTA", repuesto_id: "r1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts[0]).toMatchObject({
      tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null, creado_por: "u1",
    });
    // Una pregunta ES una razón válida de por qué la OT sigue abierta: va a la X.
    expect(planilla).toEqual([[{ columna: 23, valor: "¿Llega antes del jueves?" }]]);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0][1]).toMatchObject({
      lista: "compras_consultados",
      items: [{ etiqueta: "OT 2885", descripcion: "Rodamiento 6206 · 00473" }],
      url: "/compras/consultas",
      // No se le avisa a quien acaba de preguntar de lo que acaba de preguntar.
      excepto: "u1",
      nombre: {
        singular: "Una consulta",
        verbo: { singular: "espera tu respuesta", plural: "esperan tu respuesta" },
      },
    });
    expect(cuerpo.aviso).toEqual({ enviadas: 1, personas: 1 });
    expect(cuerpo.planilla_error).toBeNull();
  });

  // Review Focus 2: la planilla escribe con USER_ENTERED.
  it("una pregunta que arranca con = va a la planilla como texto y no como fórmula", async () => {
    await post({ texto: "=IMPORTRANGE(\"x\";\"A1\")", tipo: "PREGUNTA", repuesto_id: "r1" });
    expect(planilla).toEqual([[{ columna: 23, valor: "'=IMPORTRANGE(\"x\";\"A1\")" }]]);
  });

  // Review Focus 1: la pregunta se guarda igual, y lo que no pudo avisar vuelve a la
  // pantalla para que se diga.
  it("con la lista vacía la pregunta igual queda guardada y vuelve el motivo", async () => {
    avisar.mockResolvedValueOnce({ enviadas: 0, personas: 0, motivo: "nadie aprueba" });
    const res = await post({ texto: "¿Llega?", tipo: "PREGUNTA", repuesto_id: "r1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts).toHaveLength(1);
    expect(cuerpo.aviso).toEqual({ enviadas: 0, personas: 0, motivo: "nadie aprueba" });
  });

  it("un seguimiento apunta a la pregunta abierta, y avisa de nuevo", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [pregunta()];
    const res = await post({
      texto: "Sigue sin llegar", tipo: "PREGUNTA", repuesto_id: "r1", responde_a: "n1",
    });

    expect(res.status).toBe(200);
    expect(base.estado.inserts[0]).toMatchObject({ tipo: "PREGUNTA", responde_a: "n1" });
    expect(avisar).toHaveBeenCalledTimes(1);
  });
});

describe("«ya llegó»", () => {
  it("es una respuesta a la pregunta abierta: guarda, escribe la celda y no avisa", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [pregunta()];
    const res = await post({ texto: "Ya llegó el repuesto.", tipo: "RESPUESTA", responde_a: "n1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts[0]).toMatchObject({
      tipo: "RESPUESTA", responde_a: "n1", repuesto_id: null, creado_por: "u1",
    });
    expect(planilla).toEqual([[{ columna: 23, valor: "Ya llegó el repuesto." }]]);
    // Nadie queda esperando una decisión de quien preguntó: no hay a quién avisar.
    expect(avisar).not.toHaveBeenCalled();
    expect(cuerpo.aviso).toBeNull();
  });
});

/*
 * Qué se rechaza y por qué lo deciden `leerNotaNueva` y `comprobarNotaNueva`, con sus
 * tests en `lib/`. Lo que se prueba acá es sólo que la ruta les hace caso: lo que
 * rechazan no se guarda, no escribe la planilla, no avisa, y sale con el status que
 * dijeron. Cada caso existe porque mata una rotura que sólo se ve en la ruta:
 *
 *  - la pregunta con una abierta: la ruta tiene que LEER las notas de la orden;
 *  - el «ya llegó» sobre una pregunta respondida: la ruta comprueba también las
 *    respuestas, no sólo las preguntas;
 *  - la orden realizada: la ruta tiene que pasarle a la regla el estado de la orden;
 *  - el repuesto de otra orden: la ruta tiene que FILTRAR los repuestos por
 *    `work_order_id`. `comprobarNotaNueva` recibe la lista ya traída, así que si la
 *    ruta no filtra, la regla ve un repuesto ajeno como propio y lo acepta — y eso
 *    es justo lo que el docstring de la ruta dice que no puede pasar: sin cascade,
 *    una nota que apunte a otra orden traba el borrado de espejo de esa otra;
 *  - el cuerpo ilegible: la ruta tiene que leerlo ANTES de tocar la base;
 *  - el 403: el permiso se comprueba en la ruta, y también para preguntar.
 *
 * Este caso del repuesto ajeno se había perdido en el recorte del 30/10 —que sacó
 * los que repetían `lib/`— y con él se podía sacar el `.eq("work_order_id", id)` del
 * select sin que nada se pusiera rojo. Volvió el 31/10: la vara del recorte era «lo
 * que sólo se ve acá», y éste lo es.
 */
describe("lo que la ruta rechaza no se guarda, ni se escribe en la planilla, ni se avisa", () => {
  const casos: {
    nombre: string;
    status: number;
    preparar?: () => void;
    cuerpo: unknown;
  }[] = [
    {
      nombre: "otra pregunta por un repuesto que ya tiene una abierta",
      status: 409,
      preparar: () => { base.estado.tablas.ordenes_trabajo_notas = [pregunta()]; },
      cuerpo: { texto: "otra vez", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
    {
      nombre: "«ya llegó» sobre una pregunta que ya tiene respuesta",
      status: 409,
      preparar: () => { base.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()]; },
      cuerpo: { texto: "Ya llegó el repuesto.", tipo: "RESPUESTA", responde_a: "n1" },
    },
    {
      nombre: "una pregunta sobre una orden realizada",
      status: 409,
      preparar: () => {
        base.estado.tablas.ordenes_trabajo = [{ id: "ot1", ot_number: 2885, sheets_row: 5, estado: "REALIZADO" }];
      },
      cuerpo: { texto: "¿?", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
    {
      nombre: "una pregunta por un repuesto que es de otra orden",
      status: 400,
      cuerpo: { texto: "¿?", tipo: "PREGUNTA", repuesto_id: "r-ajeno" },
    },
    {
      nombre: "un cuerpo que no se entiende",
      status: 400,
      cuerpo: { texto: "hola", tipo: "CHARLA" },
    },
    {
      nombre: "quien sólo mira, preguntando también",
      status: 403,
      preparar: () => { sesion.edita = false; },
      cuerpo: { texto: "¿?", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: ${caso.status}`, async () => {
      caso.preparar?.();
      const res = await post(caso.cuerpo);

      expect(res.status).toBe(caso.status);
      expect(base.estado.inserts).toHaveLength(0);
      expect(escribirPlanilla).not.toHaveBeenCalled();
      expect(avisar).not.toHaveBeenCalled();
    });
  }
});

describe("borrar una entrada", () => {
  // La base se niega (23503) y la ruta lo traduce: sin esto llegaba el texto crudo.
  it("una pregunta que ya tiene respuesta no se borra: 409 que se entiende", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()];
    const res = await borrar("n1");

    expect(res.status).toBe(409);
    expect((await res.json()).error).not.toMatch(/foreign key|violates|constraint/i);
    expect(base.estado.tablas.ordenes_trabajo_notas).toHaveLength(2);
    // Nada cambió, así que la planilla tampoco.
    expect(escribirPlanilla).not.toHaveBeenCalled();
  });

  it("una respuesta suelta sí, y la celda vuelve a la que quedó última", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      respuestaAN1({ creado_por: "u1", creado_en: "2026-10-30T11:00:00Z", texto: "Ya llegó el repuesto." }),
    ];
    const res = await borrar("n2");

    expect(res.status).toBe(200);
    expect(planilla).toEqual([[{ columna: 23, valor: "¿Llega?" }]]);
  });

  it("la de otra persona no: 403", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [pregunta({ creado_por: "u9" })];
    expect((await borrar("n1")).status).toBe(403);
    expect(base.estado.tablas.ordenes_trabajo_notas).toHaveLength(1);
  });
});
