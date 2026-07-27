"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";

const PinMap = dynamic(() => import("@/components/remises/PinMap"), { ssr: false });

export default function ConfiguracionClient({ config, turnos }: { config: any; turnos: any[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    fabricaNombre: config.fabricaNombre ?? config.fabrica_nombre ?? "Fábrica",
    fabricaDireccion: config.fabricaDireccion ?? config.fabrica_direccion ?? "",
    fabricaLat: config.fabricaLat ?? config.fabrica_lat ?? null,
    fabricaLng: config.fabricaLng ?? config.fabrica_lng ?? null,
    velocidadKmh: config.velocidadKmh ?? config.velocidad_kmh ?? 40,
    ciudadReferencia: config.ciudadReferencia ?? config.ciudad_referencia ?? "",
  });
  const [geocodificando, setGeocodificando] = useState(false);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  async function geocodificar() {
    if (!form.fabricaDireccion.trim()) return;
    setGeocodificando(true);
    setErrorGeo(null);
    const res = await fetch("/api/remises/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: form.fabricaDireccion }),
    });
    setGeocodificando(false);
    if (res.ok) {
      const data = await res.json();
      setForm((f) => ({ ...f, fabricaLat: data.lat, fabricaLng: data.lng }));
    } else {
      setErrorGeo("No se encontró la dirección. Podés hacer clic en el mapa para marcarla a mano.");
    }
  }

  async function guardar() {
    setGuardando(true);
    setGuardado(false);
    const res = await fetch("/api/remises/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (res.ok) setGuardado(true);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Configuración de Remises</h1>

      <div className="card p-5">
        <h2 className="font-medium text-gray-700 mb-3 flex items-center gap-1.5">
          Fábrica
          <InfoTip text="Punto de origen/destino fijo de todas las rutas. Los empleados se recogen desde su domicilio hacia acá (ida) o se dejan desde acá hacia su domicilio (vuelta)." />
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre</label>
              <input value={form.fabricaNombre} onChange={(e) => setForm({ ...form, fabricaNombre: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Dirección</label>
              <div className="flex gap-2">
                <input value={form.fabricaDireccion} onChange={(e) => setForm({ ...form, fabricaDireccion: e.target.value })}
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
                <button type="button" onClick={geocodificar} disabled={geocodificando}
                  className="btn-primary disabled:opacity-50 whitespace-nowrap">
                  {geocodificando ? "..." : "Geocodificar"}
                </button>
              </div>
              {errorGeo && <p className="text-xs text-red-600 mt-1">{errorGeo}</p>}
              {form.fabricaLat != null && (
                <p className="text-xs text-gray-400 mt-1">{Number(form.fabricaLat).toFixed(5)}, {Number(form.fabricaLng).toFixed(5)}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                Ciudad de referencia
                <InfoTip text="Se agrega a cada búsqueda de dirección para evitar geocodificar en la ciudad equivocada. Dejalo vacío para usar el área alrededor de la fábrica en su lugar." />
              </label>
              <input value={form.ciudadReferencia} onChange={(e) => setForm({ ...form, ciudadReferencia: e.target.value })}
                placeholder="Ej: Córdoba, Argentina" className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                Velocidad promedio (km/h)
                <InfoTip text="Se usa solo como respaldo para estimar tiempos de viaje cuando el servicio de ruteo no está disponible." />
              </label>
              <input type="number" min={1} value={form.velocidadKmh} onChange={(e) => setForm({ ...form, velocidadKmh: e.target.value })}
                className="w-32 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
          </div>
          <PinMap lat={form.fabricaLat} lng={form.fabricaLng} popup={form.fabricaNombre}
            onChange={(lat, lng) => setForm((f) => ({ ...f, fabricaLat: lat, fabricaLng: lng }))} />
        </div>
        <div className="mt-4">
          <button onClick={guardar} disabled={guardando} className="btn-primary disabled:opacity-50">
            {guardando ? "Guardando..." : "Guardar configuración"}
          </button>
          {guardado && <span className="ml-3 text-sm text-emerald-600">Guardado.</span>}
        </div>
      </div>

      <TurnosCard turnos={turnos} onChange={() => router.refresh()} />
    </div>
  );
}

function TurnosCard({ turnos, onChange }: { turnos: any[]; onChange: () => void }) {
  const confirmar = useConfirm();
  const [modal, setModal] = useState<{ t: any | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function eliminar(t: any) {
    const ok = await confirmar({
      title: "Eliminar turno",
      message: `¿Eliminar el turno "${t.nombre}"? Se pierde la asistencia y el plan semanal cargados para ese turno.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/remises/turnos/${t.id}`, { method: "DELETE" });
    if (res.ok) { setError(null); onChange(); }
    else { const data = await res.json(); setError(data.error ?? "No se pudo eliminar el turno"); }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-gray-700 flex items-center gap-1.5">
          Turnos
          <InfoTip text="Franjas horarias de transporte (ej. Mañana, Tarde, Noche). Cada asistencia, ruta y plan semanal está asociado a un turno." />
        </h2>
        <button onClick={() => setModal({ t: null })} className="btn-primary text-sm">+ Agregar turno</button>
      </div>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="space-y-2">
        {turnos.map((t) => (
          <div key={t.id} className="flex items-center gap-3 border border-gray-200 rounded-md px-3 py-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: t.color }} />
            <span className="font-medium text-sm text-gray-800 flex-1">{t.nombre}</span>
            <span className="text-sm text-gray-500">{t.hora_inicio} – {t.hora_fin}</span>
            <button onClick={() => setModal({ t })} className="text-gray-700 underline text-xs">Editar</button>
            {turnos.length > 1 && <button onClick={() => eliminar(t)} className="text-red-600 underline text-xs">Eliminar</button>}
          </div>
        ))}
      </div>
      {modal && <TurnoModal t={modal.t} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChange(); }} />}
    </div>
  );
}

function TurnoModal({ t, onClose, onSaved }: { t: any | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    nombre: t?.nombre ?? "",
    horaInicio: t?.hora_inicio ?? "06:00",
    horaFin: t?.hora_fin ?? "14:00",
    color: t?.color ?? "#2563eb",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const res = await fetch(t ? `/api/remises/turnos/${t.id}` : "/api/remises/turnos", {
      method: t ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (res.ok) onSaved();
    else { const data = await res.json(); setError(data.error ?? "No se pudo guardar"); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-800 mb-4">{t ? "Editar turno" : "Nuevo turno"}</h3>
        <form onSubmit={guardar} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora inicio</label>
              <input type="time" required value={form.horaInicio} onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hora fin</label>
              <input type="time" required value={form.horaFin} onChange={(e) => setForm({ ...form, horaFin: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Color</label>
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="w-16 h-8 border border-gray-300 rounded-md" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={guardando} className="btn-primary disabled:opacity-50">
              {guardando ? "Guardando..." : "Guardar"}
            </button>
            <button type="button" onClick={onClose} className="border border-gray-300 px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
