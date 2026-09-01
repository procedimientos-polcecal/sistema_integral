"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function MiRemisClient({ nombre }: { nombre: string }) {
  const [dia, setDia] = useState<"hoy" | "manana">("manana");
  const [asignaciones, setAsignaciones] = useState<any[] | null>(null);
  const [notifEstado, setNotifEstado] = useState<"desconocido" | "activando" | "activo" | "no-soportado" | "denegado">("desconocido");

  useCargar(async (vigente) => {
    setAsignaciones(null);
    const d = await fetch(`/api/remises/mi-remis?dia=${dia}`).then((r) => r.json());
    if (!vigente()) return;
    setAsignaciones(d.asignaciones ?? []);
  }, [dia]);

  // Que el navegador soporte push no es un dato del render: se pregunta una vez
  // al montar. Va por `useCargar` para que la respuesta no se pinte si el
  // componente ya se fue.
  useCargar(async (vigente) => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setNotifEstado("no-soportado");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!vigente() || !sub) return;
    setNotifEstado("activo");
  }, []);

  async function activarNotificaciones() {
    setNotifEstado("activando");
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") { setNotifEstado("denegado"); return; }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const { publicKey } = await fetch("/api/remises/mi-remis/push-token").then((r) => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource });
      await fetch("/api/remises/mi-remis/push-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setNotifEstado("activo");
    } catch {
      setNotifEstado("desconocido");
    }
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-1">Hola, {nombre}</h1>
      <p className="text-gray-500 mb-6">Tu remis</p>

      <div className="flex gap-2 mb-6">
        {(["manana", "hoy"] as const).map((d) => (
          <button key={d} onClick={() => setDia(d)}
            className={`px-4 py-2 rounded-md text-sm ${dia === d ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"}`}>
            {d === "manana" ? "Mañana" : "Hoy"}
          </button>
        ))}
      </div>

      {!asignaciones ? (
        <p className="text-sm text-gray-500">Cargando...</p>
      ) : asignaciones.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-400">Sin remis asignado para {dia === "manana" ? "mañana" : "hoy"}.</div>
      ) : (
        <div className="space-y-3">
          {asignaciones.map((a, i) => (
            <div key={i} className="card p-5">
              <div className="text-xs text-gray-400 mb-1">{a.tipo === "ida" ? "Ida (búsqueda)" : "Vuelta (retorno)"}</div>
              <div className="text-lg font-semibold text-gray-900">{a.vehiculo ?? "Vehículo sin nombre"}</div>
              {a.chofer && <div className="text-sm text-gray-600 mt-1">Chofer: {a.chofer}{a.choferTelefono ? ` · ${a.choferTelefono}` : ""}</div>}
              {a.horaSalida && <div className="text-sm text-gray-600">Salida: {a.horaSalida}</div>}
              {a.companeros.length > 0 && (
                <div className="text-xs text-gray-400 mt-2">Con vos: {a.companeros.join(", ")}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-center">
        {notifEstado === "activo" ? (
          <p className="text-xs text-emerald-600">Notificaciones activadas</p>
        ) : notifEstado === "no-soportado" ? (
          <p className="text-xs text-gray-400">Tu navegador no soporta notificaciones push.</p>
        ) : notifEstado === "denegado" ? (
          <p className="text-xs text-amber-600">Permiso de notificaciones denegado. Activalo desde la configuración del navegador.</p>
        ) : (
          <button onClick={activarNotificaciones} disabled={notifEstado === "activando"}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50">
            {notifEstado === "activando" ? "Activando..." : "Activar notificaciones"}
          </button>
        )}
      </div>
    </div>
  );
}
