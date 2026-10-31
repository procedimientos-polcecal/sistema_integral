import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * La ruta con la que Compras contesta, con un Supabase de mentira.
 *
 * **Es el segundo test de una ruta del repo, y sigue sin ser una plantilla.** La
 * regla de la casa no cambió: la lógica que decide se saca a `lib/` y se prueba ahí,
 * y acá no se repite nada de `consultas.test.ts` —quién puede contestar, a quién se
 * le avisa, cómo se arma la bandeja, qué dice el push—. Lo que se prueba acá es lo
 * que pasa *entre* la ruta y la base, que `lib/` no puede ver.
 *
 * POR QUÉ NO SE PUDO MOVER A `lib/`
 *
 * Porque la rotura más cara de esta pantalla es **un `select` al que le falta una
 * columna**, y la casa prohíbe la única forma de probarlo desde `lib/`: «un
 * `select()` armado en una variable pierde la inferencia de tipos de Supabase, la
 * cadena va literal». O sea que la lista de columnas no puede ser una constante
 * exportada que un test compare.
 *
 * Y lo que esa falta provoca no se ve. Sin `tipo`, `repuesto_id` o `responde_a`,
 * `preguntasAbiertas` devuelve `[]` para todo; sin `orden_id`, ninguna nota se
 * agrupa con su orden y pasa lo mismo. En los dos casos **la bandeja queda vacía sin
 * un solo error**, que se lee igual que «no hay nada que contestar»: Compras deja de
 * ver preguntas, Mantenimiento sigue preguntando, y nadie se entera. El compilador
 * tampoco ayuda: el cliente admin no recibe el tipo `Database`
 * (`lib/supabase/admin.ts`), así que lo que vuelve de un `select` llega sin tipos y
 * la ruta lo pasa a `NotaDeLaBandeja[]` con un cast.
 *
 * Por eso el cliente falso **entrega sólo las columnas que se le piden**, como
 * PostgREST, que es lo que un fake ingenuo se saltea: con uno que devolviera la fila
 * entera, sacar `tipo` del select no rompería nada.
 *
 * Lo que este test NO prueba, y conviene no creerle: que las tablas y las columnas
 * existan con esos nombres, ni las claves foráneas, ni que el embed `usuarios(nombre)`
 * resuelva. Para eso hace falta la base, y la migración 20261029082249 todavía no
 * estaba aplicada cuando se escribió.
 */

const h = vi.hoisted(() => {
  type Fila = Record<string, unknown>;

  const estado = {
    usuario: { id: "facundo" } as { id: string } | null,
    accesoCompras: true,
    tablas: {} as Record<string, Fila[]>,
    /** Las columnas de cada `select`, tal cual se pidieron. */
    selects: [] as { tabla: string; columnas: string }[],
    inserts: [] as Fila[],
    /** Lo que se mandó a la columna X de la planilla. */
    planilla: [] as unknown[],
  };

  /** Los nombres, para el embed `autor:usuarios(nombre)`. */
  const NOMBRES: Record<string, string> = { ana: "Ana", facundo: "Facundo" };

  /** Cuántas filas devuelve PostgREST como mucho: `traerTodo` pagina contra esto. */
  const TOPE = 1000;

  /** El constructor de consultas de supabase-js, con lo justo para esta ruta. */
  class Consulta {
    private accion: "select" | "insert" = "select";
    private igualdades: [string, unknown][] = [];
    private enLista: [string, readonly unknown[]] | null = null;
    private columnas = "";
    private fila: Fila | null = null;
    private unica: "single" | "maybeSingle" | null = null;
    private rango: [number, number] | null = null;

    constructor(private tabla: string) {}

    select(columnas: string) {
      this.columnas = columnas;
      if (this.accion === "select") estado.selects.push({ tabla: this.tabla, columnas });
      return this;
    }
    eq(columna: string, valor: unknown) { this.igualdades.push([columna, valor]); return this; }
    in(columna: string, valores: readonly unknown[]) { this.enLista = [columna, valores]; return this; }
    range(desde: number, hasta: number) { this.rango = [desde, hasta]; return this; }
    single() { this.unica = "single"; return this; }
    // Como el de verdad, y la diferencia importa: sin fila, `maybeSingle` devuelve
    // `data: null` **sin error** y `single` devuelve un error.
    maybeSingle() { this.unica = "maybeSingle"; return this; }
    insert(fila: Fila) { this.accion = "insert"; this.fila = fila; return this; }

    then(resolver: (r: unknown) => unknown, rechazar?: (e: unknown) => unknown) {
      try { return Promise.resolve(this.ejecutar()).then(resolver, rechazar); }
      catch (e) { return Promise.reject(e).then(resolver, rechazar); }
    }

    /** Sólo las columnas pedidas, como PostgREST. `autor:usuarios(nombre)` es un embed. */
    private proyectar(fila: Fila): Fila {
      if (!this.columnas) return fila;
      const salida: Fila = {};
      for (const c of this.columnas.split(/,(?![^(]*\))/).map((x) => x.trim())) {
        if (c.includes(":")) {
          const nombre = NOMBRES[String(fila.creado_por ?? "")];
          salida[c.split(":")[0]] = nombre ? { nombre } : null;
        } else salida[c] = fila[c];
      }
      return salida;
    }

    private ejecutar() {
      const filas = estado.tablas[this.tabla] ?? (estado.tablas[this.tabla] = []);

      if (this.accion === "insert") {
        const nueva = {
          id: `nueva-${filas.length + 1}`, creado_en: "2026-10-31T15:00:00Z", ...this.fila,
        };
        filas.push(nueva);
        estado.inserts.push(nueva);
        return { data: this.proyectar(nueva), error: null };
      }

      const coincide = (f: Fila) =>
        this.igualdades.every(([c, v]) => f[c] === v) &&
        (!this.enLista || this.enLista[1].includes(f[this.enLista[0]]));

      const halladas = filas.filter(coincide);
      if (this.unica) {
        if (halladas[0]) return { data: this.proyectar(halladas[0]), error: null };
        return this.unica === "maybeSingle"
          ? { data: null, error: null }
          : { data: null, error: { message: "no hay" } };
      }

      // Corta en 1.000 como PostgREST, con `.range()` o sin él: sin esto nada
      // notaría que una lectura dejó de paginar.
      const [desde, hasta] = this.rango ?? [0, TOPE - 1];
      const tanda = halladas.slice(desde, Math.min(hasta + 1, desde + TOPE));
      return { data: tanda.map((f) => this.proyectar(f)), error: null };
    }
  }

  const admin = { from: (tabla: string) => new Consulta(tabla) };
  const avisar = vi
    .fn<(admin: unknown, opciones: { usuarioId: string }) => Promise<{ enviadas: number; personas: number; motivo?: string }>>()
    .mockResolvedValue({ enviadas: 1, personas: 1 });
  const escribirPlanilla = vi.fn(async (_orden: unknown, celdas: unknown): Promise<string | null> => {
    estado.planilla.push(celdas);
    return null;
  });

  return { estado, admin, avisar, escribirPlanilla };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.estado.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/compras/auth", () => ({ tieneAccesoCompras: async () => h.estado.accesoCompras }));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({ escribirEnLaFilaDeLaOT: h.escribirPlanilla }));
// Lo único que se cambia es quién manda el push: a quién, cuándo y con qué texto ya
// tienen sus tests. Acá interesa a quién se le pide y si se pide.
vi.mock("@/lib/core/avisoAUnaPersona", () => ({ avisarAUnaPersona: h.avisar }));

import { GET, POST } from "@/app/api/compras/consultas/route";

// Sin `Request`: el GET no lee nada de la URL —la bandeja no tiene filtros—, así que
// la ruta no lo recibe.
const get = () => GET();
const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }));

/** Una PREGUNTA de Ana sobre el rodamiento de la OT 2885. */
const pregunta = (p: Record<string, unknown> = {}) => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega antes del jueves?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "ana",
  repuesto_id: "r1", responde_a: null, ...p,
});

/** Las columnas sin las cuales la bandeja queda vacía y nada se queja. */
const COLUMNAS_SIN_LAS_QUE_LA_BANDEJA_SE_VACIA = ["orden_id", "tipo", "repuesto_id", "responde_a"];

beforeEach(() => {
  const e = h.estado;
  e.usuario = { id: "facundo" };
  e.accesoCompras = true;
  e.selects = []; e.inserts = []; e.planilla = [];
  e.tablas = {
    ordenes_trabajo: [
      { id: "ot1", ot_number: 2885, descripcion: "Pérdida en el filler", estado: "POR_HACER" },
      { id: "ot2", ot_number: 2886, descripcion: "Cambio de correa", estado: "REALIZADO" },
    ],
    ordenes_trabajo_repuestos: [
      { id: "r1", work_order_id: "ot1", nombre: "Rodamiento 6206", codigo: "00473" },
      { id: "r2", work_order_id: "ot2", nombre: "Correa B-75", codigo: null },
    ],
    ordenes_trabajo_notas: [pregunta()],
  };
  h.avisar.mockClear();
  h.escribirPlanilla.mockClear();
});

describe("la bandeja", () => {
  it("trae la consulta abierta con su orden, su repuesto y quién preguntó", async () => {
    const res = await get();
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: "n1",
      texto: "¿Llega antes del jueves?",
      autor: "Ana",
      orden: { ot_number: 2885, descripcion: "Pérdida en el filler" },
      repuesto: { nombre: "Rodamiento 6206", codigo: "00473" },
    });
  });

  /*
   * El que se rompe sin ruido, y el motivo por el que este archivo existe: con
   * cualquiera de estas columnas de menos la bandeja sale vacía y se ve igual que
   * una bandeja sin nada pendiente.
   */
  it("el select de las notas trae las columnas sin las que la bandeja se vacía", async () => {
    await get();
    const deNotas = h.estado.selects.find((s) => s.tabla === "ordenes_trabajo_notas");

    expect(deNotas, "la ruta ni siquiera leyó las notas").toBeDefined();
    for (const columna of COLUMNAS_SIN_LAS_QUE_LA_BANDEJA_SE_VACIA) {
      expect(deNotas!.columnas, columna).toContain(columna);
    }
  });

  // El estado decide si la pregunta sigue esperando; sin él, `preguntasAbiertas` lo
  // lee como desconocido y deja abiertas las de las órdenes ya realizadas.
  it("el select de las órdenes trae el estado", async () => {
    await get();
    const deOrdenes = h.estado.selects.find((s) => s.tabla === "ordenes_trabajo");

    expect(deOrdenes).toBeDefined();
    expect(deOrdenes!.columnas).toContain("estado");
  });

  // Cada orden con su propio estado: la de la OT realizada no tiene que aparecer
  // aunque la otra siga por hacer.
  it("no muestra la pregunta de una orden que ya no espera nada", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      pregunta({ id: "n2", orden_id: "ot2", repuesto_id: "r2" }),
    ];

    const { data } = await (await get()).json();
    expect(data.map((c: { id: string }) => c.id)).toEqual(["n1"]);
  });

  it("una pregunta ya contestada no sigue en la bandeja", async () => {
    h.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "facundo" }),
    ];

    expect((await (await get()).json()).data).toEqual([]);
  });

  it("sin acceso a Compras no se ve: 403", async () => {
    h.estado.accesoCompras = false;
    expect((await get()).status).toBe(403);
  });

  it("sin sesión: 401", async () => {
    h.estado.usuario = null;
    expect((await get()).status).toBe(401);
  });
});

describe("contestar", () => {
  it("guarda la respuesta apuntando a la pregunta, escribe la celda X y avisa a quien preguntó", async () => {
    const res = await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts[0]).toMatchObject({
      orden_id: "ot1",
      tipo: "RESPUESTA",
      responde_a: "n1",
      // El repuesto es el de la pregunta: repetirlo sería un segundo dato.
      repuesto_id: null,
      creado_por: "facundo",
      texto: "Lo entrega el jueves",
    });

    // La respuesta de Compras pasa a ser la justificación vigente de la OT.
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "Lo entrega el jueves" }]]);

    expect(h.avisar).toHaveBeenCalledTimes(1);
    expect(h.avisar.mock.calls[0][1]).toMatchObject({ usuarioId: "ana" });
    expect(cuerpo.aviso).toEqual({ enviadas: 1, personas: 1 });
    expect(cuerpo.planilla_error).toBeNull();
  });

  // El push es a UNA persona nombrada: la que preguntó, no la lista de consultados.
  it("el aviso lleva la OT, el repuesto y lo que se contestó", async () => {
    await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const { aviso } = h.avisar.mock.calls[0][1] as unknown as { aviso: Record<string, string> };

    expect(Object.keys(aviso).sort()).toEqual(["body", "title", "url"]);
    expect(aviso.body).toContain("OT 2885");
    expect(aviso.body).toContain("Rodamiento 6206");
    expect(aviso.url).toBe("/mantenimiento/ordenes?q=2885");
  });

  // La ruta no repite las dos condiciones del aviso: pide el destinatario, y si viene
  // `null` no avisa. Quien contesta su propia pregunta no se interrumpe a sí mismo.
  it("quien contesta su propia pregunta no recibe un push de lo que acaba de escribir", async () => {
    h.estado.usuario = { id: "ana" };
    const res = await post({ pregunta_id: "n1", texto: "Ya lo gestioné yo" });

    expect(res.status).toBe(200);
    expect(h.estado.inserts).toHaveLength(1);
    expect(h.avisar).not.toHaveBeenCalled();
    expect((await res.json()).aviso).toBeNull();
  });

  // Review Focus 5: la respuesta ya está guardada, así que un push que falla no la
  // puede voltear. Lo único que queda es el motivo en la respuesta de la ruta.
  it("si el push falla, la respuesta queda igual y vuelve el motivo", async () => {
    h.avisar.mockRejectedValueOnce(new Error("push service caído"));
    const res = await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(h.estado.inserts).toHaveLength(1);
    expect(cuerpo.aviso.motivo).toContain("push service caído");
  });

  // La planilla escribe con USER_ENTERED: una respuesta que arranca con `=` entraría
  // como fórmula.
  it("una respuesta que arranca con = va a la planilla como texto", async () => {
    await post({ pregunta_id: "n1", texto: "=IMPORTRANGE(\"x\";\"A1\")" });
    expect(h.estado.planilla).toEqual([[{ columna: 23, valor: "'=IMPORTRANGE(\"x\";\"A1\")" }]]);
  });

  // Un fallo de escritura nunca es un `console.warn`: se le dice a quien lo hizo.
  it("si la planilla falla, lo dice y la respuesta queda guardada igual", async () => {
    h.escribirPlanilla.mockResolvedValueOnce("Google dijo que no");
    const cuerpo = await (await post({ pregunta_id: "n1", texto: "Llega el lunes" })).json();

    expect(h.estado.inserts).toHaveLength(1);
    expect(cuerpo.planilla_error).toBe("Google dijo que no");
  });
});

/*
 * Lo que la ruta rechaza no se guarda, no escribe la planilla y no avisa. Qué se
 * rechaza y por qué lo deciden `puedeResponderConsulta` y `preguntasAbiertas`, con sus
 * tests en `lib/`; acá se prueba sólo que la ruta les hace caso y que no toca nada
 * cuando dicen que no. Cada caso existe porque mata una rotura que sólo se ve acá:
 *
 *  - la pregunta ya contestada: la ruta tiene que LEER las demás notas de esa orden,
 *    con `tipo` y `responde_a` en el select;
 *  - la orden realizada: la ruta tiene que pasarle a la regla el estado de la orden;
 *  - la nota que no es una pregunta: no se le puede «responder» a una justificación,
 *    y sin esto quedaría un hilo que `preguntasAbiertas` no sabe leer;
 *  - el 403: el permiso se comprueba en la ruta, y sin nivel de Mantenimiento.
 */
describe("lo que la ruta rechaza no se guarda, ni escribe la planilla, ni avisa", () => {
  const casos: { nombre: string; status: number; preparar?: () => void; cuerpo: unknown }[] = [
    {
      nombre: "una pregunta que ya tiene respuesta",
      status: 409,
      preparar: () => {
        h.estado.tablas.ordenes_trabajo_notas = [
          pregunta(),
          pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "facundo" }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una pregunta superada por un seguimiento",
      status: 409,
      preparar: () => {
        h.estado.tablas.ordenes_trabajo_notas = [
          pregunta(),
          pregunta({ id: "n3", responde_a: "n1", texto: "Sigue sin llegar." }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una pregunta de una orden ya realizada",
      status: 409,
      preparar: () => {
        h.estado.tablas.ordenes_trabajo_notas = [pregunta({ orden_id: "ot2", repuesto_id: "r2" })];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una nota que no es una pregunta",
      status: 409,
      preparar: () => {
        h.estado.tablas.ordenes_trabajo_notas = [
          pregunta({ tipo: "JUSTIFICACION", repuesto_id: null, texto: "Esperamos la parada" }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una consulta que no existe",
      status: 404,
      cuerpo: { pregunta_id: "no-existe", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "sin decir qué consulta se contesta",
      status: 400,
      cuerpo: { texto: "Lo entrega el jueves" },
    },
    {
      nombre: "sin escribir nada",
      status: 400,
      cuerpo: { pregunta_id: "n1", texto: "   " },
    },
    {
      nombre: "una respuesta más larga que la celda",
      status: 400,
      cuerpo: { pregunta_id: "n1", texto: "x".repeat(1001) },
    },
    {
      nombre: "quien no tiene Compras",
      status: 403,
      preparar: () => { h.estado.accesoCompras = false; },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
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

  it("sin sesión: 401", async () => {
    h.estado.usuario = null;
    expect((await post({ pregunta_id: "n1", texto: "hola" })).status).toBe(401);
    expect(h.estado.inserts).toHaveLength(0);
  });

  /*
   * El texto se valida con `validarNota`, que es la regla de la casa para lo que
   * termina en la celda X. Lo único propio de esta ruta es el mensaje del caso vacío:
   * el de `validarNota` dice «Falta decir por qué no se hizo», que es correcto del
   * lado de Mantenimiento y absurdo en la bandeja de Compras. Sin fijarlo, sacar esas
   * tres líneas dejaba el 400 igual y nadie se enteraba del mensaje equivocado.
   */
  it("al que no escribió nada le dice que falta la respuesta, y no «por qué no se hizo»", async () => {
    const res = await post({ pregunta_id: "n1", texto: "   " });
    const { error } = await res.json();

    expect(res.status).toBe(400);
    expect(error).toBe("Falta escribir la respuesta.");
  });
});
