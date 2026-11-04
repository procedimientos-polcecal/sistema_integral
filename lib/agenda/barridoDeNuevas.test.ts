import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./escribirEnGoogle", async (original) => ({
  ...(await original<typeof import("./escribirEnGoogle")>()),
  escribirEnGoogle: vi.fn(),
}));

import { escribirEnGoogle } from "./escribirEnGoogle";
import {
  barrerLasQueFaltan, juntarLoAnotado, loQueSeAnotaDelBarrido, ordenesQueFaltan, TOPE_POR_CORRIDA, type DeUnaOrden,
} from "./barridoDeNuevas";
import { baseEnMemoria, type Fila } from "./baseEnMemoria.testhelper";
import { CASILLA_DE_MANTENIMIENTO } from "./evento";

/** Las 09:00 de Argentina del 04/11/2026, o sea «hoy» es el 04. */
const AHORA = new Date("2026-11-04T12:00:00.000Z");

/** La hora de pared de Argentina como el instante que se guarda. */
const instante = (horaDePared: string) => `${horaDePared}.000Z`;
const A_LAS_8 = instante("2026-11-06T11:00:00");
const A_LAS_9_30 = instante("2026-11-06T12:30:00");

/** Un id válido para `ES_UUID` a partir de un número. */
const idDe = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function orden(n: number, extra: Fila = {}): Fila {
  return {
    id: idDe(n),
    ot_number: 3000 + n,
    fecha_ejecucion: "2026-11-06",
    fecha_ejecucion_pendiente: null,
    fecha_cierre: null,
    estado: "PENDIENTE",
    created_by: null,
    equipo_raw: "Molino de cal",
    equipo_code: null,
    sector_raw: "Molienda",
    especialidad: "MECÁNICO",
    tipo: "PROGRAMADO",
    descripcion: "Cambio de correas",
    ...extra,
  };
}

/** El evento que ya tiene una OT, con la especialidad embebida como la trae el `select`. */
function eventoDe(n: number, extra: Fila = {}): Fila {
  return {
    id: `e-${n}`,
    ot_id: idDe(n),
    dueno_id: "u-mant",
    casilla: CASILLA_DE_MANTENIMIENTO,
    google_event_id: `g-${n}`,
    divergencia: null,
    aviso: null,
    titulo: `OT ${3000 + n}`,
    descripcion: null,
    lugar: null,
    inicio: A_LAS_8,
    fin: A_LAS_9_30,
    turno: "8-16",
    ordenes_trabajo: { especialidad: "MECÁNICO" },
    ...extra,
  };
}

/**
 * La base como es la de verdad: lo que se inserta queda **visible para la
 * lectura siguiente**, con su especialidad resuelta. Sin el `alInsertar` el
 * test de dos órdenes del mismo día pasaría por la razón equivocada.
 */
function base(ordenes: Fila[], eventos: Fila[] = []) {
  return baseEnMemoria(
    {
      ordenes_trabajo: ordenes,
      agenda_eventos: eventos,
      agenda_invitados: [],
      usuarios: [{ id: "u-mant", email: "Mantenimiento@Polcecal.com", activo: true }],
    },
    {
      alInsertar: {
        agenda_eventos: (fila, tablas) => ({
          ...fila,
          ordenes_trabajo: {
            especialidad: tablas.ordenes_trabajo.find((o) => o.id === fila.ot_id)?.especialidad ?? null,
          },
        }),
      },
    }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(escribirEnGoogle).mockResolvedValue({
    google_event_id: "g1",
    inicio_escrito: "2026-11-06T08:00:00-03:00",
    fin_escrito: "2026-11-06T09:30:00-03:00",
  });
});

describe("el barrido de las que faltan", () => {
  it("crea evento para una OT futura sin evento", async () => {
    const b = base([orden(1)]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r).toEqual({ creados: 1, quedaron: 0, fallos: [], fechasIlegibles: [] });
    expect(b.tablas.agenda_eventos).toHaveLength(1);
    expect(b.tablas.agenda_eventos[0]).toMatchObject({ ot_id: idDe(1), turno: "8-16", inicio: A_LAS_8 });
    expect(escribirEnGoogle).toHaveBeenCalledTimes(1);
  });

  /**
   * La que se carga con fecha pendiente y la planilla todavía no devolvió: la
   * fecha que manda es la pendiente, aunque la otra sea pasada o esté vacía.
   */
  it("toma la fecha pendiente cuando la hay, aunque la de ejecución esté vacía", async () => {
    const b = base([orden(1, { fecha_ejecucion: null, fecha_ejecucion_pendiente: "2026-11-06" })]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(1);
    expect(b.tablas.agenda_eventos[0]).toMatchObject({ ot_id: idDe(1), inicio: A_LAS_8 });
  });

  it("no vuelve a crear uno para una que ya lo tiene", async () => {
    const b = base([orden(1)], [eventoDe(1)]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r).toEqual({ creados: 0, quedaron: 0, fallos: [], fechasIlegibles: [] });
    expect(b.escrituras).toEqual([]);
    expect(escribirEnGoogle).not.toHaveBeenCalled();
  });

  it("ignora las pasadas, las cerradas y las que no tienen fecha", async () => {
    const b = base([
      orden(1, { fecha_ejecucion: "2026-11-03" }),
      orden(2, { fecha_cierre: "2026-11-05" }),
      orden(3, { estado: "REALIZADO" }),
      orden(4, { fecha_ejecucion: null }),
      // La pendiente manda: la de ejecución es futura pero la persona la movió a una que ya pasó.
      orden(5, { fecha_ejecucion: "2026-11-09", fecha_ejecucion_pendiente: "2026-11-02" }),
    ]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r).toEqual({ creados: 0, quedaron: 0, fallos: [], fechasIlegibles: [] });
    expect(b.escrituras).toEqual([]);
  });

  /**
   * Una orden con la fecha ilegible no puede desaparecer sin una palabra, aunque
   * hoy la base no pueda devolverla (ver el comentario de adentro). Las otras dos que quedan afuera —cerrada sin fecha de cierre y sin fecha—
   * son lo normal (168 de 986 `REALIZADO`) y se callan: informarlas en cada
   * corrida es el ruido que hace que nadie mire el informe.
   */
  it("una con la fecha mal formada se nombra, y las cerradas o sin fecha no", async () => {
    // OJO: esto fabrica un valor que la base real **no produciría**. Las
    // columnas son `date` y Postgres siempre devuelve AAAA-MM-DD; la base en
    // memoria no tipa, así que «2026-11-6» entra. No es evidencia de un caso
    // real: prueba el guardián de una función pura, nada más.
    const b = base([
      orden(1, { fecha_ejecucion: "2026-11-6" }),
      orden(2, { estado: "REALIZADO" }),
      orden(3, { fecha_ejecucion: null }),
      orden(4, { fecha_ejecucion: "2026-11-09", fecha_ejecucion_pendiente: "2026-11-02" }),
    ]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(0);
    expect(r.fechasIlegibles).toHaveLength(1);
    expect(r.fechasIlegibles[0]).toContain("3001");
    expect(r.fechasIlegibles[0]).toContain("2026-11-6");
    // Una fecha ilegible no es un fallo del barrido: no pone la corrida en rojo.
    expect(r.fallos).toEqual([]);
    const anotado = loQueSeAnotaDelBarrido(r);
    expect(anotado?.ok).toBe(true);
    expect(anotado?.error).toContain("3001");
    expect(anotado?.error).not.toContain("3002");
  });

  it("una de hoy entra: el filtro es por día y no por hora", async () => {
    const b = base([orden(1, { fecha_ejecucion: "2026-11-04" })]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(1);
  });

  /**
   * Review Focus 4: dos mecánicas del mismo día en la MISMA corrida. Si no se
   * cuentan entre sí, las dos ven cero ocupados y las dos caen a las 08:00 —
   * que es exactamente lo que este diseño evita.
   *
   * Y la otra cara: con una base que sí muestra lo recién escrito —que es como
   * se porta la de verdad—, adelantar los huecos por otro lado cuenta cada
   * orden dos veces y deja huecos (08:00 y 11:00, no 09:30). Por eso no hay
   * ningún mapa de «ya tomados»: la base es la única fuente.
   */
  it("dos de la misma especialidad y día en una corrida no comparten hora", async () => {
    const b = base([orden(1), orden(2)]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r).toEqual({ creados: 2, quedaron: 0, fallos: [], fechasIlegibles: [] });
    const horas = b.tablas.agenda_eventos.map((e) => e.inicio).sort();
    expect(horas).toEqual([A_LAS_8, A_LAS_9_30]);
  });

  it("tres seguidas se apilan de a 1:30, sin huecos", async () => {
    const b = base([orden(1), orden(2), orden(3)]);

    await barrerLasQueFaltan(b.cliente, AHORA);

    expect(b.tablas.agenda_eventos.map((e) => e.inicio).sort())
      .toEqual([A_LAS_8, A_LAS_9_30, instante("2026-11-06T14:00:00")]);
  });

  it("se apila detrás de lo que ya había ese día, y no mezcla especialidades ni días", async () => {
    const b = base(
      [
        orden(1),
        orden(2, { especialidad: "ELÉCTRICO" }),
        orden(3, { fecha_ejecucion: "2026-11-07" }),
        orden(9), // ya tiene evento: la mecánica del 06 que ocupa las 08:00
      ],
      [eventoDe(9)]
    );

    await barrerLasQueFaltan(b.cliente, AHORA);

    const de = (n: number) => b.tablas.agenda_eventos.find((e) => e.ot_id === idDe(n))?.inicio;
    expect(de(1)).toBe(A_LAS_9_30); // detrás de la que ya estaba
    expect(de(2)).toBe(A_LAS_8); // otra especialidad: su propio grupo
    expect(de(3)).toBe(instante("2026-11-07T11:00:00")); // otro día
  });

  it("respeta el tope y dice cuántas quedaron", async () => {
    const ordenes = Array.from({ length: 30 }, (_, i) => orden(i + 1, { especialidad: `ESP-${i}` }));
    const b = base(ordenes);

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(TOPE_POR_CORRIDA).toBe(25);
    expect(r).toEqual({ creados: 25, quedaron: 5, fallos: [], fechasIlegibles: [] });
    expect(b.tablas.agenda_eventos).toHaveLength(25);
  });

  it("acepta otro tope", async () => {
    const b = base([orden(1, { especialidad: "A" }), orden(2, { especialidad: "B" }), orden(3, { especialidad: "C" })]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA, 2);

    expect(r).toEqual({ creados: 2, quedaron: 1, fallos: [], fechasIlegibles: [] });
  });

  /** Las más cercanas primero: si el tope corta, que corte lo lejano. */
  it("manda primero las de fecha más cercana", async () => {
    const b = base([
      orden(1, { fecha_ejecucion: "2026-12-20" }),
      orden(2, { fecha_ejecucion: "2026-11-05" }),
      orden(3, { fecha_ejecucion: "2026-11-30" }),
      // La pendiente es la que cuenta para el orden, no la de ejecución.
      orden(4, { fecha_ejecucion: "2026-12-30", fecha_ejecucion_pendiente: "2026-11-06" }),
    ]);

    const r = await barrerLasQueFaltan(b.cliente, AHORA, 2);

    expect(r).toEqual({ creados: 2, quedaron: 2, fallos: [], fechasIlegibles: [] });
    expect(b.tablas.agenda_eventos.map((e) => e.ot_id).sort()).toEqual([idDe(2), idDe(4)].sort());
  });

  it("un fallo en una no frena a las demás, y se dice cuál fue", async () => {
    // Todos los inserts fallan: que salgan los dos fallos prueba que la
    // segunda se intentó después de que la primera no pudo.
    const b = baseEnMemoria(
      {
        ordenes_trabajo: [orden(1, { especialidad: "A" }), orden(2, { especialidad: "B" })],
        agenda_eventos: [],
        agenda_invitados: [],
        usuarios: [{ id: "u-mant", email: "Mantenimiento@Polcecal.com", activo: true }],
      },
      { falla: { agenda_eventos: { insert: "boom" } } }
    );

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(0);
    expect(r.quedaron).toBe(0);
    expect(r.fallos).toHaveLength(2);
    expect(r.fallos[0]).toContain("3001");
    expect(r.fallos[0]).toContain("boom");
    expect(r.fallos[1]).toContain("3002");
  });

  /**
   * El tope acota **cuántas invitaciones caen en las casillas de la gente**, y un
   * intento fallido no manda ninguna. Si los fallos gastaran cupo, 25 órdenes
   * con un fallo permanente —por ejemplo, sin usuario para su casilla—
   * agotarían el tope en cada corrida y dejarían sin intentar a todas las demás,
   * para siempre.
   */
  it("las que fallan no consumen cupo del tope", async () => {
    const b = base(
      [1, 2, 3, 4, 5, 6].map((n) =>
        orden(n, { especialidad: `ESP-${n}`, fecha_ejecucion: `2026-11-${String(n + 4).padStart(2, "0")}` })
      )
    );
    // Las tres más cercanas no se pueden guardar nunca.
    const fallan = [idDe(1), idDe(2), idDe(3)];
    const desdeAca = b.cliente.from.bind(b.cliente);
    const cliente = {
      from: (tabla: string) => {
        const q = desdeAca(tabla) as unknown as { insert: (c: Fila) => unknown };
        if (tabla !== "agenda_eventos") return q;
        const insertar = q.insert.bind(q);
        q.insert = (c: Fila) =>
          fallan.includes(String(c.ot_id))
            ? { then: (alCumplir: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(alCumplir) }
            : insertar(c);
        return q;
      },
    } as unknown as typeof b.cliente;

    const r = await barrerLasQueFaltan(cliente, AHORA, 2);

    expect(r.creados).toBe(2);
    expect(r.fallos).toHaveLength(3);
    expect(r.quedaron).toBe(1);
    expect(b.tablas.agenda_eventos.map((e) => e.ot_id).sort()).toEqual([idDe(4), idDe(5)].sort());
  });

  it("avisa de cada una apenas la intenta, con su número, para quien necesite saber cuáles salieron", async () => {
    const b = base([1, 2, 3].map((n) => orden(n, { especialidad: `ESP-${n}`, fecha_ejecucion: `2026-11-${String(n + 4).padStart(2, "0")}` })));
    const desdeAca = b.cliente.from.bind(b.cliente);
    const cliente = {
      from: (tabla: string) => {
        const q = desdeAca(tabla) as unknown as { insert: (c: Fila) => unknown };
        if (tabla !== "agenda_eventos") return q;
        const insertar = q.insert.bind(q);
        q.insert = (c: Fila) =>
          c.ot_id === idDe(2)
            ? { then: (alCumplir: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(alCumplir) }
            : insertar(c);
        return q;
      },
    } as unknown as typeof b.cliente;
    const avisos: DeUnaOrden[] = [];

    await barrerLasQueFaltan(cliente, AHORA, 25, undefined, (a) => avisos.push(a));

    expect(avisos.map((a) => [a.numero, a.ok])).toEqual([[3001, true], [3002, false], [3003, true]]);
    expect(avisos[1].error).toMatch(/boom/);
    expect(avisos[0].enGoogle).toBe(true);
  });

  it("un aviso que lanza no frena el barrido", async () => {
    const b = base([orden(1), orden(2, { especialidad: "CIVIL" })]);
    const r = await barrerLasQueFaltan(b.cliente, AHORA, 25, undefined, () => { throw new Error("pantalla rota"); });
    expect(r.creados).toBe(2);
  });

  it("si lo que lanza es una excepción, tampoco frena a las demás ni sale del barrido", async () => {
    const b = base([orden(1, { especialidad: "A" }), orden(2, { especialidad: "B", fecha_ejecucion: "2026-11-07" })]);
    vi.mocked(escribirEnGoogle)
      .mockRejectedValueOnce(new Error("se cayó Google"))
      .mockResolvedValue({
        google_event_id: "g1",
        inicio_escrito: "2026-11-07T08:00:00-03:00",
        fin_escrito: "2026-11-07T09:30:00-03:00",
      });

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(1);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain("3001");
  });

  it("nunca lanza: si no puede leer la tabla, lo dice y no crea nada", async () => {
    const b = baseEnMemoria(
      { ordenes_trabajo: [], agenda_eventos: [] },
      { falla: { ordenes_trabajo: { select: "no hay conexión" } } }
    );

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(0);
    expect(r.fallos).toHaveLength(1);
    expect(r.fallos[0]).toContain("no hay conexión");
  });

  it("si no puede leer qué OT ya tienen evento, no crea ninguno: sin eso duplicaría", async () => {
    const b = baseEnMemoria(
      { ordenes_trabajo: [orden(1)], agenda_eventos: [] },
      { falla: { agenda_eventos: { select: "no hay conexión" } } }
    );

    const r = await barrerLasQueFaltan(b.cliente, AHORA);

    expect(r.creados).toBe(0);
    expect(r.fallos[0]).toContain("no hay conexión");
    expect(b.escrituras).toEqual([]);
  });

  it("con el tiempo de Google agotado deja de intentar y cuenta lo que quedó", async () => {
    const b = base([orden(1, { especialidad: "A" }), orden(2, { especialidad: "B" }), orden(3, { especialidad: "C" })]);
    let intentos = 0;
    // Se agota después de la primera: se mira antes de empezar cada orden.
    const presupuesto = { agotado: () => intentos++ >= 1 };

    const r = await barrerLasQueFaltan(b.cliente, AHORA, TOPE_POR_CORRIDA, presupuesto);

    expect(r).toEqual({ creados: 1, quedaron: 2, fallos: [], fechasIlegibles: [] });
  });
});

describe("la selección que comparten el barrido y la corrida en seco", () => {
  it("devuelve las que faltan, por fecha y número, sin las que ya tienen evento ni escribir nada", async () => {
    const b = base(
      [
        orden(3, { fecha_ejecucion: "2026-11-07" }),
        orden(1),
        orden(2),
        orden(4, { fecha_ejecucion: "2026-11-05" }),
        orden(5, { fecha_ejecucion: "2026-11-01" }),
      ],
      [eventoDe(2)]
    );

    const r = await ordenesQueFaltan(b.cliente, AHORA);

    expect(r.error).toBeNull();
    expect(r.faltan.map((f) => [f.orden.ot_number, f.fecha])).toEqual([
      [3004, "2026-11-05"], [3001, "2026-11-06"], [3003, "2026-11-07"],
    ]);
    expect(b.escrituras).toEqual([]);
    expect(escribirEnGoogle).not.toHaveBeenCalled();
  });

  it("es la misma lista que después recorre el barrido", async () => {
    const b = base([orden(1), orden(2, { fecha_ejecucion: "2026-11-05" }), orden(3, { fecha_ejecucion: "2026-11-01" })]);
    const { faltan } = await ordenesQueFaltan(b.cliente, AHORA);

    await barrerLasQueFaltan(b.cliente, AHORA);

    expect(b.tablas.agenda_eventos.map((e) => e.ot_id).sort()).toEqual(faltan.map((f) => f.orden.id).sort());
  });

  it("trae quién generó cada orden, que es de lo que depende a quién se invita", async () => {
    const b = base([orden(1, { created_by: "u-mant" })]);
    const { faltan } = await ordenesQueFaltan(b.cliente, AHORA);
    expect(faltan[0].orden.created_by).toBe("u-mant");
  });

  it("si no puede leer, lo dice en `error` y no devuelve nada", async () => {
    const b = base([orden(1)]);
    b.cliente.from = (() => { throw new Error("se cayó la base"); }) as never;
    const r = await ordenesQueFaltan(b.cliente, AHORA);
    expect(r.faltan).toEqual([]);
    expect(r.error).toMatch(/se cayó la base/);
  });
});

describe("lo que se anota de un barrido", () => {
  it("nada que decir cuando entró todo", () => {
    expect(loQueSeAnotaDelBarrido({ creados: 3, quedaron: 0, fallos: [], fechasIlegibles: [] })).toBeNull();
  });

  it("lo que quedó afuera se dice, y no es un fallo", () => {
    const a = loQueSeAnotaDelBarrido({ creados: 25, quedaron: 5, fallos: [], fechasIlegibles: [] });
    expect(a?.ok).toBe(true);
    expect(a?.error).toContain("5");
  });

  it("juntar dos anotaciones no pierde ninguna y sale en rojo si alguna lo está", () => {
    expect(juntarLoAnotado(null, null)).toBeNull();
    expect(juntarLoAnotado(null, { ok: true, error: "B" })).toEqual({ ok: true, error: "B" });
    expect(juntarLoAnotado({ ok: true, error: "A" }, { ok: false, error: "B" })).toEqual({ ok: false, error: "A. B" });
  });

  it("una fecha ilegible se dice pero no pone la corrida en rojo", () => {
    const a = loQueSeAnotaDelBarrido({ creados: 0, quedaron: 0, fallos: [], fechasIlegibles: ["OT 3001: fecha rara"] });
    expect(a).toMatchObject({ ok: true });
    expect(a?.error).toContain("OT 3001: fecha rara");
  });

  it("un fallo sale en rojo y lleva el texto de cada uno", () => {
    const a = loQueSeAnotaDelBarrido({ creados: 1, quedaron: 0, fallos: ["OT 3002: boom"], fechasIlegibles: [] });
    expect(a?.ok).toBe(false);
    expect(a?.error).toContain("OT 3002: boom");
  });
});
