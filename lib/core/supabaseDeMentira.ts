/**
 * Un Supabase de mentira para los tests de ruta. **No lo importa nada de la app.**
 *
 * Salió duplicado a mano entre `lib/mantenimiento/rutaDeNotas.test.ts` y
 * `lib/compras/rutaDeConsultas.test.ts`, y las dos copias ya habían empezado a
 * separarse: la segunda agregó `in`, `range`, `maybeSingle` y el tope de 1.000 filas,
 * y la primera tenía el 23503 del borrado. Ciento treinta renglones de andamio que
 * divergen son la forma más barata de que un test pase por una razón que el de al
 * lado no tiene.
 *
 * ── POR QUÉ NO ES UN `{ data: [...] }` FIJO ──────────────────────────────────
 *
 * Se porta como el de verdad en cinco cosas, y cada una decide si un test sirve:
 *
 *  - **Aplica los filtros.** Un fake que devolviera siempre todas las filas no
 *    distinguiría una consulta acotada de una que no lo está —y es justo lo que un
 *    test de ruta viene a mirar: que el repuesto sea de **esta** orden—.
 *  - **Entrega sólo las columnas del `select()`.** Es lo que un fake ingenuo se
 *    saltea, y sin eso una columna de menos en el `select` no rompe nada.
 *  - **Corta en 1.000 filas**, con `.range()` o sin él, igual que PostgREST, que no
 *    avisa. Sin esto nada notaría que una lectura dejó de paginar.
 *  - **Se niega a un `.in()` de más de 200 ids.** De verdad el límite es el largo de
 *    la URL y el error un 414, no un número redondo; acá se fija en los 200 que el
 *    repo usa para armar los lotes, porque lo que hay que impedir es pedir todo
 *    junto. Sin esto, `traerTodo` tapa la falta de lotes paginando.
 *  - **Borra de verdad**, así los tests pueden mirar qué quedó y no sólo qué se pidió.
 *  - **Falla donde el test le diga** (`alBorrar`), que es como se prueba qué hace una
 *    ruta cuando la base se niega.
 *
 * Y anota lo que se le pidió —qué tablas se leyeron, qué se insertó— para poder
 * afirmar que algo **no** se tocó.
 *
 * **No anota las columnas de cada `select`, y es a propósito.** Lo hizo hasta el
 * 31/10/2026, para que cada test de ruta afirmara su lista de columnas a mano; esa
 * guarda falló la segunda vez que se usó —le faltaba `creado_en`— y se mudó a
 * `lib/mantenimiento/selectsDeLasNotas.test.ts`, que lee el **texto** de todas las
 * rutas y cubre también la que nadie escribió. Volver a anotarlas acá es volver a
 * una lista por ruta.
 *
 * Lo que NO prueba, y conviene no creerle: que las tablas y las columnas existan,
 * las claves foráneas, los `on delete`, las policies, ni que un embed resuelva. Para
 * eso hace falta la base.
 */

export type Fila = Record<string, unknown>;

/** Lo que la base contestó, en el error de PostgREST. */
export interface ErrorDeLaBase {
  code?: string;
  message: string;
}

export interface EstadoDeLaBase {
  tablas: Record<string, Fila[]>;
  /** Qué tablas se leyeron con `select`, para saber si una ruta lee de más. */
  lecturas: string[];
  inserts: Fila[];
}

export interface OpcionesDeLaBase {
  /**
   * Cómo resuelve un embed —`autor:usuarios(nombre)`—: busca el `creado_por` de la
   * fila acá. Un id que no esté da `null`, como un join que no encuentra.
   */
  nombres?: Record<string, string>;
  /**
   * Si la base se niega a borrar esta fila, y con qué error. Es como se prueba el
   * `23503` de una nota a la que otra apunta, que vive en la base y no en la ruta.
   */
  alBorrar?: (tabla: string, fila: Fila, filas: readonly Fila[]) => ErrorDeLaBase | null;
}

/** Cuántas filas devuelve PostgREST como mucho. */
const TOPE = 1000;

/** De a cuántos ids se pide: más que eso arma una URL que PostgREST rechaza. */
const TOPE_DEL_IN = 200;

export interface BaseDeMentira {
  estado: EstadoDeLaBase;
  /** Lo que se le pasa a `createAdminClient()` en el `vi.mock`. */
  admin: { from: (tabla: string) => unknown };
  /** Deja las tablas como dice el test y borra lo anotado. Va en el `beforeEach`. */
  reiniciar: (tablas: Record<string, Fila[]>) => void;
}

export function supabaseDeMentira(opciones: OpcionesDeLaBase = {}): BaseDeMentira {
  const estado: EstadoDeLaBase = { tablas: {}, lecturas: [], inserts: [] };

  /** El constructor de consultas de supabase-js, con lo que usan las rutas. */
  class Consulta {
    private accion: "select" | "insert" | "delete" = "select";
    private igualdades: [string, unknown][] = [];
    private enLista: [string, readonly unknown[]] | null = null;
    private columnas = "";
    private fila: Fila | null = null;
    private unica: "single" | "maybeSingle" | null = null;
    private rango: [number, number] | null = null;

    constructor(private tabla: string) {}

    select(columnas: string) {
      if (this.accion === "select") estado.lecturas.push(this.tabla);
      this.columnas = columnas;
      return this;
    }
    eq(columna: string, valor: unknown) { this.igualdades.push([columna, valor]); return this; }
    in(columna: string, valores: readonly unknown[]) { this.enLista = [columna, valores]; return this; }
    range(desde: number, hasta: number) { this.rango = [desde, hasta]; return this; }
    /** El orden no se simula: ninguna ruta depende de él para decidir. */
    order() { return this; }
    single() { this.unica = "single"; return this; }
    // La diferencia importa: sin fila, `maybeSingle` devuelve `data: null` **sin
    // error** y `single` devuelve un error.
    maybeSingle() { this.unica = "maybeSingle"; return this; }
    insert(fila: Fila) { this.accion = "insert"; this.fila = fila; return this; }
    delete() { this.accion = "delete"; return this; }

    then(resolver: (r: unknown) => unknown, rechazar?: (e: unknown) => unknown) {
      try { return Promise.resolve(this.ejecutar()).then(resolver, rechazar); }
      catch (e) { return Promise.reject(e).then(resolver, rechazar); }
    }

    /** Sólo las columnas pedidas, como PostgREST. Lo que lleva `:` es un embed. */
    private proyectar(fila: Fila): Fila {
      if (!this.columnas) return fila;
      const salida: Fila = {};
      for (const c of this.columnas.split(/,(?![^(]*\))/).map((x) => x.trim())) {
        if (c.includes(":")) {
          const nombre = (opciones.nombres ?? {})[String(fila.creado_por ?? "")];
          salida[c.split(":")[0]] = nombre ? { nombre } : null;
        } else salida[c] = fila[c];
      }
      return salida;
    }

    private ejecutar() {
      const filas = estado.tablas[this.tabla] ?? (estado.tablas[this.tabla] = []);

      if (this.enLista && this.enLista[1].length > TOPE_DEL_IN) {
        return {
          data: null,
          error: {
            message:
              `la URL se pasó de largo: ${this.enLista[1].length} ids en un .in() ` +
              `sobre ${this.tabla}. Pedilos de a ${TOPE_DEL_IN}.`,
          },
        };
      }

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

      if (this.accion === "delete") {
        const aBorrar = filas.filter(coincide);
        for (const f of aBorrar) {
          const seNego = opciones.alBorrar?.(this.tabla, f, filas) ?? null;
          if (seNego) return { data: null, error: seNego };
        }
        estado.tablas[this.tabla] = filas.filter((f) => !coincide(f));
        return { data: aBorrar.map((f) => ({ id: f.id })), error: null };
      }

      const halladas = filas.filter(coincide);
      if (this.unica) {
        if (halladas[0]) return { data: this.proyectar(halladas[0]), error: null };
        return this.unica === "maybeSingle"
          ? { data: null, error: null }
          : { data: null, error: { message: "no hay" } };
      }

      const [desde, hasta] = this.rango ?? [0, TOPE - 1];
      const tanda = halladas.slice(desde, Math.min(hasta + 1, desde + TOPE));
      return { data: tanda.map((f) => this.proyectar(f)), error: null };
    }
  }

  return {
    estado,
    admin: { from: (tabla: string) => new Consulta(tabla) },
    reiniciar(tablas) {
      estado.tablas = tablas;
      estado.lecturas = [];
      estado.inserts = [];
    },
  };
}
