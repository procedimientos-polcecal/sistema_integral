"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import { useConfirm } from "@/components/ConfirmProvider";
import { claveDeOrdenGut } from "@/lib/mantenimiento/gut";
import { INVITADOS_DE_UNA_OT } from "@/lib/agenda/evento";
import { comoSeLee } from "@/lib/core/fechas";

const ESTADO_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ATRASADO:   { label: "Atrasado",   color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
  EN_PROCESO: { label: "En proceso", color: "#1D4ED8", bg: "#EFF6FF", dot: "#3B82F6" },
  POR_HACER:  { label: "Por hacer",  color: "#B45309", bg: "#FFFBEB", dot: "#F59E0B" },
  REALIZADO:  { label: "Realizado",  color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
};

/**
 * Lo que contesta `POST /api/mantenimiento/planificacion/[id]/calendario` por
 * cada ítem. Son los mismos cuatro estados de la ruta y no un vocabulario de
 * la pantalla.
 */
type ResultadoDeItem = {
  item_id: string;
  ot_number: number | null;
  estado: "mandada" | "mandada_en_otra_fecha" | "salteada" | "fallo";
  fecha: string | null;
  fecha_corrida: boolean;
  mensaje: string | null;
  advertencias: string[];
};

/** Cómo se ve cada estado. El color va por `style`, no por una utilidad junto a una clase sin capa. */
const RESULTADO_META: Record<ResultadoDeItem["estado"], { titulo: string; color: string; bg: string; borde: string }> = {
  mandada:               { titulo: "Mandada al calendario",       color: "#166534", bg: "#F0FDF4", borde: "#BBF7D0" },
  mandada_en_otra_fecha: { titulo: "Mandada, pero en otra fecha", color: "#92400E", bg: "#FFFBEB", borde: "#FDE68A" },
  salteada:              { titulo: "No se mandó",                 color: "#475569", bg: "#F8FAFC", borde: "#E2E8F0" },
  fallo:                 { titulo: "Falló",                       color: "#B91C1C", bg: "#FEF2F2", borde: "#FECACA" },
};

function nombreCompleto(u: { nombre?: string; apellido?: string } | null | undefined): string {
  if (!u) return "";
  return `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim();
}

export default function PlanDetalle({ plan, pendingOTs, usuarios, sectores, canEdit }: {
  plan: any; pendingOTs: any[]; usuarios: any[]; sectores: any[]; canEdit: boolean;
}) {
  const [items, setItems]         = useState<any[]>(
    [...(plan.planificacion_diaria_items ?? [])].sort((a, b) => a.orden - b.orden)
  );
  const [showAddOT, setShowAddOT] = useState(false);
  const [saving, setSaving]       = useState(false);

  const [filterSector, setFilterSector] = useState("");
  const [filterQ, setFilterQ]           = useState("");
  const [editItem, setEditItem]         = useState<any | null>(null);

  // Mandar al calendario. `mandando` es "plan" o el id del ítem en curso: con
  // uno andando se bloquean todos los botones, porque la ruta escribe una
  // planilla de a una orden y dos corridas a la vez se pisarían.
  const confirm = useConfirm();
  const [mandando, setMandando]           = useState<string | null>(null);
  const [resultados, setResultados]       = useState<Record<string, ResultadoDeItem>>({});
  const [errorDelEnvio, setErrorDelEnvio] = useState<string | null>(null);

  const planDate = new Date(plan.fecha + "T12:00:00");

  const alreadyIds = new Set(items.map((i: any) => i.work_order_id).filter(Boolean));
  // Se ofrecen en orden de GUT, de mayor a menor: acá es donde se decide qué se
  // hace mañana. `sort` es estable, así que a igual clave queda el orden en que
  // llegaron (el número de OT, de la más nueva a la más vieja).
  const availableOTs = useMemo(() => pendingOTs.filter(o => {
    if (alreadyIds.has(o.id)) return false;
    if (filterSector && o.sector_id !== filterSector) return false;
    if (filterQ) {
      const q = filterQ.toLowerCase();
      return (o.descripcion ?? "").toLowerCase().includes(q)
        || (o.equipo_raw ?? "").toLowerCase().includes(q)
        || String(o.ot_number).includes(q);
    }
    return true;
  }).sort((a, b) => claveDeOrdenGut(b) - claveDeOrdenGut(a)),
  [pendingOTs, alreadyIds, filterSector, filterQ]);

  async function addOT(ot: any) {
    setSaving(true);
    const res = await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_item",
        work_order_id:  ot.id,
        ot_number:      ot.ot_number,
        especialidad:   ot.especialidad,
        sector_raw:     ot.sector_raw,
        equipo_raw:     ot.equipo_raw,
        descripcion:    ot.descripcion,
        repuesto:       ot.repuesto,
        fecha_ejecucion: plan.fecha,
      }),
    });
    const data = await res.json();
    if (res.ok) setItems(prev => [...prev, data.data]);
    setSaving(false);
  }

  async function removeItem(itemId: string) {
    await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_item", item_id: itemId }),
    });
    setItems(prev => prev.filter(i => i.id !== itemId));
  }

  async function saveItemEdit(itemId: string, assigned_to: string, assigned_name: string, notas_item: string) {
    const res = await fetch(`/api/mantenimiento/planificacion/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_item", item_id: itemId, assigned_to, assigned_name, notas_item }),
    });
    const data = await res.json();
    if (res.ok) setItems(prev => prev.map(i => i.id === itemId ? data.data : i));
    setEditItem(null);
  }

  /**
   * `itemId` omitido es el plan entero. Cada ítem queda con lo que le pasó: el
   * caso que importa es el que no hizo lo que el plan decía, y un resumen lo
   * esconde.
   */
  async function mandarAlCalendario(itemId?: string) {
    setMandando(itemId ?? "plan");
    setErrorDelEnvio(null);
    // Lo que había en pantalla es de una corrida anterior: si ésta falla, un
    // renglón viejo «Mandada · 05/11» seguiría diciendo algo que esta corrida
    // no produjo. Se limpia el mapa entero, o la entrada de ese ítem.
    setResultados(prev => {
      if (!itemId) return {};
      const { [itemId]: _viejo, ...resto } = prev;
      return resto;
    });
    // Sin una respuesta del servidor no se sabe qué llegó a salir: la ruta sigue
    // recorriendo las órdenes aunque el cliente se haya desconectado, y «no se
    // pudo conectar» se lee como «no pasó nada». Es el mismo aviso en las dos
    // ramas que pueden quedar sin saber.
    const PUEDE_HABER_SALIDO = itemId
      ? " Revisá en el calendario antes de volver a mandar: puede que ya haya salido."
      : " Revisá en el calendario antes de volver a mandar: puede que algunas órdenes ya hayan salido.";
    const fallo = (motivo: string) => {
      if (itemId) {
        setResultados(prev => ({ ...prev, [itemId]: {
          item_id: itemId, ot_number: null, estado: "fallo", fecha: null,
          fecha_corrida: false, mensaje: motivo, advertencias: [],
        } }));
      } else {
        // Sin respuesta no se inventan renglones.
        setErrorDelEnvio(motivo);
      }
    };
    try {
      const res = await fetch(`/api/mantenimiento/planificacion/${plan.id}/calendario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { item_id: itemId } : {}),
      });
      // Un corte por tiempo devuelve HTML y no JSON: no es motivo para quedarse sin decir nada.
      const data = await res.json().catch(() => null) as
        { error?: string; resultados?: ResultadoDeItem[] } | null;
      if (!res.ok || !data?.resultados) {
        // Un error con cuerpo es la ruta diciendo qué pasó (403, 404, 400: no
        // salió nada). Sin cuerpo, no se sabe.
        fallo(data?.error ?? `El servidor respondió ${res.status}.${PUEDE_HABER_SALIDO}`);
        return;
      }
      const nuevos = Object.fromEntries(data.resultados.map(r => [r.item_id, r]));
      setResultados(prev => itemId ? { ...prev, ...nuevos } : nuevos);
    } catch (e) {
      fallo(`No se pudo conectar con el servidor: ${e instanceof Error ? e.message : String(e)}.${PUEDE_HABER_SALIDO}`);
    } finally {
      setMandando(null);
    }
  }

  async function mandarElPlanEntero() {
    // Cada evento invita a cinco personas, y ése es el número que nadie espera:
    // diez órdenes son cincuenta correos de golpe. «Hasta» porque la ruta
    // saltea las cerradas y las que ya pasaron, y al dueño no se lo invita a sí mismo.
    const invitados = INVITADOS_DE_UNA_OT.length;
    const invitaciones = items.length * invitados;
    const ok = await confirm({
      title: "¿Mandar el plan al calendario?",
      message:
        `Se van a mandar hasta ${invitaciones} invitaciones por correo: ` +
        `${items.length} ${items.length === 1 ? "orden" : "órdenes"} × ${invitados} invitados.\n` +
        `Las órdenes cerradas o con fecha pasada se saltean y no invitan a nadie. ` +
        `A las órdenes creadas desde el SdG, si el plan es para un día posterior a su fecha, se les corre la fecha; ` +
        `a las que entraron por el formulario no, y salen en la suya.`,
      confirmText: "Mandar",
    });
    if (ok) await mandarAlCalendario();
  }

  /**
   * Mandar una sola orden manda el mismo correo que el plan entero —a cada uno
   * de los invitados—, y un correo no se retira. Por eso pide confirmación igual
   * que el botón de arriba: era el único camino a un envío que no la tenía.
   */
  async function mandarUnItem(item: any) {
    const invitados = INVITADOS_DE_UNA_OT.length;
    const ok = await confirm({
      title: `¿Mandar la OT #${item.ot_number} al calendario?`,
      message:
        `Se van a mandar hasta ${invitados} invitaciones por correo.\n` +
        `Si la orden está cerrada o su fecha ya pasó, se saltea y no invita a nadie. ` +
        `Al dueño del evento no se lo invita a sí mismo.`,
      confirmText: "Mandar",
    });
    if (ok) await mandarAlCalendario(item.id);
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <Link href="/mantenimiento/planificacion" className="text-sm text-slate-400 hover:text-slate-700">← Planificación</Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {plan.titulo || planDate.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {planDate.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
            {plan.created_by_user ? ` · Creado por ${nombreCompleto(plan.created_by_user)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {items.length > 0 && (
            <Link href={`/mantenimiento/planificacion/${plan.id}/imprimir`} target="_blank"
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Imprimir
            </Link>
          )}
          {/* El segundo impreso, y conviene saber en qué se diferencia del de
              al lado: aquél saca una OT por página, para llevar al lado de la
              máquina; éste saca el turno entero como la tabla del papel
              `PARTE DIARIO DE MANTENIMIENTO`, que es el que se archiva. */}
          {items.length > 0 && (
            <Link href={`/mantenimiento/planificacion/${plan.id}/parte-diario`} target="_blank"
              className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Parte diario
            </Link>
          )}
          {canEdit && items.length > 0 && (
            <button onClick={mandarElPlanEntero} disabled={mandando !== null}
              className="btn-secondary disabled:opacity-50">
              {mandando === "plan"
                ? "Mandando…"
                : `Mandar al calendario (${items.length} ${items.length === 1 ? "orden" : "órdenes"})`}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowAddOT(true)}
              className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Agregar OT
            </button>
          )}
        </div>
      </div>

      {errorDelEnvio && (
        <div role="alert" className="rounded-lg px-3 py-2 text-sm"
          style={{ background: RESULTADO_META.fallo.bg, color: RESULTADO_META.fallo.color, border: `1px solid ${RESULTADO_META.fallo.borde}` }}>
          {errorDelEnvio}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <p className="text-slate-400 text-sm">Todavía no hay órdenes en este plan.</p>
          {canEdit && (
            <button onClick={() => setShowAddOT(true)}
              className="mt-3 text-blue-500 text-sm hover:underline">
              + Agregar OT
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const assignee = nombreCompleto(item.assigned_user) || item.assigned_name || null;
            const resultado = resultados[item.id];
            return (
              <div key={item.id} className="card overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-slate-400">#{item.ot_number}</span>
                      {item.especialidad && (
                        <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {item.especialidad}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-slate-900 mt-0.5 leading-snug">{item.descripcion}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{item.sector_raw}{item.equipo_raw ? ` · ${item.equipo_raw}` : ""}</p>
                    {item.repuesto && <p className="text-xs text-slate-500 mt-0.5">Repuesto: {item.repuesto}</p>}
                    {item.notas_item && <p className="text-xs text-blue-600 mt-0.5 italic">“{item.notas_item}”</p>}
                  </div>
                  <div className="shrink-0 text-right space-y-1.5">
                    {assignee ? (
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-xs font-bold text-blue-600">
                            {assignee.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}
                          </span>
                        </div>
                        <span className="text-xs font-medium text-slate-700">{assignee}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">Sin asignar</span>
                    )}
                    {canEdit && (
                      <div className="flex gap-1.5 justify-end">
                        <button onClick={() => setEditItem(item)}
                          className="text-xs text-slate-400 hover:text-blue-600 transition-colors">
                          Editar
                        </button>
                        <span className="text-slate-200">·</span>
                        <button onClick={() => removeItem(item.id)}
                          className="text-xs text-slate-400 hover:text-red-500 transition-colors">
                          Quitar
                        </button>
                      </div>
                    )}
                    {canEdit && (
                      <div className="flex justify-end">
                        <button onClick={() => mandarUnItem(item)} disabled={mandando !== null}
                          className="text-xs text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50">
                          {mandando === item.id ? "Mandando…" : "Al calendario"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {resultado && <ResultadoDelItem r={resultado} />}
              </div>
            );
          })}
        </div>
      )}

      {showAddOT && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Agregar órdenes al plan</h2>
              <button onClick={() => setShowAddOT(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <Select value={filterSector} onChange={e => setFilterSector(e.target.value)}
                  className="input flex-1 text-sm">
                  <option value="">Todos los sectores</option>
                  {sectores.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.empresas?.nombre ?? "Transversal"} · {s.nombre}</option>
                  ))}
                </Select>
                <input value={filterQ} onChange={e => setFilterQ(e.target.value)}
                  placeholder="Buscar OT..." className="input flex-1 text-sm" />
              </div>

              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-200">
                {availableOTs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-slate-400">No hay OTs pendientes con esos filtros.</div>
                ) : availableOTs.map(ot => {
                  const meta = ESTADO_META[ot.estado] ?? ESTADO_META.POR_HACER;
                  return (
                    <button key={ot.id} onClick={() => { addOT(ot); }}
                      disabled={saving}
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors flex items-start gap-3 disabled:opacity-50">
                      <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: meta.dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400">#{ot.ot_number}</span>
                          {ot.especialidad && <span className="text-xs text-slate-500">{ot.especialidad}</span>}
                          <span className="ml-auto text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-800 mt-0.5 leading-snug line-clamp-2">{ot.descripcion}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{ot.sector_raw}{ot.equipo_raw ? ` · ${ot.equipo_raw}` : ""}</p>
                      </div>
                      <svg className="w-4 h-4 text-blue-400 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <EditItemModal item={editItem} usuarios={usuarios}
          onSave={(assigned_to, assigned_name, notas_item) =>
            saveItemEdit(editItem.id, assigned_to, assigned_name, notas_item)}
          onClose={() => setEditItem(null)} />
      )}
    </div>
  );
}

/**
 * Lo que le pasó a un ítem al mandarlo. Lleva la fecha y, si el plan se la
 * corrió a la orden, lo dice: es lo que la persona no esperaba encontrar.
 */
function ResultadoDelItem({ r }: { r: ResultadoDeItem }) {
  const meta = RESULTADO_META[r.estado] ?? RESULTADO_META.fallo;
  return (
    <div role="status" className="px-4 py-2.5 text-xs space-y-1 break-words"
      style={{ background: meta.bg, color: meta.color, borderTop: `1px solid ${meta.borde}` }}>
      <p className="font-semibold">
        {meta.titulo}{r.fecha ? ` · ${comoSeLee(r.fecha)}` : ""}
        {r.fecha_corrida ? " · se le corrió la fecha a la orden" : ""}
      </p>
      {r.mensaje && <p>{r.mensaje}</p>}
      {r.advertencias.map((a, i) => <p key={i}>Ojo: {a}</p>)}
    </div>
  );
}

function EditItemModal({ item, usuarios, onSave, onClose }: {
  item: any; usuarios: any[];
  onSave: (a: string, b: string, c: string) => void;
  onClose: () => void;
}) {
  const [assignedTo, setAssignedTo]     = useState(item.assigned_to ?? "");
  const [assignedName, setAssignedName] = useState(item.assigned_name ?? "");
  const [notas, setNotas]               = useState(item.notas_item ?? "");
  const [saving, setSaving]             = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave(assignedTo, assignedName, notas);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Asignar OT #{item.ot_number}</h2>
        <p className="text-xs text-slate-500 -mt-2 leading-snug">{item.descripcion}</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">Asignar a (usuario del sistema)</label>
            <Select value={assignedTo} onChange={e => { setAssignedTo(e.target.value); if (e.target.value) setAssignedName(""); }}
              className="input w-full">
              <option value="">— Nombre libre —</option>
              {usuarios.map((u: any) => <option key={u.id} value={u.id}>{nombreCompleto(u)}</option>)}
            </Select>
          </div>
          {!assignedTo && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600">O escribir nombre</label>
              <input value={assignedName} onChange={e => setAssignedName(e.target.value)}
                placeholder="Nombre del operario" className="input w-full" />
            </div>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">Notas adicionales</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              rows={2} className="input resize-none w-full"
              placeholder="Ej: Llevar llave 32, coordinar con calcinación..." />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving}
              className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Guardar"}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
