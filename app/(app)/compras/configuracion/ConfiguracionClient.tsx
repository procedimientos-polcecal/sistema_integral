"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fechaHora } from "@/lib/compras/constants";
import type { Sincronizacion } from "@/lib/compras/types";

export default function ConfiguracionClient({
  sincronizaciones, aprobadores, nuevosApp, nuevosPlanilla, abiertos, abiertosGestionados, gestionados, total,
}: {
  sincronizaciones: Sincronizacion[];
  aprobadores: { id: string; nombre: string; apellido: string; email: string }[];
  /** RI creados en la app en los últimos 30 días. */
  nuevosApp: number;
  /** RI que en esos 30 días entraron por el formulario de Google. */
  nuevosPlanilla: number;
  /** RI todavía en circulación: ni recibidos ni denegados. */
  abiertos: number;
  abiertosGestionados: number;
  gestionados: number;
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

        <div className="mt-5 space-y-5">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">Por dónde entran los pedidos nuevos</span>
              <span className="text-xs text-slate-500">últimos 30 días</span>
            </div>

            {nuevosApp + nuevosPlanilla === 0 ? (
              <p className="text-sm text-slate-400">No entró ningún pedido nuevo en este período.</p>
            ) : (
              <>
                <Barra
                  partes={[
                    { valor: nuevosApp, color: "var(--primary)", etiqueta: "por el sistema" },
                    { valor: nuevosPlanilla, color: "#CBD5E1", etiqueta: "por la planilla" },
                  ]}
                />
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <Leyenda color="var(--primary)" texto={`${nuevosApp} por el sistema`} />
                  <Leyenda color="#CBD5E1" texto={`${nuevosPlanilla} por la planilla`} />
                </div>
              </>
            )}

            <p className="mt-2 text-xs text-slate-500">
              Éste es el indicador que decide. Cuando la barra sea toda verde, la planilla
              dejó de usarse para cargar y se puede apagar la sincronización.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">Pedidos abiertos gestionados desde acá</span>
              <span className="font-mono text-slate-900">
                {abiertosGestionados} / {abiertos}
              </span>
            </div>
            <Barra
              partes={[
                { valor: abiertosGestionados, color: "var(--primary)", etiqueta: "gestionados" },
                { valor: Math.max(abiertos - abiertosGestionados, 0), color: "#E2E8F0", etiqueta: "sin tocar" },
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">
              Sólo cuenta lo que sigue en circulación. Los {total.toLocaleString("es-AR")} del
              histórico incluyen pedidos ya cerrados hace meses que nadie va a volver a tocar:
              medirlos contra el total no diría nada.
              {gestionados > abiertosGestionados &&
                ` En total hay ${gestionados} requerimientos tocados desde el sistema, contando los ya cerrados.`}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quiénes pueden aprobar
        </h2>
        <p className="mb-3 text-sm text-slate-600">
          Esta lista tiene que coincidir con los editores de la protección
          «APROBACIÓN DE GERENCIA» de la planilla. Son los dos lados del mismo
          control: si acá hay alguien que allá no está, la app aprobaría algo que
          la planilla no dejaría aprobar.
        </p>

        {aprobadores.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nadie puede aprobar todavía. Asigná el módulo Compras con nivel
            <strong> admin</strong> desde Administración → Usuarios a quienes aprueban
            en la planilla.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {aprobadores.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-slate-900">{a.nombre} {a.apellido}</span>
                <span className="font-mono text-xs text-slate-500">{a.email}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Ser administrador del sistema <strong>no</strong> alcanza para aprobar: hace falta
          estar en esta lista. Es a propósito, para que el permiso sea el mismo en los
          dos lados y no dependa de quién administra el sistema.
        </p>
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

/**
 * Barra de proporción. Se le da un ancho mínimo a cada parte con valor, para
 * que un 3% siga leyéndose como una barra y no como un punto perdido.
 */
function Barra({ partes }: { partes: { valor: number; color: string; etiqueta: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  if (total === 0) return null;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      {partes.map((p, i) =>
        p.valor === 0 ? null : (
          <div
            key={i}
            title={`${p.valor} ${p.etiqueta}`}
            className="h-full transition-all"
            style={{
              width: `${(p.valor / total) * 100}%`,
              minWidth: 6,
              background: p.color,
            }}
          />
        )
      )}
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {texto}
    </span>
  );
}
