"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { labelTipoAusencia } from "@/lib/rrhh/tiposAusencia";

export default function AusenciasClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState<"injustificadas" | "licencias">(
    searchParams.get("tab") === "licencias" ? "licencias" : "injustificadas"
  );
  function setTab(t: "injustificadas" | "licencias") {
    setTabState(t);
    router.replace(`${pathname}?tab=${t}`, { scroll: false });
  }
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [ausencias, setAusencias] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  function buildQS() {
    const qs = new URLSearchParams();
    if (tab === "injustificadas") qs.set("justificada", "false");
    else { qs.set("justificada", "true"); qs.set("excluirTipo", "VACACIONES"); }
    if (desde) qs.set("desde", desde);
    if (hasta) qs.set("hasta", hasta);
    return qs.toString();
  }

  useEffect(() => {
    setCargando(true);
    fetch(`/api/rrhh/ausencias?${buildQS()}`).then((r) => r.json()).then((d) => { setAusencias(d); setCargando(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desde, hasta]);

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        {tab === "injustificadas" ? "Ausencias" : "Licencias"}
        <InfoTip text={tab === "injustificadas"
          ? "Las ausencias injustificadas cargadas. Cada una afecta el cálculo de asistencia y puede impactar la liquidación."
          : "Las licencias del personal (ART, gremial, sin goce de sueldo, examen, etc.). Son un tipo de ausencia con tratamiento particular en el cálculo de horas y sueldo."} />
      </h1>
      <div className="flex gap-2 mb-6">
        {(["injustificadas", "licencias"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t === "injustificadas" ? "Injustificadas" : "Licencias"}
          </button>
        ))}
      </div>

      <div className="flex gap-4 items-end mb-6 card p-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
        </div>
        <a href={`/api/rrhh/ausencias/export?${buildQS()}`} className="text-sm text-blue-600 hover:underline ml-auto">Exportar</a>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3">
          Historial de {tab === "injustificadas" ? "ausencias injustificadas" : "licencias"} ({ausencias.length})
        </h2>
        {cargando ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : ausencias.length === 0 ? (
          <p className="text-sm text-gray-500">No hay {tab === "injustificadas" ? "ausencias injustificadas" : "licencias"} registradas en el período.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Legajo</th>
                <th className="pb-2">Empleado</th>
                {tab === "licencias" && <th className="pb-2">Tipo</th>}
                <th className="pb-2">Desde</th>
                <th className="pb-2">Hasta</th>
                <th className="pb-2">Observaciones</th>
                <th className="pb-2">Cargado por</th>
              </tr>
            </thead>
            <tbody>
              {ausencias.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2">{a.empleados?.legajo}</td>
                  <td className="py-2">{a.empleados?.apellido}, {a.empleados?.nombre}</td>
                  {tab === "licencias" && <td className="py-2">{labelTipoAusencia(a.tipo)}</td>}
                  <td className={`py-2 ${tab === "injustificadas" ? "text-red-600" : ""}`}>{new Date(a.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2">{new Date(a.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" })}</td>
                  <td className="py-2 text-gray-500">{a.observaciones ?? "-"}</td>
                  <td className="py-2 text-gray-500">{a.usuarios?.nombre ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
