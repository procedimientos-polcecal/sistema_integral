import Link from "next/link";
import { solicitarReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ enviado?: string }>;
}) {
  const { enviado } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <img src="/logo.png" alt="POLYSAN S.A. / POLCECAL S.A." width={140} className="mb-8" style={{ objectFit: "contain" }} />

        <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Recuperar contraseña
        </h2>
        <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
          Ingresá tu email y te mandamos un link para elegir una nueva contraseña.
        </p>

        {enviado ? (
          <div
            className="rounded-lg border px-4 py-3 text-sm"
            style={{ background: "var(--primary-light)", borderColor: "var(--primary)", color: "var(--primary-dark)" }}
          >
            Si el email existe en el sistema, te va a llegar un link para restablecer tu contraseña.
          </div>
        ) : (
          <form action={solicitarReset} className="flex flex-col gap-4">
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
            <button type="submit" className="btn-primary mt-2 justify-center py-3 text-[15px]">
              Enviar link →
            </button>
          </form>
        )}

        <Link href="/login" className="mt-6 inline-block text-sm font-medium" style={{ color: "var(--primary)" }}>
          ← Volver a ingresar
        </Link>
      </div>
    </div>
  );
}
