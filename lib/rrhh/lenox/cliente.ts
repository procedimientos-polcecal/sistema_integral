import { addUtcDays } from "../dates";
import type { MarcacionLenox, EmpleadoLenox } from "./tipos";

const BASE = "https://empresas.api.lenoxhr.com/api/v1";

/**
 * Un error que vino de Lenox, con el status que lo causó.
 *
 * Existe por un caso concreto: el `429`. No es un error nuestro y se resuelve
 * esperando, así que la pantalla tiene que poder tratarlo distinto de un fallo
 * del servidor — si lo muestra como "error del servidor", la persona vuelve a
 * apretar, y cada intento prolonga el bloqueo.
 *
 * Antes eso se reconocía buscando el `"(429)"` con que termina el mensaje.
 * Funcionaba, pero fallaba en la dirección peligrosa: alguien reescribe el
 * texto, el 429 pasa a salir como un 500 genérico, y nadie se entera hasta que
 * alguien se queja de que el botón "se rompe sin motivo". Con el status en el
 * error, lo que se mira es el dato y no la redacción.
 */
export class ErrorDeLenox extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ErrorDeLenox";
  }
}

/**
 * El tope es de la API, no nuestro: "la diferencia entre las fechas desde y
 * hasta no puede superar los 7 días". Medido el 07/10/2026: lo impone el
 * servidor, con 8 días devuelve 400 ("La cantidad de dias entre las fechas
 * desde y hasta no debe superar los 7 días"). Partir el rango es obligatorio,
 * y hay un test que fija el número.
 */
export const DIAS_MAX_POR_PEDIDO = 7;

/**
 * Cinturón del bucle de paginación, medido en LLAMADAS y no en filas: lo que
 * cuesta acá son los pedidos, porque hay un límite duro y la API no dice cuál
 * (el 07/10/2026 bastaron unas doce seguidas para recibir un 429). Si Lenox
 * ignorara `FilasExcluidas` y devolviera siempre lo mismo, un tope en filas
 * saltaría recién después de más de cien llamadas y lo que se vería sería un
 * 429, no el diagnóstico correcto.
 *
 * Con 10 sobra: una semana de toda la planta entra en una sola página (735
 * filas el 07/10/2026).
 */
const MAX_PAGINAS = 10;

/**
 * Cuánto se espera una respuesta. La primera llamada medida tardó 12 segundos
 * (07/10/2026), así que 60 deja holgura de sobra. Sin tope, un pedido colgado
 * se comería los 300 segundos del cron y Vercel lo cortaría por timeout sin
 * decir nada útil; con él, el fallo llega con un mensaje que nombra a Lenox.
 */
const TIMEOUT_MS = 60_000;

/** Lo que dice el `mensaje` cuando la respuesta ya trae todo lo que queda. */
const TODOS_LOS_RESULTADOS = "se muestran todos los resultados";

export function hayCredencialesLenox(): boolean {
  return Boolean(process.env.LENOX_API_KEY?.trim());
}

/** Parte un rango en ventanas de a lo sumo `DIAS_MAX_POR_PEDIDO` días, sin huecos ni solapes. */
export function ventanasDe(desde: Date, hasta: Date): { desde: Date; hasta: Date }[] {
  const ventanas: { desde: Date; hasta: Date }[] = [];
  let inicio = desde;
  while (inicio.getTime() <= hasta.getTime()) {
    const tentativo = addUtcDays(inicio, DIAS_MAX_POR_PEDIDO - 1);
    const fin = tentativo.getTime() > hasta.getTime() ? hasta : tentativo;
    ventanas.push({ desde: inicio, hasta: fin });
    inicio = addUtcDays(fin, 1);
  }
  return ventanas;
}

function fechaParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function pedir<T>(
  ruta: string,
  params: Record<string, string>
): Promise<{ resultado: T[]; mensaje?: string }> {
  const clave = process.env.LENOX_API_KEY?.trim();
  if (!clave) throw new Error("Falta LENOX_API_KEY");

  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "LenoxBusinessAPI-Key": clave },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // `AbortSignal.timeout` rechaza con un `TimeoutError`: pelado, no dice
    // quién no respondió ni cuánto se esperó.
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`Lenox no respondió en ${TIMEOUT_MS / 1000} segundos. Probá de nuevo en unos minutos.`);
    }
    throw e;
  }

  // Un rango sin marcaciones devuelve 204 con el cuerpo VACÍO. `res.ok` es
  // true para un 204, así que no cae en la rama de error de abajo, y
  // `res.json()` sobre un cuerpo vacío lanza. Medido el 07/10/2026 contra la
  // API real: un fin de semana largo habría roto el cron. Va antes de
  // cualquier intento de parsear.
  if (res.status === 204) return { resultado: [] };

  if (res.status === 429) {
    // Se corta acá y NO se reintenta, a propósito. La respuesta no trae
    // `Retry-After`, ni headers de límite, ni cuerpo (`content-length: 0`),
    // así que cualquier espera sería inventada. Y medido el 07/10/2026: a los
    // 7 minutos de sondear cada 20 segundos seguía bloqueada, lo más probable
    // es que sondear mantenga vivo el bloqueo — un reintento automático no se
    // recuperaría nunca, se quedaría girando.
    //
    // El texto existe porque el error pelado sería "Lenox respondió 429: ",
    // que no le dice nada a nadie.
    throw new ErrorDeLenox(
      "Lenox no atendió el pedido porque se hicieron demasiadas consultas seguidas. " +
        "Esperá al menos 15 minutos antes de volver a intentar, y no aprietes el botón " +
        "mientras tanto: cada intento prolonga la espera. (429)",
      429
    );
  }

  if (!res.ok) {
    // Sin traducir, a propósito: un diagnóstico que no se distingue de otro
    // no es un diagnóstico. Es la misma regla que con los errores de Google.
    const texto = await res.text();
    throw new ErrorDeLenox(`Lenox respondió ${res.status}: ${texto.slice(0, 300)}`, res.status);
  }

  const cuerpo = await res.json();
  return {
    resultado: (cuerpo?.resultado ?? []) as T[],
    mensaje: typeof cuerpo?.mensaje === "string" ? cuerpo.mensaje : undefined,
  };
}

/**
 * Todas las filas de una ruta.
 *
 * Medido el 07/10/2026: la API **no pagina**. `FilasExcluidas` es un offset
 * real —con 10 devuelve 725 de 735 y la fila 11 pasa a ser la 1— pero devuelve
 * todo lo que queda, no una página. Con 70 empleados, 7 días dan 735 filas y
 * nunca vamos a ver un corte.
 *
 * Por eso el camino rápido es el `mensaje`: si dice que están todos, se corta
 * sin gastar una llamada de más — y las llamadas importan, porque hay un
 * límite duro y la API no dice cuál. La paginación queda abajo como red por si
 * algún día empieza a truncar, que es el único escenario en que ese mensaje
 * diría otra cosa.
 */
async function pedirTodo<T>(ruta: string, params: Record<string, string>): Promise<T[]> {
  const filas: T[] = [];
  let offset = 0;
  for (let pagina = 1; ; pagina++) {
    const { resultado, mensaje } = await pedir<T>(ruta, { ...params, FilasExcluidas: String(offset) });
    filas.push(...resultado);
    if (resultado.length === 0) break;
    if (mensaje?.trim().toLowerCase().startsWith(TODOS_LOS_RESULTADOS)) break;
    offset += resultado.length;
    if (pagina >= MAX_PAGINAS) {
      throw new Error(
        `Lenox siguió devolviendo filas después de ${MAX_PAGINAS} pedidos seguidos. ` +
          "Se sospecha que FilasExcluidas no se está respetando; se corta para no agotar el límite de llamadas."
      );
    }
  }
  return filas;
}

/** Las marcaciones de todos los empleados en un rango, partiendo el rango en ventanas de 7 días. */
export async function traerMarcaciones(desde: Date, hasta: Date): Promise<MarcacionLenox[]> {
  const filas: MarcacionLenox[] = [];
  for (const v of ventanasDe(desde, hasta)) {
    filas.push(
      ...(await pedirTodo<MarcacionLenox>("/marcaciones/getmarcaciones", {
        Desde: fechaParam(v.desde),
        Hasta: fechaParam(v.hasta),
        ExcluirDadosDeBaja: "false", // las bajas también fichan hasta su último día
      }))
    );
  }
  return filas;
}

/** El padrón completo de Lenox, bajas incluidas: el cotejo necesita ver las dos cosas. */
export async function traerEmpleados(): Promise<EmpleadoLenox[]> {
  return pedirTodo<EmpleadoLenox>("/empleados/getempleados", { ExcluirBajas: "false" });
}
