import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUTA_DE,
  SESION,
  comoContesto,
  conSuArticulo,
  despuesDelIntento,
  proximaAMandar,
  siNoSePudoAvisar,
  tomarLaCarga,
} from "@/public/cola/colaOffline.js";
import type { CargaEnCola } from "@/public/cola/colaOffline.js";
// Sólo el mensaje, no la etiqueta del `sync`: `public/sw.js` no filtra por
// etiqueta —atiende cualquier `sync`— así que ese nombre no ata nada y el test
// puede escribirlo. El del mensaje sí ata, y por eso entra importado. Y entra
// también `pedirVaciadoAhora`, que es quien lo manda de verdad: ver el test
// «de punta a punta».
import { MENSAJE_DE_VACIADO, pedirVaciadoAhora } from "./vaciarLaCola";

/**
 * Prueba `public/sw.js` de verdad: es JavaScript plano que usa `self`, así que
 * se lee el archivo, se evalúa contra un `self` falso que guarda los handlers
 * que registra, y después se disparan los eventos a mano.
 *
 * Qué NO prueba: que el navegador llame al handler, ni que Chrome ofrezca
 * instalar. Prueba lo que el archivo hace cuando lo llaman, y que está
 * registrado para que lo llamen.
 *
 * LAS DECISIONES DE LA COLA ENTRAN DE VERDAD Y NO COMO DOBLES. `proximaAMandar`,
 * `tomarLaCarga`, `comoContesto` y `despuesDelIntento` son las mismas funciones
 * puras que corre la pantalla, ya probadas en `colaOffline.test.ts`: doblarlas
 * acá probaría que el service worker llama a una doble, que es justo lo que no
 * interesa. Lo que sí va doble es IndexedDB —no existe en vitest— y `caches`.
 */

const ORIGEN = "https://sdg.test";
const CODIGO = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

/**
 * El molde evalúa texto plano con `new Function`, y un `import` ahí es un error
 * de sintaxis. Se sacan las líneas de import y lo que importan entra como
 * parámetro, con el mismo nombre. Si el service worker importa algo que
 * `DEPENDENCIAS` no tiene, el archivo revienta con un ReferenceError; hay un
 * test más abajo que lo dice con todas las letras en vez de dejarlo salir como
 * un fallo raro en otro lado.
 */
/**
 * El nombre del caché, leído del propio archivo. Sale de ahí y no escrito a
 * mano porque **se sube a propósito** cuando lo guardado quedó roto, y un test
 * que lo tuviera fijo pasaría a sembrar un caché que el service worker ya no
 * usa: seguiría verde sin probar nada.
 */
const NOMBRE_DEL_CACHE = /const CACHE = "([^"]+)"/.exec(
  readFileSync(join(process.cwd(), "public", "sw.js"), "utf8"),
)?.[1] as string;

const SIN_IMPORTS = CODIGO.replace(/^import\s+\{[\s\S]*?\}\s+from\s+"[^"]+";$/gm, "");

/**
 * El archivo sin sus comentarios, ni los de bloque ni los de línea.
 *
 * **Es un recorte a lo bruto y rompe código**: en `archivosDe`, la línea que
 * descarta `//otro.com/x.js` lleva un `"//"` adentro de un texto, y esto la
 * corta ahí como si fuera un comentario. O sea que
 * esto **no sirve para analizar el archivo**: sirve para una sola cosa, que es
 * preguntar si una llamada aparece, donde borrar de más sólo puede hacer que un
 * test pase cuando debería fallar — y esa llamada no está en ninguna de las
 * líneas que el recorte trunca. No lo uses para nada más sin mirar esto.
 */
function soloCodigo(texto: string) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Los nombres que `public/sw.js` importa, tal como los escribe. */
function loQueImporta(): string[] {
  const nombres: string[] = [];
  for (const bloque of CODIGO.matchAll(/^import\s+\{([\s\S]*?)\}\s+from\s+"[^"]+";$/gm)) {
    for (const nombre of bloque[1].split(",")) {
      const limpio = nombre.trim();
      if (limpio !== "") nombres.push(limpio);
    }
  }
  return nombres;
}

type Ventana = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
};

/** Lo mínimo de una `Response` que el service worker toca. */
type Respuesta = {
  ok: boolean;
  status?: number;
  redirected?: boolean;
  clone?: () => Respuesta;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

/** La respuesta que devuelve el `fetch` doble: alcanza con que sea identificable. */
const RESPUESTA: Respuesta = {
  ok: true,
  status: 200,
  redirected: false,
  clone: () => RESPUESTA,
  text: async () => "",
  json: async () => ({}),
};

/** Una respuesta de la ruta de alta, con lo que `comoContesto` va a mirar. */
function contesta(
  status: number,
  cuerpo: Record<string, unknown> = {},
  redirected = false,
): Respuesta {
  const respuesta: Respuesta = {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
    clone: () => respuesta,
  };
  return respuesta;
}

/** Una página servida por la red, con su HTML adentro. */
function pagina(html: string, redirected = false): Respuesta {
  const respuesta: Respuesta = {
    ok: true,
    status: 200,
    redirected,
    text: async () => html,
    json: async () => ({}),
    clone: () => respuesta,
  };
  return respuesta;
}

/** Una carga de la cola, con lo imprescindible puesto. */
function unaCarga(extra: Partial<CargaEnCola> = {}): CargaEnCola {
  return {
    clave: "k1",
    tipo: "aviso",
    cuerpo: { descripcion: "pérdida de aceite" },
    usuarioId: "u1",
    creadaEn: "2026-10-18T10:00:00.000Z",
    tomadaEn: null,
    intentos: 0,
    ultimoError: null,
    estado: "esperando",
    ...extra,
  };
}

/** IndexedDB no existe en vitest: la cola vive en un Map que se puede mirar. */
function colaDoble(iniciales: CargaEnCola[]) {
  const filas = new Map(iniciales.map((carga) => [carga.clave, { ...carga }]));
  return {
    filas,
    // Copias y no las filas mismas: así un cambio del service worker tiene que
    // pasar sí o sí por `actualizarCarga`, como contra la base de verdad.
    leerCola: vi.fn(async () => [...filas.values()].map((carga) => ({ ...carga }))),
    actualizarCarga: vi.fn(async (clave: string, cambios: Partial<CargaEnCola>) => {
      const actual = filas.get(clave);
      if (actual) filas.set(clave, { ...actual, ...cambios, clave });
    }),
    borrarCarga: vi.fn(async (clave: string) => {
      filas.delete(clave);
    }),
  };
}

/** `caches` doble: un Map por nombre de caché, con lo que guardó cada uno. */
function cachesDoble() {
  const porNombre = new Map<string, Map<string, unknown>>();
  // La clave se normaliza a url absoluta como hace el Cache de verdad, y eso no
  // es cosmético: el precache guarda con la ruta tal como la escribe el HTML
  // (`/_next/...`) y el handler de `fetch` busca con la url absoluta del
  // pedido. Si el doble no las unificara, daría por fallado un acierto real.
  const clave = (pedido: unknown) =>
    new URL(typeof pedido === "string" ? pedido : (pedido as { url: string }).url, ORIGEN).href;
  const abiertos: string[] = [];
  const caches = {
    open: vi.fn(async (nombre: string) => {
      abiertos.push(nombre);
      if (!porNombre.has(nombre)) porNombre.set(nombre, new Map());
      const guardado = porNombre.get(nombre)!;
      return {
        put: vi.fn(async (pedido: unknown, respuesta: unknown) => {
          guardado.set(clave(pedido), respuesta);
        }),
        match: vi.fn(async (pedido: unknown) => guardado.get(clave(pedido))),
        // `keys()` devuelve pedidos, no textos: es lo que el service worker
        // recorre para sacar lo que la pantalla ya no pide.
        keys: vi.fn(async () => [...guardado.keys()].map((url) => ({ url }))),
        delete: vi.fn(async (pedido: unknown) => guardado.delete(clave(pedido))),
      };
    }),
  };
  return { caches, porNombre, abiertos };
}

type Opciones = {
  /** Qué contesta la red para cada url. Por defecto, `RESPUESTA` para todo. */
  red?: (url: string, init?: Record<string, unknown>) => Promise<Respuesta>;
  /** Lo que hay en la cola del teléfono al empezar. */
  cargas?: CargaEnCola[];
  /** Quién quedó anotado como la sesión de este teléfono. */
  sesion?: { id: string; nombre: string } | null;
  /** Si mostrar una notificación falla (permiso denegado, por ejemplo). */
  sinNotificaciones?: boolean;
  /** Si IndexedDB no abre: Safari en modo privado, el almacenamiento lleno. */
  colaRota?: boolean;
  /** Si `caches.open` tira: la ventana privada de Safari hace exactamente eso. */
  sinCache?: boolean;
};

/** Evalúa el service worker y devuelve sus handlers y las dobles con que corrió. */
function cargarSW(ventanas: Ventana[] = [], opciones: Opciones = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const openWindow = vi.fn(async () => undefined);
  const showNotification = vi.fn(async () => {
    if (opciones.sinNotificaciones) throw new Error("permiso denegado");
    return undefined;
  });
  const matchAll = vi.fn(async () => ventanas);
  // `claim` y `skipWaiting` son las del ciclo de vida: sin ellas el worker
  // nuevo queda en espera y el viejo sigue atendiendo los push.
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn(() => undefined);
  const clients = { matchAll, openWindow, claim };
  const self = {
    addEventListener: (tipo: string, fn: (event: unknown) => void) => {
      handlers[tipo] = fn;
    },
    location: { origin: ORIGEN },
    registration: { showNotification },
    skipWaiting,
    clients,
  };
  // `fetch` entra como parámetro y no como global: así el handler de navegación
  // se prueba contra una doble en vez de salir a la red de verdad.
  const fetchDoble = vi.fn(
    opciones.red ?? (async (): Promise<Respuesta> => RESPUESTA),
  );
  const cola = colaDoble(opciones.cargas ?? []);
  if (opciones.colaRota) {
    cola.leerCola.mockRejectedValue(new Error("la base sdg no abre"));
  }
  const sesion = opciones.sesion === undefined ? { id: "u1", nombre: "Ana" } : opciones.sesion;
  // La clave entra **importada** y no escrita a mano: es la misma constante que
  // escribe `lib/core/sesionDelTelefono.ts` y la que el service worker lee. Si
  // el worker buscara bajo otro nombre, acá no encontraría la sesión y todos
  // los tests de vaciado se pondrían rojos, que es lo que se quiere.
  const leerCatalogo = vi.fn(async (nombre: string) => (nombre === SESION ? sesion : null));
  const { caches, porNombre, abiertos } = cachesDoble();
  if (opciones.sinCache) {
    caches.open.mockRejectedValue(new Error("el almacenamiento está bloqueado"));
  }

  const dependencias: Record<string, unknown> = {
    // El pegamento compartido, también de verdad: son las dos cadenas que la
    // pantalla y el worker tienen que escribir igual, y desde el 19/10/2026 hay
    // una sola definición de cada una en vez de dos copias.
    RUTA_DE,
    SESION,
    // Las puras, de verdad: son las mismas reglas que corre la pantalla.
    comoContesto,
    conSuArticulo,
    despuesDelIntento,
    proximaAMandar,
    siNoSePudoAvisar,
    tomarLaCarga,
    // La persistencia, doble: IndexedDB no existe acá.
    actualizarCarga: cola.actualizarCarga,
    borrarCarga: cola.borrarCarga,
    leerCatalogo,
    leerCola: cola.leerCola,
  };

  // `clients` y `caches` aparecen sueltos en el archivo, como globales del
  // service worker.
  new Function(
    "self",
    "clients",
    "fetch",
    "caches",
    ...Object.keys(dependencias),
    SIN_IMPORTS,
  )(self, clients, fetchDoble, caches, ...Object.values(dependencias));

  return {
    handlers,
    openWindow,
    showNotification,
    matchAll,
    fetchDoble,
    claim,
    skipWaiting,
    cola,
    leerCatalogo,
    caches,
    cachesAbiertos: abiertos,
    guardado: porNombre,
    dependencias,
  };
}

/**
 * Dispara un evento y devuelve la promesa de lo que el handler le pasó a
 * `waitUntil`, sin esperarla: hay un test que necesita disparar dos a la vez.
 */
function lanzar(
  handlers: Record<string, (event: unknown) => void>,
  tipo: string,
  evento: Record<string, unknown> = {},
) {
  const esperas: Promise<unknown>[] = [];
  handlers[tipo]({ ...evento, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
  return Promise.all(esperas);
}

/** Deja correr todo lo pendiente: los microtasks y los `setTimeout(0)`. */
function dejarCorrer() {
  return new Promise((resolver) => setTimeout(resolver, 0));
}

/**
 * Lo único del caché que a los tests les importa: qué quedó guardado. Devuelve
 * caminos y no urls enteras porque es lo que se lee de un vistazo en un
 * `expect`, y el origen es siempre el mismo.
 */
function urlsGuardadas(guardado: Map<string, Map<string, unknown>>) {
  return [...guardado.values()].flatMap((caché) =>
    [...caché.keys()].map((url) => new URL(url).pathname),
  );
}

/** Dispara `notificationclick` y espera lo que el handler le pasó a `waitUntil`. */
async function clickear(
  handlers: Record<string, (event: unknown) => void>,
  data?: { url?: string } | undefined
) {
  const esperas: Promise<unknown>[] = [];
  const close = vi.fn();
  handlers["notificationclick"]({
    notification: { close, data },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  await Promise.all(esperas);
  return { close };
}

describe("public/sw.js", () => {
  /*
   * El ciclo de vida, que es lo que hace que un arreglo a este archivo llegue
   * a un aparato.
   *
   * Sin `skipWaiting` el worker nuevo queda en espera hasta que se cierren
   * todas las ventanas del dominio, y mientras tanto el viejo sigue atendiendo
   * los `push`. El 18/10/2026 eso hizo que un arreglo desplegado no corriera
   * en el unico telefono con notificaciones prendidas, y no se noto porque un
   * worker en espera no se distingue de uno que funciona.
   */
  describe("ciclo de vida", () => {
    it("una version nueva no espera: toma el control enseguida", async () => {
      const { handlers, skipWaiting } = cargarSW();
      expect(handlers["install"]).toBeTypeOf("function");
      // El `install` ahora además guarda la pantalla, así que recibe su
      // `waitUntil` como cualquier evento. Lo que este test fija sigue siendo
      // lo mismo: que no se quede esperando.
      await lanzar(handlers, "install");
      expect(skipWaiting).toHaveBeenCalledTimes(1);
    });

    it("al activarse se queda con las ventanas que ya estaban abiertas", async () => {
      const { handlers, claim } = cargarSW();
      expect(handlers["activate"]).toBeTypeOf("function");
      const esperas: Promise<unknown>[] = [];
      handlers["activate"]({ waitUntil: (p: Promise<unknown>) => esperas.push(p) });
      await Promise.all(esperas);
      expect(claim).toHaveBeenCalledTimes(1);
    });

    /*
     * Un `activate` que borra un caché entero es lo que vuelve peligroso a
     * `skipWaiting`: la página vieja pide un chunk que ya no está y no hay de
     * dónde sacarlo.
     *
     * **Este test cambió a propósito cuando llegó el caché.** Antes decía «no
     * hay cachés, así que no se borra ninguno»; ahora dice algo más preciso y
     * que sigue teniendo fuerza: no se borra ningún **caché**
     * (`caches.delete`), que es la operación peligrosa. Sacar entradas de
     * adentro del propio caché (`cache.delete`) es otra cosa y sí se hace, en
     * el `install` y sólo cuando la red anduvo — un chunk que se saca y alguien
     * pide igual cae en la red, donde Vercel todavía lo tiene. Eso es lo que
     * mantiene al caché del tamaño de una pantalla, que importa porque el
     * desalojo de un origen se lleva también la cola de IndexedDB.
     */
    it("no se borra ningún caché entero: eso es lo que rompe con skipWaiting", () => {
      // Se mira el código sin comentarios: el comentario que explica esta regla
      // la nombra, y un test que se dispara con su propia explicación obliga a
      // no explicarla.
      expect(soloCodigo(CODIGO)).not.toMatch(/caches\s*\.\s*delete/);
    });
  });

  /*
   * EL PEGAMENTO QUE LOS DOS MUNDOS TIENEN QUE ESCRIBIR IGUAL.
   *
   * `SESION` y `RUTA_DE` estaban copiados a mano en `public/sw.js` y en los
   * archivos de React, sin nada que atara las copias. El modo de fallar de
   * `SESION` es el peor que tiene esta cola: el worker lee de esa clave quién
   * tiene la sesión abierta, así que una letra distinta lo deja sin sesión
   * conocida y **no sale ninguna carga**, sin un error en ningún lado.
   *
   * Se arregló sacando la copia en vez de atándola: hay **una sola definición**
   * de cada una, en `public/cola/colaOffline.js`, y los tres mundos la importan
   * —React, el service worker y estos tests, que las inyectan en el molde—. Lo
   * único que queda por vigilar, y es lo que este test hace, es que nadie vuelva
   * a declararlas acá: una `const SESION = "..."` local **gana sobre el import**
   * sin que falle nada, y el agujero vuelve a abrirse igual que antes.
   *
   * Los tests de vaciado son la otra mitad: el doble de `leerCatalogo` responde
   * bajo `SESION` y las urls esperadas salen de `RUTA_DE`, así que si el worker
   * dejara de usarlas se ponen rojos.
   */
  it("el service worker no redeclara el pegamento: lo importa", () => {
    const codigo = soloCodigo(CODIGO);
    for (const nombre of ["SESION", "RUTA_DE"]) {
      expect(loQueImporta()).toContain(nombre);
      expect(codigo).not.toMatch(new RegExp(`(const|let|var)\\s+${nombre}\\s*=`));
    }
  });

  it("el molde le da al service worker todo lo que importa", () => {
    // Si alguien agrega un import a `public/sw.js` y no lo suma acá, el archivo
    // revienta con un ReferenceError adentro de `new Function` y el fallo
    // aparece en cualquier otro test, lejos de la causa. Esto lo dice directo.
    const { dependencias } = cargarSW();
    for (const nombre of loQueImporta()) {
      expect(Object.keys(dependencias)).toContain(nombre);
    }
  });

  it("proxy.ts deja fuera de la sesión lo que el service worker importa", () => {
    /*
     * MEDIDO EN PRODUCCIÓN el 19/10/2026: pedir `/cola/cualquier-cosa.js` desde
     * el registro de un service worker daba «The script resource is behind a
     * redirect, which is disallowed» —el 307 al login—. O sea que sacar `cola`
     * del matcher no deja el módulo lento ni a medias: **el service worker
     * entero no se registra**, y se van con él el push y la instalabilidad.
     *
     * Se arma el regex del matcher igual que Next y se le pregunta por los dos
     * casos, en vez de buscar el texto «cola» adentro de la cadena: así esto
     * sigue valiendo si alguien reescribe el matcher de otra forma.
     */
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    const matcher = proxy.match(/"(\/\(\(\?!.*)",/)?.[1];
    expect(matcher).toBeTypeOf("string");
    const comoNext = new RegExp(`^${matcher}$`);

    for (const ruta of ["/cola/colaOffline.js", "/cola/idb.js"]) {
      expect(comoNext.test(ruta)).toBe(false);
    }
    // Y una pantalla normal sigue pasando por el proxy, que es lo que pide la
    // sesión: la exclusión no puede haberse comido media app.
    for (const ruta of ["/mantenimiento", "/cargar", "/compras/aprobaciones"]) {
      expect(comoNext.test(ruta)).toBe(true);
    }
  });

  it("los archivos que el service worker importa existen donde dice", () => {
    /*
     * NADA MÁS LO VERIFICA, y por eso este test existe. `tsc` no mira
     * `public/`, el build no empaqueta este archivo, `revisar-arbol-commiteado`
     * sólo sigue `./`, `../` y `@/`, y el molde de acá arriba **borra los
     * imports con un regex** antes de evaluar. O sea que si alguien mueve
     * `public/cola/`, todo queda verde y en producción el navegador no puede
     * cargar los módulos: **el service worker entero deja de registrarse** y se
     * van con él el push y la instalabilidad.
     *
     * Las rutas son absolutas (`/cola/…`) porque las resuelve el navegador
     * contra el origen, así que el archivo vive en `public` + esa ruta.
     */
    const rutas = [...CODIGO.matchAll(/^import\s+\{[\s\S]*?\}\s+from\s+"([^"]+)";$/gm)].map(
      (bloque) => bloque[1],
    );
    expect(rutas.length).toBeGreaterThan(0);
    for (const ruta of rutas) {
      expect(ruta.startsWith("/")).toBe(true);
      expect(existsSync(join(process.cwd(), "public", ruta))).toBe(true);
    }
  });

  /*
   * Guardar la pantalla es lo que hace que `/cargar` se abra sin señal. Sin los
   * archivos que esa página pide queda en blanco: el HTML de Next no trae nada
   * dibujado, lo dibuja su JavaScript.
   */
  describe("install: guardar la pantalla", () => {
    const HTML =
      `<html><head>` +
      `<link rel="stylesheet" href="/_next/static/css/a1b2.css"/>` +
      `<link rel="preload" as="script" href="/_next/static/chunks/precargado.js"/>` +
      `<link rel="preload" as="font" href="/_next/static/media/no-va.woff2"/>` +
      `</head><body><script src="/_next/static/chunks/main-9f8e.js"></script></body></html>`;

    it("guarda /cargar y los archivos que esa página pide", async () => {
      const { handlers, guardado } = cargarSW([], { red: async () => pagina(HTML) });
      await lanzar(handlers, "install");

      const urls = urlsGuardadas(guardado);
      expect(urls).toContain("/cargar");
      expect(urls).toContain("/_next/static/chunks/main-9f8e.js");
      expect(urls).toContain("/_next/static/css/a1b2.css");
      // Un `preload` de código entra aunque hoy sea redundante: si Next emite
      // uno que no esté además como `<script src>`, sin esto la pantalla
      // fallaría sin señal.
      expect(urls).toContain("/_next/static/chunks/precargado.js");
      // Una fuente no: sin ella la pantalla se dibuja con la de respaldo.
      expect(urls).not.toContain("/_next/static/media/no-va.woff2");
    });

    it("el caché va con el nombre versionado", async () => {
      // Es lo que deja convivir el caché con `skipWaiting`: subir la versión
      // estrena caché en vez de pisarle los assets a una página ya cargada.
      const { handlers, cachesAbiertos } = cargarSW([], { red: async () => pagina(HTML) });
      await lanzar(handlers, "install");
      expect(cachesAbiertos[0]).toMatch(/-v\d+$/);
    });

    it("si la sesión venció no guarda el login haciéndose pasar por /cargar", async () => {
      // `/cargar` pide sesión en `proxy.ts`: sin ella el pedido termina en el
      // login con un 200 redondo. Guardar eso sería servir el login para
      // siempre a quien abra la pantalla sin señal.
      const { handlers, guardado } = cargarSW([], { red: async () => pagina(HTML, true) });
      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toEqual([]);
    });

    it("si falta un archivo no se guarda nada: a medias es peor que nada", async () => {
      // Antes esto afirmaba lo contrario —que con el `.css` caído `/cargar`
      // igual quedaba guardado— y lo que fijaba era un estado roto: un HTML
      // guardado cuyos chunks no están es, sin señal, la pantalla en blanco.
      // Y nadie la curaba: el `install` no vuelve a correr hasta que cambien
      // los bytes del archivo.
      const { handlers, guardado } = cargarSW([], {
        red: async (url) => {
          if (url.endsWith(".css")) throw new Error("sin red");
          return pagina(HTML);
        },
      });
      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toEqual([]);
    });

    it("un archivo que contesta 404 cuenta como faltante", async () => {
      // Un 404 guardado es peor que no guardarlo: el navegador lo serviría
      // como si fuera el chunk.
      const { handlers, guardado } = cargarSW([], {
        red: async (url) => (url.endsWith(".css") ? contesta(404) : pagina(HTML)),
      });
      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toEqual([]);
    });

    it("un precache incompleto no se lleva puesto al que ya andaba", async () => {
      // Lo que ya estaba guardado sigue sirviendo sin señal. Por eso la poda
      // va al final y sólo cuando bajó todo.
      const VIEJO = "/_next/static/chunks/del-despliegue-anterior.js";
      const { handlers, guardado, caches } = cargarSW([], {
        red: async (url) => {
          if (url.endsWith(".css")) throw new Error("sin red");
          return pagina(HTML);
        },
      });
      const caché = await caches.open(NOMBRE_DEL_CACHE);
      await caché.put(`${ORIGEN}${VIEJO}`, RESPUESTA);
      await caché.put(`${ORIGEN}/cargar`, RESPUESTA);

      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toContain(VIEJO);
      expect(urlsGuardadas(guardado)).toContain("/cargar");
    });

    it("el push vuelve a intentarlo si no quedó nada guardado", async () => {
      // `install` corre una sola vez por versión del archivo, así que un corte
      // de señal justo ahí dejaba a ese teléfono sin pantalla sin señal hasta
      // el próximo despliegue del service worker.
      let hayRed = false;
      const { handlers, guardado } = cargarSW([], {
        red: async (url) => {
          if (!hayRed) throw new Error("sin red");
          return url === "/cargar" ? pagina(HTML) : RESPUESTA;
        },
      });
      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toEqual([]);

      hayRed = true;
      await lanzar(handlers, "push", {
        data: { json: () => ({ title: "SdG", body: "x", url: "/" }) },
      });
      expect(urlsGuardadas(guardado)).toContain("/cargar");
    });

    it("el sync también lo vuelve a intentar", async () => {
      // El `sync` llega cuando vuelve la señal, incluso con la app cerrada, y
      // sin este test sacarlo del handler quedaba verde.
      let hayRed = false;
      const { handlers, guardado } = cargarSW([], {
        red: async (url) => {
          if (!hayRed) throw new Error("sin red");
          return url === "/cargar" ? pagina(HTML) : RESPUESTA;
        },
      });
      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toEqual([]);

      hayRed = true;
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(urlsGuardadas(guardado)).toContain("/cargar");
    });

    it("primero sale la cola y después se completa la pantalla", async () => {
      // En paralelo, medio mega de chunks competiría con los POST de la cola
      // por la misma señal mala. La cola es lo que alguien está esperando.
      const orden: string[] = [];
      const { handlers } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) => {
          orden.push(url);
          if (url === "/api/mantenimiento/avisos") return contesta(200, { oa_number: "OA-1" });
          return url === "/cargar" ? pagina(HTML) : RESPUESTA;
        },
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(orden[0]).toBe("/api/mantenimiento/avisos");
      expect(orden).toContain("/cargar");
    });

    it("y si ya había algo guardado, el push no vuelve a bajarlo", async () => {
      // Medio mega por día por aparato contra una señal que ya es mala, para
      // refrescar algo que es consistente consigo mismo, no se paga.
      const { handlers, fetchDoble } = cargarSW([], { red: async () => pagina(HTML) });
      await lanzar(handlers, "install");
      const bajadas = fetchDoble.mock.calls.length;

      await lanzar(handlers, "push", {
        data: { json: () => ({ title: "SdG", body: "x", url: "/" }) },
      });
      expect(fetchDoble).toHaveBeenCalledTimes(bajadas);
    });

    it("saca del caché lo que la pantalla ya no pide", async () => {
      // Sin esto el caché acumularía los chunks de todos los despliegues para
      // siempre, y un desalojo del origen se lleva **también la cola** de
      // IndexedDB: lo que alguien cargó sin señal y todavía no salió.
      const VIEJO = "/_next/static/chunks/del-despliegue-anterior.js";
      const { handlers, guardado, caches } = cargarSW([], { red: async () => pagina(HTML) });
      const caché = await caches.open(NOMBRE_DEL_CACHE);
      await caché.put(`${ORIGEN}${VIEJO}`, RESPUESTA);
      expect(urlsGuardadas(guardado)).toContain(VIEJO);

      await lanzar(handlers, "install");

      expect(urlsGuardadas(guardado)).not.toContain(VIEJO);
      expect(urlsGuardadas(guardado)).toContain("/cargar");
      expect(urlsGuardadas(guardado)).toContain("/_next/static/chunks/main-9f8e.js");
    });

    it("sin red no saca nada, porque ahí no hay de dónde volver a sacarlo", async () => {
      // Borrar sólo es seguro cuando el que se saca se puede pedir a la red.
      const VIEJO = "/_next/static/chunks/del-despliegue-anterior.js";
      const { handlers, guardado, caches } = cargarSW([], {
        red: async () => {
          throw new Error("sin red");
        },
      });
      const caché = await caches.open(NOMBRE_DEL_CACHE);
      await caché.put(`${ORIGEN}${VIEJO}`, RESPUESTA);

      await lanzar(handlers, "install");
      expect(urlsGuardadas(guardado)).toContain(VIEJO);
    });

    it("si la red no contesta nada, el install no falla", async () => {
      // Un `install` que rechaza deja al worker sin activarse, y con él se van
      // el push y el vaciado. Guardar la pantalla es lo que se puede perder.
      const { handlers, skipWaiting } = cargarSW([], {
        red: async () => {
          throw new Error("sin red");
        },
      });
      await expect(lanzar(handlers, "install")).resolves.toBeDefined();
      expect(skipWaiting).toHaveBeenCalledTimes(1);
    });
  });

  it("el service worker registra un handler de fetch", () => {
    // Sin handler de fetch Chrome no dispara `beforeinstallprompt` y el botón de
    // instalar de Android no aparece nunca, sin ningún error. Es la línea que
    // alguien borraría por parecer inútil.
    const { handlers } = cargarSW();
    expect(typeof handlers["fetch"]).toBe("function");
  });

  it("una navegación se responde con la misma petición, contra la red", async () => {
    // El handler tiene que hacer algo observable: un `() => {}` es el patrón que
    // Chrome documenta como gameado y dejó de aceptar. Esto es el mínimo
    // honesto, y lo que prueba este test es que efectivamente responde.
    const { handlers, fetchDoble } = cargarSW();
    const respondWith = vi.fn();
    // `method` va puesto: el handler sirve la pantalla guardada sólo a las
    // navegaciones GET, así que sin esto este test probaría la otra rama.
    const request = { url: `${ORIGEN}/compras`, mode: "navigate", method: "GET" };
    handlers["fetch"]({ respondWith, request });

    expect(respondWith).toHaveBeenCalledTimes(1);
    expect(fetchDoble).toHaveBeenCalledWith(request);
    // Lo que se responde es lo que devolvió `fetch`, sin tocarlo: ni caché ni
    // página de reemplazo, que es la fase 3.
    const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
    await expect(respondido).resolves.toBe(RESPUESTA);
  });

  it("una navegación a una pantalla sí se responde, y a /api/ y /auth/ no", () => {
    // `/api/` y `/auth/` también son navegaciones y quedan afuera a propósito:
    // un enlace de exportación devuelve un Excel y el canje del `?code=` es un
    // 302 con `Set-Cookie`. Ninguno de los dos se puede probar desde acá, así
    // que no se los atraviesa. Este test es lo que impide sacar esas líneas.
    const casos = [
      { url: `${ORIGEN}/rrhh/empleados`, pasa: true },
      { url: `${ORIGEN}/api/rrhh/fichadas/export`, pasa: false },
      { url: `${ORIGEN}/auth/confirm?code=abc`, pasa: false },
    ];
    for (const { url, pasa } of casos) {
      const { handlers, fetchDoble } = cargarSW();
      const respondWith = vi.fn();
      handlers["fetch"]({ respondWith, request: { url, mode: "navigate", method: "GET" } });
      expect(respondWith).toHaveBeenCalledTimes(pasa ? 1 : 0);
      expect(fetchDoble).toHaveBeenCalledTimes(pasa ? 1 : 0);
    }
  });

  it("una navegación a otro origen no pasa por acá", () => {
    // No tiene por qué: el service worker es del SdG.
    const { handlers, fetchDoble } = cargarSW();
    const respondWith = vi.fn();
    handlers["fetch"]({
      respondWith,
      request: { url: "https://otro-sitio.test/compras", mode: "navigate", method: "GET" },
    });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  it("lo que no es navegación no se toca", () => {
    // Las imágenes, el JSON de las rutas y el bundle siguen su camino normal:
    // meterse en el medio de todo el tráfico no compra nada todavía.
    const { handlers, fetchDoble } = cargarSW();
    for (const mode of ["cors", "no-cors", "same-origin", undefined]) {
      const respondWith = vi.fn();
      handlers["fetch"]({
        respondWith,
        request: { url: `${ORIGEN}/icon-192.png`, mode, method: "GET" },
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(fetchDoble).not.toHaveBeenCalled();
  });

  /*
   * El respaldo de navegación. Se activa SÓLO cuando la red falla: una página
   * que cargó bien no tiene por qué recibir otra cosa que lo que pidió.
   */
  describe("sin señal", () => {
    const HTML = `<html><body><script src="/_next/static/chunks/main-9f8e.js"></script></body></html>`;

    /** Instala el sw con la pantalla guardada y después corta la red. */
    async function conLaPantallaGuardada() {
      let hayRed = true;
      // La misma respuesta siempre, para poder comparar por identidad lo que
      // se sirve sin señal con lo que se guardó al instalar.
      const laPantalla = pagina(HTML);
      const sw = cargarSW([], {
        red: async (url) => {
          if (!hayRed) throw new Error("sin red");
          return url === "/cargar" ? laPantalla : RESPUESTA;
        },
      });
      await lanzar(sw.handlers, "install");
      return { ...sw, laPantalla, cortarLaRed: () => (hayRed = false) };
    }

    /** Dispara una navegación y devuelve lo que el handler contestó. */
    async function navegarA(
      handlers: Record<string, (event: unknown) => void>,
      url: string,
    ) {
      const respondWith = vi.fn();
      handlers["fetch"]({ respondWith, request: { url, mode: "navigate", method: "GET" } });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      return await respondido;
    }

    it("una navegación que la red rechaza se contesta con /cargar guardado", async () => {
      const { handlers, cortarLaRed, laPantalla } = await conLaPantallaGuardada();
      cortarLaRed();
      expect(await navegarA(handlers, `${ORIGEN}/cargar`)).toBe(laPantalla);
    });

    it("sin señal, la raíz manda a /cargar en vez de servirla ahí", async () => {
      // `start_url` del manifest es `/`, así que tocar el ícono de la app sin
      // señal navega a `/`. Contestar ahí con el documento de `/cargar` dejaría
      // una página cuyo payload de Next describe `/cargar` mientras
      // `location.pathname` dice `/`. El redirect deja que el navegador pida la
      // url correcta, y el documento se sirve en su propio camino.
      const { handlers, cortarLaRed } = await conLaPantallaGuardada();
      cortarLaRed();
      const respuesta = (await navegarA(handlers, `${ORIGEN}/`)) as Response;
      expect(respuesta.status).toBe(302);
      expect(respuesta.headers.get("location")).toBe(`${ORIGEN}/cargar`);
    });

    it("sin señal, cualquier otra pantalla también manda a /cargar", async () => {
      const { handlers, cortarLaRed } = await conLaPantallaGuardada();
      cortarLaRed();
      const respuesta = (await navegarA(handlers, `${ORIGEN}/mantenimiento/ot`)) as Response;
      expect(respuesta.status).toBe(302);
      expect(respuesta.headers.get("location")).toBe(`${ORIGEN}/cargar`);
    });

    it("un POST que navega va a la red y no se contesta con la pantalla", async () => {
      // El envío de un formulario: lo que esa persona quiere saber es si su
      // POST entró, no ver otra pantalla. Sin señal falla como siempre.
      const { handlers, fetchDoble, cortarLaRed } = await conLaPantallaGuardada();
      const request = { url: `${ORIGEN}/mantenimiento`, mode: "navigate", method: "POST" };

      const respondWith = vi.fn();
      handlers["fetch"]({ respondWith, request });
      expect(fetchDoble).toHaveBeenCalledWith(request);
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).resolves.toBe(RESPUESTA);

      cortarLaRed();
      const segundo = vi.fn();
      handlers["fetch"]({ respondWith: segundo, request });
      const [sinRed] = segundo.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(sinRed).rejects.toThrow("sin red");
    });

    it("sin nada guardado no se redirige a ninguna parte: sería un lazo", async () => {
      const { handlers } = cargarSW([], {
        red: async () => {
          throw new Error("sin red");
        },
      });
      await expect(navegarA(handlers, `${ORIGEN}/`)).rejects.toThrow("sin red");
    });

    it("una navegación que la red contesta no toca el caché", async () => {
      const { handlers, guardado } = await conLaPantallaGuardada();
      const antes = urlsGuardadas(guardado).length;
      const respondWith = vi.fn();
      handlers["fetch"]({
        respondWith,
        request: { url: `${ORIGEN}/mantenimiento`, mode: "navigate", method: "GET" },
      });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).resolves.toBe(RESPUESTA);
      expect(urlsGuardadas(guardado)).toHaveLength(antes);
    });

    it("sin nada guardado, una navegación sin red falla como hoy", async () => {
      // El navegador muestra su página de sin-conexión, que es lo que pasaba
      // antes de que existiera este archivo. No se inventa una propia.
      const { handlers } = cargarSW([], {
        red: async () => {
          throw new Error("sin red");
        },
      });
      const respondWith = vi.fn();
      handlers["fetch"]({
        respondWith,
        request: { url: `${ORIGEN}/mantenimiento`, mode: "navigate", method: "GET" },
      });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).rejects.toThrow("sin red");
    });

    it("un chunk de la pantalla guardada se sirve del caché sin salir a la red", async () => {
      // Es todo el punto: sin señal, el HTML guardado pide sus propios chunks.
      const { handlers, fetchDoble, cortarLaRed } = await conLaPantallaGuardada();
      cortarLaRed();
      const pedidosDeRed = fetchDoble.mock.calls.length;

      const respondWith = vi.fn();
      handlers["fetch"]({
        respondWith,
        request: {
          url: `${ORIGEN}/_next/static/chunks/main-9f8e.js`,
          mode: "no-cors",
          method: "GET",
        },
      });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).resolves.toBeDefined();
      expect(fetchDoble).toHaveBeenCalledTimes(pedidosDeRed);
    });

    it("un chunk que pasa NO se guarda: el caché no crece con cada despliegue", async () => {
      // Guardar todo lo que pasa acumularía el bundle entero de cada
      // despliegue, y un desalojo del origen se lleva **también la cola** de
      // IndexedDB. Lo que la pantalla guardada necesita ya lo puso el install.
      const { handlers, guardado } = cargarSW();
      const request = {
        url: `${ORIGEN}/_next/static/chunks/otro-1234.js`,
        mode: "no-cors",
        method: "GET",
      };
      handlers["fetch"]({ respondWith: vi.fn(), request });
      await dejarCorrer();
      expect(urlsGuardadas(guardado)).not.toContain(request.url);
    });

    it("un chunk que no está guardado sale a la red igual", async () => {
      // En Vercel los assets de los despliegues viejos siguen estando, así que
      // una página ya cargada que pide un chunk de otra versión lo consigue.
      const { handlers, fetchDoble } = cargarSW();
      const request = {
        url: `${ORIGEN}/_next/static/chunks/de-otra-version.js`,
        mode: "no-cors",
        method: "GET",
      };
      handlers["fetch"]({ respondWith: vi.fn(), request });
      await dejarCorrer();
      expect(fetchDoble).toHaveBeenCalledWith(request);
    });

    it("sin caché disponible, un chunk se pide a la red igual", async () => {
      // `caches.open` tira en la ventana privada de Safari. Dejar salir esa
      // excepción haría que el chunk no cargue, o sea que la app se rompa por
      // una mejora que a esa persona no le llegó.
      const { handlers, fetchDoble } = cargarSW([], { sinCache: true });
      const respondWith = vi.fn();
      const request = {
        url: `${ORIGEN}/_next/static/chunks/x-1234.js`,
        mode: "no-cors",
        method: "GET",
      };
      handlers["fetch"]({ respondWith, request });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).resolves.toBe(RESPUESTA);
      expect(fetchDoble).toHaveBeenCalledWith(request);
    });

    it("sin caché disponible, una navegación sin red dice que no hay red", async () => {
      // Y no que falló el caché: lo que hay que contarle a quien navega es lo
      // que le pasa a su navegación.
      const { handlers } = cargarSW([], {
        sinCache: true,
        red: async () => {
          throw new Error("sin red");
        },
      });
      const respondWith = vi.fn();
      handlers["fetch"]({
        respondWith,
        request: { url: `${ORIGEN}/mantenimiento`, mode: "navigate", method: "GET" },
      });
      const [respondido] = respondWith.mock.calls[0] as unknown as [Promise<unknown>];
      await expect(respondido).rejects.toThrow("sin red");
    });

    it("sigue sin meterse con /api/ ni con /auth/ aunque la red falle", async () => {
      // Las dos exclusiones de hoy no cambian por tener caché: un enlace de
      // exportación y el canje del `?code=` de los correos no pasan por acá, y
      // menos todavía pueden contestarse con la pantalla de carga.
      const { cortarLaRed, handlers } = await conLaPantallaGuardada();
      cortarLaRed();
      for (const url of [`${ORIGEN}/api/rrhh/fichadas/export`, `${ORIGEN}/auth/confirm?code=abc`]) {
        const respondWith = vi.fn();
        handlers["fetch"]({ respondWith, request: { url, mode: "navigate", method: "GET" } });
        expect(respondWith).not.toHaveBeenCalled();
      }
    });
  });

  describe("notificationclick", () => {
    it("abre la url que viene en el payload", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "/compras/aprobaciones" });
      expect(openWindow).toHaveBeenCalledTimes(1);
      expect(openWindow).toHaveBeenCalledWith("/compras/aprobaciones");
    });

    it("conserva la query y el hash de la url", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "/compras?estado=pendiente#fila-3" });
      expect(openWindow).toHaveBeenCalledWith("/compras?estado=pendiente#fila-3");
    });

    it("sin url abre la raíz", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, {});
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("sin data en la notificación tampoco tira y abre la raíz", async () => {
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, undefined);
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("una url de otro origen no se abre: va a la raíz", async () => {
      // El payload lo arma nuestro servidor, pero una notificación no tiene
      // por qué poder llevar a nadie fuera del SdG.
      const { handlers, openWindow } = cargarSW();
      await clickear(handlers, { url: "https://otro-sitio.test/phishing" });
      expect(openWindow).toHaveBeenCalledWith("/");
    });

    it("cierra la notificación", async () => {
      const { handlers } = cargarSW();
      const { close } = await clickear(handlers, { url: "/" });
      expect(close).toHaveBeenCalled();
    });

    it("si ya hay una ventana abierta la enfoca en vez de abrir otra", async () => {
      const ventana: Ventana = {
        url: `${ORIGEN}/`,
        focus: vi.fn(async () => undefined),
      };
      const { handlers, openWindow, matchAll } = cargarSW([ventana]);
      await clickear(handlers, { url: "/" });
      expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
      expect(ventana.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("la ventana que ya estaba abierta se lleva a la url del aviso", async () => {
      // Enfocar sin navegar dejaría a la persona mirando otra pantalla que la
      // que le avisaron.
      const enfocada = { url: `${ORIGEN}/compras/aprobaciones`, focus: vi.fn(async () => undefined) };
      const ventana: Ventana = {
        url: `${ORIGEN}/rrhh`,
        focus: vi.fn(async () => undefined),
        navigate: vi.fn(async () => enfocada),
      };
      const { handlers, openWindow } = cargarSW([ventana]);
      await clickear(handlers, { url: "/compras/aprobaciones" });
      expect(ventana.navigate).toHaveBeenCalledWith(`${ORIGEN}/compras/aprobaciones`);
      expect(enfocada.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });

    it("si la ventana no se deja navegar, igual la enfoca", async () => {
      // `navigate` rechaza con ventanas que el service worker no controla.
      const ventana: Ventana = {
        url: `${ORIGEN}/rrhh`,
        focus: vi.fn(async () => undefined),
        navigate: vi.fn(async () => {
          throw new Error("no controlada");
        }),
      };
      const { handlers, openWindow } = cargarSW([ventana]);
      await clickear(handlers, { url: "/compras" });
      expect(ventana.focus).toHaveBeenCalledTimes(1);
      expect(openWindow).not.toHaveBeenCalled();
    });
  });

  describe("push", () => {
    /*
     * El payload es el que manda el servidor, con `url` en el PRIMER NIVEL:
     * un `Aviso` de `lib/core/webpush.ts`, tal cual sale de `JSON.stringify`.
     *
     * Antes este test le pasaba `{title, body, data: {url}}` —un nivel de mas,
     * que nadie escribe— y por eso pasaba en verde mientras en produccion toda
     * notificacion abria el inicio. Inventar la forma del payload en el test
     * es lo que dejo pasar el bug: la forma se copia del contrato.
     */
    it("guarda el payload en la notificación para que el click lo encuentre", async () => {
      const { handlers, showNotification } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: {
          json: () => ({
            title: "Un pedido espera tu aprobación",
            body: "RI 2161 · prueba",
            url: "/compras/aprobaciones",
          }),
        },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      expect(showNotification).toHaveBeenCalledTimes(1);
      const [titulo, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(titulo).toBe("Un pedido espera tu aprobación");
      expect((opciones.data as { url?: string })?.url).toBe("/compras/aprobaciones");
    });

    /*
     * Los dos handlers juntos, que es el unico nivel donde el bug se veia.
     * Cada uno por separado estaba bien: el `push` guardaba *algo* y el
     * `notificationclick` abria *lo que le dieran*. Lo que estaba mal era el
     * empalme, y eso no lo prueba ningun test de a uno.
     */
    it("de un Aviso del servidor al click: termina en la pantalla del aviso", async () => {
      const { handlers, showNotification, openWindow } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: {
          json: () => ({ title: "Un pedido espera tu aprobación", body: "RI 2161", url: "/compras/aprobaciones" }),
        },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      const [, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];

      // Se le da al click exactamente lo que el push guardo, sin retocarlo.
      await clickear(handlers, opciones.data as { url?: string });
      expect(openWindow).toHaveBeenCalledWith("/compras/aprobaciones");
    });

    it("usa el ícono chico y no el logo de 2 MB", async () => {
      const { handlers, showNotification } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: { json: () => ({ title: "SdG", body: "x" }) },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      const [, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(opciones.icon).toBe("/icon-192.png");
      expect(opciones.badge).toBe("/icon-192.png");
    });

    // Un aviso sin url no deberia existir —`Aviso` la pide— pero si llega, el
    // click tiene que caer en la raiz y no romperse.
    it("el push vacía la cola además de mostrar la notificación", async () => {
      // Es el disparo que de verdad llega hoy: nadie registra todavía un
      // `sync`, y el resumen diario despierta al service worker a las 8:30.
      const { handlers, fetchDoble, cola, showNotification } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) =>
          url === "/api/mantenimiento/avisos" ? contesta(200, { oa_number: "OA-77" }) : RESPUESTA,
      });
      await lanzar(handlers, "push", {
        data: { json: () => ({ title: "SdG", body: "x", url: "/" }) },
      });
      expect(showNotification).toHaveBeenCalledTimes(1);
      expect(fetchDoble).toHaveBeenCalledWith(
        "/api/mantenimiento/avisos",
        expect.objectContaining({ method: "POST" }),
      );
      expect(cola.filas.size).toBe(0);
    });

    it("un push sin url no rompe: el click cae en la raíz", async () => {
      const { handlers, showNotification, openWindow } = cargarSW();
      const esperas: Promise<unknown>[] = [];
      handlers["push"]({
        data: { json: () => ({ title: "SdG", body: "x" }) },
        waitUntil: (p: Promise<unknown>) => esperas.push(p),
      });
      await Promise.all(esperas);
      const [, opciones] = showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>];
      await clickear(handlers, opciones.data as { url?: string });
      expect(openWindow).toHaveBeenCalledWith("/");
    });
  });

  /*
   * El vaciado con la app cerrada. Las decisiones son las de `colaOffline.js`,
   * que acá entran de verdad: lo que se prueba es el empalme —que el service
   * worker las llame en el orden correcto y ejecute lo que dicen—, que es
   * exactamente el nivel donde se escondía el bug del payload del push.
   */
  describe("vaciado", () => {
    // Las urls salen de `RUTA_DE`, que es la constante que el service worker
    // usa de verdad: escritas a mano acá, el test seguiría verde con el worker
    // mandando a cualquier lado.
    const AVISOS = RUTA_DE.aviso;
    const ORDENES = RUTA_DE.orden;

    /**
     * Cuántas cargas salieron. Se cuentan los POST a las rutas de alta y no
     * los pedidos a secas: los disparos que vacían la cola también completan
     * la pantalla guardada si falta, así que `fetchDoble` ve `/cargar`.
     */
    function cargasMandadas(fetchDoble: { mock: { calls: unknown[][] } }) {
      return fetchDoble.mock.calls.filter(([url]) => url === AVISOS || url === ORDENES);
    }

    it("el evento sync manda la carga que corresponde", async () => {
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga({ tipo: "orden", cuerpo: { descripcion: "cambiar correa" } })],
        red: async (url) => (url === ORDENES ? contesta(200, { ot_number: "OT-12" }) : RESPUESTA),
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });

      expect(fetchDoble).toHaveBeenCalledWith(
        ORDENES,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ descripcion: "cambiar correa" }),
        }),
      );
      // Se mandó de verdad: sale de la cola.
      expect(cola.filas.size).toBe(0);
    });

    /*
     * El disparo de «abrir la app», que es el único que existe en un iPhone:
     * Safari no implementa Background Sync, así que sin este camino el `sync`
     * de arriba no llega nunca a la mitad del equipo y la carga se queda en el
     * teléfono hasta que alguien toque el botón de cada una.
     *
     * **EL MENSAJE ENTRA IMPORTADO Y NO ESCRITO A MANO**, y es el único motivo
     * por el que este test prueba algo. `MENSAJE_DE_VACIADO` es lo que la app
     * manda de verdad y `public/sw.js` lo compara contra un literal suyo: son
     * dos cadenas que tienen que coincidir y ningún tipo las ata. Con el
     * literal copiado acá, cambiarle el `tipo` a la constante dejaba pasar
     * `tsc`, el build y estos tres tests, y mataba en silencio el único disparo
     * que existe en un iPhone. Importándola, ese cambio pone esto en rojo.
     */
    it("un mensaje de la app también vacía la cola", async () => {
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga({ tipo: "orden", cuerpo: { descripcion: "cambiar correa" } })],
        red: async (url) => (url === ORDENES ? contesta(200, { ot_number: "OT-12" }) : RESPUESTA),
      });
      await lanzar(handlers, "message", { data: MENSAJE_DE_VACIADO });

      expect(cargasMandadas(fetchDoble)).toHaveLength(1);
      expect(cola.filas.size).toBe(0);
    });

    /*
     * Al revés que el `sync`, el `message` sí se filtra: un `sync` sólo puede
     * venir de un pedido nuestro, pero un `message` lo puede mandar cualquier
     * código de la página. Atender cualquiera sería ponerse a vaciar la cola
     * por un mensaje que no habla de esto.
     */
    it("un mensaje de otra cosa no dispara nada", async () => {
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga({ tipo: "orden" })],
      });
      await lanzar(handlers, "message", { data: { tipo: "otra-cosa" } });

      expect(cargasMandadas(fetchDoble)).toHaveLength(0);
      expect(cola.filas.size).toBe(1);
    });

    /*
     * DE PUNTA A PUNTA, Y ES EL ÚNICO TEST QUE CIERRA LA CADENA ENTERA.
     *
     * Los de arriba atan `MENSAJE_DE_VACIADO` con el literal de `public/sw.js`,
     * pero dejaban suelta la punta que de verdad manda: nadie comprobaba que
     * `pedirVaciadoAhora` mandara **esa** constante. Cambiar ahí el argumento
     * por `{ tipo: "otra-cosa" }` dejaba `tsc` limpio y los 151 tests en verde,
     * con el único disparo que existe en un iPhone muerto en silencio — la
     * misma muerte silenciosa de antes, corrida una línea.
     *
     * Acá no se escribe ningún literal: lo que sale de `pedirVaciadoAhora` se
     * le entrega tal cual al handler del service worker, y lo que se mira es si
     * la carga salió de la cola. Si las dos puntas dejan de coincidir, por el
     * lado que sea, esto se pone rojo.
     */
    it("de punta a punta: lo que manda la app es lo que el service worker atiende", async () => {
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga({ tipo: "orden", cuerpo: { descripcion: "cambiar correa" } })],
        red: async (url) => (url === ORDENES ? contesta(200, { ot_number: "OT-12" }) : RESPUESTA),
      });

      // El navegador de `pedirVaciadoAhora`: lo único que hace falta de él es
      // un worker activo que anote lo que le llega.
      const postMessage = vi.fn();
      vi.stubGlobal("navigator", {
        serviceWorker: { ready: Promise.resolve({ active: { postMessage } }) },
      });
      try {
        await pedirVaciadoAhora();
      } finally {
        vi.unstubAllGlobals();
      }

      expect(postMessage).toHaveBeenCalledTimes(1);
      await lanzar(handlers, "message", { data: postMessage.mock.calls[0][0] });

      expect(cargasMandadas(fetchDoble)).toHaveLength(1);
      expect(cola.filas.size).toBe(0);
    });

    it("un mensaje sin data no rompe el service worker", async () => {
      const { handlers, fetchDoble } = cargarSW([], { cargas: [unaCarga({ tipo: "orden" })] });
      await expect(lanzar(handlers, "message", {})).resolves.toBeDefined();
      expect(cargasMandadas(fetchDoble)).toHaveLength(0);
    });

    it("manda la más vieja primero", async () => {
      const pedidas: string[] = [];
      const { handlers } = cargarSW([], {
        cargas: [
          unaCarga({
            clave: "nueva",
            creadaEn: "2026-10-18T12:00:00.000Z",
            cuerpo: { descripcion: "la de las doce" },
          }),
          unaCarga({
            clave: "vieja",
            creadaEn: "2026-10-18T08:00:00.000Z",
            cuerpo: { descripcion: "la de las ocho" },
          }),
        ],
        red: async (url, init) => {
          if (url !== AVISOS) return RESPUESTA;
          pedidas.push(String((init as { body: string }).body));
          return contesta(200, { oa_number: "OA-1" });
        },
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(pedidas).toEqual([
        JSON.stringify({ descripcion: "la de las ocho" }),
        JSON.stringify({ descripcion: "la de las doce" }),
      ]);
    });

    it("dos disparos a la vez no mandan la misma carga dos veces", async () => {
      // El segundo la encuentra tomada y no la toca. Lo que impide el
      // duplicado de verdad es la clave del lado del servidor; esto evita el
      // pedido de más, que es lo que esta marca puede evitar.
      let soltar = () => {};
      const enElAire = new Promise<void>((resolver) => {
        soltar = resolver;
      });
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) => {
          if (url !== AVISOS) return RESPUESTA;
          await enElAire;
          return contesta(200, { oa_number: "OA-9" });
        },
      });

      const primero = lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      // Hasta que el primero llegue al POST: ahí ya la marcó como tomada.
      await dejarCorrer();
      const segundo = lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      await segundo;

      expect(cargasMandadas(fetchDoble)).toHaveLength(1);
      soltar();
      await primero;
      expect(cargasMandadas(fetchDoble)).toHaveLength(1);
      expect(cola.filas.size).toBe(0);
    });

    it("un fallo pasajero deja la carga para después y uno definitivo la para", async () => {
      const casos = [
        { status: 500, cuerpo: {}, estado: "esperando" },
        { status: 400, cuerpo: { error: "Falta el equipo" }, estado: "parada" },
      ];
      for (const caso of casos) {
        const { handlers, cola } = cargarSW([], {
          cargas: [unaCarga()],
          red: async (url) =>
            url === AVISOS ? contesta(caso.status, caso.cuerpo) : RESPUESTA,
        });
        await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });

        const quedo = cola.filas.get("k1");
        expect(quedo).toBeDefined();
        expect(quedo!.estado).toBe(caso.estado);
        // La marca de tomada se suelta sí o sí: dejarla puesta trabaría la
        // carga cinco minutos por un fallo que ya se conoce.
        expect(quedo!.tomadaEn).toBeNull();
        expect(quedo!.intentos).toBe(1);
        expect(quedo!.ultimoError).toBeTruthy();
      }
    });

    it("un fallo corta el vaciado: no se golpea la red con toda la cola", async () => {
      const { handlers, fetchDoble } = cargarSW([], {
        cargas: [unaCarga({ clave: "a" }), unaCarga({ clave: "b" })],
        red: async (url) => (url === AVISOS ? contesta(500) : RESPUESTA),
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(cargasMandadas(fetchDoble)).toHaveLength(1);
    });

    it("un 200 sin número no es un éxito: la carga no se borra", async () => {
      // Es el camino más probable de esta pantalla: `proxy.ts` contesta 307 al
      // login a cualquier pedido sin sesión y `fetch` lo sigue, así que vuelve
      // el HTML del login con un 200 redondo.
      const { handlers, cola } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) => (url === AVISOS ? contesta(200, {}, true) : RESPUESTA),
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(cola.filas.get("k1")).toBeDefined();
      expect(cola.filas.get("k1")!.estado).toBe("esperando");
    });

    it("sin sesión recordada no manda nada", async () => {
      // Una carga sale firmada por quien la hizo. Sin saber quién tiene la
      // sesión abierta no hay con qué comparar, así que no sale ninguna.
      const { handlers, fetchDoble } = cargarSW([], {
        cargas: [unaCarga()],
        sesion: null,
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(cargasMandadas(fetchDoble)).toHaveLength(0);
    });

    it("no manda la carga de otra persona", async () => {
      const { handlers, fetchDoble, cola } = cargarSW([], {
        cargas: [unaCarga({ usuarioId: "otra-persona" })],
        sesion: { id: "u1", nombre: "Ana" },
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(cargasMandadas(fetchDoble)).toHaveLength(0);
      expect(cola.filas.size).toBe(1);
    });

    it("una carga entregada con advertencia se cuenta antes de borrarla", async () => {
      // Lo que salió a medias se dice. Con la app cerrada el único lugar donde
      // se puede decir es una notificación.
      const { handlers, cola, showNotification } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) =>
          url === AVISOS
            ? contesta(200, {
                oa_number: "OA-77",
                advertencia: "Quedó escrito en la planilla y no en el sistema.",
              })
            : RESPUESTA,
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });

      expect(showNotification).toHaveBeenCalledTimes(1);
      const [titulo, opciones] = showNotification.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(titulo).toContain("OA-77");
      expect(opciones.body).toContain("Quedó escrito en la planilla");
      // Lleva a la pantalla donde está la cola, con la url en el primer nivel
      // que es lo que `destinoDe` lee.
      expect((opciones.data as { url?: string })?.url).toBe("/cargar");
      expect(cola.filas.size).toBe(0);
    });

    it("una carga entregada sin advertencia no molesta a nadie", async () => {
      const { handlers, showNotification, cola } = cargarSW([], {
        cargas: [unaCarga()],
        red: async (url) => (url === AVISOS ? contesta(200, { oa_number: "OA-5" }) : RESPUESTA),
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });
      expect(showNotification).not.toHaveBeenCalled();
      expect(cola.filas.size).toBe(0);
    });

    it("si la advertencia no se pudo mostrar, la carga queda a la vista", async () => {
      // Sin permiso de notificaciones no hay dónde decirlo en el momento, así
      // que la carga se queda con el texto adentro para que `/cargar` lo
      // muestre. Lo que no puede pasar es que se borre y nadie se entere.
      const { handlers, cola } = cargarSW([], {
        cargas: [unaCarga()],
        sinNotificaciones: true,
        red: async (url) =>
          url === AVISOS
            ? contesta(200, { oa_number: "OA-77", advertencia: "Faltó la planilla." })
            : RESPUESTA,
      });
      await lanzar(handlers, "sync", { tag: "vaciar-la-cola" });

      const quedo = cola.filas.get("k1");
      expect(quedo).toBeDefined();
      expect(quedo!.estado).toBe("parada");
      expect(quedo!.ultimoError).toContain("Faltó la planilla.");
      expect(quedo!.ultimoError).toContain("OA-77");
    });

    it("una cola que no se puede leer no se lleva puesta la notificación", async () => {
      // El push muestra su aviso igual: el vaciado es lo de más que hace, no
      // la razón por la que lo despertaron. Y si `waitUntil` recibiera una
      // promesa rechazada, el navegador cuenta el push como fallado.
      const { handlers, showNotification } = cargarSW([], {
        cargas: [unaCarga()],
        colaRota: true,
      });
      await expect(
        lanzar(handlers, "push", { data: { json: () => ({ title: "SdG", body: "x", url: "/" }) } }),
      ).resolves.toBeDefined();
      expect(showNotification).toHaveBeenCalledTimes(1);
    });
  });
});
