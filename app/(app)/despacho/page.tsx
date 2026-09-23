import { redirect } from "next/navigation";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina, rangoDelMes, comoSeLee } from "@/lib/core/fechas";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import {
  traerOrdenesDelDia,
  traerOrdenesAbiertasAnteriores,
  traerOrdenes,
  traerRecepcionesDelDia,
  traerRecepcionesAbiertasAnteriores,
} from "@/lib/despacho/consultas";
import { indicadoresDeOrdenes } from "@/lib/despacho/indicadores";

const num = new Intl.NumberFormat("es-AR");

/**
 * La página de inicio del módulo: un adelanto de hoy y de los indicadores del
 * mes, no la pantalla de la balanza —esa se mudó a `/despacho/movimientos`
 * para que la raíz pueda ser un dashboard, mismo cambio que en los otros
 * módulos.
 */
export default async function DespachoDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();
  const { primerDia } = rangoDelMes(hoy.slice(0, 7));

  const [ordenesHoy, ordenesAbiertasAntes, ordenesDelMes, recepcionesHoy, recepcionesAbiertasAntes] = await Promise.all([
    traerOrdenesDelDia(supabase, hoy),
    traerOrdenesAbiertasAnteriores(supabase, hoy),
    traerOrdenes(supabase, { desde: primerDia, hasta: hoy }),
    traerRecepcionesDelDia(supabase, hoy),
    traerRecepcionesAbiertasAnteriores(supabase, hoy),
  ]);

  const indicadores = indicadoresDeOrdenes(ordenesDelMes);
  const sinCerrar = ordenesAbiertasAntes.length + recepcionesAbiertasAntes.length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Despacho</h1>
        <Link href="/despacho/movimientos" className="btn-primary">Ir a Movimientos →</Link>
      </div>

      {/* ── KPIs ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard color="#1E7D34" label="Órdenes hoy" value={num.format(ordenesHoy.length)} href="/despacho/movimientos" />
        <KpiCard color="#0891B2" label="Recepciones hoy" value={num.format(recepcionesHoy.length)} href="/despacho/recepciones" />
        <KpiCard
          color={indicadores.promedioCarga != null ? "#7E22CE" : "#94A3B8"}
          label="Prom. carga (min, mes)"
          value={indicadores.promedioCarga != null ? num.format(indicadores.promedioCarga) : "—"}
          href="/despacho/ordenes"
        />
        <KpiCard
          color={sinCerrar > 0 ? "#B45309" : "#1E7D34"}
          label="Sin cerrar de antes"
          value={num.format(sinCerrar)}
          href="/despacho/movimientos"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Hoy ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Hoy · {comoSeLee(hoy)}</h2>
            <Link href="/despacho/movimientos" className="text-xs text-slate-500 underline">Ir a Movimientos →</Link>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Órdenes de carga</span>
              <span className="font-medium text-[var(--text-primary)]">{ordenesHoy.length}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[var(--text-secondary)]">Recepciones de material</span>
              <span className="font-medium text-[var(--text-primary)]">{recepcionesHoy.length}</span>
            </li>
            {sinCerrar > 0 && (
              <li className="flex items-center justify-between text-amber-700">
                <span>Sin cerrar de días anteriores</span>
                <span className="font-semibold">{sinCerrar}</span>
              </li>
            )}
          </ul>
        </section>

        {/* ── Peores tiempos en predio, este mes ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Más tiempo en predio (mes)</h2>
            <Link href="/despacho/ordenes" className="text-xs text-slate-500 underline">Ver órdenes →</Link>
          </div>
          {indicadores.peoresEnPredio.length === 0 ? (
            <p className="empty-state mt-3">Sin datos suficientes este mes.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {indicadores.peoresEnPredio.map((o) => (
                <li key={o.numero} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-[var(--text-muted)]">{o.numero}</span>{" "}
                    <span className="text-[var(--text-secondary)]">{o.cliente ?? "—"}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium text-[var(--text-primary)]">{num.format(o.minutos)} min</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            {indicadores.cantidad} órdenes este mes · {indicadores.sinTiempoDeCarga} sin tiempo de carga · {indicadores.sinTiempoEnPredio} sin tiempo en predio.
          </p>
        </section>
      </div>

      {nivel === "admin" && (
        <section className="mt-6">
          <h2 className="section-title mb-2">Más</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Acceso href="/despacho/productos" label="Productos" />
          </div>
        </section>
      )}
    </div>
  );
}

function Acceso({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm font-medium text-[var(--text-secondary)] transition hover:-translate-y-0.5 hover:border-[var(--border-dark)] hover:text-[var(--text-primary)] hover:shadow-md"
    >
      {label}
      <span className="text-[var(--text-muted)]">→</span>
    </Link>
  );
}

