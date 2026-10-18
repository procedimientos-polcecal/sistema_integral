"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { BotonNotificaciones } from "@/components/BotonNotificaciones";


export default function MiRemisClient({ nombre }: { nombre: string }) {
  const [dia, setDia] = useState<"hoy" | "manana">("manana");
  const [asignaciones, setAsignaciones] = useState<any[] | null>(null);

  useCargar(async (vigente) => {
    setAsignaciones(null);
    const d = await fetch(`/api/remises/mi-remis?dia=${dia}`).then((r) => r.json());
    if (!vigente()) return;
    setAsignaciones(d.asignaciones ?? []);
  }, [dia]);



  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold text-slate-900 mb-1">Hola, {nombre}</h1>
      <p className="text-slate-500 mb-6">Tu remis</p>

      <div className="flex gap-2 mb-6">
        {(["manana", "hoy"] as const).map((d) => (
          <button key={d} onClick={() => setDia(d)}
            className={`px-4 py-2 rounded-md text-sm ${dia === d ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
            {d === "manana" ? "Mañana" : "Hoy"}
          </button>
        ))}
      </div>

      {!asignaciones ? (
        <p className="text-sm text-slate-500">Cargando...</p>
      ) : asignaciones.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-400">Sin remis asignado para {dia === "manana" ? "mañana" : "hoy"}.</div>
      ) : (
        <div className="space-y-3">
          {asignaciones.map((a, i) => (
            <div key={i} className="card p-5">
              <div className="text-xs text-slate-400 mb-1">{a.tipo === "ida" ? "Ida (búsqueda)" : "Vuelta (retorno)"}</div>
              <div className="text-lg font-semibold text-slate-900">{a.vehiculo ?? "Vehículo sin nombre"}</div>
              {a.chofer && <div className="text-sm text-slate-600 mt-1">Chofer: {a.chofer}{a.choferTelefono ? ` · ${a.choferTelefono}` : ""}</div>}
              {a.horaSalida && <div className="text-sm text-slate-600">Salida: {a.horaSalida}</div>}
              {a.companeros.length > 0 && (
                <div className="text-xs text-slate-400 mt-2">Con vos: {a.companeros.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* El mismo componente que `/mi-cuenta`. Antes esto tenía su propia
          copia de todo —pedir permiso, registrar el service worker, suscribir,
          guardar— y era el único lugar del sistema donde se podían prender las
          notificaciones, escondido en una pantalla que ve un puñado de gente. */}
      <div className="mt-6">
        <BotonNotificaciones />
      </div>
    </div>
  );
}
