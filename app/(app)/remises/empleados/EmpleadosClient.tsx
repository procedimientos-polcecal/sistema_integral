"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import InfoTip from "@/components/InfoTip";
import { usePuedeEditarRemises } from "@/lib/remises/context";

const PinMap = dynamic(() => import("@/components/remises/PinMap"), { ssr: false });

function datos(e: any) {
  return e.remises_empleados_datos ?? {};
}

export default function EmpleadosClient({ empleados, turnos }: { empleados: any[]; turnos: any[] }) {
  const router = useRouter();
  const canEdit = usePuedeEditarRemises();
  const [busqueda, setBusqueda] = useState("");
  const [modal, setModal] = useState<{ e: any } | null>(null);
  const [geocodificandoTodos, setGeocodificandoTodos] = useState(false);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return empleados;
    return empleados.filter(
      (e) => `${e.apellido} ${e.nombre} ${e.legajo}`.toLowerCase().includes(q)
    );
  }, [empleados, busqueda]);

  const faltantes = useMemo(
    () => empleados.filter((e) => {
      const d = datos(e);
      return !d.lat && (d.direccion || e.domicilio);
    }),
    [empleados]
  );

  async function geocodificarFaltantes() {
    setGeocodificandoTodos(true);
    setProgreso({ hecho: 0, total: faltantes.length });
    for (const emp of faltantes) {
      const direccion = datos(emp).direccion || emp.domicilio;
      const res = await fetch("/api/remises/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direccion }),
      });
      if (res.ok) {
        const { lat, lng } = await res.json();
        await fetch(`/api/remises/empleados/${emp.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direccion, lat, lng }),
        });
      }
      setProgreso((p) => ({ ...p, hecho: p.hecho + 1 }));
      await new Promise((r) => setTimeout(r, 1100)); // respeta el rate-limit de Nominatim
    }
    setGeocodificandoTodos(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Empleados
          <InfoTip text="Domicilio de recogida y turno habitual de cada empleado para el transporte. Necesitan coordenadas geocodificadas para poder incluirse en la generación de rutas." />
        </h1>
        {canEdit && faltantes.length > 0 && (
          <button onClick={geocodificarFaltantes} disabled={geocodificandoTodos} className="btn-primary disabled:opacity-50">
            {geocodificandoTodos ? `Geocodificando ${progreso.hecho}/${progreso.total}...` : `Geocodificar faltantes (${faltantes.length})`}
          </button>
        )}
      </div>

      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o legajo..."
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm mb-4 w-full max-w-sm" />

      <div className="card p-5">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Legajo</th>
              <th className="pb-2">Nombre</th>
              <th className="pb-2">Dirección de recogida</th>
              <th className="pb-2">Coordenadas</th>
              <th className="pb-2">Turno default</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((e) => {
              const d = datos(e);
              const turno = turnos.find((t) => t.id === d.turno_default_id);
              return (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2">{e.legajo}</td>
                  <td className="py-2">{e.apellido}, {e.nombre}</td>
                  <td className="py-2 text-gray-500">{d.direccion || e.domicilio || "-"}</td>
                  <td className="py-2">
                    {d.lat ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">OK</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Falta geocodificar</span>
                    )}
                  </td>
                  <td className="py-2 text-gray-500">{turno?.nombre ?? "-"}</td>
                  <td className="py-2 text-right">
                    {canEdit && <button onClick={() => setModal({ e })} className="text-gray-700 underline text-xs">Editar</button>}
                  </td>
                </tr>
              );
            })}
            {filtrados.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {modal && (
        <EmpleadoModal empleado={modal.e} turnos={turnos} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh(); }} />
      )}
    </div>
  );
}

function EmpleadoModal({
  empleado, turnos, onClose, onSaved,
}: { empleado: any; turnos: any[]; onClose: () => void; onSaved: () => void }) {
  const d = datos(empleado);
  const [form, setForm] = useState({
    direccion: d.direccion || empleado.domicilio || "",
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    turnoDefaultId: d.turno_default_id || "",
  });
  const [geocodificando, setGeocodificando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cuentaEmail, setCuentaEmail] = useState<string | null | undefined>(undefined);
  const [nuevoEmail, setNuevoEmail] = useState("");
  const [creandoCuenta, setCreandoCuenta] = useState(false);
  const [avisoCuenta, setAvisoCuenta] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/remises/empleados/${empleado.id}/cuenta`).then((r) => r.json()).then((d) => setCuentaEmail(d.email));
  }, [empleado.id]);

  async function darAcceso() {
    if (!nuevoEmail.trim()) return;
    setCreandoCuenta(true);
    setAvisoCuenta(null);
    const res = await fetch(`/api/remises/empleados/${empleado.id}/cuenta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: nuevoEmail.trim() }),
    });
    const data = await res.json();
    setCreandoCuenta(false);
    if (res.ok) { setCuentaEmail(nuevoEmail.trim()); setAvisoCuenta("Cuenta creada — se envió un link para definir contraseña."); }
    else setAvisoCuenta(data.error ?? "No se pudo dar acceso");
  }

  async function geocodificar() {
    if (!form.direccion.trim()) return;
    setGeocodificando(true);
    setError(null);
    const res = await fetch("/api/remises/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direccion: form.direccion }),
    });
    setGeocodificando(false);
    if (res.ok) {
      const data = await res.json();
      setForm((f) => ({ ...f, lat: data.lat, lng: data.lng }));
    } else {
      setError("No se encontró la dirección. Podés hacer clic en el mapa para marcarla a mano.");
    }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/remises/empleados/${empleado.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setGuardando(false);
    if (res.ok) onSaved();
    else { const data = await res.json(); setError(data.error ?? "No se pudo guardar"); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-800 mb-4">{empleado.apellido}, {empleado.nombre}</h3>
        <form onSubmit={guardar} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dirección de recogida</label>
            <div className="flex gap-2">
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              <button type="button" onClick={geocodificar} disabled={geocodificando} className="btn-primary disabled:opacity-50 whitespace-nowrap">
                {geocodificando ? "..." : "Geocodificar"}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Turno default</label>
            <select value={form.turnoDefaultId} onChange={(e) => setForm({ ...form, turnoDefaultId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Sin turno default</option>
              {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <PinMap lat={form.lat} lng={form.lng} popup={`${empleado.apellido}, ${empleado.nombre}`}
            onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))} />
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

        <div className="border-t border-gray-100 mt-4 pt-4">
          <h4 className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
            Acceso “Mi remis”
            <InfoTip text="Da acceso al empleado para que vea desde su celular en qué remis viaja y active notificaciones. Se le manda un email para que defina su propia contraseña." />
          </h4>
          {cuentaEmail === undefined ? (
            <p className="text-xs text-gray-400">Cargando...</p>
          ) : cuentaEmail ? (
            <p className="text-xs text-emerald-600">Tiene acceso con {cuentaEmail}</p>
          ) : (
            <div className="flex gap-2">
              <input type="email" value={nuevoEmail} onChange={(e) => setNuevoEmail(e.target.value)} placeholder="email@ejemplo.com"
                className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              <button type="button" onClick={darAcceso} disabled={creandoCuenta} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap">
                {creandoCuenta ? "..." : "Dar acceso"}
              </button>
            </div>
          )}
          {avisoCuenta && <p className="text-xs text-gray-500 mt-1">{avisoCuenta}</p>}
        </div>
      </div>
    </div>
  );
}
