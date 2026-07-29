"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { TIPOS_AUSENCIA, labelTipoAusencia } from "@/lib/rrhh/tiposAusencia";
import FichadaEditModal from "@/components/rrhh/FichadaEditModal";

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

function ClasificarModal({ seleccion, onClose, onSaved }: {
  seleccion: { employeeId: string; fecha: string; nombre: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState("ENFERMEDAD_ACCIDENTE_INCULPABLE");
  const [justificada, setJustificada] = useState(true);
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    await fetch("/api/rrhh/ausencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: seleccion.employeeId,
        fechaDesde: seleccion.fecha,
        fechaHasta: seleccion.fecha,
        tipo: justificada ? tipo : "INJUSTIFICADA",
        justificada,
        observaciones: observaciones || undefined,
      }),
    });
    setGuardando(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-800 mb-1">Clasificar falta</h3>
        <p className="text-sm text-gray-500 mb-4">
          {seleccion.nombre} · {new Date(`${seleccion.fecha}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
        </p>
        <label className="block text-xs text-gray-500 mb-1">¿La falta está justificada?</label>
        <div className="flex gap-2 mb-3">
          <button onClick={() => setJustificada(true)} className={`flex-1 py-1.5 rounded-md text-sm ${justificada ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>Justificada</button>
          <button onClick={() => setJustificada(false)} className={`flex-1 py-1.5 rounded-md text-sm ${!justificada ? "bg-red-600 text-white" : "bg-gray-100 text-gray-600"}`}>Injustificada</button>
        </div>
        {justificada && (
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Motivo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input">
              {TIPOS_AUSENCIA.filter(([v]) => v !== "INJUSTIFICADA").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">Observaciones {justificada && tipo === "OTRA" ? "(obligatorio: aclarar el motivo)" : ""}</label>
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="input" rows={2} />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
          <button onClick={guardar} disabled={(justificada && tipo === "OTRA" && !observaciones.trim()) || guardando} className="btn-primary disabled:opacity-50">
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AsistenciaClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState<"periodo" | "dia">(
    searchParams.get("tab") === "dia" ? "dia" : "periodo"
  );
  function setTab(t: "periodo" | "dia") {
    setTabState(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        Asistencia
        <InfoTip text="Resumen de asistencia por período o por día puntual. Acá clasificás las faltas que quedaron sin clasificar." />
      </h1>
      <div className="flex gap-2 mb-6">
        {(["periodo", "dia"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t === "periodo" ? "Por período" : "Por día"}
          </button>
        ))}
      </div>
      {tab === "periodo" ? <AsistenciaPeriodo /> : <AsistenciaDia />}
    </div>
  );
}

function AsistenciaPeriodo() {
  const [desde, setDesde] = useState(firstOfMonth());
  const [hasta, setHasta] = useState(today());
  const [resumen, setResumen] = useState<any>(null);
  const [faltas, setFaltas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState<{ employeeId: string; fecha: string; nombre: string } | null>(null);

  async function cargar() {
    setCargando(true);
    const [r, f] = await Promise.all([
      fetch(`/api/rrhh/asistencia/resumen?desde=${desde}&hasta=${hasta}`).then((r) => r.json()),
      fetch(`/api/rrhh/asistencia/faltas-sin-clasificar?desde=${desde}&hasta=${hasta}`).then((r) => r.json()),
    ]);
    setResumen(r);
    setFaltas(f);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex gap-4 items-end mb-6 card p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div className="text-sm text-gray-500 ml-auto flex items-center gap-4">
          % asistencia general: <span className="font-semibold text-gray-800">{resumen?.porcentajeGeneral ?? "-"}%</span>
          <a href={`/api/rrhh/ausencias/export?desde=${desde}&hasta=${hasta}`} className="text-blue-600 hover:underline">Exportar ausencias</a>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <h2 className="font-medium text-gray-700 mb-3">Faltas sin clasificar ({faltas.length})</h2>
        {faltas.length === 0 && <p className="text-sm text-gray-500">No hay faltas pendientes de clasificar en el período.</p>}
        {faltas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Fecha</th>
                <th className="pb-2">Empleado</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {faltas.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2">{new Date(f.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{f.empleados?.apellido}, {f.empleados?.nombre} ({f.empleados?.legajo})</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => setSeleccion({ employeeId: f.empleado_id, fecha: f.fecha.slice(0, 10), nombre: `${f.empleados?.apellido}, ${f.empleados?.nombre}` })}
                      className="text-gray-700 underline text-sm"
                    >
                      Clasificar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3">Asistencia por empleado</h2>
        {cargando ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Legajo</th>
                <th className="pb-2">Nombre</th>
                <th className="pb-2">Días esperados</th>
                <th className="pb-2">Presentes</th>
                <th className="pb-2">Justificadas</th>
                <th className="pb-2">Injustificadas</th>
                <th className="pb-2">Sin clasificar</th>
                <th className="pb-2">% Asistencia</th>
              </tr>
            </thead>
            <tbody>
              {(resumen?.empleados ?? []).map((e: any) => (
                <tr key={e.employeeId} className="border-b last:border-0">
                  <td className="py-2">{e.legajo}</td>
                  <td className="py-2">{e.nombre}</td>
                  <td className="py-2">{e.diasEsperados}</td>
                  <td className="py-2">{e.presentes}</td>
                  <td className="py-2">{e.ausenciasJustificadas}</td>
                  <td className="py-2 text-red-600">{e.ausenciasInjustificadas}</td>
                  <td className="py-2 text-amber-600">{e.ausenciasSinClasificar}</td>
                  <td className="py-2 font-medium">{e.porcentajeAsistencia}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {seleccion && <ClasificarModal seleccion={seleccion} onClose={() => setSeleccion(null)} onSaved={cargar} />}
    </div>
  );
}

function AsistenciaDia() {
  const [dia, setDia] = useState(today());
  const [roster, setRoster] = useState<{ empleados: any[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [seleccion, setSeleccion] = useState<{ employeeId: string; fecha: string; nombre: string } | null>(null);
  const [empleadoEnEdicion, setEmpleadoEnEdicion] = useState<any | null>(null);

  async function cargar() {
    setCargando(true);
    const data = await fetch(`/api/rrhh/asistencia/dia?fecha=${dia}`).then((r) => r.json());
    setRoster(data);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, [dia]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex gap-4 items-end mb-6 card p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Día</label>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3">
          Quién faltó el {new Date(`${dia}T00:00:00`).toLocaleDateString("es-AR", { timeZone: "UTC" })}
        </h2>
        {cargando ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Legajo</th>
                <th className="pb-2">Nombre</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2">Horas trabajadas</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {(roster?.empleados ?? []).map((e) => (
                <tr key={e.employeeId} className="border-b last:border-0">
                  <td className="py-2">{e.legajo}</td>
                  <td className="py-2">{e.nombre}</td>
                  <td className="py-2">
                    {!e.ausente ? (
                      <span className="text-green-700">Presente</span>
                    ) : e.justificada === true ? (
                      <span className="text-gray-600">Ausente · {labelTipoAusencia(e.tipoAusencia ?? "")}</span>
                    ) : e.justificada === false ? (
                      <span className="text-red-600">Ausente injustificado</span>
                    ) : (
                      <span className="text-amber-600">Ausente sin clasificar</span>
                    )}
                  </td>
                  <td className="py-2">{Number(e.horasTrabajadas).toFixed(1)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEmpleadoEnEdicion(e)} className="text-gray-500 hover:text-blue-600 text-xs underline mr-3">Corregir</button>
                    {e.ausente && e.justificada === null && (
                      <button onClick={() => setSeleccion({ employeeId: e.employeeId, fecha: dia, nombre: e.nombre })} className="text-gray-700 underline text-sm">
                        Clasificar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {seleccion && <ClasificarModal seleccion={seleccion} onClose={() => setSeleccion(null)} onSaved={cargar} />}

      {empleadoEnEdicion && (
        <FichadaEditModal
          employeeId={empleadoEnEdicion.employeeId}
          empleadoNombre={empleadoEnEdicion.nombre}
          fecha={dia}
          fichadas={empleadoEnEdicion.fichadas.map((f: any) => ({ id: f.id, hora_entrada: f.hora_entrada, hora_salida: f.hora_salida }))}
          horasNormales={Number(empleadoEnEdicion.horasNormales)}
          horasExtra50={Number(empleadoEnEdicion.horasExtra50)}
          horasExtra100={Number(empleadoEnEdicion.horasExtra100)}
          horasManual={empleadoEnEdicion.horasManual}
          onClose={() => setEmpleadoEnEdicion(null)}
          onSaved={cargar}
        />
      )}
    </div>
  );
}
