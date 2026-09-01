/**
 * El cuerpo JSON de un request, sin reventar cuando no lo hay.
 *
 * `await request.json()` tira `SyntaxError` con un cuerpo vacío o mal formado, y
 * en un route handler de Next eso no lo atrapa nadie: el navegador recibe un
 * **500 con stack** en vez de un 400 que diga qué falta. Estaba así en 60
 * handlers; otros 28 ya lo envolvían en `.catch(...)`, así que el patrón bueno
 * ya existía y sólo faltaba parejo.
 *
 * Devuelve un objeto vacío en vez de un error a propósito. Los handlers ya
 * validan sus campos obligatorios —"Falta el usuario", "La descripción es
 * requerida"— y con `{}` esa validación se dispara sola y contesta el 400 que
 * corresponde, en su propio idioma. Un error genérico acá taparía ese mensaje
 * con uno peor.
 */
/*
 * El tipo por defecto es `any`, igual que `Request.json()`.
 *
 * No es descuido: esto reemplaza a `request.json()` en 58 handlers y el cambio
 * es de **manejo de errores**, no de tipos. Devolver `Record<string, unknown>`
 * convertiría cada `const { nombre } = ...` en un `unknown` y habría que
 * escribir el tipo del cuerpo de las 58 rutas en el mismo commit — que es un
 * trabajo que vale la pena, pero no mezclado con éste: un error de tipos
 * escondido entre cincuenta archivos no se revisa, se aprueba.
 *
 * El que quiera el tipo lo pasa: `cuerpoJson<{ nombre: string }>(request)`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cuerpoJson<T = any>(request: Request): Promise<T> {
  try {
    const cuerpo = await request.json();
    // `JSON.parse("null")` y `JSON.parse("3")` no tiran y no son un cuerpo:
    // destructurar un número da undefined en todo y confunde más que ayuda.
    return cuerpo !== null && typeof cuerpo === "object" ? (cuerpo as T) : ({} as T);
  } catch {
    return {} as T;
  }
}
