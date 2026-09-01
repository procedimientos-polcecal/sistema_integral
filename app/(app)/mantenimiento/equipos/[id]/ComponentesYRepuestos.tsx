"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";

/**
 * De qué está hecho el equipo y qué repuestos conviene tener.
 *
 * Dos listas cortas, una al lado de la otra: los componentes salen del
 * relevamiento y los repuestos de la experiencia de quien lo repara.
 */

interface Componente {
  id: string;
  componente_id: string | null;
  nombre: string;
  categoria: string | null;
  especificacion: string | null;
  material: string | null;
  cantidad: string | null;
  proveedor_critico: string | null;
  criticidad: string | null;
}

interface Repuesto {
  id: string;
  name: string;
  code: string | null;
  notes: string | null;
}

export default function ComponentesYRepuestos({
  equipoId, puedeEditar,
}: {
  equipoId: string;
  puedeEditar: boolean;
}) {
  const [componentes, setComponentes] = useState<Componente[]>([]);
  const [repuestos, setRepuestos] = useState<Repuesto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const traer = useCargar(async (vigente) => {
    setCargando(true);
    const [c, r] = await Promise.all([
      fetch(`/api/mantenimiento/equipos/${equipoId}/componentes`),
      fetch(`/api/mantenimiento/equipos/${equipoId}/repuestos`),
    ]);
    const cBody = await c.json().catch(() => ({}));
    const rBody = await r.json().catch(() => ({}));
    if (!vigente()) return;
    setCargando(false);

    if (!c.ok || !r.ok) {
      setError(cBody.error ?? rBody.error ?? "No se pudo traer la lista.");
      return;
    }
    setComponentes(cBody.data ?? []);
    setRepuestos(rBody.data ?? []);
  }, [equipoId]);

  async function agregarComponente(nombre: string, categoria: string, especificacion: string) {
    const res = await fetch(`/api/mantenimiento/equipos/${equipoId}/componentes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, categoria, especificacion }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo agregar.");
      return false;
    }
    traer();
    return true;
  }

  async function agregarRepuesto(name: string, code: string, notes: string) {
    const res = await fetch(`/api/mantenimiento/equipos/${equipoId}/repuestos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, notes }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo agregar.");
      return false;
    }
    traer();
    return true;
  }

  async function borrar(que: "componentes" | "repuestos", id: string) {
    const clave = que === "componentes" ? "componente" : "repuesto";
    const res = await fetch(`/api/mantenimiento/equipos/${equipoId}/${que}?${clave}=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo borrar.");
      return;
    }
    traer();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 md:col-span-2">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Componentes
          <span className="ml-2 text-xs font-normal text-slate-400">{componentes.length}</span>
        </h2>

        {cargando ? (
          <p className="py-4 text-center text-sm text-slate-400">Cargando…</p>
        ) : componentes.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            Todavía no se relevó de qué está hecho.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {componentes.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-slate-800">
                    {c.nombre}
                    {c.cantidad && <span className="text-slate-400"> ×{c.cantidad}</span>}
                    {c.criticidad?.toUpperCase() === "ALTA" && (
                      <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                        crítico
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {[c.categoria, c.especificacion, c.material, c.proveedor_critico]
                      .filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {puedeEditar && (
                  <button
                    onClick={() => borrar("componentes", c.id)}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                    title="Sacar de la lista"
                  >×</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {puedeEditar && (
          <AgregarComponente onAgregar={agregarComponente} />
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Repuestos
          <span className="ml-2 text-xs font-normal text-slate-400">{repuestos.length}</span>
        </h2>

        {cargando ? (
          <p className="py-4 text-center text-sm text-slate-400">Cargando…</p>
        ) : repuestos.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Sin repuestos anotados.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {repuestos.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-slate-800">
                    {r.name}
                    {r.code && <span className="ml-1.5 font-mono text-xs text-slate-400">{r.code}</span>}
                  </div>
                  {r.notes && <div className="truncate text-xs text-slate-400">{r.notes}</div>}
                </div>
                {puedeEditar && (
                  <button
                    onClick={() => borrar("repuestos", r.id)}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                    title="Sacar de la lista"
                  >×</button>
                )}
              </li>
            ))}
          </ul>
        )}

        {puedeEditar && <AgregarRepuesto onAgregar={agregarRepuesto} />}
      </div>
    </div>
  );
}

function AgregarComponente({
  onAgregar,
}: {
  onAgregar: (nombre: string, categoria: string, especificacion: string) => Promise<boolean>;
}) {
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    if (!nombre.trim()) return;
    setGuardando(true);
    const ok = await onAgregar(nombre.trim(), categoria.trim(), especificacion.trim());
    setGuardando(false);
    if (ok) { setNombre(""); setCategoria(""); setEspecificacion(""); }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Rodamiento lado motor"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <input
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Categoría"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={especificacion}
          onChange={(e) => setEspecificacion(e.target.value)}
          placeholder="Especificación"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={agregar}
          disabled={guardando || !nombre.trim()}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Sumar
        </button>
      </div>
    </div>
  );
}

function AgregarRepuesto({
  onAgregar,
}: {
  onAgregar: (name: string, code: string, notes: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    if (!name.trim()) return;
    setGuardando(true);
    const ok = await onAgregar(name.trim(), code.trim(), notes.trim());
    setGuardando(false);
    if (ok) { setName(""); setCode(""); setNotes(""); }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Correa B-75"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Nota"
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={agregar}
          disabled={guardando || !name.trim()}
          className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Sumar
        </button>
      </div>
    </div>
  );
}
