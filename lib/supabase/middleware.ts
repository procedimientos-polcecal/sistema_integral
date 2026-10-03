import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizarUrlSupabase, claveAnonima } from "./url";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    normalizarUrlSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL),
    claveAnonima(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Endpoints que llama una máquina, no una persona: no hay cookie de sesión,
  // y cada uno valida su propio secreto (CRON_SECRET / SHEETS_WEBHOOK_SECRET /
  // FACTURACION_CORREO_SECRET). Sin esta excepción, el middleware les devuelve
  // un 307 al login y el cron de Vercel y los Apps Script nunca llegan a
  // ejecutarse.
  //
  // **Agregar el endpoint acá es parte de escribir el webhook, no un detalle
  // posterior.** El del correo se olvidó y no lo atrapó ni `tsc` ni los tests:
  // apareció recién al mandarle un POST de verdad, que contestó con el HTML
  // del login. Del lado de Gmail eso habría sido un 307 silencioso y la
  // bandeja vacía para siempre.
  //
  // Se listan uno por uno a propósito. Dejar pasar todo /api abriría las ~54
  // rutas que no validan sesión por su cuenta y confían en este redirect: hoy
  // ninguna usa el cliente admin, así que RLS las cubriría, pero es una red de
  // seguridad que no conviene sacar de un plumazo.
  const esEndpointDeMaquina =
    path.startsWith("/api/cron/") ||
    path === "/api/compras/sheets/webhook" ||
    path === "/api/mantenimiento/sheets/webhook" ||
    path === "/api/facturacion/correo/webhook";

  const isPublicPath =
    path === "/login" ||
    path === "/forgot-password" ||
    path.startsWith("/reset-password") ||
    path.startsWith("/auth") ||
    esEndpointDeMaquina;

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
