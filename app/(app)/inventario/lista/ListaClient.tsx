"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TraerDeLaPlanilla from "../TraerDeLaPlanilla";
import type { UltimaSync } from "@/lib/core/sincronizaciones";

interface Solicitante {
  id: string;
  nombre: string;
  destino_id: string | null;
  empleado_id: string | null;
  activo: boolean;
}
interface Destino {
  id: string;
  nombre: string;
  sector_id: string | null;
  activo: boolean;
}
type Opcion = { id: string; nombre: string };

/**
 * La lista del pañol.
 *
 * Dos columnas y las dos son la validación de la planilla: quién puede figurar
 * en "QUIEN" y qué puede figurar en "SECTOR". Lo que se escribe acá es lo que la
 * app va a escribir allá, así que el nombre va tal cual —espacios de más
 * incluidos— y no se lo corrige por prolijidad.
 *
 * Se muestra además con qué se engancha cada fila en el resto del sistema. Es
 * información y no un trámite: un solicitante sin empleado sigue funcionando,
 * sólo que su consumo no se puede cruzar con RRHH. Lo que no se engancha se
 * deja vacío y se ve, porque enlazarlo al que se le parece es peor.
 */
export default function ListaClient({
  solicitantes, destinos, sectores, puedeEditar, sync,
}: {
  solicitantes: Solicitante[];
  destinos: Destino[];
  sectores: Opcion[];
  puedeEditar: boolean;
  sync: UltimaSync | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);

  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoDestino, setNuevoDestino] = useState("");
  const [nuevoDestinoNombre, setNuevoDestinoNombre] = useState("");

  const nombreDeDestino = (id: string | null) =>
    destinos.find((d) => d.id === id)?.nombre ?? null;
  const nombreDeSector = (id: string | null) =>
    sectores.find((s) => s.id === id)?.nombre ?? null;

  async function pedir(url: string, body: unknown) {
    setOcupado(true);
    setError("");
    const res = await fetch(url, {
      method: url.endsWith("/lista") ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) { setError(json.error ?? "No se pudo guardar."); return false; }
    router.refresh();
    return true;
  }

  const editar = (que: string, id: string, cambio: Record<string, unknown>) =>
    pedir(`/api/inventario/lista/${id}`, { que, ...cambio });

  const visibles = <T extends { activo: boolean }>(filas: T[]) =>
    verInactivos ? filas : filas.filter((f) => f.activo);

  const sinEmpleado = solicitantes.filter((s) => s.activo && !s.empleado_id).length;
  const sinSector = destinos.filter((d) => d.activo && !d.sector_id).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">La lista del pañol</h1>
        <p className="text-sm text-slate-500">
          Quién puede retirar y a dónde va. Es lo mismo que el desplegable de la
          planilla, y es lo que el formulario de movimientos escribe en las
          columnas <strong>QUIEN</strong> y <strong>SECTOR</strong> del kardex.
        </p>
      </div>

      {/* Acá el botón sirve para lo suyo: la sincronización engancha con el
          padrón los nombres que todavía están sueltos, y esta es la pantalla
          donde eso se ve. La lista la arma el servidor, así que alcanza con el
          refresh que el botón ya hace. */}
      <TraerDeLaPlanilla sync={sync} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
        Ver también los dados de baja
      </label>

      {/* ── Quién retira ──────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Quién retira <span className="font-normal text-slate-400">· {visibles(solicitantes).length}</span>
          </h2>
          {sinEmpleado > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {sinEmpleado} sin empleado del padrón. Funcionan igual — los
              contratistas y &laquo;REGULADOR&raquo; no son empleados — pero su
              consumo no se puede cruzar con RRHH.
            </p>
          )}
        </header>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Nombre</th>
              <th className="px-4 py-2 text-left">Destino habitual</th>
              <th className="px-4 py-2 text-left">Empleado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibles(solicitantes).map((s) => (
              <tr key={s.id} className={s.activo ? "" : "bg-slate-50 text-slate-400"}>
                <td className="px-4 py-2">{s.nombre}</td>
                <td className="px-4 py-2">
                  {puedeEditar ? (
                    <select
                      value={s.destino_id ?? ""}
                      disabled={ocupado}
                      onChange={(e) => editar("solicitante", s.id, { destino_id: e.target.value })}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">— sin destino</option>
                      {destinos.filter((d) => d.activo).map((d) => (
                        <option key={d.id} value={d.id}>{d.nombre}</option>
                      ))}
                    </select>
                  ) : (
                    nombreDeDestino(s.destino_id) ?? "—"
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {s.empleado_id ? "del padrón" : "sin enganchar"}
                </td>
                <td className="px-4 py-2 text-right">
                  {puedeEditar && (
                    <button
                      disabled={ocupado}
                      onClick={() => editar("solicitante", s.id, { activo: !s.activo })}
                      className="text-xs text-slate-500 underline hover:text-slate-900 disabled:opacity-40"
                    >
                      {s.activo ? "Dar de baja" : "Reactivar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {puedeEditar && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nuevoNombre.trim()) return;
              if (await pedir("/api/inventario/lista", {
                que: "solicitante", nombre: nuevoNombre, destino_id: nuevoDestino,
              })) { setNuevoNombre(""); setNuevoDestino(""); }
            }}
          >
            <label className="flex-1">
              <span className="block text-xs text-slate-500">
                Nombre, igual que en la planilla
              </span>
              <input
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="APELLIDO, Nombre"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <select
              value={nuevoDestino}
              onChange={(e) => setNuevoDestino(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">— sin destino</option>
              {destinos.filter((d) => d.activo).map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
            </select>
            <button
              disabled={ocupado || !nuevoNombre.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Agregar
            </button>
          </form>
        )}
      </section>

      {/* ── A dónde va ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            A dónde va <span className="font-normal text-slate-400">· {visibles(destinos).length}</span>
          </h2>
          {sinSector > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              {sinSector} sin sector del núcleo. La mayoría no lo tiene porque no
              es un sector — MECÁNICO y LUBRICADOR son oficios —, pero si alguno
              sí lo es, enlazarlo acá hace que su consumo aparezca en los
              informes por sector del resto del sistema.
            </p>
          )}
        </header>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Destino</th>
              <th className="px-4 py-2 text-left">Sector del sistema</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibles(destinos).map((d) => (
              <tr key={d.id} className={d.activo ? "" : "bg-slate-50 text-slate-400"}>
                <td className="px-4 py-2 font-medium">{d.nombre}</td>
                <td className="px-4 py-2">
                  {puedeEditar ? (
                    <select
                      value={d.sector_id ?? ""}
                      disabled={ocupado}
                      onChange={(e) => editar("destino", d.id, { sector_id: e.target.value })}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">— no es un sector</option>
                      {sectores.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  ) : (
                    nombreDeSector(d.sector_id) ?? "—"
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {puedeEditar && (
                    <button
                      disabled={ocupado}
                      onClick={() => editar("destino", d.id, { activo: !d.activo })}
                      className="text-xs text-slate-500 underline hover:text-slate-900 disabled:opacity-40"
                    >
                      {d.activo ? "Dar de baja" : "Reactivar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {puedeEditar && (
          <form
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nuevoDestinoNombre.trim()) return;
              if (await pedir("/api/inventario/lista", {
                que: "destino", nombre: nuevoDestinoNombre,
              })) setNuevoDestinoNombre("");
            }}
          >
            <label className="flex-1">
              <span className="block text-xs text-slate-500">
                Destino, igual que en la planilla
              </span>
              <input
                value={nuevoDestinoNombre}
                onChange={(e) => setNuevoDestinoNombre(e.target.value)}
                placeholder="TALLER VIAL"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              disabled={ocupado || !nuevoDestinoNombre.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Agregar
            </button>
          </form>
        )}
      </section>

      <p className="text-xs text-slate-400">
        Agregar a alguien acá no lo agrega al desplegable de la planilla: eso se
        hace allá, en la validación de datos. Mientras las dos listas no digan lo
        mismo, la app puede escribir un nombre que la planilla marca en rojo.
      </p>
    </div>
  );
}
