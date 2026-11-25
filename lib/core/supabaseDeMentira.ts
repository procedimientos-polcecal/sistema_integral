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
 * Se porta como el de verdad en siete cosas, y cada una decide si un test sirve
 * (decía «seis» y listaba siete desde que se escribió: el número sale de contar
 * los renglones de abajo, como el de los módulos en CLAUDE.md):
 *
 *  - **Aplica los filtros.** Un fake que devolviera siempre todas las filas no
 *    distinguiría una consulta acotada de una que no lo está —y es justo lo que un
 *    test de ruta viene a mirar: que el repuesto sea de **esta** orden—. Por lo
 *    mismo, **un filtro que no sabe simular revienta en vez de ignorarlo**: sabe
 *    `.eq`, `.in`, `.is(col, null)` y `.not(col, "is", null)`, y cualquier otra
 *    forma —`.lt`, `.or`, un `.is` contra algo que no sea null— tira un error.
 *    Lo escribió un caso real el 12/11/2026: `main` sumó tres conteos con `.not`
 *    y `.is`, uno voló un test y **los otros dos contaron 0 en silencio** porque
 *    atrapan sus errores. El segundo modo es el que no se nota, y es el que
 *    tendría un no-op. Sus filtros se prueban en `supabaseDeMentira.test.ts`.
 *  - **Entrega sólo las columnas del `select()`.** Es lo que un fake ingenuo se
 *    saltea, y sin eso una columna de menos en el `select` no rompe nada.
 *  - **Corta en 1.000 filas**, con `.range()` o sin él, igual que PostgREST, que no
 *    avisa. Sin esto nada notaría que una lectura dejó de paginar.
 *  - **Se niega a un `.in()` de más de 200 ids.** De verdad el límite es el largo de
 *    la URL y el error un 414, no un número redondo; acá se fija en los 200 que el
 *    repo usa para armar los lotes, porque lo que hay que impedir es pedir todo
 *    junto. Sin esto, `traerTodo` tapa la falta de lotes paginando.
 *  - **Borra de verdad**, así los tests pueden mirar qué quedó y no sólo qué se pidió.
 *  - **Un `upsert` que choca actualiza en vez de agregar.** Si siempre insertara, un
 *    test no podría distinguir una ruta idempotente de una que duplica la fila cada
 *    vez que alguien aprieta el botón dos veces.
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
  /**
   * Si la base se niega a insertar esta fila, y con qué error. Es como se prueba el
   * `23505` de un índice único, que vive en la base y no en la ruta: el fake no
   * conoce los índices, así que el test dice cuál es la regla.
   */
  alInsertar?: (tabla: string, fila: Fila, filas: readonly Fila[]) => ErrorDeLaBase | null;
}

/** Cuántas filas devuelve PostgREST como mucho. */
const TOPE = 1000;

/** De a cuántos ids se pide: más que eso arma una URL que PostgREST rechaza. */
const TOPE_DEL_IN = 200;

/** `IS NULL` de verdad: la columna que la fila ni siquiera trae también es nula. */
const esNula = (v: unknown) => v === null || v === undefined;

/**
 * El error de un filtro que el fake no simula.
 *
 * Nombra **las dos puntas** —lo que le pidieron y lo único que sabe— porque
 * quien lo lee suele estar a mitad de un merge que trajo una consulta nueva, y
 * con una sola de las dos tiene que ir a buscar la otra.
 */
const sóloSabe = (pedido: string, loQueSabe: string) =>
  `el Supabase de mentira sólo sabe ${loQueSabe}, y le pidieron ${pedido}. ` +
  `Devolver todo haría pasar el test con el filtro sin aplicar, así que revienta: ` +
  `si hace falta esa forma, implementala acá.`;

/**
 * Un `or=(...)` de PostgREST, evaluado de verdad.
 *
 * Existe porque el conteo de OT atrasadas de la campana no se puede escribir
 * con `.eq()`: son tres alternativas y dos de ellas llevan un `and` con un `or`
 * adentro (`lib/mantenimiento/alertas.ts`, `condicionDeAtrasada`). La salida
 * cómoda habría sido que el fake ignore el `.or()` y devuelva todo — y ése es
 * exactamente el test en verde con el filtro sin aplicar que el resto de este
 * archivo existe para no tener: ahí el conteo daría **todas** las órdenes y
 * nadie lo notaría, porque un número más grande no se ve roto.
 *
 * Lo que entiende: una lista separada por comas (que es un OR), `and(...)` y
 * `or(...)` anidados, y las hojas `col.eq.v`, `col.neq.v`, `col.lt.v`,
 * `col.lte.v`, `col.gt.v`, `col.gte.v`, `col.is.null` y `col.not.is.null`.
 * Cualquier otro operador revienta, por la misma razón que el `.not` de abajo.
 *
 * **Compara como texto**, que es lo que hacen las fechas `aaaa-mm-dd` de este
 * repo —ordenan igual como texto que como fecha— y no sirve para números: un
 * `.lt` sobre una columna numérica daría mal, y hay que implementarlo acá
 * antes de usarlo.
 */
export function cumpleElOr(fila: Fila, filtros: string): boolean {
  return partirPorComas(filtros).some((t) => evaluarFiltro(fila, t));
}

/** Corta por comas de primer nivel: las de adentro de un paréntesis no cuentan. */
function partirPorComas(texto: string): string[] {
  const partes: string[] = [];
  let hondo = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "(") hondo++;
    else if (c === ")") hondo--;
    else if (c === "," && hondo === 0) {
      partes.push(texto.slice(desde, i));
      desde = i + 1;
    }
  }
  partes.push(texto.slice(desde));
  return partes.map((p) => p.trim()).filter(Boolean);
}

function evaluarFiltro(fila: Fila, termino: string): boolean {
  if (termino.startsWith("and(") && termino.endsWith(")")) {
    return partirPorComas(termino.slice(4, -1)).every((t) => evaluarFiltro(fila, t));
  }
  if (termino.startsWith("or(") && termino.endsWith(")")) {
    return partirPorComas(termino.slice(3, -1)).some((t) => evaluarFiltro(fila, t));
  }

  const corte = termino.indexOf(".");
  const columna = termino.slice(0, corte);
  const resto = termino.slice(corte + 1);
  const valor = fila[columna];

  if (resto === "is.null") return esNula(valor);
  if (resto === "not.is.null") return !esNula(valor);

  const corte2 = resto.indexOf(".");
  const operador = resto.slice(0, corte2);
  const contra = resto.slice(corte2 + 1);

  if (esNula(valor)) return false;
  const texto = String(valor);
  switch (operador) {
    case "eq": return texto === contra;
    case "neq": return texto !== contra;
    case "lt": return texto < contra;
    case "lte": return texto <= contra;
    case "gt": return texto > contra;
    case "gte": return texto >= contra;
    default:
      throw new Error(sóloSabe(
        `el operador "${operador}" en un .or()`,
        `.or() con eq, neq, lt, lte, gt, gte, is.null y not.is.null`));
  }
}

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
    private accion: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    private igualdades: [string, unknown][] = [];
    private enLista: [string, readonly unknown[]] | null = null;
    private nulas: string[] = [];
    private noNulas: string[] = [];
    private fueraDeLista: [string, string[]][] = [];
    private alternativas: string[] = [];
    private columnas = "";
    private fila: Fila | null = null;
    private unica: "single" | "maybeSingle" | null = null;
    private rango: [number, number] | null = null;
    private conflicto: string | null = null;
    private pidioSelect = false;

    constructor(private tabla: string) {}

    /**
      * Además de las columnas, anota **que se pidió**: en PostgREST `select()` es lo
      * único que agrega `Prefer: return=representation`, así que un `delete()` o un
      * `update()` sin él devuelven `data: null`. Devolver las filas igual dejaba
      * pasar en verde el error de sacarle el `.select("id")` a un borrado que cuenta
      * cuántas borró — y en producción ese borrado contestaba «no había nada» después
      * de haber borrado. Es la misma regla que el `.not` de más abajo: lo cómodo acá
      * es un test verde con la ruta rota.
      */
    select(columnas: string) {
      if (this.accion === "select") estado.lecturas.push(this.tabla);
      this.columnas = columnas;
      this.pidioSelect = true;
      return this;
    }
    eq(columna: string, valor: unknown) { this.igualdades.push([columna, valor]); return this; }
    in(columna: string, valores: readonly unknown[]) { this.enLista = [columna, valores]; return this; }
    /**
     * El `IS` de PostgREST, que **no es `eq`**. El repo siempre le pasa `null`,
     * y ahí la diferencia importa: una fila a la que le falta la clave también
     * es nula, y en un test ése es el caso **normal** —se arman con las columnas
     * que interesan y el resto se omite—. Con una igualdad pelada esa fila no
     * entraría y el conteo daría de menos sin decirlo.
     */
    is(columna: string, valor: unknown) {
      if (valor !== null) throw new Error(sóloSabe(`.is("${columna}", ${JSON.stringify(valor)})`, `.is(columna, null)`));
      this.nulas.push(columna);
      return this;
    }
    /**
     * Dos formas: `.not(columna, "is", null)` —las divergencias de la Agenda,
     * los ciclos de OT, los pendientes de planilla— y `.not(columna, "in",
     * "(A,B)")`, que es como la campana y el listado sacan las órdenes cerradas
     * del conteo de atrasadas. Cualquier otra **revienta**, y eso es lo
     * contrario de lo cómodo a propósito: devolver todo sería un test en verde
     * con el filtro sin aplicar, que es el modo de fallar que este archivo
     * entero existe para no tener.
     */
    not(columna: string, operador: string, valor: unknown) {
      if (operador === "is" && valor === null) {
        this.noNulas.push(columna);
        return this;
      }
      if (operador === "in" && typeof valor === "string" && /^\(.*\)$/.test(valor)) {
        // Se compara como texto, igual que el `in` de PostgREST sobre una
        // columna de texto. Una fila sin la columna no está en la lista.
        this.fueraDeLista.push([columna, valor.slice(1, -1).split(",").map((v) => v.trim())]);
        return this;
      }
      throw new Error(sóloSabe(
        `.not("${columna}", "${operador}", ${JSON.stringify(valor)})`,
        `.not(columna, "is", null) y .not(columna, "in", "(A,B)")`));
    }
    /** El `or=(...)` de PostgREST. Lo evalúa `cumpleElOr`, definida más arriba. */
    or(filtros: string) { this.alternativas.push(filtros); return this; }
    range(desde: number, hasta: number) { this.rango = [desde, hasta]; return this; }
    /** El orden no se simula: ninguna ruta depende de él para decidir. */
    order() { return this; }
    single() { this.unica = "single"; return this; }
    // La diferencia importa: sin fila, `maybeSingle` devuelve `data: null` **sin
    // error** y `single` devuelve un error.
    maybeSingle() { this.unica = "maybeSingle"; return this; }
    insert(fila: Fila) { this.accion = "insert"; this.fila = fila; return this; }
    /**
     * Sólo el `onConflict` de una columna, que es como lo usan las tres listas de
     * Compras. Sin él se porta como un `insert`: no se simula la clave primaria
     * de cada tabla, así que un upsert sin decir sobre qué columna choca no tiene
     * con qué chocar.
     */
    upsert(fila: Fila, opciones?: { onConflict?: string }) {
      this.accion = "upsert";
      this.fila = fila;
      this.conflicto = opciones?.onConflict ?? null;
      return this;
    }
    /** Un `update` aplica los mismos filtros que un `select`: sólo toca lo que coincide. */
    update(fila: Fila) { this.accion = "update"; this.fila = fila; return this; }
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

      if (this.accion === "upsert" && this.conflicto) {
        // `onConflict` es una **lista** de columnas separadas por coma, que es
        // como se nombra una clave natural: `equipment_id,accion,componente`.
        // Tratarla como un solo nombre de columna hacía que el fake comparara
        // `undefined === undefined` y diera que **todo choca con todo**: dos
        // upserts distintos sobre la misma tabla terminaban en una sola fila, y
        // un test que afirmara «no se escribió nada» pasaba en verde por el
        // motivo equivocado (25/11/2026).
        const claves = this.conflicto.split(",").map((c) => c.trim()).filter(Boolean);
        // Una fila que no trae alguna de las columnas de la clave no puede
        // chocar por ella: en Postgres dos NULL no son iguales para un `unique`.
        const choca = claves.every((c) => this.fila![c] !== undefined)
          ? filas.find((f) => claves.every((c) => f[c] === this.fila![c]))
          : undefined;
        // La fila que ya estaba se actualiza y no se anota en `inserts`: lo que un
        // test quiere saber de un upsert repetido es justamente que no agregó nada.
        if (choca) {
          Object.assign(choca, this.fila);
          return { data: this.proyectar(choca), error: null };
        }
      }

      if (this.accion === "insert" || this.accion === "upsert") {
        const seNego = opciones.alInsertar?.(this.tabla, this.fila!, filas) ?? null;
        if (seNego) return { data: null, error: seNego };
        const nueva = {
          id: `nueva-${filas.length + 1}`, creado_en: "2026-10-31T15:00:00Z", ...this.fila,
        };
        filas.push(nueva);
        estado.inserts.push(nueva);
        return { data: this.proyectar(nueva), error: null };
      }

      const coincide = (f: Fila) =>
        this.igualdades.every(([c, v]) => f[c] === v) &&
        this.nulas.every((c) => esNula(f[c])) &&
        this.noNulas.every((c) => !esNula(f[c])) &&
        this.fueraDeLista.every(([c, vs]) => !vs.includes(String(f[c] ?? ""))) &&
        this.alternativas.every((filtros) => cumpleElOr(f, filtros)) &&
        (!this.enLista || this.enLista[1].includes(f[this.enLista[0]]));

      if (this.accion === "update") {
        const aTocar = filas.filter(coincide);
        for (const f of aTocar) Object.assign(f, this.fila);
        return { data: this.pidioSelect ? aTocar.map((f) => this.proyectar(f)) : null, error: null };
      }

      if (this.accion === "delete") {
        const aBorrar = filas.filter(coincide);
        for (const f of aBorrar) {
          const seNego = opciones.alBorrar?.(this.tabla, f, filas) ?? null;
          if (seNego) return { data: null, error: seNego };
        }
        estado.tablas[this.tabla] = filas.filter((f) => !coincide(f));
        return { data: this.pidioSelect ? aBorrar.map((f) => ({ id: f.id })) : null, error: null };
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
