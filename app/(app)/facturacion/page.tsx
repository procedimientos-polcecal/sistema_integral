import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina, rangoDelMes, sumarDias, comoSeLee } from "@/lib/core/fechas";
import { nivelFacturacionDe } from "@/lib/facturacion/auth";

const num = new Intl.NumberFormat("es-AR");
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/**
 * La página de inicio del módulo: un adelanto de lo que entró y de lo que
 * falta vincular, no el buzón en sí —ese se mudó a `/facturacion/buzon` para
 * que la raíz pueda ser un dashboard, mismo cambio que en los otros módulos.
 */
export default async function FacturacionDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelFacturacionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();
  const { primerDia } = rangoDelMes(hoy.slice(0, 7));
  const manana = sumarDias(hoy, 1);

  const base = () => supabase.from("facturas_proveedor").select("id", { count: "exact", head: true });

  const [
    { count: sinVincular },
    { count: esperandoConfirmar },
    { count: cargadasHoy },
    { count: cargadasMes },
    { data: recientes },
  ] = await Promise.all([
    base().eq("estado", "recibida"),
    base().in("estado", ["vinculada", "informada"]),
    base().gte("created_at", hoy).lt("created_at", manana),
    base().gte("created_at", primerDia),
    supabase
      .from("facturas_proveedor")
      .select("id, numero, punto_venta, importe_total, moneda, estado, odoo_partner_nombre, proveedores!proveedor_id(nombre), created_at")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Facturación</h1>
        <Link href="/facturacion/buzon" className="btn-primary">Ir al buzón →</Link>
      </div>

      {/* ── KPIs ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi color="#1E7D34" label="Cargadas hoy" value={num.format(cargadasHoy ?? 0)} href="/facturacion/buzon" />
        <Kpi color="#0891B2" label="Cargadas este mes" value={num.format(cargadasMes ?? 0)} href="/facturacion/buzon" />
        <Kpi
          color={(sinVincular ?? 0) > 0 ? "#B45309" : "#1E7D34"}
          label="Sin vincular"
          value={num.format(sinVincular ?? 0)}
          href="/facturacion/buzon?estado=recibida"
        />
        <Kpi color="#7E22CE" label="Esperando confirmar" value={num.format(esperandoConfirmar ?? 0)} href="/facturacion/buzon" />
      </div>

      {/* ── Últimas cargadas ── */}
      <section className="card mt-6 p-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Últimas cargadas</h2>
          <Link href="/facturacion/buzon" className="text-xs text-slate-500 underline">Ver todas →</Link>
        </div>
        {!recientes || recientes.length === 0 ? (
          <p className="empty-state mt-3">Todavía no entró ninguna factura.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {recientes.map((f: any) => (
              <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="text-[var(--text-secondary)]">
                    {f.proveedores?.nombre ?? f.odoo_partner_nombre ?? "—"}
                  </span>{" "}
                  {f.numero != null && (
                    <span className="font-mono text-xs text-[var(--text-muted)]">
                      {String(f.punto_venta ?? 0).padStart(4, "0")}-{String(f.numero).padStart(8, "0")}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{comoSeLee(f.created_at.slice(0, 10))}</span>
                <span className="whitespace-nowrap font-medium text-[var(--text-primary)]">
                  {f.importe_total != null ? ars.format(f.importe_total) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
