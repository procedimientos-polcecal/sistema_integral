import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelInventarioDe } from "@/lib/inventario/auth";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { hoyEnArgentina, comoSeLee } from "@/lib/core/fechas";
import TraerDeLaPlanilla from "./TraerDeLaPlanilla";

const num = new Intl.NumberFormat("es-AR");

const ETIQUETA_TIPO: Record<string, string> = { entrada: "Entrada", salida: "Salida", ajuste: "Ajuste" };

/**
 * La página de inicio del módulo: un adelanto de faltantes y de los últimos
 * movimientos, no la pantalla del stock en sí —esa se mudó a
 * `/inventario/stock` para que la raíz pueda ser un dashboard, mismo cambio
 * que ya se hizo en Cantera y en Remises.
 */
export default async function InventarioDashboardPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelInventarioDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();

  const base = () => supabase.from("inventario_articulos").select("id", { count: "exact", head: true });

  const [
    sync,
    total,
    { data: faltantes, count: cantidadFaltantes },
    { count: movimientosHoy },
    { data: pendientes, count: cantidadPendientes },
    { data: recientes },
  ] = await Promise.all([
    ultimaSincronizacionDe(supabase, "inventario", "articulos"),
    base(),
    supabase
      .from("inventario_articulos")
      .select("id, codigo, descripcion, stock_actual, stock_seguridad, faltante", { count: "exact" })
      .gt("faltante", 0)
      .order("faltante", { ascending: false })
      .limit(6),
    supabase.from("inventario_movimientos").select("id", { count: "exact", head: true }).eq("fecha", hoy),
    supabase
      .from("inventario_movimientos")
      .select("id, codigo, tipo, cantidad, fecha", { count: "exact" })
      .not("sheets_pendiente", "is", null)
      .order("sheets_pendiente_en", { ascending: false })
      .limit(5),
    supabase
      .from("inventario_movimientos")
      .select("id, codigo, tipo, cantidad, fecha, solicitante")
      .order("fecha", { ascending: false })
      .limit(6),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-header">Inventario</h1>
        <div className="flex items-center gap-2">
          <TraerDeLaPlanilla sync={sync} />
          <Link href="/inventario/movimientos/nuevo" className="btn-primary">Cargar movimiento</Link>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi color="#1E7D34" label="Artículos" value={num.format(total.count ?? 0)} href="/inventario/stock" />
        <Kpi
          color={(cantidadFaltantes ?? 0) > 0 ? "#B45309" : "#1E7D34"}
          label="Con faltante"
          value={num.format(cantidadFaltantes ?? 0)}
          href="/inventario/stock?faltantes=1"
        />
        <Kpi color="#0891B2" label="Movimientos hoy" value={num.format(movimientosHoy ?? 0)} href="/inventario/movimientos" />
        <Kpi
          color={(cantidadPendientes ?? 0) > 0 ? "#B45309" : "#1E7D34"}
          label="Sin sincronizar"
          value={num.format(cantidadPendientes ?? 0)}
          href="/inventario/movimientos"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Faltantes ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Con faltante</h2>
            <Link href="/inventario/stock?faltantes=1" className="text-xs text-slate-500 underline">Ver todos →</Link>
          </div>
          {!faltantes || faltantes.length === 0 ? (
            <p className="empty-state mt-3">Sin faltantes — todo por encima del stock de seguridad.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {faltantes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-[var(--text-muted)]">{a.codigo}</span>{" "}
                    <span className="text-[var(--text-secondary)]">{a.descripcion}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium text-amber-700">
                    {a.stock_actual} / {a.stock_seguridad}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Movimientos recientes ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Movimientos recientes</h2>
            <Link href="/inventario/movimientos" className="text-xs text-slate-500 underline">Ver todos →</Link>
          </div>
          {!recientes || recientes.length === 0 ? (
            <p className="empty-state mt-3">Todavía no hay movimientos cargados.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {recientes.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-xs text-[var(--text-muted)]">{m.codigo}</span>{" "}
                    <span className="text-[var(--text-secondary)]">{ETIQUETA_TIPO[m.tipo] ?? m.tipo}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{comoSeLee(m.fecha)}</span>
                  <span className="font-medium text-[var(--text-primary)]">{m.cantidad}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {pendientes && pendientes.length > 0 && (
        <section className="card mt-5 border-amber-200 bg-amber-50/40 p-4">
          <h2 className="section-title text-amber-800">Sin sincronizar a la planilla</h2>
          <p className="mt-1 text-xs text-amber-700">
            Su stock se va a revertir en la próxima sincronización si no se corrige.
          </p>
          <ul className="mt-3 divide-y divide-amber-100">
            {pendientes.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="font-mono text-xs text-amber-800">{m.codigo}</span>
                <span className="text-amber-700">{ETIQUETA_TIPO[m.tipo] ?? m.tipo} · {m.cantidad}</span>
                <span className="text-xs text-amber-600">{comoSeLee(m.fecha)}</span>
              </li>
            ))}
          </ul>
          <Link href="/inventario/movimientos" className="mt-2 inline-block text-xs font-medium text-amber-800 underline">
            Ver en Movimientos →
          </Link>
        </section>
      )}

      <section className="mt-6">
        <h2 className="section-title mb-2">Más</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Acceso href="/inventario/lista" label="La lista del pañol" />
          {nivel === "admin" && <Acceso href="/inventario/articulos" label="Artículos" />}
        </div>
      </section>
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

function Kpi({ color, label, value, href }: { color: string; label: string; value: string; href?: string }) {
  const contenido = (
    <>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs font-medium text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value}</div>
    </>
  );
  const clases = "relative block overflow-hidden rounded-xl border border-[var(--border)] bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md";
  const franja = <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />;
  return href ? (
    <Link href={href} className={clases}>{franja}{contenido}</Link>
  ) : (
    <div className={clases}>{franja}{contenido}</div>
  );
}
