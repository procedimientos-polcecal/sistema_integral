import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial, traerEstadosDiarios, traerServices } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas, evolucionMensualDeLitros, resumenMensualPorEquipo, ultimosMeses } from "@/lib/tallerVial/combustible";
import { estadoActualPorEquipo, resumenDeEstadoActual, resumenMensualDeEstados, type EstadoDiario } from "@/lib/tallerVial/estados";
import { resumenServicePorEquipo, ultimaLecturaPorEquipo } from "@/lib/tallerVial/service";
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
  const [equipos, todasLasCargas, todosLosEstados, todosLosServices] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
    traerEstadosDiarios(supabase, {}),
    traerServices(supabase),
  ]);

  const porCodigo = new Map(equipos.map((e) => [e.id, e]));
  const cargasDelMes = todasLasCargas.filter((c) => c.fecha.startsWith(mesActual));
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

  const estadosPlanos = todosLosEstados.map((e) => ({
    equipoId: e.equipo_id,
    fecha: e.fecha,
    estado: e.estado as EstadoDiario,
  }));

  const resumenEstados = resumenMensualDeEstados(estadosPlanos, mesActual)
    .map((r) => ({ ...r, equipo: porCodigo.get(r.equipoId) }))
    .filter((r) => r.equipo)
    .sort((a, b) => b.diasFueraDeServicio - a.diasFueraDeServicio);

  const estadoActual = estadoActualPorEquipo(estadosPlanos);
  const resumenActual = resumenDeEstadoActual(estadoActual, equipos.map((e) => e.id));
  const pct = (n: number) => (resumenActual.total > 0 ? Math.round((n / resumenActual.total) * 100) : 0);

  // El "service de 250 hs" es el que se repite todo el tiempo (por la
  // cascada, siempre vence antes que el de 500/1000/2000): es la tabla que
  // importa mirar seguido. El horómetro actual sale de la última lectura de
  // combustible, no de un campo propio — ver el comentario de
  // `ultimaLecturaPorEquipo`.
  const horometroActualPorEquipo = ultimaLecturaPorEquipo(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ equipoId: c.equipo_id!, fecha: c.fecha, lectura: c.lectura }))
  );
  const servicePorEquipo = resumenServicePorEquipo(
    equipos.map((e) => e.id),
    todosLosServices.map((s) => ({ id: s.id, equipoId: s.equipo_id, tier: s.tier, fecha: s.fecha, horometro: s.horometro })),
    horometroActualPorEquipo
  )
    .map((r) => ({ ...r, equipo: porCodigo.get(r.equipoId), de250: r.escalones.find((e) => e.tier === 250)! }))
    .filter((r) => r.equipo)
    // Vencido primero (el más atrasado adelante), después próximo, después
    // al día, y sin dato al final.
    .sort((a, b) => {
      const orden = { VENCIDO: 0, PROXIMO: 1, AL_DIA: 2 } as const;
      const ra = a.de250.lectura ? orden[a.de250.lectura] : 3;
      const rb = b.de250.lectura ? orden[b.de250.lectura] : 3;
      if (ra !== rb) return ra - rb;
      return (a.de250.horasFaltantes ?? Infinity) - (b.de250.horasFaltantes ?? Infinity);
    });
  const serviceVencidos = servicePorEquipo.filter((r) => r.de250.lectura === "VENCIDO").length;
  const serviceProximos = servicePorEquipo.filter((r) => r.de250.lectura === "PROXIMO").length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Taller Vial</h1>
      </div>

      {/* ── Estado actual de la flota ── */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Metrica
          color="#1E7D34"
          valor={`${pct(resumenActual.operativos)}%`}
          label={`Operativos (${resumenActual.operativos}/${resumenActual.total})`}
        />
        <Metrica
          color={resumenActual.fueraDeServicio > 0 ? "#DC2626" : "#94A3B8"}
          valor={`${pct(resumenActual.fueraDeServicio)}%`}
          label={`Fuera de servicio (${resumenActual.fueraDeServicio}/${resumenActual.total})`}
        />
        <Metrica
          color={resumenActual.conFallas > 0 ? "#D97706" : "#94A3B8"}
          valor={`${pct(resumenActual.conFallas)}%`}
          label={`Con fallas (${resumenActual.conFallas}/${resumenActual.total})`}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica color="#0891B2" valor={`${num0.format(litrosTotalDelMes)} L`} label="Combustible cargado este mes" href="/taller-vial/cargas" />
        <Metrica color="#1E7D34" valor={String(equiposConCargaEsteMes)} label="Equipos con carga este mes" />
        <Metrica color="#7E22CE" valor={String(cargasDelMes.length)} label="Cargas registradas este mes" href="/taller-vial/cargas" />
        <Metrica
          color={resumenActual.sinDato > 0 ? "#94A3B8" : "#1E7D34"}
          valor={String(resumenActual.sinDato)}
          label="Equipos sin estado cargado"
        />
      </div>

      <section className="card mt-4 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Próximo service (250 hs)</h2>
          <Link href="/taller-vial/services" className="text-xs text-slate-500 underline">Ver los 4 escalones →</Link>
        </div>
        {(serviceVencidos > 0 || serviceProximos > 0) && (
          <p className="mt-1 text-xs text-slate-500">
            {serviceVencidos > 0 && <span className="font-medium text-red-600">{serviceVencidos} vencido{serviceVencidos > 1 ? "s" : ""}</span>}
            {serviceVencidos > 0 && serviceProximos > 0 && " · "}
            {serviceProximos > 0 && <span className="font-medium text-amber-700">{serviceProximos} próximo{serviceProximos > 1 ? "s" : ""} a vencer</span>}
          </p>
        )}
        <div className="mt-4 space-y-3">
          {servicePorEquipo.map((r) => {
            const lectura = r.de250.lectura;
            const color = lectura === "VENCIDO" ? "bg-red-500" : lectura === "PROXIMO" ? "bg-amber-500" : lectura === "AL_DIA" ? "bg-emerald-500" : "bg-slate-200";
            const textoEstado =
              lectura === "VENCIDO"
                ? `Vencido hace ${num0.format(Math.abs(r.de250.horasFaltantes!))} hs`
                : lectura === "PROXIMO"
                  ? `Faltan ${num0.format(r.de250.horasFaltantes!)} hs`
                  : lectura === "AL_DIA"
                    ? `Faltan ${num0.format(r.de250.horasFaltantes!)} hs`
                    : "Sin service cargado";
            const colorTexto = lectura === "VENCIDO" ? "text-red-600" : lectura === "PROXIMO" ? "text-amber-700" : "text-slate-500";
            // % del ciclo de 250 hs ya transcurrido desde el último service — se
            // satura en 100% cuando está vencido, para que la barra no se salga.
            const progreso = r.de250.horasFaltantes !== null ? Math.min(100, Math.max(0, ((250 - r.de250.horasFaltantes) / 250) * 100)) : 0;
            return (
              <div key={r.equipoId} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-700">
                  {r.equipo!.code} - {r.equipo!.name}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${progreso}%` }} />
                </div>
                <span className={`w-32 shrink-0 text-right text-xs font-medium tabular-nums ${colorTexto}`}>{textoEstado}</span>
              </div>
            );
          })}
        </div>
      </section>

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
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Estados del mes, por equipo</h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Operativo</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> Con fallas</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Fuera de servicio</span>
          </div>
        </div>
        {resumenEstados.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">Todavía no hay estados cargados este mes.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {resumenEstados.map((r) => {
              const total = r.diasRegistrados || 1;
              return (
                <div key={r.equipoId} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-700">
                    {r.equipo!.code} - {r.equipo!.name}
                  </span>
                  <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    {r.diasOperativo > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(r.diasOperativo / total) * 100}%` }} />}
                    {r.diasConFallas > 0 && <div className="h-full bg-amber-500" style={{ width: `${(r.diasConFallas / total) * 100}%` }} />}
                    {r.diasFueraDeServicio > 0 && <div className="h-full bg-red-500" style={{ width: `${(r.diasFueraDeServicio / total) * 100}%` }} />}
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">
                    {r.diasFueraDeServicio > 0 ? `${r.diasFueraDeServicio}d FS` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href="/taller-vial/services"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          Services por horómetro (250 / 500 / 1000 / 2000 hs)
          <span className="text-slate-400">→</span>
        </Link>
        <Link
          href="/taller-vial/reparaciones"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          Historial de reparaciones
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
