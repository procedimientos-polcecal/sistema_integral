"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import type { ReparacionDB } from "@/lib/tallerVial/types";
import RepuestosDelTrabajo from "../RepuestosDelTrabajo";
import BuscadorDeArticulo, { type ArticuloOpcion } from "../BuscadorDeArticulo";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const TIPOS = ["Reparación", "Revisión"];

interface RepuestoAUsar extends ArticuloOpcion {
  cantidad: number;
}

export default function ReparacionesClient({
  equipos, reparaciones, puedeEditar,
}: {
  equipos: EquipoTallerVial[];
  reparaciones: ReparacionDB[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const hoy = new Date().toISOString().slice(0, 10);

  const [equipoId, setEquipoId] = useState(equipos[0]?.id ?? "");
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [fecha, setFecha] = useState(hoy);
  const [descripcion, setDescripcion] = useState("");
  const [horas, setHoras] = useState("");
  const [horometro, setHorometro] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filaAbierta, setFilaAbierta] = useState<string | null>(null);

  // Repuestos elegidos antes de cargar la reparación: se reservan recién
  // después de crearla, porque la reserva necesita su id.
  const [repuestosAUsar, setRepuestosAUsar] = useState<RepuestoAUsar[]>([]);
  const [articuloElegido, setArticuloElegido] = useState<ArticuloOpcion | null>(null);
  const [cantidadRepuesto, setCantidadRepuesto] = useState("");

  function agregarRepuestoAUsar() {
    if (!articuloElegido) return;
    const n = Number(cantidadRepuesto.replace(",", "."));
    if (!isFinite(n) || n <= 0) { setError("La cantidad del repuesto tiene que ser mayor a cero"); return; }
    setRepuestosAUsar((lista) => [...lista, { ...articuloElegido, cantidad: n }]);
    setArticuloElegido(null);
    setCantidadRepuesto("");
    setError(null);
  }

  function quitarRepuestoAUsar(id: string) {
    setRepuestosAUsar((lista) => lista.filter((r) => r.id !== id));
  }

  async function cargar() {
    if (!equipoId) { setError("Elegí un equipo"); return; }
    if (!descripcion.trim()) { setError("Contá qué se le hizo al equipo"); return; }

    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch("/api/taller-vial/reparaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipo_id: equipoId,
          tipo,
          fecha,
          descripcion: descripcion.trim(),
          horas: horas.trim() === "" ? null : Number(horas.replace(",", ".")),
          horometro: horometro.trim() === "" ? null : Number(horometro.replace(",", ".")),
          observaciones: observaciones.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");

      const avisos: string[] = [];
      for (const r of repuestosAUsar) {
        const resRep = await fetch("/api/taller-vial/repuestos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reparacion_id: json.data.id, articulo_id: r.id, cantidad: r.cantidad }),
        });
        const jsonRep = await resRep.json();
        if (!resRep.ok) avisos.push(`${r.codigo}: ${jsonRep.error ?? "no se pudo reservar"}`);
        else if (jsonRep.aviso) avisos.push(jsonRep.aviso.mensaje);
      }
      if (avisos.length > 0) setAviso(avisos.join(" · "));

      setDescripcion("");
      setHoras("");
      setHorometro("");
      setObservaciones("");
      setRepuestosAUsar([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Borrar esta reparación?")) return;
    const res = await fetch(`/api/taller-vial/reparaciones?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "No se pudo borrar"); return; }
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/taller-vial" className="text-xs text-slate-500 underline">← Taller Vial</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Reparaciones</h1>
        <p className="page-subheader">El historial de intervenciones a cada equipo.</p>
      </div>

      {puedeEditar && (
        <section className="card mt-4 p-4">
          <h2 className="section-title">Cargar una reparación</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
            <select className="input sm:col-span-2" value={equipoId} onChange={(e) => setEquipoId(e.target.value)}>
              {equipos.map((eq) => (
                <option key={eq.id} value={eq.id}>{eq.code} - {eq.name}</option>
              ))}
            </select>
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input
              className="input" inputMode="decimal" placeholder="Horas de trabajo (opcional)"
              value={horas} onChange={(e) => setHoras(e.target.value)}
            />
          </div>
          <div className="mt-2">
            <input
              className="input w-full" placeholder="Qué se le hizo al equipo"
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              className="input" inputMode="decimal" placeholder="Horómetro (opcional)"
              value={horometro} onChange={(e) => setHorometro(e.target.value)}
            />
            <input
              className="input sm:col-span-2" placeholder="Observaciones (opcional)"
              value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>

          {/* ── Repuestos del pañol usados en esta reparación ── */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="section-title">Repuestos del pañol usados (opcional)</p>
            {repuestosAUsar.length > 0 && (
              <ul className="mt-2 space-y-1">
                {repuestosAUsar.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-xs text-slate-700">
                    <span>{r.codigo} - {r.descripcion} × {r.cantidad}</span>
                    <button className="text-slate-400 underline hover:text-red-600" onClick={() => quitarRepuestoAUsar(r.id)}>Quitar</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                {articuloElegido ? (
                  <div className="input flex items-center justify-between">
                    <span>{articuloElegido.codigo} - {articuloElegido.descripcion}</span>
                    <button className="text-slate-400 hover:text-slate-700" onClick={() => setArticuloElegido(null)}>✕</button>
                  </div>
                ) : (
                  <BuscadorDeArticulo onElegir={setArticuloElegido} />
                )}
              </div>
              <input
                className="input w-24" inputMode="decimal" placeholder="Cant."
                value={cantidadRepuesto} onChange={(e) => setCantidadRepuesto(e.target.value)}
              />
              <button type="button" className="btn-secondary shrink-0" onClick={agregarRepuestoAUsar}>Agregar</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">Esto reserva el repuesto — Inventario confirma la baja real después.</p>
          </div>

          <div className="mt-3 flex justify-end">
            <button className="btn-primary" disabled={guardando} onClick={cargar}>Cargar</button>
          </div>
          {aviso && <p className="mt-2 text-sm text-amber-700">{aviso}</p>}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      )}

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Equipo</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th className="text-right">Horas</th>
                <th className="text-right">Horómetro</th>
                <th>Observaciones</th>
                <th>Repuestos</th>
              </tr>
            </thead>
            <tbody>
              {reparaciones.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400">Todavía no hay ninguna reparación cargada.</td></tr>
              ) : (
                reparaciones.map((r) => {
                  const equipo = equipos.find((e) => e.id === r.equipo_id);
                  const abierta = filaAbierta === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="whitespace-nowrap">{r.fecha}</td>
                        <td className="text-slate-800">{equipo ? `${equipo.code} - ${equipo.name}` : "—"}</td>
                        <td className="text-slate-500">{r.tipo}</td>
                        <td className="text-slate-700">{r.descripcion}</td>
                        <td className="text-right font-mono tabular-nums">{r.horas !== null ? num0.format(r.horas) : "—"}</td>
                        <td className="text-right font-mono tabular-nums">{r.horometro !== null ? num0.format(r.horometro) : "—"}</td>
                        <td className="text-slate-500">{r.observaciones ?? ""}</td>
                        <td className="whitespace-nowrap">
                          <button className="btn-ghost" onClick={() => setFilaAbierta(abierta ? null : r.id)}>
                            {abierta ? "Ocultar" : "Ver / agregar"}
                          </button>
                          {puedeEditar && (
                            <button className="btn-ghost text-red-600" onClick={() => borrar(r.id)}>Borrar</button>
                          )}
                        </td>
                      </tr>
                      {abierta && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 p-3">
                            <RepuestosDelTrabajo reparacionId={r.id} puedeEditar={puedeEditar} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
