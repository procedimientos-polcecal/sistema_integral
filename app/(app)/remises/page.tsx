import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina, comoSeLee } from "@/lib/core/fechas";

const num = new Intl.NumberFormat("es-AR");

/**
 * La página de inicio del módulo: un adelanto de "Hoy" y del historial, no la
 * pantalla operativa en sí — esa se mudó a `/remises/hoy` para que la raíz
 * pueda ser un dashboard, mismo cambio que ya se hizo en Cantera.
 */
export default async function RemisesDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hoy = hoyEnArgentina();

  const [
    { data: empleados },
    { data: vehiculos },
    { data: turnos },
    { data: asistenciaHoy },
    { data: hojasHoy },
    { data: historialCrudo },
  ] = await Promise.all([
    supabase.from("empleados").select("id, remises_empleados_datos(lat)").eq("activo", true),
    supabase.from("vehiculos").select("id, activo"),
    supabase.from("remises_turnos").select("id, nombre, color").eq("activo", true).order("nombre"),
    supabase.from("remises_asistencia").select("empleado_id, turno_id").eq("fecha", hoy),
    supabase.from("hojas_ruta").select("id, tipo, turno_id").eq("fecha", hoy),
    supabase
      .from("hojas_ruta")
      .select("id, fecha, tipo, turno_id, remises_turnos(nombre), vehiculos(nombre)")
      .order("fecha", { ascending: false })
      .limit(60),
  ]);

  // "Con remis" = tiene ficha de Remises cargada (domicilio geocodificado o
  // no); el endpoint de empleados trae a todos los activos de la empresa, así
  // que acá se cuenta sólo a los que de verdad usan el módulo.
  const conRemis = (empleados ?? []).filter((e: any) => e.remises_empleados_datos);
  const sinCoordenadas = conRemis.filter((e: any) => e.remises_empleados_datos?.lat == null);
  const vehiculosActivos = (vehiculos ?? []).filter((v: any) => v.activo);
  const presentesHoy = new Set((asistenciaHoy ?? []).map((a) => a.empleado_id));
  const remisesHoy = (hojasHoy ?? []).length;

  const porTurno = (turnos ?? []).map((t) => ({
    turno: t,
    presentes: (asistenciaHoy ?? []).filter((a) => a.turno_id === t.id).length,
    ida: (hojasHoy ?? []).filter((h: any) => h.turno_id === t.id && h.tipo === "ida").length,
    vuelta: (hojasHoy ?? []).filter((h: any) => h.turno_id === t.id && h.tipo === "vuelta").length,
  }));

  // Mismo agrupado que /api/remises/historial (fecha + turno + tipo = un
  // grupo de remis), acá sólo para el adelanto de las últimas 5 corridas.
  const grupos = new Map<string, { fecha: string; turno: string; tipo: string; cantidad: number }>();
  for (const h of (historialCrudo ?? []) as any[]) {
    const clave = `${h.fecha}__${h.turno_id}__${h.tipo}`;
    const g = grupos.get(clave) ?? { fecha: h.fecha, turno: h.remises_turnos?.nombre ?? "—", tipo: h.tipo, cantidad: 0 };
    g.cantidad += 1;
    grupos.set(clave, g);
  }
  const historialReciente = [...grupos.values()].slice(0, 5);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Remises</h1>
        <Link href="/remises/hoy" className="btn-primary">Ir a Hoy →</Link>
      </div>

      {/* ── KPIs ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi color="#1E7D34" label="Empleados con remis" value={num.format(conRemis.length)} />
        <Kpi color="#0891B2" label="Vehículos activos" value={num.format(vehiculosActivos.length)} />
        <Kpi color="#7E22CE" label="Presentes hoy" value={`${num.format(presentesHoy.size)} / ${num.format(conRemis.length)}`} />
        <Kpi
          color={sinCoordenadas.length > 0 ? "#B45309" : "#1E7D34"}
          label="Sin coordenadas"
          value={num.format(sinCoordenadas.length)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Adelanto de Hoy ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Hoy · {comoSeLee(hoy)}</h2>
            <Link href="/remises/hoy" className="text-xs text-slate-500 underline">Ir a Hoy →</Link>
          </div>
          {porTurno.length === 0 ? (
            <p className="empty-state mt-3">Todavía no hay turnos activos configurados.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--text-muted)]">
                  <th className="py-1.5">Turno</th>
                  <th className="py-1.5 text-right">Presentes</th>
                  <th className="py-1.5 text-right">Ida</th>
                  <th className="py-1.5 text-right">Vuelta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {porTurno.map(({ turno, presentes, ida, vuelta }) => (
                  <tr key={turno.id}>
                    <td className="py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: turno.color ?? "#94A3B8" }} />
                        {turno.nombre}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{presentes}</td>
                    <td className="py-1.5 text-right tabular-nums">{ida || "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{vuelta || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">{remisesHoy} remis generados hoy en total.</p>
        </section>

        {/* ── Historial reciente ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Historial reciente</h2>
            <Link href="/remises/historial" className="text-xs text-slate-500 underline">Ver todo →</Link>
          </div>
          {historialReciente.length === 0 ? (
            <p className="empty-state mt-3">Todavía no se generaron rutas.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {historialReciente.map((g, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-[var(--text-secondary)]">{comoSeLee(g.fecha)}</span>
                  <span className="text-xs text-[var(--text-muted)]">{g.turno} · {g.tipo === "ida" ? "Ida" : "Vuelta"}</span>
                  <span className="font-medium text-[var(--text-primary)]">{g.cantidad} remis</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/remises/semana" className="btn-secondary">Semana</Link>
        <Link href="/remises/empleados" className="btn-secondary">Empleados</Link>
        <Link href="/remises/vehiculos" className="btn-secondary">Vehículos</Link>
        <Link href="/remises/historial" className="btn-secondary">Historial</Link>
        <Link href="/remises/configuracion" className="btn-secondary">Configuración</Link>
      </div>
    </div>
  );
}

function Kpi({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-white p-4">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs font-medium text-[var(--text-muted)]">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
