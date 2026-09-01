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
