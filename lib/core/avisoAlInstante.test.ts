import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  esHoraDeAvisar,
  textoDeLaInterrupcion,
  aparatosAAvisar,
  avisarAQuienDecide,
  type ItemQueEspera,
} from "./avisoAlInstante";
import { enviarPush } from "./webpush";

// El envío real necesita las claves VAPID y sale a internet. Lo que se prueba
// acá es a quién se le manda y qué pasa cuando falla, no `web-push`.
vi.mock("./webpush", () => ({ enviarPush: vi.fn() }));

const PEDIDO = { singular: "Un pedido", plural: "pedidos" };
const URL = "/compras/aprobaciones";

describe("esHoraDeAvisar", () => {
  /*
   * La ventana es 7:00–21:00 de Argentina, o sea 10:00–00:00 UTC. Los bordes se
   * prueban con el instante UTC y no con una hora local, porque eso es lo que
   * la funcion recibe en produccion: Vercel corre en UTC.
   */
  it("adentro de la ventana", () => {
    expect(esHoraDeAvisar(new Date("2026-10-18T12:00:00Z"))).toBe(true); // 9:00 AR
    expect(esHoraDeAvisar(new Date("2026-10-18T10:00:00Z"))).toBe(true); // 7:00 AR, el borde
    expect(esHoraDeAvisar(new Date("2026-10-18T23:59:00Z"))).toBe(true); // 20:59 AR
  });

  it("afuera: la madrugada de Argentina, que en UTC ya es el dia siguiente", () => {
    expect(esHoraDeAvisar(new Date("2026-10-19T00:00:00Z"))).toBe(false); // 21:00 AR
    expect(esHoraDeAvisar(new Date("2026-10-19T03:00:00Z"))).toBe(false); // 0:00 AR
    expect(esHoraDeAvisar(new Date("2026-10-19T02:59:00Z"))).toBe(false); // 23:59 AR
  });

  // El cron de Compras corre a las 09:00 UTC, que son las 6 de la manana de
  // aca. Medido: en 27 dias trajo filas nuevas a esa hora una sola vez.
  it("el cron de las seis de la manana queda afuera", () => {
    expect(esHoraDeAvisar(new Date("2026-10-18T09:00:00Z"))).toBe(false);
  });
});

describe("textoDeLaInterrupcion", () => {
  it("sin items no se manda nada", () => {
    expect(textoDeLaInterrupcion([], PEDIDO, URL)).toBeNull();
  });

  it("uno solo se nombra, con lo que pidio", () => {
    expect(
      textoDeLaInterrupcion(
        [{ etiqueta: "RI 1842", descripcion: "Rodamiento SKF 6205" }],
        PEDIDO,
        URL
      )
    ).toEqual({
      title: "Un pedido espera tu aprobación",
      body: "RI 1842 · Rodamiento SKF 6205",
      url: URL,
    });
  });

  it("uno solo sin descripcion queda con la etiqueta sola", () => {
    expect(
      textoDeLaInterrupcion(
        [{ etiqueta: "OS 231", descripcion: null }],
        { singular: "Una orden de servicio", plural: "órdenes de servicio" },
        URL
      )
    ).toEqual({
      title: "Una orden de servicio espera tu aprobación",
      body: "OS 231",
      url: URL,
    });
  });

  it("tres se nombran todos", () => {
    expect(
      textoDeLaInterrupcion(
        [1842, 1843, 1844].map((n) => ({ etiqueta: `RI ${n}`, descripcion: "x" })),
        PEDIDO,
        URL
      )
    ).toEqual({
      title: "3 pedidos esperan tu aprobación",
      body: "RI 1842, RI 1843 y RI 1844",
      url: URL,
    });
  });

  /*
   * El freno contra una pegada de doscientas filas en la planilla: sigue siendo
   * UNA notificacion. Es la regla que gobierna todo el diseño y la unica razon
   * por la que esto no repite el problema que la fase 2 decidio no tener.
   */
  it("doscientos son una sola notificacion", () => {
    expect(
      textoDeLaInterrupcion(
        Array.from({ length: 200 }, (_, i) => ({ etiqueta: `RI ${i + 1}`, descripcion: null })),
        PEDIDO,
        URL
      )
    ).toEqual({
      title: "200 pedidos esperan tu aprobación",
      body: "RI 1, RI 2, RI 3 y 197 más",
      url: URL,
    });
  });

  it("una descripcion larga se recorta", () => {
    const r = textoDeLaInterrupcion(
      [{ etiqueta: "RI 1", descripcion: "a".repeat(200) }],
      PEDIDO,
      URL
    );
    expect(r!.body.length).toBeLessThanOrEqual(90);
    expect(r!.body.endsWith("…")).toBe(true);
  });

  it("una descripcion en blanco se trata como ausente", () => {
    expect(
      textoDeLaInterrupcion([{ etiqueta: "RI 1", descripcion: "   " }], PEDIDO, URL)!.body
    ).toBe("RI 1");
  });
});

describe("aparatosAAvisar", () => {
  const subs = [
    { usuario_id: "ana", endpoint: "a1" },
    { usuario_id: "ana", endpoint: "a2" },
    { usuario_id: "beto", endpoint: "b1" },
    { usuario_id: "caro", endpoint: "c1" },
  ];

  // La clave de `push_suscripciones` es (usuario_id, endpoint): el celular y la
  // computadora son dos filas y las dos tienen que sonar.
  it("los dos aparatos de la misma persona reciben los dos", () => {
    expect(aparatosAAvisar(subs, new Set(["ana"]), null)).toEqual([
      { usuario_id: "ana", endpoint: "a1" },
      { usuario_id: "ana", endpoint: "a2" },
    ]);
  });

  it("quien no puede decidir no recibe", () => {
    expect(aparatosAAvisar(subs, new Set(["beto"]), null).map((s) => s.endpoint)).toEqual([
      "b1",
    ]);
  });

  it("a quien lo cargo no se le avisa de lo que acaba de hacer", () => {
    expect(
      aparatosAAvisar(subs, new Set(["ana", "beto"]), "ana").map((s) => s.endpoint)
    ).toEqual(["b1"]);
  });

  it("nadie con suscripcion entre los que deciden da vacio", () => {
    expect(aparatosAAvisar(subs, new Set(["nadie"]), null)).toEqual([]);
  });

  it("sin suscripciones da vacio", () => {
    expect(aparatosAAvisar([] as { usuario_id: string }[], new Set(["ana"]), null)).toEqual([]);
  });
});

describe("los dos armados reales", () => {
  const unRequerimiento: ItemQueEspera[] = [
    { etiqueta: "RI 1842", descripcion: "Rodamiento SKF 6205 para la cinta 3" },
  ];

  it("el texto de un pedido de compra", () => {
    expect(textoDeLaInterrupcion(unRequerimiento, PEDIDO, "/compras/aprobaciones")).toEqual({
      title: "Un pedido espera tu aprobación",
      body: "RI 1842 · Rodamiento SKF 6205 para la cinta 3",
      url: "/compras/aprobaciones",
    });
  });

  // Las OS se aprueban en /compras/aprobaciones aunque sean una entidad de
  // Mantenimiento: es donde se ejerce la decision.
  it("el texto de una orden de servicio lleva a la misma pantalla", () => {
    expect(
      textoDeLaInterrupcion(
        [{ etiqueta: "OS 231", descripcion: "Reparación de bomba hidráulica" }],
        { singular: "Una orden de servicio", plural: "órdenes de servicio" },
        "/compras/aprobaciones"
      )
    ).toEqual({
      title: "Una orden de servicio espera tu aprobación",
      body: "OS 231 · Reparación de bomba hidráulica",
      url: "/compras/aprobaciones",
    });
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * El envío
 *
 * Lo que se prueba acá no es el texto —eso ya está arriba, puro— sino las dos
 * propiedades que no se pueden sacar de una función pura: que un fallo no
 * voltee la acción que lo disparó, y que no reciba quien no debe.
 * ────────────────────────────────────────────────────────────────────────── */

/** Un Supabase de mentira que devuelve lo que se le pide por tabla y anota qué le pidieron. */
function clienteFalso(
  tablas: Record<string, unknown[]>,
  opciones: { errorEn?: string } = {}
) {
  const hechos: string[] = [];

  const consulta = (tabla: string) => {
    const self: Record<string, unknown> = {};
    const encadena = () => self;
    for (const m of ["select", "eq", "in", "range", "returns", "order", "not", "is"]) {
      self[m] = encadena;
    }
    self.then = (resolver: (v: unknown) => unknown) =>
      Promise.resolve(
        opciones.errorEn === tabla
          ? { data: null, error: { message: `la tabla ${tabla} no se pudo leer` } }
          : { data: tablas[tabla] ?? [], error: null }
      ).then(resolver);
    self.delete = () => {
      const borra: Record<string, unknown> = {};
      const eq = (_c: string, v: unknown) => {
        if (typeof v === "string" && v.startsWith("http")) hechos.push(`borra ${v}`);
        return borra;
      };
      borra.eq = eq;
      borra.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r);
      return borra;
    };
    return self;
  };

  return { cliente: { from: consulta } as never, hechos };
}

const sub = (usuario_id: string, endpoint: string) => ({
  usuario_id, endpoint, p256dh: "p", auth: "a",
});

const UN_ITEM: ItemQueEspera[] = [{ etiqueta: "RI 1", descripcion: "algo" }];
const DE_DIA = new Date("2026-10-19T15:00:00Z"); // 12:00 AR
const DE_NOCHE = new Date("2026-10-19T05:00:00Z"); // 2:00 AR

const base = {
  lista: "compras_aprobadores" as const,
  items: UN_ITEM,
  nombre: PEDIDO,
  url: URL,
  ahora: DE_DIA,
};

describe("avisarAQuienDecide", () => {
  beforeEach(() => {
    vi.mocked(enviarPush).mockReset();
    vi.mocked(enviarPush).mockResolvedValue("enviada");
  });

  it("fuera de hora no manda ni lee nada", async () => {
    const { cliente } = clienteFalso({});
    expect(await avisarAQuienDecide(cliente, { ...base, ahora: DE_NOCHE })).toEqual({
      enviadas: 0, personas: 0, motivo: "fuera de hora",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  it("sin items no lee ni manda nada", async () => {
    const { cliente } = clienteFalso({});
    expect(await avisarAQuienDecide(cliente, { ...base, items: [] })).toEqual({
      enviadas: 0, personas: 0, motivo: "nada que avisar",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  it("manda a cada aparato de cada aprobador activo", async () => {
    const { cliente } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }, { usuario_id: "beto" }],
      push_suscripciones: [sub("ana", "a1"), sub("ana", "a2"), sub("beto", "b1")],
      usuarios: [{ id: "ana" }, { id: "beto" }],
    });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({ enviadas: 3, personas: 2 });
  });

  // `push_suscripciones` sobrevive a desactivar a alguien: sus filas se van
  // recién con el `on delete cascade`, o sea al borrar al usuario.
  it("un aprobador dado de baja no recibe aunque tenga suscripcion", async () => {
    const { cliente } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }],
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [], // ninguno activo
    });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({
      enviadas: 0, personas: 0, motivo: "nadie activo",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  it("a quien lo cargo no se le avisa, aunque sea aprobador", async () => {
    const { cliente } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }],
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [{ id: "ana" }],
    });
    expect(await avisarAQuienDecide(cliente, { ...base, excepto: "ana" })).toEqual({
      enviadas: 0, personas: 0, motivo: "nadie suscripto",
    });
  });

  /*
   * La propiedad que importa: un push service caido no puede hacer fallar la
   * sincronizacion que lo llamo. La compra ya quedo pedida.
   */
  it("si enviarPush tira, no relanza", async () => {
    vi.mocked(enviarPush).mockRejectedValue(new Error("el push service exploto"));
    const { cliente } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }],
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [{ id: "ana" }],
    });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({
      enviadas: 0, personas: 0, motivo: "el push service exploto",
    });
  });

  it("si la lectura de la base falla, no relanza", async () => {
    const { cliente } = clienteFalso({}, { errorEn: "compras_aprobadores" });
    const r = await avisarAQuienDecide(cliente, base);
    expect(r.enviadas).toBe(0);
    expect(r.motivo).toContain("no se pudo leer");
  });

  it("un fallo de envio no borra la suscripcion ni frena a los demas", async () => {
    vi.mocked(enviarPush)
      .mockResolvedValueOnce("fallo")
      .mockResolvedValueOnce("enviada");
    const { cliente, hechos } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }, { usuario_id: "beto" }],
      push_suscripciones: [sub("ana", "https://a1"), sub("beto", "https://b1")],
      usuarios: [{ id: "ana" }, { id: "beto" }],
    });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({ enviadas: 1, personas: 2 });
    expect(hechos).toEqual([]);
  });

  // Se desinstalo la app de un telefono, no se dio de baja de todo: se borra
  // ese aparato y no los otros de la misma persona.
  it("una suscripcion vencida se borra, y la otra de la misma persona no", async () => {
    vi.mocked(enviarPush)
      .mockResolvedValueOnce("vencida")
      .mockResolvedValueOnce("enviada");
    const { cliente, hechos } = clienteFalso({
      compras_aprobadores: [{ usuario_id: "ana" }],
      push_suscripciones: [sub("ana", "https://a1"), sub("ana", "https://a2")],
      usuarios: [{ id: "ana" }],
    });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({ enviadas: 1, personas: 1 });
    expect(hechos).toEqual(["borra https://a1"]);
  });

  it("sin nadie en la lista de aprobadores no se lee ni una suscripcion", async () => {
    const { cliente } = clienteFalso({ compras_aprobadores: [] });
    expect(await avisarAQuienDecide(cliente, base)).toEqual({
      enviadas: 0, personas: 0, motivo: "nadie aprueba",
    });
  });
});
