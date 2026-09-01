"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { useConfirm } from "@/components/ConfirmProvider";
import { usePuedeEditarRemises } from "@/lib/remises/context";

export default function VehiculosClient({ vehiculos, choferes }: { vehiculos: any[]; choferes: any[] }) {
  const [tab, setTab] = useState<"vehiculos" | "choferes">("vehiculos");
  const canEdit = usePuedeEditarRemises();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Vehículos y choferes
          <InfoTip text="Los vehículos disponibles para remises y sus choferes. Cada vehículo tiene una capacidad de asientos, usada al generar rutas para no superar el cupo." />
        </h1>
      </div>
      <div className="flex gap-2 mb-6">
        {(["vehiculos", "choferes"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm ${tab === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"}`}>
            {t === "vehiculos" ? "Vehículos" : "Choferes"}
          </button>
        ))}
      </div>
      {tab === "vehiculos" ? (
        <VehiculosTab vehiculos={vehiculos} choferes={choferes} canEdit={canEdit} />
      ) : (
        <ChoferesTab choferes={choferes} canEdit={canEdit} />
      )}
    </div>
  );
}

function VehiculosTab({ vehiculos, choferes, canEdit }: { vehiculos: any[]; choferes: any[]; canEdit: boolean }) {
  const router = useRouter();
  const confirmar = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [modal, setModal] = useState<{ v: any | null } | null>(null);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportando(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/remises/vehiculos/import", { method: "POST", body: fd });
    const data = await res.json();
    setImportando(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok) router.refresh();
  }

  async function eliminar(v: any) {
    const ok = await confirmar({
      title: "Eliminar vehículo",
      message: `¿Eliminar el vehículo "${v.nombre}"? Esta acción no se puede deshacer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/remises/vehiculos/${v.id}`, { method: "DELETE" });
    if (res.ok) { setError(null); router.refresh(); }
    else { const data = await res.json(); setError(data.error ?? "No se pudo eliminar el vehículo"); }
  }

  return (
    <div>
      {canEdit && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => setModal({ v: null })} className="btn-primary">+ Agregar vehículo</button>
          {/* Una descarga, no una pagina: `<Link>` haria navegacion del lado
              del cliente y el archivo nunca bajaria. La regla no distingue
              /api/ de una ruta de pagina. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/remises/vehiculos/template" download className="text-sm text-blue-600 hover:underline">Descargar plantilla</a>
          <button onClick={() => fileRef.current?.click()} disabled={importando}
            className="text-sm text-blue-600 hover:underline disabled:opacity-50">
            {importando ? "Importando..." : "Importar Excel"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importar} />
        </div>
      )}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="card p-5">
        {vehiculos.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no hay vehículos cargados.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehiculos.map((v) => (
              <div key={v.id} className={`rounded-xl border p-4 ${v.activo ? "border-gray-200" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                <div className="font-medium text-gray-900">{v.nombre}</div>
                <div className="text-sm text-gray-500 mt-1">Chofer: {v.choferes?.nombre ?? "-"}</div>
                <div className="text-sm text-gray-500">Capacidad: {v.capacidad}</div>
                {v.choferes?.telefono && <div className="text-sm text-gray-500">Tel: {v.choferes.telefono}</div>}
                {canEdit && (
                  <div className="mt-3 flex gap-3">
                    <button onClick={() => setModal({ v })} className="text-gray-700 underline text-xs">Editar</button>
                    <button onClick={() => eliminar(v)} className="text-red-600 underline text-xs">Eliminar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && <VehiculoModal v={modal.v} choferes={choferes} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />}
    </div>
  );
}

function VehiculoModal({ v, choferes, onClose, onSaved }: { v: any | null; choferes: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    nombre: v?.nombre ?? "",
    choferId: v?.chofer_id ?? "",
    capacidad: v?.capacidad ?? 8,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const res = await fetch(v ? `/api/remises/vehiculos/${v.id}` : "/api/remises/vehiculos", {
      method: v ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: form.nombre, choferId: form.choferId || null, capacidad: Number(form.capacidad) }),
    });
    setGuardando(false);
    if (res.ok) onSaved();
    else { const data = await res.json(); setError(data.error ?? "No se pudo guardar"); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-medium text-gray-800 mb-4">{v ? "Editar vehículo" : "Nuevo vehículo"}</h3>
        <form onSubmit={guardar} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Remise 1 - Ford Transit" className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Chofer</label>
            <select value={form.choferId} onChange={(e) => setForm({ ...form, choferId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm">
              <option value="">Sin asignar</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Capacidad</label>
            <input type="number" min={1} value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
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

function ChoferesTab({ choferes, canEdit }: { choferes: any[]; canEdit: boolean }) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [modal, setModal] = useState<{ c: any | null } | null>(null);

  async function eliminar(c: any) {
    const ok = await confirmar({
      title: "Eliminar chofer",
      message: `¿Eliminar a "${c.nombre}"? Los vehículos que lo tenían asignado quedan sin chofer.`,
      confirmText: "Eliminar",
      danger: true,
    });
    if (!ok) return;
    await fetch(`/api/remises/choferes/${c.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      {canEdit && (
        <div className="mb-4">
          <button onClick={() => setModal({ c: null })} className="btn-primary">+ Agregar chofer</button>
        </div>
      )}
      <div className="card p-5">
        {choferes.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no hay choferes cargados.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Nombre</th><th className="pb-2">Teléfono</th><th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {choferes.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2">{c.nombre}</td>
                  <td className="py-2 text-gray-500">{c.telefono ?? "-"}</td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <>
                        <button onClick={() => setModal({ c })} className="text-gray-700 underline text-xs">Editar</button>
                        <button onClick={() => eliminar(c)} className="text-red-600 underline text-xs ml-3">Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      {modal && <ChoferModal c={modal.c} onClose={() => setModal(null)} onSaved={() => { setModal(null); router.refresh(); }} />}
    </div>
  );
}

function ChoferModal({ c, onClose, onSaved }: { c: any | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ nombre: c?.nombre ?? "", telefono: c?.telefono ?? "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    const res = await fetch(c ? `/api/remises/choferes/${c.id}` : "/api/remises/choferes", {
      method: c ? "PUT" : "POST",
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
        <h3 className="font-medium text-gray-800 mb-4">{c ? "Editar chofer" : "Nuevo chofer"}</h3>
        <form onSubmit={guardar} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nombre</label>
            <input required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Teléfono</label>
            <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
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
