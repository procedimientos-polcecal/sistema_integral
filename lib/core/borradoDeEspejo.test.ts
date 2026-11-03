/**
 * Los casos usan los tamaños reales: 2.201 OT y 172 avisos al 18/10/2026. El
 * freno se calibra contra tablas de ese porte, así que probarlo con tres filas
 * inventadas no diría nada.
 */
import { describe, it, expect } from "vitest";
import {
  queSeBorra, comoSeCuenta, borrarLoQueLaPlanillaNoTrajo, type FilaDelEspejo,
} from "@/lib/core/borradoDeEspejo";

const ARRANQUE = "2026-10-18T09:15:00.000Z";

function fila(numero: number, extra: Partial<FilaDelEspejo> = {}): FilaDelEspejo {
  return {
    id: `id-${numero}`,
    numero,
    nuncaEstuvoEnLaPlanilla: false,
    editadaEnLaApp: false,
    creadaEn: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("queSeBorra", () => {
  it("borra la que la planilla dejó de tener", () => {
    const v = queSeBorra({
      candidatas: [fila(1843), fila(1844)],
      totalEnLaBase: 2201,
      inicioDeLaCorrida: ARRANQUE,
    });
    expect(v.freno).toBeNull();
    expect(v.borrar.map((f) => f.numero)).toEqual([1843, 1844]);
    expect(v.protegidas).toEqual([]);
  });

  it("no borra nada cuando no hay nada que borrar", () => {
    const v = queSeBorra({ candidatas: [], totalEnLaBase: 2201, inicioDeLaCorrida: ARRANQUE });
    expect(v).toMatchObject({ borrar: [], protegidas: [], freno: null });
  });

  describe("lo que protege, porque su ausencia no prueba nada", () => {
    it("la que la app escribió y todavía no se exportó", () => {
      // Hoy hay una OT así: la planilla nunca la tuvo, así que que no venga en
      // la lectura es exactamente lo esperable.
      const v = queSeBorra({
        candidatas: [fila(2202, { nuncaEstuvoEnLaPlanilla: true })],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.borrar).toEqual([]);
      expect(v.protegidas[0].motivo).toContain("todavía no se exportó");
    });

    it("la que nació después de que leyéramos la planilla", () => {
      // Leímos 9:15, la cargaron 9:16. No estaba en lo que leímos y no es
      // culpa de nadie.
      const v = queSeBorra({
        candidatas: [fila(2203, { creadaEn: "2026-10-18T09:16:00.000Z" })],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.borrar).toEqual([]);
      expect(v.protegidas[0].motivo).toContain("después");
    });

    it("pero no la que nació justo antes", () => {
      const v = queSeBorra({
        candidatas: [fila(2204, { creadaEn: "2026-10-18T09:14:59.000Z" })],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.borrar).toHaveLength(1);
    });

    it("NO protege la que quedó pendiente de exportar, y por eso el que llama tiene que contarla como leída", () => {
      // Éste es el caso que casi cuesta una OT el 26/10/2026, y vale escribirlo
      // porque la trampa no está acá sino en quien llama.
      //
      // Una OT que vino de la planilla y cuyo cambio no se pudo exportar queda
      // con `sheets_pendiente`, y la importación la **saltea** para no pisarla.
      // Hasta ahí, bien. El problema es que saltearla la dejaba afuera de
      // `clavesLeidas`, o sea: "la planilla ya no la tiene". Y acá no hay nada
      // que la salve — `nuncaEstuvoEnLaPlanilla` es `app_created && sin fila`,
      // y ésta tiene las dos al revés: nació en la planilla y tiene su fila.
      //
      // O sea que la marca que existe para protegerla de que la pisen la
      // mandaba a borrar, con sus notas, sus repuestos y su aviso en cascada.
      // La protección no puede vivir acá: `clavesLeidas` es **lo que la
      // planilla trajo**, no lo que la corrida escribió, y así lo dice su
      // docstring. Es la misma lección que Compras ya había pagado con las
      // 1.678 filas `editado_en_app`.
      const pendienteDeExportar = fila(2896, {
        nuncaEstuvoEnLaPlanilla: false,
        creadaEn: "2026-01-01T00:00:00.000Z",
      });
      const v = queSeBorra({
        candidatas: [pendienteDeExportar],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.protegidas).toEqual([]);
      expect(v.borrar.map((f) => f.numero)).toEqual([2896]);
    });

    it("NO protege la que la app editó: si la planilla manda, manda para borrar", () => {
      const v = queSeBorra({
        candidatas: [fila(1850, { editadaEnLaApp: true })],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.borrar).toHaveLength(1);
      expect(v.editadas).toBe(1);
    });
  });

  describe("el freno de mano", () => {
    it("una fuente sin leer frena todo, aunque sean tres filas", () => {
      // La OS lee una pestaña por área. Si falla la de Calcinación, sus filas
      // faltan en bloque y borrarlas vacía el área por un error de red.
      const v = queSeBorra({
        candidatas: [fila(1), fila(2), fila(3)],
        totalEnLaBase: 228,
        inicioDeLaCorrida: ARRANQUE,
        fuentesSinLeer: ["CALCINACION"],
      });
      expect(v.borrar).toEqual([]);
      expect(v.freno).toContain("CALCINACION");
      expect(v.freno).toContain("Se guardó lo que sí se leyó");
    });

    it("frena la lectura que se trajo media planilla", () => {
      // El caso del 13/10/2026: una planilla recalculando devolvió 2 filas de
      // 623. Con el borrado puesto y sin freno, eso se lleva 621 OT.
      const v = queSeBorra({
        candidatas: Array.from({ length: 621 }, (_, i) => fila(i + 1)),
        totalEnLaBase: 623,
        inicioDeLaCorrida: ARRANQUE,
      });
      expect(v.borrar).toEqual([]);
      expect(v.freno).toContain("621");
      expect(v.freno).toContain("tope es 63");
    });

    it("el tope es el mayor entre 50 filas y el 10%", () => {
      // Con 2.201 OT el tope es 221; con 172 avisos sigue siendo 50, porque el
      // 10% de una tabla chica frenaría cualquier limpieza normal.
      const muchas = (n: number) => Array.from({ length: n }, (_, i) => fila(i + 1));
      expect(queSeBorra({ candidatas: muchas(221), totalEnLaBase: 2201, inicioDeLaCorrida: ARRANQUE }).freno).toBeNull();
      expect(queSeBorra({ candidatas: muchas(222), totalEnLaBase: 2201, inicioDeLaCorrida: ARRANQUE }).freno).not.toBeNull();
      expect(queSeBorra({ candidatas: muchas(50), totalEnLaBase: 172, inicioDeLaCorrida: ARRANQUE }).freno).toBeNull();
      expect(queSeBorra({ candidatas: muchas(51), totalEnLaBase: 172, inicioDeLaCorrida: ARRANQUE }).freno).not.toBeNull();
    });

    it("una persona lo puede levantar, el cron no", () => {
      const v = queSeBorra({
        candidatas: Array.from({ length: 621 }, (_, i) => fila(i + 1)),
        totalEnLaBase: 623,
        inicioDeLaCorrida: ARRANQUE,
        sinFreno: true,
      });
      expect(v.freno).toBeNull();
      expect(v.borrar).toHaveLength(621);
    });

    it("ni levantado a mano borra lo que la planilla nunca tuvo", () => {
      const v = queSeBorra({
        candidatas: [fila(1), fila(2202, { nuncaEstuvoEnLaPlanilla: true })],
        totalEnLaBase: 2201,
        inicioDeLaCorrida: ARRANQUE,
        sinFreno: true,
      });
      expect(v.borrar.map((f) => f.numero)).toEqual([1]);
    });

    it("una fuente sin leer gana sobre el permiso de una persona", () => {
      // Levantar el freno es decir "sé que son muchas", no "borrá aunque no
      // hayas podido leer".
      const v = queSeBorra({
        candidatas: [fila(1)],
        totalEnLaBase: 228,
        inicioDeLaCorrida: ARRANQUE,
        fuentesSinLeer: ["HIDRATACION"],
        sinFreno: true,
      });
      expect(v.borrar).toEqual([]);
      expect(v.freno).toContain("HIDRATACION");
    });
  });
});

describe("comoSeCuenta", () => {
  it("dice cuáles, no sólo cuántas", () => {
    const v = queSeBorra({
      candidatas: [fila(1843), fila(1844)],
      totalEnLaBase: 2201,
      inicioDeLaCorrida: ARRANQUE,
    });
    expect(comoSeCuenta(v)).toBe("Se borraron 2 que la planilla ya no tiene: 1843, 1844.");
  });

  it("avisa cuántas de las borradas tenían cambios del sistema", () => {
    const v = queSeBorra({
      candidatas: [fila(1843, { editadaEnLaApp: true })],
      totalEnLaBase: 2201,
      inicioDeLaCorrida: ARRANQUE,
    });
    expect(comoSeCuenta(v)).toContain("1 de ellas tenían cambios hechos desde el sistema");
  });

  it("corta la lista larga pero dice el total", () => {
    const v = queSeBorra({
      candidatas: Array.from({ length: 30 }, (_, i) => fila(i + 1)),
      totalEnLaBase: 2201,
      inicioDeLaCorrida: ARRANQUE,
    });
    expect(comoSeCuenta(v)).toContain("y 10 más");
  });

  it("cuando no hay nada que decir, no dice nada", () => {
    expect(comoSeCuenta(queSeBorra({ candidatas: [], totalEnLaBase: 10, inicioDeLaCorrida: ARRANQUE }))).toBeNull();
  });

  it("el freno se cuenta como lo que es", () => {
    const v = queSeBorra({
      candidatas: [fila(1)],
      totalEnLaBase: 228,
      inicioDeLaCorrida: ARRANQUE,
      fuentesSinLeer: ["CALCINACION"],
    });
    expect(comoSeCuenta(v)).toContain("No se borró nada");
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * El orden: primero el registro, después el borrado
 *
 * Es la propiedad que más importa de todo el archivo y la única que no se
 * puede probar con una función pura. Se prueba con un cliente de mentira
 * porque la alternativa —ejercitarlo contra la base— significa que un error
 * se lleva 2.201 órdenes de trabajo.
 * ────────────────────────────────────────────────────────────────────────── */

/** Un Supabase de mentira que anota qué le pidieron. */
function clienteFalso(opciones: { auditoriaFalla?: string; filas?: Record<string, unknown>[] } = {}) {
  const hechos: string[] = [];
  const filas = opciones.filas ?? [];

  const consulta = (tabla: string) => {
    const self: Record<string, unknown> = {};
    const encadena = () => self;
    for (const m of ["select", "neq", "is", "range", "returns", "eq", "order"]) self[m] = encadena;
    // `select(...).range(...)` termina devolviéndose a sí mismo y se espera
    // como promesa: así `traerTodo` lo puede recorrer.
    self.then = (resolver: (v: unknown) => unknown) =>
      Promise.resolve(
        tabla === "auditoria"
          ? { data: null, error: opciones.auditoriaFalla ? { message: opciones.auditoriaFalla } : null }
          : { data: filas, error: null, count: 500 }
      ).then(resolver);
    self.insert = (f: unknown) => {
      hechos.push(`insert ${tabla}`);
      return Promise.resolve({
        data: f, error: opciones.auditoriaFalla ? { message: opciones.auditoriaFalla } : null,
      });
    };
    self.delete = () => {
      hechos.push(`delete ${tabla}`);
      return { in: () => Promise.resolve({ error: null }) };
    };
    return self;
  };

  return { cliente: { from: consulta } as never, hechos };
}

const ESPEJO = {
  tabla: "avisos", numero: "oa_number",
  creada: "created_at", fila: "sheets_row",
  deLaApp: { columna: "app_created", valor: true },
  modulo: "mantenimiento", entidad: "aviso",
} as const;

const UNA_FILA = [{
  id: "abc", oa_number: "A9", created_at: "2026-01-01T00:00:00.000Z",
  sheets_row: 12, app_created: false,
}];

describe("borrarLoQueLaPlanillaNoTrajo", () => {
  it("borra sólo después de registrar, y registra antes de borrar", async () => {
    const { cliente, hechos } = clienteFalso({ filas: UNA_FILA });
    const r = await borrarLoQueLaPlanillaNoTrajo(cliente, ESPEJO, {
      clavesLeidas: new Set<string | number>(),
      cuando: "2026-10-18T09:00:00.000Z", inicio: ARRANQUE,
    });
    expect(r.borradas).toBe(1);
    expect(hechos).toEqual(["insert auditoria", "delete avisos"]);
  });

  it("si la auditoría no entra, NO borra", async () => {
    // Es lo que pasa hoy hasta que se aplique la migración del verbo
    // `borrar`: el check de la tabla rechaza la fila. Comprobado contra la
    // base el 18/10/2026, y la respuesta fue exactamente ese error.
    const { cliente, hechos } = clienteFalso({
      filas: UNA_FILA,
      auditoriaFalla: 'violates check constraint "auditoria_accion_check"',
    });
    const r = await borrarLoQueLaPlanillaNoTrajo(cliente, ESPEJO, {
      clavesLeidas: new Set<string | number>(),
      cuando: "2026-10-18T09:00:00.000Z", inicio: ARRANQUE,
    });
    expect(r.borradas).toBe(0);
    expect(hechos).not.toContain("delete avisos");
    expect(r.aviso).toContain("Un borrado sin registro no se hace");
    expect(r.aviso).toContain("20261018134754");
  });

  it("NO borra la fila que la planilla sí trajo, aunque esta corrida no la haya escrito", async () => {
    // La falla del 18/10/2026. La primera versión preguntaba "¿quién no
    // selló esta corrida?" dando por sentado que todo lo que la planilla trae
    // se reescribe. En Compras una fila con `editado_en_app` se saltea sin
    // reescribirse —1.678 de 2.160—, así que quedaban como candidatas 1.678
    // filas que la planilla tenía, el freno saltaba y no se borraba nada: se
    // veía igual que si la función no existiera.
    const { cliente, hechos } = clienteFalso({ filas: UNA_FILA });
    const r = await borrarLoQueLaPlanillaNoTrajo(cliente, ESPEJO, {
      clavesLeidas: new Set(["A9"]),
      cuando: "2026-10-18T09:00:00.000Z", inicio: ARRANQUE,
    });
    expect(r.borradas).toBe(0);
    expect(r.aviso).toBeNull();
    expect(hechos).toEqual([]);
  });

  it("compara las claves como texto, venga número o texto de la planilla", () => {
    // El N° de OT y el RI son números; el de aviso es "A1". Un Set de números
    // no encuentra un "2161" y se llevaría puesta toda la tabla.
    expect(new Set([2161, "A9"].map(String)).has(String(2161))).toBe(true);
    expect(new Set([2161].map(String)).has(String("2161"))).toBe(true);
  });

  it("con el freno puesto no registra ni borra", async () => {
    // 500 candidatas sobre una tabla de 500: ni se llega a la auditoría.
    const muchas = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`, oa_number: `A${i}`, created_at: "2026-01-01T00:00:00.000Z",
      sheets_row: i, app_created: false,
    }));
    const { cliente, hechos } = clienteFalso({ filas: muchas });
    const r = await borrarLoQueLaPlanillaNoTrajo(cliente, ESPEJO, {
      clavesLeidas: new Set<string | number>(),
      cuando: "2026-10-18T09:00:00.000Z", inicio: ARRANQUE,
    });
    expect(r.borradas).toBe(0);
    expect(hechos).toEqual([]);
    expect(r.aviso).toContain("No se borró nada");
  });
});
