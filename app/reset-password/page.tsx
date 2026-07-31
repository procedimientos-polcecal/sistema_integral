"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [listo, setListo] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setListo(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setListo(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setGuardando(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOk(true);
    setTimeout(() => router.push("/"), 1200);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <img src="/logo.png" alt="POLYSAN S.A. / POLCECAL S.A." width={140} className="mb-8" style={{ objectFit: "contain" }} />

        <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          Nueva contraseña
        </h2>

        {ok ? (
          <p className="text-sm" style={{ color: "var(--primary-dark)" }}>Contraseña actualizada. Entrando...</p>
        ) : !listo ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Abrí este link desde el email que te mandamos para poder continuar.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em]"
                style={{ color: "var(--text-muted)" }}
              >
                Nueva contraseña
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={guardando} className="btn-primary mt-2 justify-center py-3 text-[15px]">
              {guardando ? "Guardando..." : "Guardar contraseña →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
