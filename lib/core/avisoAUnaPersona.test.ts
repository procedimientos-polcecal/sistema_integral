import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { avisarAUnaPersona } from "./avisoAUnaPersona";
import { enviarPush, type Aviso } from "./webpush";

// El envío real necesita las claves VAPID y sale a internet. Lo que se prueba
// acá es a quién se le manda, cuándo, y qué pasa cuando algo falla; no `web-push`.
vi.mock("./webpush", () => ({ enviarPush: vi.fn() }));

/* ──────────────────────────────────────────────────────────────────────────
 * El cliente de mentira
 *
 * Se porta como el de verdad en cuatro cosas que acá deciden si el código está
 * bien, y por eso es más que un `{ data: [...] }` fijo:
 *
 *   - **Aplica los `.eq()`**. Un fake que devolviera siempre todas las filas no
 *     distinguiría una consulta acotada a una persona de una que no lo está.
 *   - **Corta en 1.000 filas**, con `.range()` o sin él, como PostgREST, que no
 *     avisa. Sin esto, nada notaría que la lectura dejó de paginar.
 *   - **Entrega sólo las columnas del `select()`**. Con el `select` ignorado, un
 *     refactor de «traigo sólo lo necesario» que sacara `usuario_id` o `p256dh`
 *     pasaría los tests y rompería el envío.
 *   - **Borra de verdad**: después de un `delete()` la fila ya no está, y los
 *     tests miran qué quedó en la tabla, no sólo qué se pidió borrar.
 *
 * Además anota qué se leyó, para poder afirmar que algo NO se tocó, y corta si
 * se lee de más: una paginación que no avanza (un `.range()` que falta) itera
 * para siempre y colgaría la suite en vez de hacerla fallar. Y puede fallar
 * donde se le pida —al leer una tabla o al borrar en ella—, porque lo que más
 * pesa en esta función es qué hace cuando algo sale mal.
 * ────────────────────────────────────────────────────────────────────────── */

type Fila = Record<string, unknown>;
type Resultado = { data: Fila[] | null; error: { message: string } | null };

interface ConsultaFalsa {
  select(columnas?: string): ConsultaFalsa;
  eq(columna: string, valor: unknown): ConsultaFalsa;
  range(desde: number, hasta: number): ConsultaFalsa;
  delete(): ConsultaFalsa;
  maybeSingle(): Promise<{ data: Fila | null; error: { message: string } | null }>;
  // Es lo que hace que `await consulta` y `traerTodo()` funcionen.
  then(resolver: (v: Resultado) => unknown, rechazar?: (e: unknown) => unknown): Promise<unknown>;
}

const TOPE_DE_POSTGREST = 1000;
/** Con 1.001 filas hacen falta dos lecturas de aparatos; esto es mucho más de lo legítimo. */
const MAXIMO_DE_LECTURAS = 50;

/**
 * `ignorarFiltrosEn` hace que una tabla devuelva todo aunque se la filtre: es la
 * forma de preguntar qué pasa **si** la lectura trajera filas que no debía.
 * `errorEn` hace que toda lectura de esa tabla devuelva un error.
 * `errorAlBorrarEn` hace que todo borrado en esa tabla devuelva un error y no
 * borre nada.
 */
function adminFalso(
  tablas: Record<string, Fila[]>,
  opciones: { errorEn?: string; ignorarFiltrosEn?: string; errorAlBorrarEn?: string } = {}
) {
  // Copias: un borrado en un test no puede filtrarse al siguiente.
  const datos: Record<string, Fila[]> = Object.fromEntries(
    Object.entries(tablas).map(([tabla, filas]) => [tabla, [...filas]])
  );
  const lecturas: { tabla: string; filtros: Fila }[] = [];

  const from = (tabla: string): ConsultaFalsa => {
    const filtros: Fila = {};
    let columnas: string[] | null = null;
    let rango: [number, number] | null = null;
    let borrando = false;

    const filasQueCoinciden = () =>
      (datos[tabla] ?? []).filter(
        (fila) =>
          opciones.ignorarFiltrosEn === tabla ||
          Object.entries(filtros).every(([columna, valor]) => fila[columna] === valor)
      );

    // El filtro se aplica sobre la fila entera y recién después se recortan las
    // columnas, igual que en la base: se puede filtrar por lo que no se trae.
    const soloLasPedidas = (fila: Fila): Fila =>
      columnas ? Object.fromEntries(columnas.map((c) => [c, fila[c]])) : fila;

    const leer = (): Resultado => {
      if (lecturas.length >= MAXIMO_DE_LECTURAS) {
        throw new Error(`más de ${MAXIMO_DE_LECTURAS} lecturas: ¿una paginación que no avanza?`);
      }
      lecturas.push({ tabla, filtros: { ...filtros } });
      if (opciones.errorEn === tabla) {
        return { data: null, error: { message: `la tabla ${tabla} no se pudo leer` } };
      }
      const [desde, hasta] = rango ?? [0, TOPE_DE_POSTGREST - 1];
      // PostgREST corta en `max-rows` aunque el rango pida más.
      const fin = Math.min(hasta + 1, desde + TOPE_DE_POSTGREST);
      return { data: filasQueCoinciden().slice(desde, fin).map(soloLasPedidas), error: null };
    };

    const borrar = (): Resultado => {
      if (opciones.errorAlBorrarEn === tabla) {
        return { data: null, error: { message: `la tabla ${tabla} no dejó borrar` } };
      }
      const aBorrar = new Set(filasQueCoinciden());
      datos[tabla] = (datos[tabla] ?? []).filter((fila) => !aBorrar.has(fila));
      return { data: null, error: null };
    };

    const consulta: ConsultaFalsa = {
      select: (pedidas) => {
        if (pedidas && pedidas.trim() !== "*") columnas = pedidas.split(",").map((c) => c.trim());
        return consulta;
      },
      eq: (columna, valor) => {
        filtros[columna] = valor;
        return consulta;
      },
      range: (desde, hasta) => {
        rango = [desde, hasta];
        return consulta;
      },
      delete: () => {
        borrando = true;
        return consulta;
      },
      maybeSingle: () => {
        const { data, error } = leer();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      then: (resolver, rechazar) =>
        Promise.resolve(borrando ? borrar() : leer()).then(resolver, rechazar),
    };
    return consulta;
  };

  return {
    cliente: { from } as never,
    lecturas,
    /** Lo que quedó en la tabla después de lo que hizo la función. */
    filas: (tabla: string) => datos[tabla] ?? [],
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Lo de siempre
 * ────────────────────────────────────────────────────────────────────────── */

/** Una fila de `push_suscripciones`. Las claves llevan el endpoint para reconocer cuál llegó. */
const sub = (usuario_id: string, endpoint: string) => ({
  usuario_id,
  endpoint,
  p256dh: `p-${endpoint}`,
  auth: `a-${endpoint}`,
});

/** Quien preguntó, con la cuenta activa: el caso normal. */
const ANA = { id: "ana", activo: true };
const BETO = { id: "beto", activo: true };

const AVISO: Aviso = {
  title: "Compras contestó tu pregunta",
  body: "OT 2885 · Rodamiento 6206",
  url: "/mantenimiento/ordenes",
};

const MEDIODIA = new Date("2026-10-29T12:00:00-03:00"); // 12:00 de Argentina
// Las 6:00 de Argentina son las 09:00 UTC, la hora a la que corre el cron de
// Compras: afuera de la ventana 7:00–21:00. Los bordes de la ventana los prueba
// `avisoAlInstante.test.ts`; acá importa que esta función la respete.
const MADRUGADA = new Date("2026-10-29T06:00:00-03:00");

const base = { usuarioId: "ana", aviso: AVISO, ahora: MEDIODIA };

/** A qué aparatos (por endpoint) se les mandó, en orden. */
const endpointsAvisados = () =>
  vi.mocked(enviarPush).mock.calls.map(([aparato]) => aparato.endpoint);

describe("avisarAUnaPersona", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(enviarPush).mockReset();
    vi.mocked(enviarPush).mockResolvedValue("enviada");
    // El `catch` deja un `console.error`; que los tests que lo provocan no
    // ensucien la salida.
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  /* ── La hora ─────────────────────────────────────────────────────────── */

  it("fuera de hora no manda nada ni toca la base", async () => {
    const { cliente, lecturas } = adminFalso({
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [ANA],
    });

    const r = await avisarAUnaPersona(cliente, { ...base, ahora: MADRUGADA });

    expect(r).toEqual({ enviadas: 0, personas: 0, motivo: "fuera de hora" });
    expect(enviarPush).not.toHaveBeenCalled();
    expect(lecturas).toEqual([]);
  });

  // En producción nadie pasa `ahora`: la ruta llama con `{ usuarioId, aviso }`.
  // Todos los otros tests la inyectan, así que sin éste una función que no manda
  // nunca de verdad —por ejemplo, con la época como reloj por defecto— pasaba la
  // suite entera en verde. Se finge sólo `Date`, que es lo único que lee
  // `esHoraDeAvisar`.
  it("sin `ahora`, que es como se llama en producción, usa el reloj de verdad", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { cliente } = adminFalso({
        push_suscripciones: [sub("ana", "a1")],
        usuarios: [ANA],
      });
      const sinAhora = { usuarioId: "ana", aviso: AVISO };

      vi.setSystemTime(MEDIODIA);
      expect(await avisarAUnaPersona(cliente, sinAhora)).toEqual({ enviadas: 1, personas: 1 });

      vi.setSystemTime(MADRUGADA);
      expect(await avisarAUnaPersona(cliente, sinAhora)).toEqual({
        enviadas: 0,
        personas: 0,
        motivo: "fuera de hora",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  /* ── A quién ─────────────────────────────────────────────────────────── */

  it("manda a todos los aparatos de esa persona y a nadie más", async () => {
    const { cliente } = adminFalso({
      push_suscripciones: [sub("ana", "a1"), sub("ana", "a2"), sub("beto", "b1")],
      usuarios: [ANA, BETO],
    });

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 2, personas: 1 });
    expect(endpointsAvisados()).toEqual(["a1", "a2"]);
  });

  it("lee sólo los aparatos de esa persona, no los de todo el sistema", async () => {
    const { cliente, lecturas } = adminFalso({
      push_suscripciones: [sub("ana", "a1"), sub("beto", "b1")],
      usuarios: [ANA],
    });

    await avisarAUnaPersona(cliente, base);

    const deAparatos = lecturas.filter((l) => l.tabla === "push_suscripciones");
    expect(deAparatos.length).toBeGreaterThan(0);
    for (const lectura of deAparatos) {
      expect(lectura.filtros).toMatchObject({ usuario_id: "ana" });
    }
  });

  // El filtro de la consulta es una cosa y `aparatosAAvisar` es otra: la regla
  // de "a quién se le manda" tiene una sola definición, y es la última antes de
  // `enviarPush`. Con la lectura devolviendo todo, sólo ésa protege a Beto.
  it("si la lectura trajera aparatos de otra persona, tampoco les manda", async () => {
    const { cliente } = adminFalso(
      { push_suscripciones: [sub("ana", "a1"), sub("beto", "b1")], usuarios: [ANA, BETO] },
      { ignorarFiltrosEn: "push_suscripciones" }
    );

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 1, personas: 1 });
    expect(endpointsAvisados()).toEqual(["a1"]);
  });

  it("los aparatos de otra persona no cuentan como aparatos de ésta", async () => {
    const { cliente } = adminFalso({
      push_suscripciones: [sub("beto", "b1")],
      usuarios: [ANA, BETO],
    });

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 0, personas: 0, motivo: "sin aparatos" });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  // Review Focus 5 del plan: no tener aparatos suscriptos no es un error. La
  // respuesta está en la OT igual, y la persona la ve cuando abre la orden.
  it("sin aparatos no falla, lo dice", async () => {
    const { cliente } = adminFalso({ push_suscripciones: [], usuarios: [ANA] });

    await expect(avisarAUnaPersona(cliente, base)).resolves.toEqual({
      enviadas: 0,
      personas: 0,
      motivo: "sin aparatos",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  // El orden de las lecturas es lo que hace que no cueste nada cuando no hay a
  // quién mandarle: primero los aparatos, y la cuenta sólo si hay alguno.
  it("sin aparatos no se lee ni la cuenta", async () => {
    const { cliente, lecturas } = adminFalso({ push_suscripciones: [], usuarios: [ANA] });

    await avisarAUnaPersona(cliente, base);

    expect(lecturas.map((l) => l.tabla)).toEqual(["push_suscripciones"]);
  });

  /* ── Una cuenta dada de baja no recibe ──────────────────────────────── */

  // `push_suscripciones` sobrevive a desactivar a alguien: sus filas se van
  // recién con el `on delete cascade`, o sea al borrar la fila de `usuarios`.
  // Es el mismo cuidado que ya tienen `avisarAQuienDecide` y el cron del resumen.
  it("una cuenta dada de baja no recibe, aunque tenga aparatos", async () => {
    const { cliente } = adminFalso({
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [{ id: "ana", activo: false }],
    });

    expect(await avisarAUnaPersona(cliente, base)).toEqual({
      enviadas: 0,
      personas: 0,
      motivo: "cuenta dada de baja",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  it("la baja se mira en la cuenta de esa persona, no en la de cualquiera", async () => {
    const { cliente } = adminFalso({
      push_suscripciones: [sub("ana", "a1")],
      // Hay alguien activo en el sistema, pero no es Ana.
      usuarios: [{ id: "ana", activo: false }, BETO],
    });

    expect(await avisarAUnaPersona(cliente, base)).toMatchObject({
      enviadas: 0,
      motivo: "cuenta dada de baja",
    });
    expect(enviarPush).not.toHaveBeenCalled();
  });

  /* ── Qué le llega ────────────────────────────────────────────────────── */

  /*
   * La comparación es exacta a propósito: el payload de un push es plano,
   * `{title, body, url}` con la `url` en el primer nivel. Una forma anidada es
   * la que ningún emisor produce y la que dejó un mes de notificaciones que
   * abrían el inicio (ver `lib/core/sw.test.ts`).
   */
  it("al aparato le llega el aviso tal cual, y con la suscripción de ese aparato", async () => {
    const { cliente } = adminFalso({
      push_suscripciones: [sub("ana", "a1")],
      usuarios: [ANA],
    });

    await avisarAUnaPersona(cliente, base);

    expect(enviarPush).toHaveBeenCalledTimes(1);
    const [aparato, aviso] = vi.mocked(enviarPush).mock.calls[0];
    expect(aviso).toEqual(AVISO);
    expect(aparato).toMatchObject({ endpoint: "a1", p256dh: "p-a1", auth: "a-a1" });
  });

  /* ── Las suscripciones que vencen ────────────────────────────────────── */

  // Se desinstaló la app de un teléfono, no se dio de baja de todo: se borra
  // ese aparato y no los otros de la misma persona.
  it("una suscripción vencida se borra, y el otro aparato de la persona no", async () => {
    vi.mocked(enviarPush).mockResolvedValueOnce("vencida").mockResolvedValueOnce("enviada");
    const { cliente, filas } = adminFalso({
      push_suscripciones: [sub("ana", "a1"), sub("ana", "a2")],
      usuarios: [ANA],
    });

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 1, personas: 1 });
    expect(filas("push_suscripciones").map((f) => f.endpoint)).toEqual(["a2"]);
  });

  // La clave es `(usuario_id, endpoint)` y nada impide que el mismo `endpoint`
  // aparezca bajo dos `usuario_id`: la ruta de alta hace `upsert` sobre el par
  // (`app/api/push/suscripcion/route.ts`), y puede pasar si dos personas se
  // suscriben desde el mismo navegador. Se borra la fila de quien se avisó, no
  // la del otro.
  it("se borra por la clave entera: la fila de otra persona con el mismo endpoint queda", async () => {
    vi.mocked(enviarPush).mockResolvedValue("vencida");
    const { cliente, filas } = adminFalso({
      push_suscripciones: [sub("ana", "pc-compartida"), sub("beto", "pc-compartida")],
      usuarios: [ANA, BETO],
    });

    await avisarAUnaPersona(cliente, base);

    expect(filas("push_suscripciones")).toEqual([sub("beto", "pc-compartida")]);
  });

  // El borrado es limpieza: si no sale, la próxima vez el push service vuelve a
  // contestar 404/410 y se reintenta. Lo que no puede pasar es que esa fila que
  // no se pudo sacar deje sin aviso a los otros aparatos de la persona.
  it("si no puede borrar una suscripción vencida, igual sigue con los otros aparatos", async () => {
    vi.mocked(enviarPush).mockResolvedValueOnce("vencida").mockResolvedValueOnce("enviada");
    const { cliente, filas } = adminFalso(
      { push_suscripciones: [sub("ana", "a1"), sub("ana", "a2")], usuarios: [ANA] },
      { errorAlBorrarEn: "push_suscripciones" }
    );

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 1, personas: 1 });
    expect(endpointsAvisados()).toEqual(["a1", "a2"]);
    expect(filas("push_suscripciones")).toHaveLength(2);
  });

  // `fallo` es el push service caído, un 429, un error de red: el problema es
  // del otro lado y la suscripción sirve. Borrarla es desuscribir a alguien por
  // una caída ajena.
  it("un fallo de envío no borra la suscripción ni frena a los otros aparatos", async () => {
    vi.mocked(enviarPush).mockResolvedValueOnce("fallo").mockResolvedValueOnce("enviada");
    const { cliente, filas } = adminFalso({
      push_suscripciones: [sub("ana", "a1"), sub("ana", "a2")],
      usuarios: [ANA],
    });

    const r = await avisarAUnaPersona(cliente, base);

    expect(r).toEqual({ enviadas: 1, personas: 1 });
    expect(enviarPush).toHaveBeenCalledTimes(2);
    expect(filas("push_suscripciones")).toHaveLength(2);
  });

  // Que ningún aparato lo reciba no es lo mismo que no tener aparatos: acá se
  // intentó con una persona (`personas: 1`) y nadie contestó, y quien llama
  // puede distinguirlo de `sin aparatos`, que es `personas: 0` y trae motivo.
  it("si ningún aparato lo recibe, no es un error y se distingue de no tener aparatos", async () => {
    vi.mocked(enviarPush).mockResolvedValue("fallo");
    const { cliente } = adminFalso({
      push_suscripciones: [sub("ana", "a1"), sub("ana", "a2")],
      usuarios: [ANA],
    });

    await expect(avisarAUnaPersona(cliente, base)).resolves.toEqual({
      enviadas: 0,
      personas: 1,
    });
  });

  /* ── La lectura pagina ───────────────────────────────────────────────── */

  // PostgREST corta en 1.000 filas y no avisa. Nadie tiene mil aparatos: el test
  // usa 1.001 porque es lo único que hace visible si la lectura pagina o no, y
  // la regla del repo es no razonar «esta tabla es chica».
  it("no se queda en las 1.000 filas que PostgREST entrega de una vez", async () => {
    const muchos = Array.from({ length: 1001 }, (_, i) => sub("ana", `https://push/${i}`));
    const { cliente } = adminFalso({ push_suscripciones: muchos, usuarios: [ANA] });

    const r = await avisarAUnaPersona(cliente, base);

    expect(r.enviadas).toBe(1001);
  });

  /* ── Nunca tira ──────────────────────────────────────────────────────── */

  /*
   * La propiedad que importa: la respuesta de Compras ya se guardó cuando se
   * llega acá, y un push service caído no puede hacerla fallar. Cada test de
   * este bloque provoca el error en un lugar distinto del camino.
   */
  describe("nunca tira", () => {
    it("si enviarPush tira, no relanza y deja el motivo", async () => {
      // Lo que tira de verdad `enviarPush` cuando faltan las claves VAPID.
      vi.mocked(enviarPush).mockRejectedValue(
        new Error("Faltan variables de entorno de Web Push (VAPID)")
      );
      const { cliente } = adminFalso({
        push_suscripciones: [sub("ana", "a1")],
        usuarios: [ANA],
      });

      await expect(avisarAUnaPersona(cliente, base)).resolves.toEqual({
        enviadas: 0,
        personas: 0,
        motivo: "Faltan variables de entorno de Web Push (VAPID)",
      });
      expect(log).toHaveBeenCalled();
    });

    it("si la lectura de los aparatos falla, no relanza ni manda", async () => {
      const { cliente } = adminFalso({ usuarios: [ANA] }, { errorEn: "push_suscripciones" });

      const r = await avisarAUnaPersona(cliente, base);

      expect(r.enviadas).toBe(0);
      expect(r.motivo).toContain("no se pudo leer");
      expect(enviarPush).not.toHaveBeenCalled();
    });

    it("si la lectura de la cuenta falla, no relanza ni manda", async () => {
      const { cliente } = adminFalso(
        { push_suscripciones: [sub("ana", "a1")] },
        { errorEn: "usuarios" }
      );

      const r = await avisarAUnaPersona(cliente, base);

      expect(r.enviadas).toBe(0);
      expect(r.motivo).toContain("no se pudo leer");
      expect(enviarPush).not.toHaveBeenCalled();
    });
  });
});
