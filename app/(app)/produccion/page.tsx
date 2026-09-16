import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina, rangoDelMes, comoSeLee } from "@/lib/core/fechas";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { armarElMes } from "@/lib/produccion/consultas";
import { TURNOS, comoSeLeeElTurno } from "@/lib/produccion/turnos";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

function sumaTotal(dias: { produccionCalculada: Record<string, number>; despacho: Record<string, number>; rotura: Record<string, number> }[]) {
  let produccion = 0, despacho = 0, rotura = 0;
  for (const d of dias) {
    produccion += Object.values(d.produccionCalculada).reduce((s, v) => s + v, 0);
    despacho += Object.values(d.despacho).reduce((s, v) => s + v, 0);
    rotura += Object.values(d.rotura).reduce((s, v) => s + v, 0);
  }
  return { produccion, despacho, rotura };
}

/**
 * La página de inicio del módulo: un adelanto del mes y de hoy, no la
 * pantalla para cargar el parte del turno —esa se mudó a `/produccion/dia`
 * para que la raíz pueda ser un dashboard, mismo cambio que ya se hizo en
 * Cantera/Remises/Inventario.
 */
export default async function ProduccionDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();
  const mes = hoy.slice(0, 7);
  const { primerDia, ultimoDia } = rangoDelMes(mes);

  const [{ dias }, { data: partesHoy }] = await Promise.all([
    armarElMes(supabase, primerDia, ultimoDia),
    supabase.from("produccion_partes").select("turno").eq("fecha", hoy),
  ]);

  const { produccion, despacho, rotura } = sumaTotal(dias);
  const turnosCargados = dias.reduce((s, d) => s + d.turnosCargados, 0);
  const turnosPosibles = dias.length * TURNOS.length;
  const turnosHoy = new Set((partesHoy ?? []).map((p) => p.turno));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Producción</h1>
        <Link href="/produccion/dia" className="btn-primary">Ir al día →</Link>
      </div>

      {/* ── KPIs del mes ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi color="#1E7D34" label="Producido este mes" value={`${num1.format(produccion)} t`} href="/produccion/resumenes" />
        <Kpi color="#0891B2" label="Despachado este mes" value={`${num1.format(despacho)} t`} href="/produccion/resumenes" />
        <Kpi color="#7E22CE" label="Rotura este mes" value={`${num1.format(rotura)} t`} href="/produccion/resumenes" />
        <Kpi color="#B45309" label="Turnos cargados" value={`${turnosCargados} / ${turnosPosibles}`} href="/produccion/dia" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Hoy ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Hoy · {comoSeLee(hoy)}</h2>
            <Link href="/produccion/dia" className="text-xs text-slate-500 underline">Ir al día →</Link>
          </div>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {TURNOS.map((t) => {
              const cargado = turnosHoy.has(t);
              return (
                <li key={t} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-[var(--text-secondary)]">Turno {comoSeLeeElTurno(t)}</span>
                  <span className={`text-xs font-semibold ${cargado ? "text-[var(--primary)]" : "text-amber-700"}`}>
                    {cargado ? "Cargado" : "Sin cargar"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── El mes, por día ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Este mes</h2>
            <Link href="/produccion/resumenes" className="text-xs text-slate-500 underline">Ver resúmenes →</Link>
          </div>
          {dias.every((d) => d.turnosCargados === 0) ? (
            <p className="empty-state mt-3">Todavía no se cargó ningún parte este mes.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {dias
                .filter((d) => d.turnosCargados > 0)
                .slice(-6)
                .reverse()
                .map((d) => (
                  <li key={d.fecha} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-[var(--text-secondary)]">{comoSeLee(d.fecha)}</span>
                    <span className="text-xs text-[var(--text-muted)]">{d.turnosCargados} / {TURNOS.length} turnos</span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {num1.format(Object.values(d.produccionCalculada).reduce((s, v) => s + v, 0))} t
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>

      {nivel === "admin" && (
        <p className="mt-6 text-xs text-[var(--text-muted)]">
          También: <Link href="/produccion/productos" className="text-slate-600 underline">Renglones del parte</Link>
        </p>
      )}
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
