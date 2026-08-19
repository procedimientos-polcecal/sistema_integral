import Link from "next/link";
import { login } from "./actions";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

/**
 * El callback de Google redirige con un código corto en lugar del texto, para
 * no armar mensajes en la URL. `login()` sigue mandando el texto directo.
 */
const MENSAJES_ERROR: Record<string, string> = {
  oauth: "No se pudo completar el ingreso con Google. Probá de nuevo.",
  dominio: "Sólo se puede ingresar con una cuenta @polcecal.com.",
  sin_alta: "Tu cuenta de Google es válida, pero todavía no fue dada de alta en el sistema. Pedísela a un administrador.",
  inactivo: "Tu cuenta está desactivada. Si creés que es un error, avisale a un administrador.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const mensajeError = error ? (MENSAJES_ERROR[error] ?? error) : null;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Panel izquierdo */}
      <div
        className="relative hidden overflow-hidden md:flex md:w-[45%] md:flex-col md:justify-between"
        style={{ background: "linear-gradient(165deg, var(--sidebar-bg) 0%, var(--sidebar-bg-dark) 100%)", padding: "48px" }}
      >
        {/* Foto de la cantera/planta — colocar el archivo en public/cantera.jpg para que aparezca acá (se atenúa con el degradé verde encima). Sin el archivo, no se ve nada raro: queda solo el fondo verde. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ backgroundImage: "url('/cantera.jpg')", backgroundSize: "cover", backgroundPosition: "center" }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(165deg, rgba(30,54,37,.88) 0%, rgba(20,37,25,.94) 100%)" }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 85%, rgba(201,162,39,.14) 0%, transparent 55%), radial-gradient(circle at 85% 10%, rgba(201,162,39,.08) 0%, transparent 50%)",
          }}
        />

        <div />

        <div className="relative z-10 flex flex-col items-center text-center">
          <img
            src="/logo.png"
            alt="POLYSAN S.A. / POLCECAL S.A."
            width={260}
            className="mb-10"
            style={{ objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
          <h1 className="font-extrabold leading-tight" style={{ fontSize: "clamp(28px, 3.2vw, 42px)", color: "#F1F5F9" }}>
            La gestión de tu planta,
            <br />
            <span style={{ color: "var(--primary-tint)" }}>siempre a mano.</span>
          </h1>
        </div>

        <div className="relative z-10 text-center" style={{ fontSize: 11, color: "rgba(169,194,174,.4)" }}>
          © {new Date().getFullYear()} POLCECAL / POLYSAN S.A.
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <img
            src="/logo.png"
            alt="POLYSAN S.A. / POLCECAL S.A."
            width={140}
            className="mb-8 md:hidden"
            style={{ objectFit: "contain" }}
          />
          <div className="mb-10">
            <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
              Bienvenido
            </h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Ingresá con tu cuenta para continuar.
            </p>
          </div>

          <form action={login} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em]"
                style={{ color: "var(--text-muted)" }}
              >
                Email
              </label>
              <input id="email" name="email" type="email" required placeholder="usuario@empresa.com" className="input" />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label
                  htmlFor="password"
                  className="text-[11px] font-semibold uppercase tracking-[.08em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Contraseña
                </label>
                <Link href="/forgot-password" className="text-xs font-medium" style={{ color: "var(--primary)" }}>
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <input id="password" name="password" type="password" required placeholder="••••••••" className="input" />
            </div>

            {mensajeError && (
              <div className="rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {mensajeError}
              </div>
            )}

            <div className="mt-2 flex gap-3">
              <button type="submit" className="btn-primary flex-1 justify-center py-3 text-[15px]">
                Ingresar →
              </button>
              <GoogleSignInButton />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
