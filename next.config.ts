import type { NextConfig } from "next";

/**
 * Content-Security-Policy — en modo REPORT-ONLY a propósito.
 *
 * Una CSP mal ajustada rompe la app en silencio: deja de cargar un mapa, un
 * gráfico o una fuente y nadie se entera hasta que un usuario lo reporta. En
 * Report-Only el navegador no bloquea nada, sólo anota la violación en la
 * consola. La idea es recorrer los cuatro módulos, juntar lo que aparezca, y
 * recién entonces cambiar la cabecera a `Content-Security-Policy` para que
 * empiece a bloquear de verdad.
 *
 * Los orígenes de acá salieron de leer el código, no de adivinar:
 *
 * - `fonts.googleapis.com` / `fonts.gstatic.com`: Public Sans y JetBrains Mono,
 *   que se importan desde globals.css.
 * - `*.basemaps.cartocdn.com`: los tiles de los mapas de Remises.
 * - `unpkg.com`: los PNG del marcador de Leaflet (sólo imágenes; Leaflet mismo
 *   viene del bundle, no de la CDN).
 * - El proyecto de Supabase, para la API y el login. Se arma desde la variable
 *   de entorno para que no quede un dominio hardcodeado que hay que acordarse
 *   de cambiar si el proyecto se muda.
 *
 * `'unsafe-inline'` en scripts y estilos es, por ahora, inevitable: Next inyecta
 * scripts inline para hidratar y buena parte de la app usa `style={{...}}`.
 * Sacarlo requiere nonces por request desde el middleware — vale hacerlo, pero
 * después de que la política esté estable y sin violaciones.
 */
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabase.replace(/^https:/, "wss:");

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://unpkg.com`,
  `connect-src 'self' ${supabase} ${supabaseWs}`.trim(),
  "worker-src 'self'",
  // El PDF de html2pdf y las descargas de Excel se abren como blob.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Equivalente moderno de X-Frame-Options: DENY, que igual se deja por los
  // navegadores viejos.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
