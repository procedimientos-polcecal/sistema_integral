import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Links de acceso y de recuperación de contraseña.
 *
 * Se generan del lado del servidor en vez de depender sólo del correo, porque
 * el SMTP por defecto de Supabase está muy limitado (unos pocos envíos por
 * hora, y pensado para pruebas). Con el link en la mano, un administrador puede
 * pasárselo a la persona por el medio que sea y el alta no queda bloqueada
 * esperando un mail que quizá nunca llegue.
 *
 * El link es de un solo uso y caduca: hay que tratarlo como una contraseña
 * temporal, no dejarlo escrito en cualquier lado.
 */

/** Base pública de la app, para armar el destino del link. */
export function urlBase(request: Request): string {
  const configurada = process.env.NEXT_PUBLIC_APP_URL;
  if (configurada) return configurada.replace(/\/$/, "");

  // El header `origin` no viaja en todas las peticiones (por ejemplo, en varias
  // server actions), así que `host` es el respaldo confiable.
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const host = request.headers.get("host") ?? "localhost:3000";
  const protocolo = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${protocolo}://${host}`;
}

export interface LinkAcceso {
  link: string | null;
  /** Motivo por el que no se pudo generar, para mostrárselo al administrador. */
  error: string | null;
}

/**
 * Genera un link para que la persona defina su contraseña.
 *
 * `recovery` sirve tanto para el alta (la cuenta se crea sin contraseña) como
 * para un blanqueo posterior: en los dos casos termina en /reset-password.
 */
export async function generarLinkAcceso(email: string, base: string): Promise<LinkAcceso> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${base}/reset-password` },
  });

  if (error) return { link: null, error: error.message };
  return { link: data?.properties?.action_link ?? null, error: null };
}

/**
 * Intenta además mandar el correo. Es "best effort": si el SMTP no está
 * configurado o se pasó del límite, no tiene que hacer fallar el alta, porque
 * el link generado ya resuelve el caso.
 */
export async function intentarEnviarCorreo(email: string, base: string): Promise<string | null> {
  const admin = createAdminClient();
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${base}/reset-password`,
  });
  return error ? error.message : null;
}
