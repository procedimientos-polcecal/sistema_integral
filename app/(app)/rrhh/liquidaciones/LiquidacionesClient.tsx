"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

interface FilaPlanilla {
  empleadoId: string;
  nombre: string;
  legajo: string;
  modalidadPago: "JORNAL" | "MENSUAL";
  horasNormales: number;
  horasExtra50: number;
  horasExtra100: number;
  horasFranco: number;
  horasVacaciones: number;
  horasEnfermedad: number;
  montoNormal: number;
  montoExtra50: number;
  montoExtra100: number;
  montoFranco: number;
  montoTotal: number;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function LiquidacionesClient({ empleados }: { empleados: any[] }) {
  const confirmar = useConfirm();
  const [liquidaciones, setLiquidaciones] = useState<any[] | null>(null);

  async function cargar() {
    const data = await fetch("/api/rrhh/liquidaciones").then((r) => r.json());
    setLiquidaciones(data);
  }
  useEffect(() => { cargar(); }, []);

  const [form, setForm] = useState({
    employeeId: "",
    tipo: "QUINCENAL",
    fechaDesde: firstOfMonth(),
    fechaHasta: today(),
  });
  const [generando, setGenerando] = useState(false);
  const [errorGenerar, setErrorGenerar] = useState(false);
  const [avisoSinValidar, setAvisoSinValidar] = useState<string | null>(null);

  async function onGenerar(e: React.FormEvent) {
    e.preventDefault();
    const emp = empleados.find((x) => x.id === form.employeeId);
    const ok = await confirmar({
      title: "Generar liquidación",
      message: `Se va a generar la liquidación ${form.tipo.toLowerCase()} de ${
        emp ? `${emp.apellido}, ${emp.nombre}` : "el empleado"
      } para el período ${form.fechaDesde} a ${form.fechaHasta}. ¿Confirmás?`,
      confirmText: "Generar",
    });
    if (!ok) return;

    setGenerando(true);
    setErrorGenerar(false);
    const res = await fetch("/api/rrhh/liquidaciones/generar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      setErrorGenerar(true);
    } else {
      const data = await res.json();
      if (data.diasSinValidarCount > 0) {
        setAvisoSinValidar(
          `Ojo: quedaron ${data.horasExtra50SinValidar.toFixed(1)}hs extra 50% y ${data.horasExtra100SinValidar.toFixed(
            1
          )}hs extra 100% sin validar en ${data.diasSinValidarCount} día(s) — no se incluyeron en esta liquidación. Validalas desde la ficha del empleado y generá la liquidación de nuevo si corresponde.`
        );
      } else {
        setAvisoSinValidar(null);
      }
      cargar();
    }
    setGenerando(false);
  }

  async function eliminar(l: any) {
    const periodo = `${new Date(l.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })} - ${new Date(l.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}`;
    const ok = await confirmar({
      title: "Eliminar liquidación",
      message: `¿Eliminar la liquidación de ${l.empleados?.apellido}, ${l.empleados?.nombre} (${l.tipo.toLowerCase()}, ${periodo})? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/rrhh/liquidaciones/${l.id}`, { method: "DELETE" });
    cargar();
  }

  async function cerrar(l: any) {
    const ok = await confirmar({
      title: "Cerrar liquidación",
      message: "Una vez cerrada, la liquidación queda marcada como definitiva. ¿Confirmás?",
      confirmText: "Cerrar",
    });
    if (!ok) return;
    await fetch(`/api/rrhh/liquidaciones/${l.id}/cerrar`, { method: "PUT" });
    cargar();
  }

  const [planilla, setPlanilla] = useState({ fechaDesde: firstOfMonth(), fechaHasta: today() });
  const [modalidadPlanilla, setModalidadPlanilla] = useState("");
  const [filasPlanilla, setFilasPlanilla] = useState<FilaPlanilla[] | null>(null);
  const [calculandoPlanilla, setCalculandoPlanilla] = useState(false);
  const [errorPlanilla, setErrorPlanilla] = useState(false);

  function qsPlanilla() {
    const qs = new URLSearchParams({ desde: planilla.fechaDesde, hasta: planilla.fechaHasta });
    if (modalidadPlanilla) qs.set("modalidadPago", modalidadPlanilla);
    return qs.toString();
  }

  async function verPlanilla() {
    setCalculandoPlanilla(true);
    setErrorPlanilla(false);
    const res = await fetch(`/api/rrhh/liquidaciones/planilla?${qsPlanilla()}`);
    if (!res.ok) {
      setErrorPlanilla(true);
      setFilasPlanilla(null);
    } else {
      setFilasPlanilla(await res.json());
    }
    setCalculandoPlanilla(false);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">Liquidaciones</h1>

      <div className="card p-5 mb-6">
        <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          Generar liquidación
          <InfoTip text="Calcula el sueldo de un empleado para el período elegido: horas normales, extra 50% y 100%. Solo se incluyen las horas extra ya validadas desde la ficha del empleado." />
        </h2>
        <form onSubmit={onGenerar} className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Empleado</label>
            <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm min-w-[200px]">
              <option value="">Seleccionar...</option>
              {empleados.map((e) => <option key={e.id} value={e.id}>{e.legajo} - {e.apellido}, {e.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              Tipo
              <InfoTip text="Quincenal: del 1 al 15, o del 16 a fin de mes. Mensual: el mes completo. Define qué período abarca la liquidación." />
            </label>
            <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              <option value="QUINCENAL">Quincenal</option>
              <option value="MENSUAL">Mensual</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={form.fechaDesde} onChange={(e) => setForm({ ...form, fechaDesde: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={form.fechaHasta} onChange={(e) => setForm({ ...form, fechaHasta: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" disabled={generando} className="btn-primary disabled:opacity-50">
            {generando ? "Generando..." : "Generar"}
          </button>
        </form>
        {errorGenerar && <p className="text-red-600 text-sm mt-2">No se pudo generar la liquidación</p>}
        {avisoSinValidar && <p className="text-amber-600 text-sm mt-2">{avisoSinValidar}</p>}
      </div>

      <div className="card p-5 mb-6">
        <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          Planilla general (todo el personal)
          <InfoTip text="Resumen de horas y montos de TODO el personal para el período elegido, sin generar liquidaciones individuales. Incluye las horas de vacaciones y de enfermedad, que no salen del cálculo diario. Se puede ver en pantalla o bajar en Excel." />
        </h2>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={planilla.fechaDesde} onChange={(e) => setPlanilla({ ...planilla, fechaDesde: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={planilla.fechaHasta} onChange={(e) => setPlanilla({ ...planilla, fechaHasta: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Modalidad</label>
            <select value={modalidadPlanilla} onChange={(e) => setModalidadPlanilla(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="JORNAL">Jornal</option>
              <option value="MENSUAL">Mensual</option>
            </select>
          </div>
          <button onClick={verPlanilla} disabled={calculandoPlanilla} className="btn-primary disabled:opacity-50">
            {calculandoPlanilla ? "Calculando..." : "Ver planilla"}
          </button>
          <a href={`/api/rrhh/liquidaciones/export-planilla?${qsPlanilla()}`}
            className="bg-white border border-gray-300 text-gray-700 text-sm px-4 py-2 rounded-md hover:bg-gray-50 inline-block">
            Exportar a Excel
          </a>
        </div>

        {errorPlanilla && <p className="text-red-600 text-sm mt-2">No se pudo calcular la planilla</p>}

        {filasPlanilla && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-3">Empleado</th>
                  <th className="pb-2 pr-3">Legajo</th>
                  <th className="pb-2 pr-3">Tipo</th>
                  <th className="pb-2 pr-3">Hs. normales</th>
                  <th className="pb-2 pr-3">Hs. extra 50%</th>
                  <th className="pb-2 pr-3">Hs. extra 100%</th>
                  <th className="pb-2 pr-3">Franco comp.</th>
                  <th className="pb-2 pr-3">Hs. vacaciones</th>
                  <th className="pb-2 pr-3">Hs. enfermedad</th>
                  <th className="pb-2">Total $</th>
                </tr>
              </thead>
              <tbody>
                {filasPlanilla.length === 0 && (
                  <tr><td colSpan={10} className="py-3 text-center text-gray-400">No hay empleados activos.</td></tr>
                )}
                {filasPlanilla.map((f) => (
                  <tr key={f.empleadoId} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{f.nombre}</td>
                    <td className="py-2 pr-3">{f.legajo}</td>
                    <td className="py-2 pr-3">{f.modalidadPago === "MENSUAL" ? "Mensual" : "Jornal"}</td>
                    <td className="py-2 pr-3">{f.horasNormales.toFixed(1)}</td>
                    <td className="py-2 pr-3">{f.horasExtra50.toFixed(1)}</td>
                    <td className="py-2 pr-3">{f.horasExtra100.toFixed(1)}</td>
                    <td className="py-2 pr-3">{f.horasFranco.toFixed(1)}</td>
                    <td className="py-2 pr-3">{f.horasVacaciones.toFixed(1)}</td>
                    <td className="py-2 pr-3">{f.horasEnfermedad.toFixed(1)}</td>
                    <td className="py-2 font-medium">${f.montoTotal.toLocaleString("es-AR", { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5">
        {!liquidaciones ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Empleado</th>
                <th className="pb-2">Tipo</th>
                <th className="pb-2">Período</th>
                <th className="pb-2">Hs. normales</th>
                <th className="pb-2">Hs. extra 50%</th>
                <th className="pb-2">Hs. extra 100%</th>
                <th className="pb-2">Total</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-2">{l.empleados?.apellido}, {l.empleados?.nombre}</td>
                  <td className="py-2">{l.tipo}</td>
                  <td className="py-2">
                    {new Date(l.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })} -{" "}
                    {new Date(l.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}
                  </td>
                  <td className="py-2">{Number(l.horas_normales).toFixed(1)}</td>
                  <td className="py-2">{Number(l.horas_extra_50).toFixed(1)}</td>
                  <td className="py-2">{Number(l.horas_extra_100).toFixed(1)}</td>
                  <td className="py-2 font-medium">${Number(l.total_bruto).toLocaleString("es-AR", { maximumFractionDigits: 0 })}</td>
                  <td className="py-2">{l.estado}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <a href={`/api/rrhh/liquidaciones/${l.id}/export`} className="text-blue-600 underline text-sm">Exportar</a>
                    {l.estado === "BORRADOR" && (
                      <button onClick={() => cerrar(l)} className="text-gray-700 underline text-sm ml-3">Cerrar</button>
                    )}
                    <button onClick={() => eliminar(l)} className="text-red-600 underline text-sm ml-3">Eliminar</button>
                  </td>
                </tr>
              ))}
              {liquidaciones.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-gray-400">Todavía no hay liquidaciones generadas</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
