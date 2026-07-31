import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Panel izquierdo */}
      <div
        className="relative hidden overflow-hidden md:flex md:w-[45%] md:flex-col md:justify-between"
        style={{ background: "linear-gradient(165deg, var(--sidebar-bg) 0%, var(--sidebar-bg-dark) 100%)", padding: "48px" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 85%, rgba(201,162,39,.14) 0%, transparent 55%), radial-gradient(circle at 85% 10%, rgba(201,162,39,.08) 0%, transparent 50%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Watermark de íconos — misma familia visual que el sidebar, a modo de textura de marca */}
        <div className="pointer-events-none absolute -bottom-6 -right-6 z-0" style={{ color: "rgba(255,255,255,.05)" }}>
          <IconWrenchBig />
        </div>
        <div className="pointer-events-none absolute bottom-24 right-28 z-0" style={{ color: "rgba(201,162,39,.10)" }}>
          <IconCarBig />
        </div>
        <div className="pointer-events-none absolute bottom-40 right-4 z-0" style={{ color: "rgba(255,255,255,.045)" }}>
          <IconUsersBig />
        </div>

        <div className="relative z-10">
          <img
            src="/logo.png"
            alt="POLYSAN S.A. / POLCECAL S.A."
            width={190}
            style={{ objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
        </div>

        <div className="relative z-10">
          <h1 className="mb-4 font-extrabold leading-tight" style={{ fontSize: "clamp(28px, 3.2vw, 42px)", color: "#F1F5F9" }}>
            La gestión de tu planta,
            <br />
            <span style={{ color: "var(--primary-tint)" }}>siempre a mano.</span>
          </h1>
          <p style={{ color: "var(--sidebar-text)", fontSize: 15, lineHeight: 1.6, maxWidth: 320 }}>
            Sistema de Gestión — Polcecal / Polysan
          </p>
          <div className="mt-10 flex gap-8">
            {[
              { v: "RRHH", l: "Personal" },
              { v: "Remises", l: "Transporte" },
              { v: "Mantenimiento", l: "Planta" },
            ].map((s) => (
              <div key={s.v}>
                <div className="font-bold" style={{ fontSize: 18, color: "var(--primary-tint)" }}>{s.v}</div>
                <div style={{ fontSize: 11, color: "var(--sidebar-text)", textTransform: "uppercase", letterSpacing: ".08em" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10" style={{ fontSize: 11, color: "rgba(169,194,174,.4)" }}>
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
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em]"
                style={{ color: "var(--text-muted)" }}
              >
                Contraseña
              </label>
              <input id="password" name="password" type="password" required placeholder="••••••••" className="input" />
            </div>

            {error && (
              <div className="rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary mt-2 justify-center py-3 text-[15px]">
              Ingresar →
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─── Íconos decorativos (misma familia de trazo que el sidebar) ─── */
function IconWrenchBig() {
  return (
    <svg width="200" height="200" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
      <path d="M14.7 6.3a4 4 0 10-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.83 2.83a2 2 0 01-2.83-2.83L14.7 6.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCarBig() {
  return (
    <svg width="110" height="110" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
      <path d="M5 17h14M5 17a2 2 0 01-2-2v-2l2-5a2 2 0 012-2h6a2 2 0 012 2l2 5v2a2 2 0 01-2 2M5 17a2 2 0 002 2h0a2 2 0 002-2m8 0a2 2 0 002 2h0a2 2 0 002-2M7 13h10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconUsersBig() {
  return (
    <svg width="90" height="90" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
