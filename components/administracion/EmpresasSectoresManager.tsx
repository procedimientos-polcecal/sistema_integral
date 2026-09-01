"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";

interface Sector {
  id: string;
  nombre: string;
  activo: boolean;
}

interface Empresa {
  id: string;
  nombre: string;
  activo: boolean;
  sectores: Sector[];
}

export default function EmpresasSectoresManager() {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [nuevoSector, setNuevoSector] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const cargar = useCargar(async (vigente) => {
    const res = await fetch("/api/administracion/empresas");
    if (!res.ok) return;
    const datos = await res.json();
    if (!vigente()) return;
    setEmpresas(datos);
  }, []);

  async function toggleEmpresa(e: Empresa) {
    const res = await fetch(`/api/administracion/empresas/${e.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !e.activo }),
    });
    if (res.ok) { setError(null); cargar(); }
    else setError("No se pudo actualizar la empresa");
  }

  async function toggleSector(s: Sector) {
    const res = await fetch(`/api/administracion/sectores/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !s.activo }),
    });
    if (res.ok) { setError(null); cargar(); }
    else setError("No se pudo actualizar el sector");
  }

  async function agregarSector(empresaId: string, e: React.FormEvent) {
    e.preventDefault();
    const nombre = (nuevoSector[empresaId] ?? "").trim();
    if (!nombre) return;
    const res = await fetch("/api/administracion/sectores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresaId, nombre }),
    });
    if (res.ok) {
      setError(null);
      setNuevoSector({ ...nuevoSector, [empresaId]: "" });
      cargar();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo crear el sector");
    }
  }

  if (!empresas) return <p className="text-gray-500 text-sm">Cargando...</p>;

  return (
    <div className="card p-5 max-w-3xl">
      <h2 className="font-medium text-gray-700 mb-3">Empresas y sectores</h2>
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      <div className="space-y-6">
        {empresas.map((emp) => (
          <div key={emp.id}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-800">{emp.nombre}</h3>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={emp.activo} onChange={() => toggleEmpresa(emp)} />
                Activa
              </label>
            </div>
            <ul className="space-y-1 mb-2">
              {emp.sectores.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-sm text-gray-600 pl-3">
                  <span>{s.nombre}</span>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={s.activo} onChange={() => toggleSector(s)} />
                    Activo
                  </label>
                </li>
              ))}
              {emp.sectores.length === 0 && <li className="text-sm text-gray-400 pl-3">Sin sectores</li>}
            </ul>
            <form onSubmit={(e) => agregarSector(emp.id, e)} className="flex gap-2 pl-3">
              <input
                placeholder="Nuevo sector"
                value={nuevoSector[emp.id] ?? ""}
                onChange={(e) => setNuevoSector({ ...nuevoSector, [emp.id]: e.target.value })}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm flex-1"
              />
              <button type="submit" className="btn-ghost">Agregar</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
