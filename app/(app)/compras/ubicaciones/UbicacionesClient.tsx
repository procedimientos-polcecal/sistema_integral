"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ConfirmProvider";
import type { UbicacionCompras } from "@/lib/compras/types";

const TIPOS = ["planta", "taller", "equipo", "oficina", "otra"] as const;

const TIPO_LABEL: Record<string, { label: string; color: string }> = {
  planta:  { label: "Planta",  color: "bg-blue-100 text-blue-800" },
  taller:  { label: "Taller",  color: "bg-amber-100 text-amber-800" },
  equipo:  { label: "Equipo",  color: "bg-purple-100 text-purple-800" },
  oficina: { label: "Oficina", color: "bg-slate-100 text-slate-600" },
  otra:    { label: "Otra",    color: "bg-gray-100 text-gray-500" },
};

type Opcion = { id: string; nombre: string };
type Equipo = { id: string; name: string; code: string };

/** Compara ignorando mayúsculas y acentos, igual que la sincronización. */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().replace(/\s+/g, " ");

/** Distancia por posición: alcanza para detectar un caracter cambiado. */
function casiIgual(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (x === y || Math.abs(x.length - y.length) > 1) return false;
  let d = 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) d++;
  return d === 1;
}

export default function UbicacionesClient({
  ubicaciones, conteo, sectores, equipos, canEdit,
}: {
  ubicaciones: UbicacionCompras[];
  conteo: Record<string, number>;
  sectores: Opcion[];
  equipos: Equipo[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const confirmar = useConfirm();
  const [busqueda, setBusqueda] = useState("");
  const [editando, setEditando] = useState<UbicacionCompras | null>(null);
  const [creando, setCreando] = useState(false);
  const [fusionando, setFusionando] = useState<UbicacionCompras | null>(null);
  const [error, setError] = useState("");

  const filas = useMemo(() => {
    const q = norm(busqueda);
    return q ? ubicaciones.filter((u) => norm(u.nombre).includes(q)) : ubicaciones;
  }, [ubicaciones, busqueda]);

  // Pares casi idénticos: casi siempre uno es un error de tipeo de la planilla.
  const sospechosos = useMemo(() => {
    const pares: [UbicacionCompras, UbicacionCompras][] = [];
    for (const a of ubicaciones) {
      for (const b of ubicaciones) {
        if (a.id >= b.id) continue;
        if (casiIgual(a.nombre, b.nombre)) pares.push([a, b]);
      }
    }
    // El de menos uso primero: es el candidato a fusionarse dentro del otro.
    return pares.map(([a, b]) =>
      (conteo[a.id] ?? 0) <= (conteo[b.id] ?? 0) ? [a, b] : [b, a]
    ) as [UbicacionCompras, UbicacionCompras][];
  }, [ubicaciones, conteo]);

  const sinUso = ubicaciones.filter((u) => !conteo[u.id]).length;

  async function borrar(u: UbicacionCompras) {
    const ok = await confirmar({
      title: "Eliminar ubicación",
      message: `Se elimina «${u.nombre}». No la usa ningún requerimiento, así que no se pierde nada.`,
      confirmText: "Eliminar",
    });
    if (!ok) return;

    const res = await fetch(`/api/compras/ubicaciones/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo eliminar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Ubicaciones</h1>
          <p className="text-sm text-slate-500">
            Dónde se necesita lo que se pide. {ubicaciones.length} en total
            {sinUso > 0 && `, ${sinUso} sin usar`}.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setCreando(true)}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            + Nueva ubicación
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Posibles duplicados */}
      {canEdit && sospechosos.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {sospechosos.length} {sospechosos.length === 1 ? "par parecido" : "pares parecidos"}
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            Difieren en un solo caracter. Algunos son lugares distintos de verdad
            (Planta 1 y Planta 2); otros son un error de tipeo y conviene fusionarlos,
            porque si no el gasto de una misma máquina queda partido en dos.
          </p>
          <ul className="mt-3 space-y-1.5">
            {sospechosos.map(([menos, mas]) => (
              <li key={menos.id + mas.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-700">
                  «{menos.nombre}» ({conteo[menos.id] ?? 0} RI) vs «{mas.nombre}» ({conteo[mas.id] ?? 0} RI)
                </span>
                <button
                  onClick={() => setFusionando(menos)}
                  className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
                >
                  Fusionar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <input
        className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Buscar ubicación…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nombre</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Enlazada a</th>
                <th className="px-3 py-2 text-right">RI</th>
                <th className="px-3 py-2 text-left">Activa</th>
                {canEdit && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="px-3 py-10 text-center text-slate-400">
                    Ninguna ubicación coincide con la búsqueda.
                  </td>
                </tr>
              ) : (
                filas.map((u) => {
                  const usos = conteo[u.id] ?? 0;
                  const enlace = u.equipo_id
                    ? equipos.find((e) => e.id === u.equipo_id)
                    : null;
                  const sector = u.sector_id ? sectores.find((s) => s.id === u.sector_id) : null;
                  const tipo = TIPO_LABEL[u.tipo ?? "otra"] ?? TIPO_LABEL.otra;
                  return (
                    <tr key={u.id} className={`hover:bg-slate-50 ${u.activo ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2 font-medium text-slate-900">{u.nombre}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tipo.color}`}>
                          {tipo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {enlace ? `${enlace.code} — ${enlace.name}` : sector ? sector.nombre : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">{usos}</td>
                      <td className="px-3 py-2 text-slate-600">{u.activo ? "Sí" : "No"}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <button onClick={() => setEditando(u)} className="text-xs text-slate-500 hover:text-slate-900">
                            Editar
                          </button>
                          {usos > 0 ? (
                            <button
                              onClick={() => setFusionando(u)}
                              className="ml-3 text-xs text-slate-500 hover:text-slate-900"
                            >
                              Fusionar
                            </button>
                          ) : (
                            <button
                              onClick={() => borrar(u)}
                              className="ml-3 text-xs text-red-600 hover:text-red-800"
                            >
                              Eliminar
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Mientras la planilla siga en uso, las ubicaciones nuevas que aparezcan ahí se
        dan de alta solas al sincronizar. Si acá renombrás una, la planilla la va a
        volver a crear con el nombre viejo: conviene corregirla en los dos lados.
      </p>

      {(editando || creando) && (
        <ModalUbicacion
          ubicacion={editando}
          sectores={sectores}
          equipos={equipos}
          onClose={() => { setEditando(null); setCreando(false); }}
          onSaved={() => { setEditando(null); setCreando(false); router.refresh(); }}
        />
      )}

      {fusionando && (
        <ModalFusion
          origen={fusionando}
          candidatas={ubicaciones.filter((u) => u.id !== fusionando.id)}
          conteo={conteo}
          onClose={() => setFusionando(null)}
          onSaved={() => { setFusionando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ModalUbicacion({
  ubicacion, sectores, equipos, onClose, onSaved,
}: {
  ubicacion: UbicacionCompras | null;
  sectores: Opcion[];
  equipos: Equipo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(ubicacion?.nombre ?? "");
  const [tipo, setTipo] = useState(ubicacion?.tipo ?? "otra");
  const [sectorId, setSectorId] = useState(ubicacion?.sector_id ?? "");
  const [equipoId, setEquipoId] = useState(ubicacion?.equipo_id ?? "");
  const [activo, setActivo] = useState(ubicacion?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");

    const res = await fetch(
      ubicacion ? `/api/compras/ubicaciones/${ubicacion.id}` : "/api/compras/ubicaciones",
      {
        method: ubicacion ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          tipo,
          // Se enlaza a un sector o a un equipo, no a los dos.
          sector_id: equipoId ? null : sectorId || null,
          equipo_id: equipoId || null,
          activo,
        }),
      }
    );

    setGuardando(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar.");
      return;
    }
    onSaved();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="mt-16 w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {ubicacion ? "Editar ubicación" : "Nueva ubicación"}
          </h2>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-6 py-5">
          <Campo label="Nombre" requerido>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
          </Campo>

          <Campo label="Tipo">
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t].label}</option>)}
            </select>
          </Campo>

          <Campo label="Enlazar a un equipo de Mantenimiento">
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              <option value="">Sin enlazar</option>
              {equipos.map((e2) => <option key={e2.id} value={e2.id}>{e2.code} — {e2.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Enlazarla permite ver cuánto se gastó en esa máquina.
            </p>
          </Campo>

          {!equipoId && (
            <Campo label="O a un sector">
              <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
                <option value="">Sin enlazar</option>
                {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activa — las inactivas no aparecen al cargar un pedido
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={guardando || !nombre.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalFusion({
  origen, candidatas, conteo, onClose, onSaved,
}: {
  origen: UbicacionCompras;
  candidatas: UbicacionCompras[];
  conteo: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [destinoId, setDestinoId] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");

  // Las parecidas primero: casi siempre la fusión es con una de ellas.
  const ordenadas = useMemo(() => {
    const parecidas = candidatas.filter((c) => casiIgual(c.nombre, origen.nombre));
    const resto = candidatas.filter((c) => !parecidas.includes(c));
    return [...parecidas, ...resto];
  }, [candidatas, origen]);

  const usos = conteo[origen.id] ?? 0;

  async function fusionar() {
    setProcesando(true);
    setError("");
    const res = await fetch(`/api/compras/ubicaciones/${origen.id}/fusionar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destino_id: destinoId }),
    });
    setProcesando(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo fusionar.");
      return;
    }
    onSaved();
  }

  const destino = candidatas.find((c) => c.id === destinoId);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="mt-24 w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Fusionar «{origen.nombre}»</h2>
          <p className="text-sm text-slate-500">
            Sus {usos} requerimiento{usos === 1 ? "" : "s"} pasan a la ubicación que elijas,
            y «{origen.nombre}» se elimina.
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Conservar esta ubicación
            </span>
            <select className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Elegir…</option>
              {ordenadas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({conteo[c.id] ?? 0} RI)
                  {casiIgual(c.nombre, origen.nombre) ? "  ← parecida" : ""}
                </option>
              ))}
            </select>
          </label>

          {destino && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Va a quedar «{destino.nombre}» con {(conteo[destino.id] ?? 0) + usos} requerimientos.
              Esto no se puede deshacer.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={procesando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button onClick={fusionar} disabled={procesando || !destinoId}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50">
              {procesando ? "Fusionando…" : "Fusionar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, requerido, children }: { label: string; requerido?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{requerido && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
