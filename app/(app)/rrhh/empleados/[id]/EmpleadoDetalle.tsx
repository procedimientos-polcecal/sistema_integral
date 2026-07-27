"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TIPOS_AUSENCIA, labelTipoAusencia } from "@/lib/rrhh/tiposAusencia";
import FichadaEditModal from "@/components/rrhh/FichadaEditModal";
import { useConfirm } from "@/components/ConfirmProvider";

const tabs = ["fichadas", "ausencias", "vacaciones", "francos"] as const;
type Tab = (typeof tabs)[number];

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function formatHora(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires",
  });
}

export default function EmpleadoDetalle({ empleado, empresas, sectores, canEdit }: {
  empleado: any;
  empresas: any[];
  sectores: any[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [tab, setTab] = useState<Tab>("fichadas");
  const [editando, setEditando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());

  const [dias, setDias] = useState<any[] | null>(null);
  const [cargandoDias, setCargandoDias] = useState(false);
  const [ausencias, setAusencias] = useState<any[] | null>(null);
  const [vacaciones, setVacaciones] = useState<any | null>(null);
  const [francos, setFrancos] = useState<any[] | null>(null);

  useEffect(() => {
    if (tab !== "fichadas" && tab !== "ausencias") return;
    setCargandoDias(true);
    fetch(`/api/rrhh/asistencia/empleado/${empleado.id}?desde=${desde}&hasta=${hasta}`)
      .then((r) => r.json())
      .then((d) => setDias(d))
      .finally(() => setCargandoDias(false));
  }, [tab, desde, hasta, empleado.id]);

  useEffect(() => {
    if (tab !== "ausencias") return;
    fetch(`/api/rrhh/ausencias?employeeId=${empleado.id}`).then((r) => r.json()).then(setAusencias);
  }, [tab, empleado.id]);

  useEffect(() => {
    if (tab !== "vacaciones") return;
    fetch(`/api/rrhh/vacaciones/${empleado.id}/balance`).then((r) => r.json()).then(setVacaciones);
  }, [tab, empleado.id]);

  useEffect(() => {
    if (tab !== "francos") return;
    fetch(`/api/rrhh/francos?employeeId=${empleado.id}`).then((r) => r.json()).then(setFrancos);
  }, [tab, empleado.id]);

  const [validando, setValidando] = useState<string | null>(null);
  async function validar(fecha: string) {
    setValidando(fecha);
    await fetch("/api/rrhh/asistencia/validar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: empleado.id, fecha }),
    });
    setValidando(null);
    fetch(`/api/rrhh/asistencia/empleado/${empleado.id}?desde=${desde}&hasta=${hasta}`).then((r) => r.json()).then(setDias);
  }

  const [diaEnEdicion, setDiaEnEdicion] = useState<any | null>(null);

  // --- edición de datos del empleado ---
  const [form, setForm] = useState({
    nombre: empleado.nombre,
    apellido: empleado.apellido,
    sindicato: empleado.rrhh_empleados_datos?.sindicato ?? "",
    fechaIngreso: empleado.fecha_ingreso.slice(0, 10),
    valorHoraNormal: String(empleado.valor_hora_normal),
    horasTeoricasDiarias: String(empleado.horas_teoricas_diarias),
    empresaId: empleado.empresa_id ?? "",
    sectorId: empleado.sector_id ?? "",
  });
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoEdicion(true);
    await fetch(`/api/rrhh/empleados/${empleado.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        sindicato: form.sindicato || null,
        valorHoraNormal: Number(form.valorHoraNormal),
        horasTeoricasDiarias: Number(form.horasTeoricasDiarias),
        sectorId: form.sectorId || null,
      }),
    });
    setGuardandoEdicion(false);
    setEditando(false);
    router.refresh();
  }

  async function toggleActivo() {
    await fetch(`/api/rrhh/empleados/${empleado.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !empleado.activo }),
    });
    router.refresh();
  }

  async function eliminar() {
    const res = await fetch(`/api/rrhh/empleados/${empleado.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setErrorEliminar(data.error ?? "No se pudo eliminar el empleado");
      return;
    }
    router.push("/rrhh/empleados");
  }

  // --- ausencias ---
  const [nuevaAusencia, setNuevaAusencia] = useState({
    fechaDesde: "", fechaHasta: "", tipo: "PERMISO_PERSONAL", justificada: true, observaciones: "",
  });
  const [editandoAusenciaId, setEditandoAusenciaId] = useState<string | null>(null);
  const [guardandoAusencia, setGuardandoAusencia] = useState(false);
  function cancelarEdicionAusencia() {
    setEditandoAusenciaId(null);
    setNuevaAusencia({ fechaDesde: "", fechaHasta: "", tipo: "PERMISO_PERSONAL", justificada: true, observaciones: "" });
  }
  async function refrescarAusencias() {
    const data = await fetch(`/api/rrhh/ausencias?employeeId=${empleado.id}`).then((r) => r.json());
    setAusencias(data);
    fetch(`/api/rrhh/asistencia/empleado/${empleado.id}?desde=${desde}&hasta=${hasta}`).then((r) => r.json()).then(setDias);
  }
  async function crearAusencia(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoAusencia(true);
    const data = {
      employeeId: empleado.id,
      fechaDesde: nuevaAusencia.fechaDesde,
      fechaHasta: nuevaAusencia.fechaHasta || nuevaAusencia.fechaDesde,
      tipo: nuevaAusencia.justificada ? nuevaAusencia.tipo : "INJUSTIFICADA",
      justificada: nuevaAusencia.justificada,
      observaciones: nuevaAusencia.observaciones || undefined,
    };
    await fetch(editandoAusenciaId ? `/api/rrhh/ausencias/${editandoAusenciaId}` : "/api/rrhh/ausencias", {
      method: editandoAusenciaId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setGuardandoAusencia(false);
    cancelarEdicionAusencia();
    refrescarAusencias();
  }
  async function eliminarAusencia(id: string) {
    await fetch(`/api/rrhh/ausencias/${id}`, { method: "DELETE" });
    refrescarAusencias();
  }

  // --- falta sin clasificar ---
  const [faltaEnEdicion, setFaltaEnEdicion] = useState<string | null>(null);
  const [claseFalta, setClaseFalta] = useState({ tipo: "PERMISO_PERSONAL", justificada: true, observaciones: "" });
  const [clasificando, setClasificando] = useState(false);
  async function clasificarFalta() {
    setClasificando(true);
    await fetch("/api/rrhh/ausencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: empleado.id,
        fechaDesde: faltaEnEdicion,
        fechaHasta: faltaEnEdicion,
        tipo: claseFalta.justificada ? claseFalta.tipo : "INJUSTIFICADA",
        justificada: claseFalta.justificada,
        observaciones: claseFalta.observaciones || undefined,
      }),
    });
    setClasificando(false);
    setFaltaEnEdicion(null);
    setClaseFalta({ tipo: "PERMISO_PERSONAL", justificada: true, observaciones: "" });
    refrescarAusencias();
  }

  // --- vacaciones ---
  const [nuevaVacacion, setNuevaVacacion] = useState({ fechaDesde: "", fechaHasta: "", diasTomados: "" });
  const [editandoVacacionId, setEditandoVacacionId] = useState<string | null>(null);
  const [guardandoVacacion, setGuardandoVacacion] = useState(false);
  function cancelarEdicionVacacion() {
    setEditandoVacacionId(null);
    setNuevaVacacion({ fechaDesde: "", fechaHasta: "", diasTomados: "" });
  }
  async function refrescarVacaciones() {
    const data = await fetch(`/api/rrhh/vacaciones/${empleado.id}/balance`).then((r) => r.json());
    setVacaciones(data);
  }
  async function guardarVacacion(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoVacacion(true);
    const data = {
      employeeId: empleado.id,
      anioCorrespondiente: vacaciones?.anio ?? new Date().getFullYear(),
      fechaDesde: nuevaVacacion.fechaDesde,
      fechaHasta: nuevaVacacion.fechaHasta,
      diasTomados: Number(nuevaVacacion.diasTomados),
    };
    await fetch(editandoVacacionId ? `/api/rrhh/vacaciones/${editandoVacacionId}` : "/api/rrhh/vacaciones", {
      method: editandoVacacionId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setGuardandoVacacion(false);
    cancelarEdicionVacacion();
    refrescarVacaciones();
  }
  async function eliminarVacacion(id: string) {
    await fetch(`/api/rrhh/vacaciones/${id}`, { method: "DELETE" });
    refrescarVacaciones();
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">
          {empleado.apellido}, {empleado.nombre}
          {!empleado.activo && <span className="ml-2 text-sm font-normal text-red-600">(inactivo)</span>}
        </h1>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => setEditando((v) => !v)} className="bg-white border border-gray-300 text-gray-700 text-sm px-3 py-1.5 rounded-md hover:bg-gray-50">
              {editando ? "Cancelar" : "Editar"}
            </button>
            <button onClick={toggleActivo} className="bg-white border border-gray-300 text-gray-700 text-sm px-3 py-1.5 rounded-md hover:bg-gray-50">
              {empleado.activo ? "Dar de baja" : "Reactivar"}
            </button>
            <button
              onClick={async () => {
                setErrorEliminar(null);
                const ok = await confirmar({
                  title: "Eliminar empleado",
                  message: `¿Eliminar definitivamente a ${empleado.apellido}, ${empleado.nombre}? Esta acción no se puede deshacer. Si tiene fichadas o liquidaciones asociadas no se podrá borrar; en ese caso, dalo de baja.`,
                  confirmText: "Eliminar",
                  danger: true,
                });
                if (ok) eliminar();
              }}
              className="bg-white border border-red-300 text-red-600 text-sm px-3 py-1.5 rounded-md hover:bg-red-50"
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
      <p className="text-gray-500 mb-4">
        Legajo {empleado.legajo} · {empleado.empresas?.nombre ?? "Sin empresa"} · {empleado.sectores?.nombre ?? "Sin sector"}
        {empleado.rrhh_empleados_datos?.sindicato ? ` · ${empleado.rrhh_empleados_datos.sindicato}` : ""} · $
        {Number(empleado.valor_hora_normal).toLocaleString("es-AR")}/hora · {empleado.horas_teoricas_diarias}hs teóricas/día
      </p>
      {errorEliminar && <p className="text-sm text-red-600 mb-4">{errorEliminar}</p>}

      {editando && (
        <form onSubmit={guardarEdicion} className="card p-5 mb-6 grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Nombre</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Apellido</label>
            <input required value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Sindicato</label>
            <input value={form.sindicato} onChange={(e) => setForm({ ...form, sindicato: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Fecha de ingreso</label>
            <input type="date" required value={form.fechaIngreso} onChange={(e) => setForm({ ...form, fechaIngreso: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Valor hora normal ($)</label>
            <input type="number" step="0.01" required value={form.valorHoraNormal} onChange={(e) => setForm({ ...form, valorHoraNormal: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Horas teóricas diarias</label>
            <input type="number" step="0.5" required value={form.horasTeoricasDiarias} onChange={(e) => setForm({ ...form, horasTeoricasDiarias: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Empresa</label>
            <select required value={form.empresaId} onChange={(e) => setForm({ ...form, empresaId: e.target.value })} className="input">
              <option value="">Seleccionar...</option>
              {empresas.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Sector</label>
            <select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })} className="input">
              <option value="">Sin asignar</option>
              {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <button type="submit" disabled={guardandoEdicion} className="btn-primary disabled:opacity-50">
              {guardandoEdicion ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 mb-4">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm capitalize ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="card p-5">
        {tab === "fichadas" && (
          <div>
            <div className="flex gap-3 items-end mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Desde</label>
                <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </div>
            {cargandoDias ? (
              <p className="text-gray-500 text-sm">Cargando...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="pb-2">Fecha</th>
                    <th className="pb-2">Marcaciones</th>
                    <th className="pb-2">Hs. trabajadas</th>
                    <th className="pb-2">Extra 50%</th>
                    <th className="pb-2">Extra 100%</th>
                    <th className="pb-2">Día</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(dias ?? [])
                    .filter((d) => d.fichadas.length > 0 || Number(d.horas_normales) + Number(d.horas_extra_50) + Number(d.horas_extra_100) > 0)
                    .map((d) => {
                      const horasTrabajadas = Number(d.horas_normales) + Number(d.horas_extra_50) + Number(d.horas_extra_100);
                      const tieneExtras = Number(d.horas_extra_50) > 0 || Number(d.horas_extra_100) > 0;
                      const esDomingoOFeriado = d.tipo_dia === "DOMINGO" || d.tipo_dia === "FERIADO";
                      return (
                        <tr key={d.fecha} className="border-b last:border-0">
                          <td className="py-2">{new Date(d.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                          <td className="py-2">
                            {d.fichadas.map((f: any, i: number) => (
                              <span key={f.id} className="mr-2 whitespace-nowrap">
                                {formatHora(f.hora_entrada)}-{f.hora_salida ? formatHora(f.hora_salida) : "?"}
                                {i < d.fichadas.length - 1 ? "," : ""}
                              </span>
                            ))}
                            {d.tarde && <span className="ml-1 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded whitespace-nowrap">Tardanza</span>}
                            {d.retiro_anticipado && <span className="ml-1 text-[10px] font-medium text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded whitespace-nowrap">Retiro anticipado</span>}
                          </td>
                          <td className="py-2">
                            {horasTrabajadas.toFixed(1)}
                            {d.horas_manual && <span className="ml-1 text-[10px] text-amber-700 align-middle">(manual)</span>}
                          </td>
                          <td className="py-2">{Number(d.horas_extra_50) > 0 ? Number(d.horas_extra_50).toFixed(1) : "-"}</td>
                          <td className="py-2">{Number(d.horas_extra_100) > 0 ? Number(d.horas_extra_100).toFixed(1) : "-"}</td>
                          <td className="py-2">
                            {esDomingoOFeriado ? (
                              <span className="text-amber-700">{d.tipo_dia === "DOMINGO" ? "Domingo" : "Feriado"} ({horasTrabajadas.toFixed(1)}hs)</span>
                            ) : d.tipo_dia}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <button onClick={() => setDiaEnEdicion(d)} className="text-gray-500 hover:text-blue-600 text-xs underline mr-3">Corregir</button>
                            {tieneExtras && (
                              d.extras_validadas ? (
                                <span className="text-green-700 text-xs">✓ Validado</span>
                              ) : (
                                <button onClick={() => validar(d.fecha)} disabled={validando === d.fecha}
                                  className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded-md hover:bg-gray-700 disabled:opacity-50">
                                  Validar
                                </button>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "ausencias" && (
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              {editandoAusenciaId ? "Editar ausencia / incidencia" : "Registrar ausencia / incidencia"}
            </h3>
            <form onSubmit={crearAusencia} className="grid grid-cols-2 gap-3 mb-6">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Desde</label>
                <input type="date" required value={nuevaAusencia.fechaDesde} onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, fechaDesde: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                <input type="date" value={nuevaAusencia.fechaHasta} onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, fechaHasta: e.target.value })} placeholder="igual que Desde" className="input" />
              </div>
              <div className="col-span-2 flex gap-2">
                <button type="button" onClick={() => setNuevaAusencia({ ...nuevaAusencia, justificada: true })}
                  className={`flex-1 py-1.5 rounded-md text-sm ${nuevaAusencia.justificada ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                  Justificada
                </button>
                <button type="button" onClick={() => setNuevaAusencia({ ...nuevaAusencia, justificada: false })}
                  className={`flex-1 py-1.5 rounded-md text-sm ${!nuevaAusencia.justificada ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                  Injustificada
                </button>
              </div>
              {nuevaAusencia.justificada && (
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Motivo</label>
                  <select value={nuevaAusencia.tipo} onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, tipo: e.target.value })} className="input">
                    {TIPOS_AUSENCIA.filter(([v]) => v !== "INJUSTIFICADA").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">
                  Observaciones {nuevaAusencia.justificada && nuevaAusencia.tipo === "OTRA" ? "(obligatorio: aclarar el motivo)" : ""}
                </label>
                <textarea value={nuevaAusencia.observaciones} onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, observaciones: e.target.value })} className="input" rows={2} />
              </div>
              <div className="col-span-2 flex gap-2">
                <button type="submit"
                  disabled={(nuevaAusencia.justificada && nuevaAusencia.tipo === "OTRA" && !nuevaAusencia.observaciones.trim()) || guardandoAusencia}
                  className="btn-primary disabled:opacity-50">
                  {guardandoAusencia ? "Guardando..." : editandoAusenciaId ? "Guardar cambios" : "Registrar"}
                </button>
                {editandoAusenciaId && <button type="button" onClick={cancelarEdicionAusencia} className="text-sm text-gray-600 px-4 py-2">Cancelar edición</button>}
              </div>
            </form>

            <h3 className="text-sm font-medium text-gray-700 mb-1">Días sin fichada</h3>
            <p className="text-xs text-gray-500 mb-3">
              Días detectados como falta (sin marcación) entre el {new Date(`${desde}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })} y el {new Date(`${hasta}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })} (mismo rango que la pestaña Fichadas), estén o no clasificados todavía.
            </p>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Fecha</th>
                  <th className="pb-2">Estado</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(dias ?? []).filter((d) => d.ausente).length === 0 && (
                  <tr><td colSpan={3} className="py-3 text-center text-gray-400">Sin faltas en el período.</td></tr>
                )}
                {(dias ?? []).filter((d) => d.ausente).map((d) => (
                  <tr key={d.fecha} className="border-b last:border-0">
                    <td className="py-2">{new Date(d.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">
                      {d.justificada === null ? (
                        <span className="text-amber-600">Sin clasificar</span>
                      ) : d.justificada ? (
                        <span className="text-green-700">Justificada — {labelTipoAusencia(d.tipo_ausencia ?? "OTRA")}</span>
                      ) : (
                        <span className="text-red-600">Injustificada</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {d.justificada === null && (
                        <button onClick={() => { setFaltaEnEdicion(d.fecha.slice(0, 10)); setClaseFalta({ tipo: "PERMISO_PERSONAL", justificada: true, observaciones: "" }); }}
                          className="text-gray-700 underline text-xs">
                          Clasificar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="text-sm font-medium text-gray-700 mb-2">Ausencias registradas</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Desde</th>
                  <th className="pb-2">Hasta</th>
                  <th className="pb-2">Tipo</th>
                  <th className="pb-2">Justificada</th>
                  <th className="pb-2">Observaciones</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(ausencias ?? []).map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(a.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{new Date(a.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{labelTipoAusencia(a.tipo)}</td>
                    <td className="py-2">{a.justificada ? "Sí" : "No"}</td>
                    <td className="py-2">{a.observaciones ?? "-"}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => {
                          setEditandoAusenciaId(a.id);
                          setNuevaAusencia({
                            fechaDesde: a.fecha_desde.slice(0, 10),
                            fechaHasta: a.fecha_hasta.slice(0, 10),
                            tipo: a.tipo,
                            justificada: a.justificada,
                            observaciones: a.observaciones ?? "",
                          });
                        }}
                        className="text-gray-700 underline text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await confirmar({
                            title: "Eliminar ausencia",
                            message: `¿Eliminar esta ausencia (${new Date(a.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })} - ${new Date(a.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })})? Esta acción no se puede deshacer.`,
                            confirmText: "Eliminar",
                            danger: true,
                          });
                          if (ok) eliminarAusencia(a.id);
                        }}
                        className="text-red-600 underline text-xs ml-3"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "vacaciones" && vacaciones && (
          <div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <div className="text-sm text-gray-500">Días correspondientes</div>
                <div className="text-2xl font-semibold">{vacaciones.correspondientes}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Días tomados</div>
                <div className="text-2xl font-semibold">{vacaciones.tomados}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Días restantes</div>
                <div className="text-2xl font-semibold text-blue-600">{vacaciones.restantes}</div>
              </div>
            </div>

            <h3 className="text-sm font-medium text-gray-700 mb-2">
              {editandoVacacionId ? "Editar período de vacaciones" : "Cargar período tomado"}
            </h3>
            <form onSubmit={guardarVacacion} className="flex gap-3 items-end mb-6">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Desde</label>
                <input type="date" required value={nuevaVacacion.fechaDesde} onChange={(e) => setNuevaVacacion({ ...nuevaVacacion, fechaDesde: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hasta</label>
                <input type="date" required value={nuevaVacacion.fechaHasta} onChange={(e) => setNuevaVacacion({ ...nuevaVacacion, fechaHasta: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Días</label>
                <input type="number" required min={1} value={nuevaVacacion.diasTomados} onChange={(e) => setNuevaVacacion({ ...nuevaVacacion, diasTomados: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-20" />
              </div>
              <button type="submit" disabled={guardandoVacacion} className="btn-primary disabled:opacity-50">
                {guardandoVacacion ? "Guardando..." : editandoVacacionId ? "Guardar cambios" : "Guardar"}
              </button>
              {editandoVacacionId && <button type="button" onClick={cancelarEdicionVacacion} className="text-sm text-gray-600 px-2 py-2">Cancelar edición</button>}
            </form>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Desde</th>
                  <th className="pb-2">Hasta</th>
                  <th className="pb-2">Días</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {vacaciones.periodos.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(p.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{new Date(p.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                    <td className="py-2">{p.dias_tomados}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => {
                          setEditandoVacacionId(p.id);
                          setNuevaVacacion({ fechaDesde: p.fecha_desde.slice(0, 10), fechaHasta: p.fecha_hasta.slice(0, 10), diasTomados: String(p.dias_tomados) });
                        }}
                        className="text-gray-700 underline text-xs"
                      >
                        Editar
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await confirmar({
                            title: "Eliminar período de vacaciones",
                            message: `¿Eliminar este período (${new Date(p.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })} - ${new Date(p.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })})? Esta acción no se puede deshacer.`,
                            confirmText: "Eliminar",
                            danger: true,
                          });
                          if (ok) eliminarVacacion(p.id);
                        }}
                        className="text-red-600 underline text-xs ml-3"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "francos" && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Generado</th>
                <th className="pb-2">Horas</th>
                <th className="pb-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {(francos ?? []).map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2">{new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{f.horas}</td>
                  <td className="py-2">{f.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {diaEnEdicion && (
        <FichadaEditModal
          employeeId={empleado.id}
          empleadoNombre={`${empleado.apellido}, ${empleado.nombre}`}
          fecha={diaEnEdicion.fecha.slice(0, 10)}
          fichadas={diaEnEdicion.fichadas}
          horasNormales={Number(diaEnEdicion.horas_normales)}
          horasExtra50={Number(diaEnEdicion.horas_extra_50)}
          horasExtra100={Number(diaEnEdicion.horas_extra_100)}
          horasManual={diaEnEdicion.horas_manual}
          onClose={() => setDiaEnEdicion(null)}
          onSaved={() => fetch(`/api/rrhh/asistencia/empleado/${empleado.id}?desde=${desde}&hasta=${hasta}`).then((r) => r.json()).then(setDias)}
        />
      )}

      {faltaEnEdicion && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setFaltaEnEdicion(null)}>
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium text-gray-800 mb-1">Clasificar falta</h3>
            <p className="text-sm text-gray-500 mb-4">
              {empleado.apellido}, {empleado.nombre} · {new Date(`${faltaEnEdicion}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
            </p>
            <label className="block text-xs text-gray-500 mb-1">¿La falta está justificada?</label>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setClaseFalta({ ...claseFalta, justificada: true })}
                className={`flex-1 py-1.5 rounded-md text-sm ${claseFalta.justificada ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>
                Justificada
              </button>
              <button onClick={() => setClaseFalta({ ...claseFalta, justificada: false })}
                className={`flex-1 py-1.5 rounded-md text-sm ${!claseFalta.justificada ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>
                Injustificada
              </button>
            </div>
            {claseFalta.justificada && (
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">Motivo</label>
                <select value={claseFalta.tipo} onChange={(e) => setClaseFalta({ ...claseFalta, tipo: e.target.value })} className="input">
                  {TIPOS_AUSENCIA.filter(([v]) => v !== "INJUSTIFICADA").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}
            <div className="mb-4">
              <label className="block text-xs text-gray-500 mb-1">
                Observaciones {claseFalta.justificada && claseFalta.tipo === "OTRA" ? "(obligatorio: aclarar el motivo)" : ""}
              </label>
              <textarea value={claseFalta.observaciones} onChange={(e) => setClaseFalta({ ...claseFalta, observaciones: e.target.value })} className="input" rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFaltaEnEdicion(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button
                onClick={clasificarFalta}
                disabled={(claseFalta.justificada && claseFalta.tipo === "OTRA" && !claseFalta.observaciones.trim()) || clasificando}
                className="btn-primary disabled:opacity-50"
              >
                {clasificando ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
