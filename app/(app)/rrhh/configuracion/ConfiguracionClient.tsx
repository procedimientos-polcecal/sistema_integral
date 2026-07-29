"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import EmpresasSectoresManager from "@/components/administracion/EmpresasSectoresManager";

export default function ConfiguracionClient() {
  const [config, setConfig] = useState<any | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    fetch("/api/rrhh/configuracion").then((r) => r.json()).then(setConfig);
  }, []);

  async function guardar() {
    setGuardando(true);
    setGuardado(false);
    const res = await fetch("/api/rrhh/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setGuardando(false);
    if (res.ok) { setConfig(await res.json()); setGuardado(true); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Configuración</h1>

      {!config ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : (
        <div className="card p-5 max-w-3xl">
          <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
            Reglas de cálculo de horas
            <InfoTip text="Definen cómo se calculan las horas y su valor: cuántas horas son 'normales' por día, desde qué hora del sábado se paga extra, y los multiplicadores de las horas extra al 50% y 100%. Estos valores se usan en cada liquidación." />
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Horas normales por día</label>
              <input type="number" value={config.horasNormalesPorDia} onChange={(e) => setConfig({ ...config, horasNormalesPorDia: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Corte sábado (hora)</label>
              <input type="time" value={config.horaCorteSabado} onChange={(e) => setConfig({ ...config, horaCorteSabado: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Horas de franco compensatorio</label>
              <input type="number" value={config.horasFrancoCompensatorio} onChange={(e) => setConfig({ ...config, horasFrancoCompensatorio: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Multiplicador extra 50% (ej. 1.5)</label>
              <input type="number" step="0.01" value={config.multiplicadorExtra50} onChange={(e) => setConfig({ ...config, multiplicadorExtra50: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Multiplicador extra 100% (ej. 2.0)</label>
              <input type="number" step="0.01" value={config.multiplicadorExtra100} onChange={(e) => setConfig({ ...config, multiplicadorExtra100: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={config.feriadoComoDomingo} onChange={(e) => setConfig({ ...config, feriadoComoDomingo: e.target.checked })} />
                Tratar feriados como domingo
              </label>
            </div>
          </div>

          <h3 className="text-sm font-medium text-gray-700 mb-2">Escala de vacaciones por antigüedad</h3>
          <div className="space-y-2 mb-4">
            {config.escalaVacaciones.map((tramo: any, i: number) => (
              <div key={i} className="flex gap-3 items-center">
                <span className="text-sm text-gray-500">Hasta</span>
                <input type="number" value={tramo.hastaAnios} onChange={(e) => {
                  const escala = [...config.escalaVacaciones];
                  escala[i] = { ...tramo, hastaAnios: Number(e.target.value) };
                  setConfig({ ...config, escalaVacaciones: escala });
                }} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm" />
                <span className="text-sm text-gray-500">años →</span>
                <input type="number" value={tramo.dias} onChange={(e) => {
                  const escala = [...config.escalaVacaciones];
                  escala[i] = { ...tramo, dias: Number(e.target.value) };
                  setConfig({ ...config, escalaVacaciones: escala });
                }} className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm" />
                <span className="text-sm text-gray-500">días</span>
              </div>
            ))}
          </div>

          <button onClick={guardar} disabled={guardando} className="btn-primary disabled:opacity-50">
            {guardando ? "Guardando..." : "Guardar configuración"}
          </button>
          {guardado && <span className="ml-3 text-sm text-emerald-600">Guardado.</span>}
        </div>
      )}

      <EmpresasSectoresManager />
    </div>
  );
}
