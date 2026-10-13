import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo } from "./recalcular";

/**
 * Las columnas NOT NULL de `calculos_diarios` que el recálculo escribe. La
 * lista está acá y no importada porque el punto del test es justamente que la
 * base las rechaza si llegan en null.
 */
const NO_ADMITEN_NULL = [
  "empleado_id", "fecha", "tipo_dia", "horas_normales", "horas_extra_50",
  "horas_extra_100", "franco_generado", "ausente", "extras_validadas",
  "tarde", "retiro_anticipado",
];

/**
 * Simula lo que hace PostgREST con un `upsert` en lote: arma UNA sola lista de
 * columnas —la unión de las claves de todas las filas— y manda null donde una
 * fila no trae esa clave. Contra una columna NOT NULL, eso voltea el lote
 * entero, que es exactamente el error que devolvía la base.
 */
function comoPostgrest(filas: Record<string, unknown>[]) {
  const columnas = new Set(filas.flatMap((f) => Object.keys(f)));
  for (const col of columnas) {
    if (!NO_ADMITEN_NULL.includes(col)) continue;
    if (filas.some((f) => f[col] === undefined || f[col] === null)) {
      return {
        error: {
          message: `null value in column "${col}" of relation "calculos_diarios" violates not-null constraint`,
        },
      };
    }
  }
  return { error: null };
}

/**
 * Cliente mínimo: devuelve lo que le pasan por tabla, sin aplicar filtros (el
 * fixture ya viene filtrado), y guarda las filas de cada `upsert` para poder
 * mirarlas.
 */
function clienteFalso(datos: Record<string, Record<string, unknown>[]>) {
  const upserts: Record<string, unknown>[][] = [];

  function consulta(tabla: string) {
    const filas = () => datos[tabla] ?? [];
    const q: Record<string, unknown> = {
      single: async () => ({ data: filas()[0] ?? null, error: null }),
      range: async (desde: number, hasta: number) => ({ data: filas().slice(desde, hasta + 1), error: null }),
      then: (resolver: (r: unknown) => unknown) => resolver({ data: filas(), error: null }),
    };
    for (const metodo of ["select", "eq", "in", "gte", "lte", "order"]) q[metodo] = () => q;
    return q;
  }

  const cliente = {
    from: (tabla: string) => ({
      ...consulta(tabla),
      upsert: async (filas: Record<string, unknown>[]) => {
        upserts.push(filas);
        return comoPostgrest(filas);
      },
      insert: async () => ({ error: null }),
    }),
  } as unknown as SupabaseClient;

  return { cliente, upserts };
}

const CONFIG = {
  horas_normales_por_dia: 8, hora_corte_sabado: "12:00", multiplicador_extra_50: 1.5,
  multiplicador_extra_100: 2, horas_franco_compensatorio: 8, feriado_como_domingo: true,
};

/**
 * El recálculo deja afuera las tres columnas de validación en los días cuyas
 * extras ya se validaron y siguen dando lo mismo, para no pisarlas. Eso mezcla
 * dos formas de fila en un mismo lote, y ahí se rompía: la planilla general de
 * agosto —un período con días validados— devolvía "No se pudo calcular la
 * planilla" y el recálculo nocturno venía fallando por lo mismo.
 */
describe("recálculo de un período con días ya validados", () => {
  const datos = () => ({
    empleados: [{ id: "e1", sector_id: null, sectores: null }],
    config_liquidacion: [CONFIG],
    feriados: [],
    jornadas: [],
    fichadas: [],
    ausencias: [],
    vacaciones: [],
    francos: [],
    // El primer día ya está validado y da lo mismo que antes: se preserva.
    // El segundo no existe todavía: se escribe entero.
    calculos_diarios: [
      {
        empleado_id: "e1", fecha: "2026-06-01", horas_manual: false,
        extras_validadas: true, horas_extra_50: 0, horas_extra_100: 0,
      },
    ],
  });

  const desde = new Date("2026-06-01T00:00:00Z");
  const hasta = new Date("2026-06-02T00:00:00Z");

  it("no rompe: ninguna fila viaja sin las columnas que la base exige", async () => {
    const { cliente } = clienteFalso(datos());
    await expect(recalcularSectorPeriodo(cliente, null, desde, hasta)).resolves.toBe(1);
  });

  it("cada upsert lleva un solo juego de columnas", async () => {
    const { cliente, upserts } = clienteFalso(datos());
    await recalcularSectorPeriodo(cliente, null, desde, hasta);
    for (const lote of upserts) {
      const formas = new Set(lote.map((f) => Object.keys(f).sort().join("|")));
      expect(formas.size).toBe(1);
    }
  });

  it("el día ya validado sigue viajando sin las columnas de validación", async () => {
    const { cliente, upserts } = clienteFalso(datos());
    await recalcularSectorPeriodo(cliente, null, desde, hasta);
    const todas = upserts.flat();
    const validado = todas.find((f) => f.fecha === "2026-06-01");
    const nuevo = todas.find((f) => f.fecha === "2026-06-02");
    expect(validado).toBeDefined();
    expect(validado).not.toHaveProperty("extras_validadas");
    expect(nuevo).toMatchObject({ extras_validadas: false });
  });
});

/**
 * El caso que dejaba la validacion sin efecto.
 *
 * Una jornada de 8h05 da 0.08333... horas extra. `calculos_diarios` guarda
 * numeric(5,2), asi que en la base queda 0.08. Al recalcular, el motor volvia a
 * calcular 0.08333... y lo comparaba con === contra el 0.08 guardado: nunca
 * eran iguales, la validacion se borraba, y la planilla general volvia a avisar
 * que faltaban validar las mismas horas. Validar y correr la planilla era un
 * circulo cerrado.
 *
 * Los dias que dan un numero redondo —8 hs, 4 hs— no lo mostraban: esos si
 * comparaban iguales.
 */
describe("dias validados con horas extra que no dan un numero redondo", () => {
  // Hora de pared en Argentina (UTC-3 fijo), igual que en recalcular-puro.test.
  const hora = (dia: number, h: number, min = 0) => new Date(Date.UTC(2026, 5, dia, h + 3, min));
  const desde = new Date("2026-06-02T00:00:00Z"); // martes
  const hasta = desde;

  /** 8h05 de trabajo: 8 normales y 0.08333... de extra al 50%. */
  const datos = (guardado: { horas_extra_50: number; extras_validadas: boolean }) => ({
    empleados: [{ id: "e1", sector_id: null, sectores: null }],
    config_liquidacion: [CONFIG],
    feriados: [],
    jornadas: [],
    fichadas: [
      {
        empleado_id: "e1",
        fecha: "2026-06-02",
        hora_entrada: hora(2, 8).toISOString(),
        hora_salida: hora(2, 16, 5).toISOString(),
      },
    ],
    ausencias: [],
    vacaciones: [],
    francos: [],
    calculos_diarios: [
      {
        empleado_id: "e1",
        fecha: "2026-06-02",
        horas_manual: false,
        horas_extra_100: 0,
        ...guardado,
      },
    ],
  });

  it("conserva la validacion: 0.08 guardado es la misma hora que 0.08333 calculado", async () => {
    // Es lo que la base pudo guardar de ese numero, no un valor distinto.
    const { cliente, upserts } = clienteFalso(datos({ horas_extra_50: 0.08, extras_validadas: true }));
    await recalcularSectorPeriodo(cliente, null, desde, hasta);
    const fila = upserts.flat().find((f) => f.fecha === "2026-06-02");
    expect(fila).not.toHaveProperty("extras_validadas");
  });

  it("si las horas cambiaron de verdad, la validacion se cae", async () => {
    // Se habian validado 2 hs y ahora la cuenta da 5 minutos: esa validacion ya
    // no dice nada sobre este numero.
    const { cliente, upserts } = clienteFalso(datos({ horas_extra_50: 2, extras_validadas: true }));
    await recalcularSectorPeriodo(cliente, null, desde, hasta);
    const fila = upserts.flat().find((f) => f.fecha === "2026-06-02");
    expect(fila).toMatchObject({ extras_validadas: false, validado_por_id: null, fecha_validacion: null });
  });
});
