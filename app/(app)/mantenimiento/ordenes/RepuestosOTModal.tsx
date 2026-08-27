"use client";

import { useCallback, useEffect, useState } from "react";
import { ESTADO_DE_STOCK, type Disponibilidad, type Insumo } from "@/lib/mantenimiento/stock";

/**
 * Los repuestos que hacen falta para hacer la orden.
 *
 * Y si los hay: la disponibilidad se consulta en vivo contra la planilla del
 * pañol, porque el stock cambia cada vez que alguien retira algo. La lista se
 * carga igual aunque el inventario no esté conectado —saber qué hace falta no
 * depende de saber si lo hay—.
 */

interface Repuesto {
  id: string;
  nombre: string;
  codigo: string | null;
  cantidad: string | null;
}

export default function RepuestosOTModal({
  orden, puedeEditar, onCerrar,
}: {
  orden: { id: string; ot_number: number | null; descripcion: string | null; repuesto: string | null };
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const [repuestos, setRepuestos] = useState<Repuesto[]>([]);
  const [disponibilidad, setDisponibilidad] = useState<Record<string, Disponibilidad>>({});
  const [inventarioConectado, setInventarioConectado] = useState<boolean | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const traer = useCallback(async () => {
    setCargando(true);
    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/repuestos`);
    setCargando(false);

    if (!res.ok) { setError("No se pudieron traer los repuestos."); return; }
    const lista: Repuesto[] = (await res.json()).data ?? [];
    setRepuestos(lista);

    if (lista.length === 0) { setDisponibilidad({}); return; }

    // Y qué hay de cada uno, si el pañol está conectado.
    const stock = await fetch("/api/mantenimiento/inventario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repuestos: lista.map((r) => ({ codigo: r.codigo, nombre: r.nombre })) }),
    });
    if (!stock.ok) return;

    const body = await stock.json();
    setInventarioConectado(body.configurado);

    const porClave: Record<string, Disponibilidad> = {};
    (body.disponibilidad ?? []).forEach((d: Disponibilidad, i: number) => {
      porClave[lista[i].id] = d;
    });
    setDisponibilidad(porClave);
  }, [orden.id]);

  useEffect(() => { traer(); }, [traer]);

  async function sacar(id: string) {
    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/repuestos?repuesto=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "No se pudo sacar."); return; }
    traer();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Repuestos que hacen falta</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              OT #{orden.ot_number ?? "—"} · {orden.descripcion ?? ""}
            </p>
          </div>
          <button onClick={onCerrar} className="text-xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>

        {/* Lo que dice la planilla, que es una sola línea de texto libre. */}
        {orden.repuesto && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            La planilla dice: <span className="font-medium">{orden.repuesto}</span>
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {inventarioConectado === false && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            El inventario del pañol no está conectado, así que no se puede decir si hay stock. Los
            repuestos se cargan igual.
          </p>
        )}

        {cargando ? (
          <p className="py-6 text-center text-sm text-gray-400">Cargando…</p>
        ) : repuestos.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            Todavía no se anotó ningún repuesto.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {repuestos.map((r) => {
              const d = disponibilidad[r.id];
              const estado = d ? ESTADO_DE_STOCK[d.estado] : null;
              return (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-800">
                      {r.nombre}
                      {r.cantidad && <span className="text-gray-400"> ×{r.cantidad}</span>}
                      {r.codigo && <span className="ml-1.5 font-mono text-xs text-gray-400">{r.codigo}</span>}
                    </div>
                    {estado && (
                      <div className={`text-xs ${estado.color}`}>
                        {estado.label}
                        {d.insumo?.stock !== null && d.insumo?.stock !== undefined && ` · ${d.insumo.stock} en stock`}
                        {d.insumo?.ubicacion && ` · ${d.insumo.ubicacion}`}
                      </div>
                    )}
                  </div>
                  {puedeEditar && (
                    <button
                      onClick={() => sacar(r.id)}
                      className="shrink-0 text-xs text-gray-400 hover:text-red-600"
                      title="Sacar de la lista"
                    >×</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {puedeEditar && <Agregar ordenId={orden.id} onAgregado={traer} onError={setError} />}
      </div>
    </div>
  );
}

/**
 * Sumar un repuesto, buscándolo en el inventario.
 *
 * Buscar antes de escribir es lo que hace que el código quede bien puesto: con
 * el código, después se sabe si hay stock sin adivinar por el nombre.
 */
function Agregar({
  ordenId, onAgregado, onError,
}: {
  ordenId: string;
  onAgregado: () => void;
  onError: (e: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [sugerencias, setSugerencias] = useState<Insumo[]>([]);
  const [guardando, setGuardando] = useState(false);

  // Se busca mientras se escribe, pero recién cuando hay letras suficientes:
  // con dos, el inventario entero es una sugerencia.
  useEffect(() => {
    if (nombre.trim().length < 3) { setSugerencias([]); return; }

    const t = setTimeout(async () => {
      const res = await fetch(`/api/mantenimiento/inventario?q=${encodeURIComponent(nombre.trim())}`);
      if (!res.ok) return;
      const body = await res.json();
      setSugerencias(body.data ?? []);
    }, 300);

    return () => clearTimeout(t);
  }, [nombre]);

  async function agregar() {
    if (!nombre.trim()) return;
    setGuardando(true);

    const res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/repuestos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim(), cantidad: cantidad.trim() }),
    });
    setGuardando(false);

    if (!res.ok) {
      onError((await res.json().catch(() => ({}))).error ?? "No se pudo agregar.");
      return;
    }
    setNombre(""); setCodigo(""); setCantidad(""); setSugerencias([]);
    onAgregado();
  }

  return (
    <div className="space-y-2 border-t border-gray-100 pt-3">
      <div className="relative">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Rodamiento 6206, correa B-75…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {sugerencias.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {sugerencias.map((s, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setNombre(s.descripcion ?? "");
                    setCodigo(s.codigo ?? "");
                    setSugerencias([]);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                >
                  <span className="text-gray-800">{s.descripcion}</span>
                  {s.codigo && <span className="ml-1.5 font-mono text-xs text-gray-400">{s.codigo}</span>}
                  {s.stock !== null && <span className="ml-1.5 text-xs text-gray-400">· {s.stock}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          placeholder="Cantidad"
          className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={agregar}
          disabled={guardando || !nombre.trim()}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Sumar
        </button>
      </div>
    </div>
  );
}
