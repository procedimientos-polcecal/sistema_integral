import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * La ruta de notas de una OT, con un Supabase de mentira.
 *
 * **Es el único test de una ruta del repo, y no es una plantilla.** Las rutas siguen
 * sin tener tests, y la lógica que decide sigue sacándose a `lib/` y probándose ahí:
 * `consultaDeRepuesto.test.ts` tiene qué pregunta es válida, qué se rechaza y por qué, y
 * qué se le dice a quien preguntó. Acá no se repite nada de eso. Lo propio de este
 * archivo es lo que pasa *entre* la ruta y la base y `lib/` no puede ver: qué columnas
 * lee, qué inserta, qué escribe en la planilla y a quién avisa —y que lo que se
 * rechaza no inserta, no escribe la planilla y no avisa—. Quien tenga otra ruta con una
 * regla para probar, que la saque a `lib/`; esto no es un modelo a copiar.
 *
 * Existe por una falla, la peor de esta funcionalidad: **los `select` de la ruta tienen
 * que traer `tipo`, `repuesto_id` y `responde_a`**. Sin ellos `preguntasAbiertas`
 * devuelve `[]` para todo —ninguna pregunta se ve abierta, el botón ofrece abrir una
 * segunda, la regla de «una abierta por repuesto» deja de defenderse— y no hay un solo
 * error: se ve igual que una orden sin preguntas. Y nadie más la puede ver. El cliente
 * admin no recibe el tipo `Database` (`lib/supabase/admin.ts`), así que lo que trae un
 * `select` llega sin tipos, y la ruta lo pasa a `NotaDeLaOT[]` con un cast: ni el
 * compilador ni un test de `lib/`, a los que les llegan las notas ya traídas, pueden
 * notar que a un `select` le falta `tipo`.
 *
 * Por eso el cliente falso entrega sólo las columnas que se le piden, como PostgREST,
 * que es lo que cualquier fake ingenuo se saltea. Con uno que devolvía la fila entera,
 * sacar `tipo` del select de contexto del POST no rompía nada y el test pasaba (se
 * comprobó: la mutación sobrevivía).
 *
 * Lo que este test NO prueba, y conviene no creerle: que las tablas y columnas existan
 * con esos nombres, ni las claves foráneas. Para eso hace falta la base, y la
 * migración 20261029082249 todavía no estaba aplicada cuando se escribió.
 */

const h = vi.hoisted(() => {
  type Fila = Record<string, unknown>;

  const estado = {
    usuario: { id: "u1" } as { id: string } | null,
    edita: true,
    tablas: {} as Record<string, Fila[]>,
    /** Qué tablas se leyeron con `select`, para saber si una justificación lee de más. */
    lecturas: [] as string[],
    /** Las columnas de cada `select`, tal cual se pidieron. */
    selects: [] as { tabla: string; columnas: string }[],
    inserts: [] as Fila[],
    /** Lo que se mandó a la columna X de la planilla. */
    planilla: [] as unknown[],
  };

  /** El constructor de consultas de supabase-js, con lo justo para esta ruta. */
  class Consulta {
    private accion: "select" | "insert" | "delete" = "select";
    private filtros: [string, unknown][] = [];
    private columnas = "";
    private fila: Fila | null = null;
    private unica = false;

    constructor(private tabla: string) {}

    select(columnas: string) {
      if (this.accion === "select") estado.lecturas.push(this.tabla);
      this.columnas = columnas;
      estado.selects.push({ tabla: this.tabla, columnas });
      return this;
    }
    eq(columna: string, valor: unknown) { this.filtros.push([columna, valor]); return this; }
    order() { return this; }
    single() { this.unica = true; return this; }
    insert(fila: Fila) { this.accion = "insert"; this.fila = fila; return this; }
    delete() { this.accion = "delete"; return this; }

    then(resolver: (r: unknown) => unknown, rechazar?: (e: unknown) => unknown) {
      try { return Promise.resolve(this.ejecutar()).then(resolver, rechazar); }
      catch (e) { return Promise.reject(e).then(resolver, rechazar); }
    }

    /** Sólo las columnas pedidas, como PostgREST. `autor:usuarios(nombre)` es un embed. */
    private proyectar(fila: Fila): Fila {
      if (!this.columnas) return fila;
      const salida: Fila = {};
      for (const c of this.columnas.split(/,(?![^(]*\))/).map((x) => x.trim())) {
        if (c.includes(":")) salida[c.split(":")[0]] = { nombre: "Ana" };
        else salida[c] = fila[c];
      }
      return salida;
    }

    private ejecutar() {
      const filas = estado.tablas[this.tabla] ?? (estado.tablas[this.tabla] = []);
      const coincide = (f: Fila) => this.filtros.every(([c, v]) => f[c] === v);

      if (this.accion === "insert") {
        const nueva = { id: `nueva-${filas.length + 1}`, creado_en: "2026-10-30T15:00:00Z", ...this.fila };
        filas.push(nueva);
        estado.inserts.push(nueva);
        return { data: this.proyectar(nueva), error: null };
      }

      if (this.accion === "delete") {
        const aBorrar = filas.filter(coincide);
        for (const f of aBorrar) {
          // `responde_a` no borra en cascada: la base se niega a borrar una nota a la
          // que otra apunta, con el 23503 que Postgres devuelve.
          if (this.tabla === "ordenes_trabajo_notas" && filas.some((o) => o.responde_a === f.id)) {
            return {
              data: null,
              error: {
                code: "23503",
                message:
                  'update or delete on table "ordenes_trabajo_notas" violates foreign key ' +
                  'constraint "ordenes_trabajo_notas_responde_a_fkey" on table "ordenes_trabajo_notas"',
              },
            };
          }
        }
        estado.tablas[this.tabla] = filas.filter((f) => !coincide(f));
        return { data: aBorrar.map((f) => ({ id: f.id })), error: null };
      }

      const halladas = filas.filter(coincide);
      if (this.unica) {
        return halladas[0]
          ? { data: this.proyectar(halladas[0]), error: null }
          : { data: null, error: { message: "no hay" } };
      }
      return { data: halladas.map((f) => this.proyectar(f)), error: null };
    }
  }

  const admin = { from: (tabla: string) => new Consulta(tabla) };
  const avisar = vi
    .fn<(admin: unknown, opciones: unknown) => Promise<{ enviadas: number; personas: number; motivo?: string }>>()
    .mockResolvedValue({ enviadas: 1, personas: 1 });
  const escribirPlanilla = vi.fn(async (_orden: unknown, celdas: unknown) => {
    estado.planilla.push(celdas);
    return null;
  });

  return { estado, admin, avisar, escribirPlanilla };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.estado.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/mantenimiento/auth", () => ({
  puedeEditarMantenimiento: async () => h.estado.edita,
  puedeVerMantenimiento: async () => true,
}));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({ escribirEnLaFilaDeLaOT: h.escribirPlanilla }));
// Lo único que se cambia es quién manda el push: el texto, la lista y la hora ya
// tienen sus tests en `avisoAlInstante.test.ts`. Acá interesa a quién se le pide.
vi.mock("@/lib/core/avisoAlInstante", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/core/avisoAlInstante")>()),
  avisarAQuienDecide: h.avisar,
}));

import { GET, POST, DELETE } from "@/app/api/mantenimiento/ordenes/[id]/notas/route";

const params = { params: Promise.resolve({ id: "ot1" }) };
const get = () => GET(new Request("http://prueba/api"), params);
const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }), params);
const borrar = (nota: string) =>
  DELETE(new Request(`http://prueba/api?nota=${nota}`, { method: "DELETE" }), params);

/** Una PREGUNTA de u1 sobre el rodamiento, como la deja la base. */
const pregunta = (p: Record<string, unknown> = {}) => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "u1",
  repuesto_id: "r1", responde_a: null, ...p,
});
/** La RESPUESTA a n1, de otra persona y sin repuesto, como la escribe Compras. */
const respuestaAN1 = (p: Record<string, unknown> = {}) =>
  pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "u2", ...p });

const COLUMNAS_QUE_LEE_preguntasAbiertas = ["tipo", "repuesto_id", "responde_a"];

beforeEach(() => {
  const e = h.estado;
  e.usuario = { id: "u1" };
  e.edita = true;
  e.lecturas = []; e.selects = []; e.inserts = []; e.planilla = [];
  e.tablas = {
    ordenes_trabajo: [{ id: "ot1", ot_number: 2885, sheets_row: 5, estado: "POR_HACER" }],
    ordenes_trabajo_repuestos: [
      { id: "r1", work_order_id: "ot1", nombre: "Rodamiento 6206", codigo: "00473" },
      { id: "r2", work_order_id: "ot1", nombre: "Correa B-75", codigo: null },
      { id: "r-ajeno", work_order_id: "otra-ot", nombre: "Chumacera", codigo: null },
    ],
    ordenes_trabajo_notas: [],
  };
  h.avisar.mockClear();
  h.escribirPlanilla.mockClear();
});

describe("leer el historial", () => {
  // Es el que se rompe sin ruido: una orden con preguntas se vería igual que una sin.
  it("trae las tres columnas que lee preguntasAbiertas", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()];
    const res = await get();
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toHaveLength(2);
    for (const nota of data) {
      for (const columna of COLUMNAS_QUE_LEE_preguntasAbiertas) {
        expect(Object.keys(nota), columna).toContain(columna);
      }
    }
    expect(data.find((n: { id: string }) => n.id === "n1")).toMatchObject({
      tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null,
    });
  });
});

describe("escribir una justificación, como siempre", () => {
  it("guarda, escribe la planilla, no avisa, y no lee más que la orden", async () => {
    const res = await post({ texto: "falta el repuesto" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts[0]).toMatchObject({
      tipo: "JUSTIFICACION", repuesto_id: null, responde_a: null, creado_por: "u1",
    });
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "falta el repuesto" }]]);
    expect(h.avisar).not.toHaveBeenCalled();
    expect(cuerpo.aviso).toBeNull();

    // Lo único que se lee es la orden: una justificación no se refiere a nada y no
    // tiene por qué costar tres consultas más.
    expect(h.estado.lecturas.filter((t) => t !== "ordenes_trabajo")).toEqual([]);
  });

  // El `select` del propio insert, que es lo que vuelve a la pantalla.
  it("devuelve la nota con tipo, repuesto_id y responde_a", async () => {
    const { data } = await (await post({ texto: "falta el repuesto" })).json();
    for (const columna of COLUMNAS_QUE_LEE_preguntasAbiertas) {
      expect(Object.keys(data), columna).toContain(columna);
    }
  });
});

describe("preguntarle a Compras", () => {
  it("guarda, escribe la celda, y avisa a la lista de consultados", async () => {
    const res = await post({ texto: "¿Llega antes del jueves?", tipo: "PREGUNTA", repuesto_id: "r1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts[0]).toMatchObject({
      tipo: "PREGUNTA", repuesto_id: "r1", responde_a: null, creado_por: "u1",
    });
    // Una pregunta ES una razón válida de por qué la OT sigue abierta: va a la X.
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "¿Llega antes del jueves?" }]]);

    expect(h.avisar).toHaveBeenCalledTimes(1);
    expect(h.avisar.mock.calls[0][1]).toMatchObject({
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
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "'=IMPORTRANGE(\"x\";\"A1\")" }]]);
  });

  // Review Focus 1: la pregunta se guarda igual, y lo que no pudo avisar vuelve a la
  // pantalla para que se diga.
  it("con la lista vacía la pregunta igual queda guardada y vuelve el motivo", async () => {
    h.avisar.mockResolvedValueOnce({ enviadas: 0, personas: 0, motivo: "nadie aprueba" });
    const res = await post({ texto: "¿Llega?", tipo: "PREGUNTA", repuesto_id: "r1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts).toHaveLength(1);
    expect(cuerpo.aviso).toEqual({ enviadas: 0, personas: 0, motivo: "nadie aprueba" });
  });

  it("un seguimiento apunta a la pregunta abierta, y avisa de nuevo", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [pregunta()];
    const res = await post({
      texto: "Sigue sin llegar", tipo: "PREGUNTA", repuesto_id: "r1", responde_a: "n1",
    });

    expect(res.status).toBe(200);
    expect(h.estado.inserts[0]).toMatchObject({ tipo: "PREGUNTA", responde_a: "n1" });
    expect(h.avisar).toHaveBeenCalledTimes(1);
  });
});

describe("«ya llegó»", () => {
  it("es una respuesta a la pregunta abierta: guarda, escribe la celda y no avisa", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [pregunta()];
    const res = await post({ texto: "Ya llegó el repuesto.", tipo: "RESPUESTA", responde_a: "n1" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts[0]).toMatchObject({
      tipo: "RESPUESTA", responde_a: "n1", repuesto_id: null, creado_por: "u1",
    });
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "Ya llegó el repuesto." }]]);
    // Nadie queda esperando una decisión de quien preguntó: no hay a quién avisar.
    expect(h.avisar).not.toHaveBeenCalled();
    expect(cuerpo.aviso).toBeNull();
  });
});

/*
 * Qué se rechaza y por qué lo deciden `leerNotaNueva` y `comprobarNotaNueva`, con sus
 * tests en `lib/`. Lo que se prueba acá es sólo que la ruta les hace caso: lo que
 * rechazan no se guarda, no escribe la planilla, no avisa, y sale con el status que
 * dijeron. Cada caso existe porque mata una rotura que sólo se ve en la ruta:
 *
 *  - la pregunta con una abierta: la ruta tiene que LEER las notas de la orden, con
 *    `tipo` en el select (es el caso que mata la lectura de contexto sin `tipo`);
 *  - el «ya llegó» sobre una pregunta respondida: la ruta comprueba también las
 *    respuestas, no sólo las preguntas;
 *  - la orden realizada: la ruta tiene que pasarle a la regla el estado de la orden;
 *  - el cuerpo ilegible: la ruta tiene que leerlo ANTES de tocar la base;
 *  - el 403: el permiso se comprueba en la ruta, y también para preguntar.
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
      preparar: () => { h.estado.tablas.ordenes_trabajo_notas = [pregunta()]; },
      cuerpo: { texto: "otra vez", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
    {
      nombre: "«ya llegó» sobre una pregunta que ya tiene respuesta",
      status: 409,
      preparar: () => { h.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()]; },
      cuerpo: { texto: "Ya llegó el repuesto.", tipo: "RESPUESTA", responde_a: "n1" },
    },
    {
      nombre: "una pregunta sobre una orden realizada",
      status: 409,
      preparar: () => {
        h.estado.tablas.ordenes_trabajo = [{ id: "ot1", ot_number: 2885, sheets_row: 5, estado: "REALIZADO" }];
      },
      cuerpo: { texto: "¿?", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
    {
      nombre: "un cuerpo que no se entiende",
      status: 400,
      cuerpo: { texto: "hola", tipo: "CHARLA" },
    },
    {
      nombre: "quien sólo mira, preguntando también",
      status: 403,
      preparar: () => { h.estado.edita = false; },
      cuerpo: { texto: "¿?", tipo: "PREGUNTA", repuesto_id: "r1" },
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: ${caso.status}`, async () => {
      caso.preparar?.();
      const res = await post(caso.cuerpo);

      expect(res.status).toBe(caso.status);
      expect(h.estado.inserts).toHaveLength(0);
      expect(h.escribirPlanilla).not.toHaveBeenCalled();
      expect(h.avisar).not.toHaveBeenCalled();
    });
  }
});

describe("borrar una entrada", () => {
  // La base se niega (23503) y la ruta lo traduce: sin esto llegaba el texto crudo.
  it("una pregunta que ya tiene respuesta no se borra: 409 que se entiende", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [pregunta(), respuestaAN1()];
    const res = await borrar("n1");

    expect(res.status).toBe(409);
    expect((await res.json()).error).not.toMatch(/foreign key|violates|constraint/i);
    expect(h.estado.tablas.ordenes_trabajo_notas).toHaveLength(2);
    // Nada cambió, así que la planilla tampoco.
    expect(h.escribirPlanilla).not.toHaveBeenCalled();
  });

  it("una respuesta suelta sí, y la celda vuelve a la que quedó última", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      respuestaAN1({ creado_por: "u1", creado_en: "2026-10-30T11:00:00Z", texto: "Ya llegó el repuesto." }),
    ];
    const res = await borrar("n2");

    expect(res.status).toBe(200);
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "¿Llega?" }]]);
  });

  it("la de otra persona no: 403", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [pregunta({ creado_por: "u9" })];
    expect((await borrar("n1")).status).toBe(403);
    expect(h.estado.tablas.ordenes_trabajo_notas).toHaveLength(1);
  });
});
