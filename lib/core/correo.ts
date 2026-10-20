/**
 * Mandar un correo desde el SdG.
 *
 * ## Por qué un Apps Script y no un servicio de correo
 *
 * Es el patrón que ya usan seis scripts de este repo, y evita sumar un
 * proveedor y una cuenta que pagar. La diferencia con los que existen es la
 * dirección: `docs/facturacion-correo-apps-script.gs` es Apps Script
 * **llamando al** SdG, y éste es el SdG **llamando a** un Apps Script
 * publicado como aplicación web.
 *
 * Leer o escribir Gmail desde el servidor no es una opción, y está medido: la
 * cuenta de servicio pide un token haciéndose pasar por un usuario del dominio
 * y Google contesta `unauthorized_client`, porque la delegación a nivel dominio
 * no está otorgada —y otorgarla le daría al sistema permiso de leer
 * **cualquier** buzón—. El porqué largo está en el encabezado de ese archivo.
 *
 * ## Devuelve qué pasó en vez de lanzar
 *
 * Mismo molde que `lib/core/webpush.ts`, que es el hermano de esto. Quien
 * llama son las dos rutas de alta, en el camino de rechazar una carga: lo que
 * la ruta le debe a la persona es la respuesta sobre su carga, y un problema
 * del correo no puede cambiarla.
 *
 * ## POR QUÉ UN `console.error` ALCANZA ACÁ
 *
 * Es una excepción deliberada a una regla de este repo —un fallo de escritura
 * nunca es un `console.warn`— y conviene que esté dicha donde alguien se la va
 * a preguntar. Esa regla existe porque una escritura que no llega a la planilla
 * crea una divergencia que no avisa. Acá no hay divergencia: la carga sigue
 * parada, visible en `/cargar` y contada por la barra del layout. Un correo que
 * no sale degrada al estado anterior a esto, nada más. Y decírselo a alguien en
 * la respuesta sería inútil, porque por diseño **no hay nadie mirando** cuando
 * esto pasa: el correo sólo se intenta para una carga que mandó el teléfono con
 * la app cerrada, así que la respuesta se la lleva el service worker.
 */

/**
 * Cuánto se espera al Apps Script antes de dejarlo.
 *
 * Del otro lado hay un servicio que no es rápido —arranca una máquina virtual
 * de Google por pedido— y de este lado hay un rechazo esperando salir. Más vale
 * un correo que no se manda que una carga que tarda.
 *
 * **Medido contra el script real el 20/10/2026**: el primer envío, en frío,
 * tardó 1.918 ms, y el segundo 1.773 ms. O sea que cinco segundos es generoso
 * y no apretado — era el único número de este trabajo puesto a ojo. Si alguna
 * vez empieza a cortar, lo que cambió es el script o Google, no esto.
 */
const TOPE_DE_ESPERA_MS = 5_000;

/**
 * Si el correo está configurado, para preguntarlo **antes** de juntar los
 * datos del mensaje.
 *
 * Entre el deploy y el día que alguien publique el Apps Script va a pasar
 * tiempo, y en ese rato cada carga rechazada haría una consulta a `usuarios`
 * para después tirar el resultado. Las dos variables van juntas o no van.
 */
export function estaConfigurado(): boolean {
  return Boolean(process.env.SDG_CORREO_URL && process.env.SDG_CORREO_SECRET);
}

export type ResultadoDelCorreo = "enviado" | "sin-configurar" | "fallo";

export interface Mensaje {
  /** A quién. El Apps Script sólo acepta direcciones de los dominios de la empresa. */
  para: string;
  asunto: string;
  cuerpo: string;
}

export async function enviarCorreo(mensaje: Mensaje): Promise<ResultadoDelCorreo> {
  const url = process.env.SDG_CORREO_URL;
  const secreto = process.env.SDG_CORREO_SECRET;

  // Sin configurar **no se intenta y no se loguea**. Entre el deploy de esto y
  // el día que alguien publique el script va a pasar tiempo, y un error por
  // cada carga rechazada sería ruido diario sobre algo que nadie pidió todavía.
  if (!url || !secreto) return "sin-configurar";

  try {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secreto, ...mensaje }),
      signal: AbortSignal.timeout(TOPE_DE_ESPERA_MS),
    });

    // **Una aplicación web de Apps Script contesta 200 siempre**: no deja
    // elegir el status. Así que `respuesta.ok` no dice nada y el estado real
    // viene en el cuerpo. Mirar sólo el status daría por enviado un correo que
    // el script rechazó por secreto inválido o por dominio no permitido.
    const dijo = await respuesta.text().catch(() => "");
    let resuelto: { ok?: unknown } | null = null;
    try {
      resuelto = JSON.parse(dijo) as { ok?: unknown };
    } catch {
      // Contestó algo que no es su JSON: la pantalla de error de Google, o la
      // de inicio de sesión si la implementación quedó restringida.
    }

    if (resuelto?.ok === true) return "enviado";

    // Lo que contestó, sin traducir: es lo único que después va a permitir
    // distinguir un secreto mal puesto de un dominio no permitido de un cupo
    // agotado.
    console.error("correo: lo rechazó el Apps Script", respuesta.status, dijo.slice(0, 500));
    return "fallo";
  } catch (e) {
    console.error("correo: no se pudo llamar al Apps Script", (e as Error)?.message ?? e);
    return "fallo";
  }
}
