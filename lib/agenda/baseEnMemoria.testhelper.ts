/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Una base en memoria con la forma del cliente de Supabase que usan las
 * funciones de la Agenda, **sólo para los tests**. Evalúa los filtros de verdad
 * (`eq`, `is`, `not … is null`, `gte`, `lt`, `in`, `ilike`), así que un test que
 * se equivoca de filtro falla en vez de pasar contra un doble que no mira nada.
 *
 * No es un motor de SQL: soporta lo que esas funciones llaman y nada más. Si una
 * función nueva usa otro operador, esto tira en vez de devolver cualquier cosa.
 *
 * **Tampoco resuelve embeds.** Una fila que el código lee con
 * `select("…, ordenes_trabajo!ot_id(especialidad)")` tiene que traer ese objeto
 * escrito en el fixture: acá no hay join que lo arme.
 */

export type Fila = Record<string, unknown>;

/** Lo que una consulta hace con la tabla. */
export type Operacion = "select" | "update" | "upsert" | "insert" | "delete";

export interface Opciones {
  /** Mensaje de error por tabla y operación: `{ agenda_eventos: { update: "boom" } }`. */
  falla?: Record<string, Partial<Record<Operacion, string>>>;
  /** Tablas cuyo `update` no encuentra nunca la fila: simula un predicado que no coincide. */
  updateQueNoTocaNada?: string[];
  /**
   * Tablas cuyo `select` **con filtros** devuelve vacío (y sin filtros devuelve
   * todo): simula un filtro que no coincide, como un `.gte` sobre un `timestamptz`.
   */
  selectConFiltrosVacio?: string[];
}

export interface BaseEnMemoria {
  cliente: SupabaseClient;
  tablas: Record<string, Fila[]>;
  /** Cada escritura que se pidió, en orden, haya tocado filas o no. */
  escrituras: { tabla: string; operacion: Exclude<Operacion, "select">; columnas: Fila; tocadas: number }[];
}

const mismo = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const instante = (v: unknown) => new Date(String(v)).getTime();

export function baseEnMemoria(tablas: Record<string, Fila[]>, opciones: Opciones = {}): BaseEnMemoria {
  const escrituras: BaseEnMemoria["escrituras"] = [];

  const cliente = {
    from(tabla: string) {
      const filtros: ((f: Fila) => boolean)[] = [];
      let modo: Operacion = "select";
      let columnas: Fila = {};
      let nuevas: Fila[] = [];
      let clave = "";
      let desde = 0;
      let hasta = Infinity;

      const ejecutar = () => {
        const fallo = opciones.falla?.[tabla]?.[modo];
        const filas = (tablas[tabla] ??= []);
        if (fallo) return { data: null, error: { message: fallo } };

        if (modo === "select") {
          // Copias: una fila leída es una foto, no la fila viva.
          const roto = filtros.length > 0 && opciones.selectConFiltrosVacio?.includes(tabla);
          const leidas = roto ? [] : filas.filter((f) => filtros.every((p) => p(f))).slice(desde, hasta + 1);
          return { data: leidas.map((f) => ({ ...f })), error: null };
        }
        if (modo === "update") {
          const tocadas = opciones.updateQueNoTocaNada?.includes(tabla)
            ? []
            : filas.filter((f) => filtros.every((p) => p(f)));
          for (const f of tocadas) Object.assign(f, columnas);
          escrituras.push({ tabla, operacion: "update", columnas, tocadas: tocadas.length });
          return { data: tocadas.map((f) => ({ id: f.id })), error: null };
        }
        if (modo === "insert") {
          for (const f of nuevas) filas.push({ ...f });
          escrituras.push({ tabla, operacion: "insert", columnas: nuevas[0] ?? {}, tocadas: nuevas.length });
          return { data: nuevas.map((f) => ({ ...f })), error: null };
        }
        if (modo === "delete") {
          const sacadas = filas.filter((f) => filtros.every((p) => p(f)));
          for (const f of sacadas) filas.splice(filas.indexOf(f), 1);
          escrituras.push({ tabla, operacion: "delete", columnas: {}, tocadas: sacadas.length });
          return { data: sacadas.map((f) => ({ id: f.id })), error: null };
        }
        const previa = filas.find((f) => f[clave] === columnas[clave]);
        if (previa) Object.assign(previa, columnas);
        else filas.push({ ...columnas });
        escrituras.push({ tabla, operacion: "upsert", columnas, tocadas: 1 });
        return { data: null, error: null };
      };

      const q: any = {
        select: () => q,
        returns: () => q,
        order: () => q,
        range: (d: number, h: number) => {
          desde = d;
          hasta = h;
          return q;
        },
        eq: (c: string, v: unknown) => (filtros.push((f) => mismo(f[c], v)), q),
        is: (c: string, v: unknown) => (filtros.push((f) => mismo(f[c], v)), q),
        not: (c: string, op: string, v: unknown) => {
          if (op !== "is") throw new Error(`baseEnMemoria: not(${op}) no está soportado`);
          filtros.push((f) => !mismo(f[c], v));
          return q;
        },
        gte: (c: string, v: unknown) => (filtros.push((f) => instante(f[c]) >= instante(v)), q),
        lt: (c: string, v: unknown) => (filtros.push((f) => instante(f[c]) < instante(v)), q),
        in: (c: string, v: unknown[]) => (filtros.push((f) => v.some((x) => mismo(f[c], x))), q),
        // Sin `%` ni `_`, `ilike` es una igualdad que no mira mayúsculas: es
        // como la usa la búsqueda de la casilla del área.
        ilike: (c: string, v: string) =>
          (filtros.push((f) => String(f[c] ?? "").toLowerCase() === v.toLowerCase()), q),
        update: (c: Fila) => {
          modo = "update";
          columnas = c;
          return q;
        },
        upsert: (c: Fila, o: { onConflict: string }) => {
          modo = "upsert";
          columnas = c;
          clave = o.onConflict;
          return q;
        },
        insert: (c: Fila | Fila[]) => {
          modo = "insert";
          nuevas = Array.isArray(c) ? c : [c];
          return q;
        },
        delete: () => {
          modo = "delete";
          return q;
        },
        maybeSingle: () => {
          const r = ejecutar();
          return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error });
        },
        then: (alCumplir: (v: unknown) => unknown, alRechazar: (e: unknown) => unknown) =>
          Promise.resolve(ejecutar()).then(alCumplir, alRechazar),
      };
      return q;
    },
  };

  return { cliente: cliente as unknown as SupabaseClient, tablas, escrituras };
}
