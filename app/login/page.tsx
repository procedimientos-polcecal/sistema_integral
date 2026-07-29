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
        style={{ background: "#0A0F1C", padding: "48px" }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 80%, rgba(232,160,32,.1) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(70,184,105,.08) 0%, transparent 50%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10">
          <img src="/logo.png" alt="POLYSAN S.A. / POLCECAL S.A." width={200} style={{ objectFit: "contain" }} />
        </div>

        <div className="relative z-10">
          <h1 className="mb-4 font-extrabold leading-tight" style={{ fontSize: "clamp(26px, 3vw, 40px)", color: "#F1F5F9" }}>
            Sistema de
            <br />
            <span style={{ color: "#46B869" }}>Gestión</span>
            <br />
            Polcecal / Polysan
          </h1>
          <p style={{ color: "#475569", fontSize: 15, lineHeight: 1.6, maxWidth: 320 }}>
            RRHH, Remises y Mantenimiento en un solo lugar.
          </p>
          <div className="mt-10 flex gap-8">
            {[
              { v: "RRHH", l: "Personal" },
              { v: "Remises", l: "Transporte" },
              { v: "Mantenimiento", l: "Planta" },
            ].map((s) => (
              <div key={s.v}>
                <div className="font-bold" style={{ fontSize: 18, color: "#46B869" }}>{s.v}</div>
                <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: ".08em" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10" style={{ fontSize: 11, color: "#1E2A3A" }}>
          © {new Date().getFullYear()} POLCECAL / POLYSAN S.A.
        </div>
      </div>

      {/* Panel derecho */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
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
