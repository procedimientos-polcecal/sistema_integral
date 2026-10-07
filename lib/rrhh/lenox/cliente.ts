import { addUtcDays } from "../dates";
import type { MarcacionLenox, EmpleadoLenox } from "./tipos";

const BASE = "https://empresas.api.lenoxhr.com/api/v1";

/**
 * El tope es de la API, no nuestro: "la diferencia entre las fechas desde y
 * hasta no puede superar los 7 días". Medido el 07/10/2026: lo impone el
 * servidor, con 8 días devuelve 400 ("La cantidad de dias entre las fechas
 * desde y hasta no debe superar los 7 días"). Partir el rango es obligatorio,
 * y hay un test que fija el número.
 */
export const DIAS_MAX_POR_PEDIDO = 7;

/**
 * Cinturón del bucle de paginación, no un número de la API: si Lenox ignorara
 * `FilasExcluidas` devolvería siempre lo mismo y el bucle no terminaría nunca.
 * 100.000 filas son más de 130 veces lo que da una semana de toda la planta
 * (735 filas el 07/10/2026).
 */
const TOPE_DE_FILAS = 100_000;

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

  const res = await fetch(url, { headers: { "LenoxBusinessAPI-Key": clave } });

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
    throw new Error(
      "Lenox rechazó el pedido por exceso de llamadas (429). No dice cuánto hay que esperar y " +
        "volver a intentar antes de tiempo parece prolongar el bloqueo: dejá pasar un buen rato " +
        "(medido, más de 7 minutos) sin tocar nada y recién entonces probá de nuevo."
    );
  }

  if (!res.ok) {
    // Sin traducir, a propósito: un diagnóstico que no se distingue de otro
    // no es un diagnóstico. Es la misma regla que con los errores de Google.
    const texto = await res.text();
    throw new Error(`Lenox respondió ${res.status}: ${texto.slice(0, 300)}`);
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
  for (;;) {
    const { resultado, mensaje } = await pedir<T>(ruta, { ...params, FilasExcluidas: String(offset) });
    filas.push(...resultado);
    if (resultado.length === 0) break;
    if (mensaje?.trim().toLowerCase().startsWith(TODOS_LOS_RESULTADOS)) break;
    offset += resultado.length;
    if (offset > TOPE_DE_FILAS) {
      throw new Error("Lenox devolvió más filas de las razonables; ¿está ignorando FilasExcluidas?");
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
