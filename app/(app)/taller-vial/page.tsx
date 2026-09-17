import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial, traerEstadosDiarios } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas, evolucionMensualDeLitros, resumenMensualPorEquipo, ultimosMeses } from "@/lib/tallerVial/combustible";
import { resumenMensualDeEstados } from "@/lib/tallerVial/estados";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/**
 * El inicio de Taller Vial: cuánto combustible se cargó este mes y a qué
 * consumo, equipo por equipo, más los días fuera de servicio. Espejo de sólo
 * lectura de la planilla real ("DATOS" y "HISTORIAL ESTADOS", vía
 * `lib/tallerVial/importar.ts`) — se sigue cargando ahí, acá sólo se mira.
 * Lo que sí se carga desde acá son los services por horómetro
 * (`/taller-vial/services`). El resto de la planilla (disponibilidad,
 * checklist de lavado/engrase, choferes) queda para etapas siguientes.
 */
export default async function TallerVialInicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);

  // El cálculo de trabajado encadena contra la carga anterior, así que hace
  // falta el historial completo del equipo y no sólo las del mes — una carga
  // de este mes puede ser la primera con lectura después de una de agosto.
  // Se trae una sola vez y el resto de los números salen de filtrarla acá.
  const [equipos, todasLasCargas, estadosDelMes] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
    traerEstadosDiarios(supabase, { mes: mesActual }),
  ]);

  const porCodigo = new Map(equipos.map((e) => [e.id, e]));
  const cargasDelMes = todasLasCargas.filter((c) => c.fecha.startsWith(mesActual));
  const cargasSinEquipo = todasLasCargas.filter((c) => c.equipo_id === null);
  const conTrabajo = calcularTrabajoEntreCargas(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ id: c.id, equipoId: c.equipo_id!, fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
  );
  const resumen = resumenMensualPorEquipo(conTrabajo, mesActual)
    .map((r) => ({ ...r, equipo: porCodigo.get(r.equipoId) }))
    .filter((r) => r.equipo)
    .sort((a, b) => b.litrosTotal - a.litrosTotal);

  const litrosTotalDelMes = cargasDelMes.reduce((s, c) => s + c.litros, 0);
  const equiposConCargaEsteMes = new Set(cargasDelMes.map((c) => c.equipo_id).filter(Boolean)).size;

  const meses = ultimosMeses(mesActual, 6);
  const evolucion = evolucionMensualDeLitros(
    todasLasCargas.map((c) => ({ id: c.id, equipoId: c.equipo_id ?? "sin-equipo", fecha: c.fecha, litros: c.litros, lectura: c.lectura })),
    meses
  );
  const maxLitrosEvolucion = Math.max(1, ...evolucion.map((e) => e.litrosTotal));

  const resumenEstados = resumenMensualDeEstados(
    estadosDelMes.map((e) => ({ equipoId: e.equipo_id, fecha: e.fecha, estado: e.estado as "OPERATIVO" | "FUERA_DE_SERVICIO" | "OPERATIVO_CON_FALLAS" })),
    mesActual
  )
    .map((r) => ({ ...r, equipo: porCodigo.get(r.equipoId) }))
    .filter((r) => r.equipo)
    .sort((a, b) => b.diasFueraDeServicio - a.diasFueraDeServicio);
  const totalDiasFueraDeServicio = resumenEstados.reduce((s, r) => s + r.diasFueraDeServicio, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Taller Vial</h1>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metrica color="#0891B2" valor={`${num0.format(litrosTotalDelMes)} L`} label="Combustible cargado este mes" href="/taller-vial/cargas" />
        <Metrica color="#1E7D34" valor={String(equiposConCargaEsteMes)} label="Equipos con carga este mes" />
        <Metrica color="#7E22CE" valor={String(cargasDelMes.length)} label="Cargas registradas este mes" href="/taller-vial/cargas" />
        <Metrica
          color={cargasSinEquipo.length > 0 ? "#B45309" : "#1E7D34"}
          valor={String(cargasSinEquipo.length)}
          label="Cargas sin equipo reconocido"
        />
        <Metrica
          color={totalDiasFueraDeServicio > 0 ? "#DC2626" : "#1E7D34"}
          valor={String(totalDiasFueraDeServicio)}
          label="Días fuera de servicio este mes (toda la flota)"
        />
      </div>

      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Consumo del mes, por equipo</h2>
          <Link href="/taller-vial/cargas" className="text-xs text-slate-500 underline">Ver cargas →</Link>
        </div>
        {resumen.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Todavía no hay cargas este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="text-right">Cargas</th>
                  <th className="text-right">Litros</th>
                  <th className="text-right">Trabajado</th>
                  <th className="text-right">Consumo</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => {
                  const unidad = unidadDeUso(r.equipo!.code);
                  return (
                    <tr key={r.equipoId}>
                      <td className="font-medium text-slate-800">{r.equipo!.code} - {r.equipo!.name}</td>
                      <td className="text-right">{r.cargas}</td>
                      <td className="text-right font-mono tabular-nums">{num0.format(r.litrosTotal)}</td>
                      <td className="text-right font-mono tabular-nums">
                        {r.trabajadoTotal !== null ? `${num1.format(r.trabajadoTotal)} ${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {r.consumoPromedio !== null ? `${num1.format(r.consumoPromedio)} L/${ETIQUETA_UNIDAD[unidad]}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-slate-900">Evolución del consumo, últimos 6 meses</h2>
        <div className="mt-3 space-y-2">
          {evolucion.map((e) => (
            <div key={e.mes} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs text-slate-500">{e.mes}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded bg-[#0891B2]"
                  style={{ width: `${(e.litrosTotal / maxLitrosEvolucion) * 100}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-slate-600">
                {num0.format(e.litrosTotal)} L
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold text-slate-900">Estados del mes, por equipo</h2>
        {resumenEstados.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Todavía no hay estados cargados este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="text-right">Días operativo</th>
                  <th className="text-right">Días fuera de servicio</th>
                  <th className="text-right">Días con fallas</th>
                </tr>
              </thead>
              <tbody>
                {resumenEstados.map((r) => (
                  <tr key={r.equipoId}>
                    <td className="font-medium text-slate-800">{r.equipo!.code} - {r.equipo!.name}</td>
                    <td className="text-right font-mono tabular-nums text-emerald-700">{r.diasOperativo}</td>
                    <td className={`text-right font-mono tabular-nums ${r.diasFueraDeServicio > 0 ? "text-red-600 font-semibold" : "text-slate-500"}`}>
                      {r.diasFueraDeServicio}
                    </td>
                    <td className={`text-right font-mono tabular-nums ${r.diasConFallas > 0 ? "text-amber-700 font-semibold" : "text-slate-500"}`}>
                      {r.diasConFallas}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-4">
        <Link
          href="/taller-vial/services"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          Services por horómetro (250 / 500 / 1000 / 2000 hs)
          <span className="text-slate-400">→</span>
        </Link>
      </section>
    </div>
  );
}

function Metrica({
  color, valor, label, href,
}: { color: string; valor: string; label: string; href?: string }) {
  const contenido = (
    <>
      <div className="text-3xl font-bold tabular-nums" style={{ color }}>{valor}</div>
      <div className="mt-0.5 text-sm text-slate-500">{label}</div>
    </>
  );
  const clases = "card block p-4 transition hover:-translate-y-0.5 hover:shadow-lg";
  const estilo = { borderTop: `3px solid ${color}` };
  return href ? (
    <Link href={href} className={clases} style={estilo}>{contenido}</Link>
  ) : (
    <div className={clases} style={estilo}>{contenido}</div>
  );
}
