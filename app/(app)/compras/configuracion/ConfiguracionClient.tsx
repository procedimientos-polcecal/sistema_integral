"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fechaHora } from "@/lib/compras/constants";
import type { Sincronizacion } from "@/lib/compras/types";

export default function ConfiguracionClient({
  sincronizaciones, gestionadosEnApp, total,
}: {
  sincronizaciones: Sincronizacion[];
  gestionadosEnApp: number;
  total: number;
}) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function sincronizar() {
    setSincronizando(true);
    setError("");
    setResultado(null);

    const res = await fetch("/api/compras/sheets/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo sincronizar con la planilla.");
      return;
    }
    setResultado(
      `Se leyeron ${body.filas_leidas} filas: ${body.filas_nuevas} nuevas, ` +
      `${body.filas_actualizadas} actualizadas y ${body.filas_omitidas} omitidas por estar ya gestionadas acá.`
    );
    router.refresh();
  }

  const ultima = sincronizaciones[0];
  const avance = total > 0 ? Math.round((gestionadosEnApp / total) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración de Compras</h1>
        <p className="text-sm text-slate-500">Sincronización con la planilla de Google Sheets</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cómo conviven la planilla y el sistema
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-slate-700">
          <li>· <strong>La planilla manda en el alta.</strong> Los RI nuevos siguen entrando por el formulario y el sistema los incorpora.</li>
          <li>· <strong>El sistema manda en lo que gestiona.</strong> Apenas se aprueba, se elige proveedor o se carga un costo acá, ese RI queda marcado y la planilla ya no puede pisarlo.</li>
          <li>· Los cambios de compra hechos acá se escriben de vuelta en la pestaña del área correspondiente.</li>
        </ul>

        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="text-slate-600">Requerimientos ya gestionados en el sistema</span>
            <span className="font-mono text-slate-900">
              {gestionadosEnApp.toLocaleString("es-AR")} / {total.toLocaleString("es-AR")} ({avance}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${avance}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Cuando este número se acerque al total y los RI nuevos entren por acá en lugar del
            formulario, la planilla deja de hacer falta.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sincronización manual</h2>
            <p className="mt-1 text-sm text-slate-500">
              {ultima
                ? `Última corrida: ${fechaHora(ultima.created_at)} (${ultima.origen})`
                : "Todavía no se ejecutó ninguna sincronización."}
              <br />
              Además corre automáticamente cada 2 horas.
            </p>
          </div>
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>

        {resultado && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {resultado}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="px-5 pt-5 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Últimas sincronizaciones
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Cuándo</th>
                <th className="px-3 py-2 text-left">Origen</th>
                <th className="px-3 py-2 text-right">Leídas</th>
                <th className="px-3 py-2 text-right">Nuevas</th>
                <th className="px-3 py-2 text-right">Actualiz.</th>
                <th className="px-3 py-2 text-right">Omitidas</th>
                <th className="px-3 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sincronizaciones.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin sincronizaciones registradas.</td></tr>
              ) : (
                sincronizaciones.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fechaHora(s.created_at)}</td>
                    <td className="px-3 py-2 text-slate-600">{s.origen}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_leidas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_nuevas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_actualizadas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_omitidas}</td>
                    <td className={`px-3 py-2 ${s.error ? "text-red-600" : "text-slate-600"}`}>
                      {s.error ?? `OK${s.duracion_ms ? ` · ${(s.duracion_ms / 1000).toFixed(1)}s` : ""}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
