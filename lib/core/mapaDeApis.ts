/**
 * Lo que se puede saber de una ruta leyendo su archivo.
 *
 * Existe para que el mapa de las 282 rutas lo escriba un script y no una
 * persona: una lista hecha a mano queda desactualizada al día siguiente, y una
 * documentación que miente es peor que no tenerla. Lo que decide —cuál de las
 * guardas tiene una ruta, qué tablas toca, si escribe una planilla— vive acá,
 * separado de la lectura de archivos, que es lo que hace
 * `scripts/mapa-de-apis.mts`.
 *
 * **Lee texto, no ejecuta nada.** No hay análisis sintáctico: son expresiones
 * regulares sobre el código fuente, y eso tiene un techo que conviene conocer
 * antes de confiar en un número. Lo que no ve está dicho en cada función.
 */

/** La url que alguien llama, a partir de dónde vive el archivo. */
export function rutaDeLaUrl(rutaDelArchivo: string): string {
  return (
    "/" +
    rutaDelArchivo
      .replace(/\\/g, "/")
      .replace(/^.*?app\//, "")
      .replace(/\/route\.ts$/, "")
  );
}

/** Los verbos HTTP que la ruta expone, en el orden en que están escritos. */
export function metodosDe(fuente: string): string[] {
  const encontrados = fuente.matchAll(
    /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\b/g,
  );
  return [...encontrados].map((m) => m[1]);
}

/**
 * Qué separa a esta ruta de cualquiera que la llame.
 *
 * Son cinco clases y **el orden importa**, porque varias conviven: una ruta de
 * módulo pide sesión *y* permiso, y se informa la más fuerte. Lo que no es
 * ninguna se dice `sin-guarda` **a propósito**: puede estar protegida por el
 * proxy o por RLS, pero eso no se ve en este archivo, y suponerlo sería
 * justamente lo que esta documentación no tiene que hacer. Quien junta las dos
 * mitades es `guardaEfectiva`, más abajo.
 */
export type ClaseDeGuarda =
  | "secreto-de-cron"
  | "secreto-propio"
  | "secreto-en-base"
  | "permiso"
  | "sesion"
  | "sin-guarda";

export interface Guarda {
  clase: ClaseDeGuarda;
  /** El nombre de la función de permiso o de la variable del secreto, si lo hay. */
  detalle: string | null;
}

export function guardaDe(fuente: string): Guarda {
  if (/revisarElSecreto\s*\(/.test(fuente)) return { clase: "secreto-de-cron", detalle: null };

  const secretoPropio = fuente.match(/process\.env\.([A-Z0-9_]*SECRET[A-Z0-9_]*)/);
  if (secretoPropio) return { clase: "secreto-propio", detalle: secretoPropio[1] };

  // Un token que viaja en el pedido y se compara contra una fila. Hoy hay
  // **uno solo**: el `X-Goog-Channel-Token` de la Agenda, que se guardó en
  // `agenda_canales` al abrir el canal. Se reconoce por el ayudante, así que un
  // segundo caso o lo reusa o se agrega acá — y si no, va a salir `ABIERTA`,
  // que es ruidoso a propósito.
  if (/\btokenValido\s*\(/.test(fuente)) {
    return { clase: "secreto-en-base", detalle: "tokenValido" };
  }

  // Las formas de preguntar por un permiso que hay en el repo. `es_admin_check`
  // entra acá y no en una clase propia: es un permiso, el más alto que hay.
  const permiso = fuente.match(
    /\b(puede[A-Z][A-Za-z]*|nivelEnModulo|nivel[A-Z][A-Za-z]*De|es_admin_check)\s*\(/,
  );
  if (permiso) return { clase: "permiso", detalle: permiso[1] };

  // `usuarioActual()` es `auth.getUser()` memoizado por render: pide lo mismo.
  if (/auth\.getUser\s*\(|\busuarioActual\s*\(/.test(fuente)) {
    return { clase: "sesion", detalle: null };
  }

  return { clase: "sin-guarda", detalle: null };
}

/**
 * Las tablas que la ruta nombra en un `.from("…")`.
 *
 * Sólo las literales: con una variable adentro no se puede saber cuál es
 * leyendo el archivo, y escribir el nombre de la variable sería peor que no
 * decir nada. Tampoco ve las tablas que toca a través de una función de
 * `lib/`, y por eso el mapa lista además de qué módulos depende cada ruta.
 */
export function tablasDe(fuente: string): string[] {
  const encontradas = fuente.matchAll(/\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g);
  return [...new Set([...encontradas].map((m) => m[1]))].sort();
}

/**
 * De qué módulos de `lib/` depende la ruta.
 *
 * Es la mitad de «con qué está conectada» que las tablas no cuentan: una ruta
 * que no nombra ninguna tabla puede tocar seis a través de un módulo
 * compartido. Se lee del `import`, así que es exacto para lo que el archivo
 * declara y ciego para lo que ese módulo importe a su vez.
 */
export function dependenciasDe(fuente: string): string[] {
  const encontrados = fuente.matchAll(/from\s+["'`]@\/(lib\/[^"'`]+)["'`]/g);
  return [...new Set([...encontrados].map((m) => m[1]))].sort();
}

export interface Rasgos {
  /** Usa el cliente admin, o sea que **RLS no corre**: el permiso lo pone la ruta. */
  clienteAdmin: boolean;
  /** Escribe en una planilla de Google, que es lo que obliga a anotar un pendiente. */
  escribeEnPlanilla: boolean;
  /** Deja rastro en `auditoria`, que es lo que lleva una acción irreversible. */
  audita: boolean;
  /** Usa `traerTodo`, o sea que previó el corte de PostgREST en 1000 filas. */
  paginado: boolean;
  /** Valida el cuerpo con zod en vez de a mano. */
  zod: boolean;
  /** Segundos declarados, cuando la ruta sabe que puede tardar. */
  maxDuration: number | null;
}

export function rasgosDe(fuente: string): Rasgos {
  const duracion = fuente.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  return {
    clienteAdmin: /createAdminClient\s*\(/.test(fuente),
    // Las dos funciones de escritura de `lib/core/sheets.ts`. Leer no cuenta:
    // lo que obliga a dejar el pendiente anotado es escribir.
    escribeEnPlanilla: /\b(agregarFila|escribirCeldas)\s*\(/.test(fuente),
    audita: /\bauditar\s*\(/.test(fuente),
    paginado: /\btraerTodo\s*\(/.test(fuente),
    zod: /\bvalidar\s*\(/.test(fuente),
    maxDuration: duracion ? Number(duracion[1]) : null,
  };
}

/**
 * Las rutas que el proxy deja pasar **sin sesión**, leídas del propio
 * middleware.
 *
 * No se copian acá a propósito. Dos listas que tienen que coincidir es
 * exactamente la forma del error que este repo ya pagó tres veces —la clave de
 * la sesión, el mensaje de vaciado, el nombre del caché—, y ésta decide quién
 * entra sin estar logueado. Leerla del archivo que la aplica hace que el mapa
 * no pueda contradecir a la realidad.
 */
export function exentasDeSesion(fuenteDelMiddleware: string): string[] {
  const iguales = [...fuenteDelMiddleware.matchAll(/path\s*===\s*["'`](\/api\/[^"'`]+)["'`]/g)];
  const prefijos = [
    ...fuenteDelMiddleware.matchAll(/path\.startsWith\(\s*["'`](\/api\/[^"'`]+)["'`]\s*\)/g),
  ];
  return [...new Set([...iguales, ...prefijos].map((m) => m[1]))].sort();
}

/**
 * Qué protege de verdad a una ruta: lo que declara su archivo, y si no declara
 * nada, el proxy.
 *
 * **`ABIERTA` es el único resultado que pide una explicación**: quiere decir
 * que el proxy la deja pasar sin sesión *y* que el archivo no escribe ninguna
 * guarda. Hoy eso no pasa —los cinco exentos validan su propio secreto— y la
 * gracia de que esto se genere es que el día que pase, aparezca solo.
 */
export function guardaEfectiva(
  claseDelArchivo: ClaseDeGuarda,
  url: string,
  exentas: string[],
): ClaseDeGuarda | "el proxy" | "ABIERTA" {
  if (claseDelArchivo !== "sin-guarda") return claseDelArchivo;
  const exenta = exentas.some((e) => (e.endsWith("/") ? url.startsWith(e) : url === e));
  return exenta ? "ABIERTA" : "el proxy";
}
