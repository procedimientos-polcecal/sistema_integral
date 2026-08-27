"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { moneda } from "@/lib/compras/constants";
import type { Proveedor } from "@/lib/compras/types";

type Estadistica = { pedidos: number; monto: number };

export default function ProveedoresClient({
  proveedores, estadisticas, canEdit,
}: {
  proveedores: Proveedor[];
  estadisticas: Record<string, Estadistica>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<"monto" | "nombre">("monto");
  // Qué proveedor tiene desplegados sus datos. Uno por vez: son ocho campos y
  // varios abiertos a la vez convierten la lista en una pared de texto.
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [creando, setCreando] = useState(false);

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? proveedores.filter(
          (p) =>
            p.nombre.toLowerCase().includes(q) ||
            (p.rubro ?? "").toLowerCase().includes(q) ||
            (p.contacto ?? "").toLowerCase().includes(q)
        )
      : proveedores;

    return [...base].sort((a, b) =>
      orden === "nombre"
        ? a.nombre.localeCompare(b.nombre, "es")
        : (estadisticas[b.id]?.monto ?? 0) - (estadisticas[a.id]?.monto ?? 0)
    );
  }, [proveedores, busqueda, orden, estadisticas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Proveedores</h1>
          <p className="text-sm text-slate-500">
            {proveedores.length} proveedores. El padrón lo comparten Compras y Mantenimiento.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setCreando(true)}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            + Nuevo proveedor
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Buscar proveedor, rubro o contacto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={orden}
          onChange={(e) => setOrden(e.target.value as typeof orden)}
        >
          <option value="monto">Ordenar por monto comprado</option>
          <option value="nombre">Ordenar por nombre</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-left">Rubro</th>
                <th className="px-3 py-2 text-left">Contacto</th>
                <th className="px-3 py-2 text-left">Teléfono</th>
                <th className="px-3 py-2 text-right">Pedidos</th>
                <th className="px-3 py-2 text-right">Monto</th>
                {canEdit && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-3 py-10 text-center text-slate-400">
                    Ningún proveedor coincide con la búsqueda.
                  </td>
                </tr>
              ) : (
                filas.map((p) => {
                  const stat = estadisticas[p.id];
                  const desplegado = abierto === p.id;
                  return (
                    <Fragment key={p.id}>
                    <tr
                      onClick={() => setAbierto(desplegado ? null : p.id)}
                      className={`cursor-pointer hover:bg-slate-50 ${p.activo ? "" : "opacity-50"} ${desplegado ? "bg-slate-50" : ""}`}
                    >
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {p.nombre}
                        {p.es_contratista && (
                          <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
                            contratista
                          </span>
                        )}
                        {!p.activo && <span className="ml-1.5 text-xs text-slate-400">(inactivo)</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{p.rubro ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{p.contacto ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{p.telefono ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{stat?.pedidos ?? 0}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {stat ? moneda(stat.monto) : "—"}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2">
                          <button
                            // Sin esto, tocar Editar también despliega la fila.
                            onClick={(e) => { e.stopPropagation(); setEditando(p); }}
                            className="text-xs text-slate-500 hover:text-slate-900"
                          >
                            Editar
                          </button>
                        </td>
                      )}
                    </tr>

                    {desplegado && (
                      <tr className="bg-slate-50">
                        <td colSpan={canEdit ? 7 : 6} className="px-3 pb-3">
                          <DatosDelProveedor p={p} />
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
      </div>

      {(editando || creando) && (
        <ModalProveedor
          proveedor={editando}
          onClose={() => { setEditando(null); setCreando(false); }}
          onSaved={() => { setEditando(null); setCreando(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Lo que hace falta para pagarle a un proveedor.
 *
 * Vive escondido detrás de un toque y no en la tabla porque son nueve campos
 * más: en la fila no entran, y en el 90% de las visitas a esta pantalla nadie
 * los está buscando. Cuando se los busca, se los busca de a uno.
 *
 * Los campos vacíos no se dibujan. Una grilla llena de guiones se lee como
 * "esto está roto"; que falte lo que falta se ve mejor por ausencia.
 */
function DatosDelProveedor({ p }: { p: Proveedor }) {
  const campos: [string, string | null][] = [
    ["CUIT", p.cuit],
    ["Plazo de pago", p.plazo_pago_dias === null ? null : `${p.plazo_pago_dias} días`],
    ["Forma de pago", p.forma_pago],
    ["Condición", p.condicion_pago],
    ["CBU", p.cbu],
    ["Alias", p.alias_bancario],
    ["Teléfono alternativo", p.telefono_alt],
    ["Email", p.email],
    ["Dirección", p.direccion],
    ["Sitio web", p.sitio_web],
  ];
  const cargados = campos.filter(([, v]) => v !== null && v !== "");

  if (cargados.length === 0 && !p.notas && !p.comentario) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-400">
        De este proveedor no hay más datos cargados. Los trae la base de datos de
        administración, y ahí todavía no figuran.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {cargados.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">{etiqueta}</dt>
            <dd
              className={`text-slate-800 ${
                // El CBU y el CUIT se copian y se comparan dígito a dígito.
                etiqueta === "CBU" || etiqueta === "CUIT" ? "font-mono break-all" : "break-words"
              }`}
            >
              {valor}
            </dd>
          </div>
        ))}
      </dl>

      {(p.notas || p.comentario) && (
        <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">
          {[p.notas, p.comentario].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

function ModalProveedor({
  proveedor, onClose, onSaved,
}: {
  proveedor: Proveedor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nombre: proveedor?.nombre ?? "",
    cuit: proveedor?.cuit ?? "",
    rubro: proveedor?.rubro ?? "",
    contacto: proveedor?.contacto ?? "",
    telefono: proveedor?.telefono ?? "",
    email: proveedor?.email ?? "",
    notas: proveedor?.notas ?? "",
    es_contratista: proveedor?.es_contratista ?? false,
    activo: proveedor?.activo ?? true,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");

    const res = await fetch(
      proveedor ? `/api/compras/proveedores/${proveedor.id}` : "/api/compras/proveedores",
      {
        method: proveedor ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          nombre: form.nombre.trim(),
          cuit: form.cuit.trim() || null,
          rubro: form.rubro.trim() || null,
          contacto: form.contacto.trim() || null,
          telefono: form.telefono.trim() || null,
          email: form.email.trim() || null,
          notas: form.notas.trim() || null,
        }),
      }
    );

    setGuardando(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo guardar el proveedor.");
      return;
    }
    onSaved();
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="mt-10 w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">
            {proveedor ? "Editar proveedor" : "Nuevo proveedor"}
          </h2>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-6 py-5">
          <Campo label="Nombre" requerido>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.nombre}
              onChange={(e) => set("nombre", e.target.value)}
              required
              autoFocus
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ["cuit", "CUIT", ""],
              ["rubro", "Rubro", "Rodamientos, hierros…"],
              ["contacto", "Contacto", ""],
              ["telefono", "Teléfono", ""],
              ["email", "Email", ""],
            ] as const).map(([campo, label, ph]) => (
              <Campo key={campo} label={label}>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form[campo] as string}
                  onChange={(e) => set(campo, e.target.value)}
                  placeholder={ph}
                />
              </Campo>
            ))}
          </div>

          <Campo label="Notas">
            <textarea
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={form.notas}
              onChange={(e) => set("notas", e.target.value)}
            />
          </Campo>

          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.es_contratista}
                onChange={(e) => set("es_contratista", e.target.checked)} />
              Presta servicios (aparece como contratista en Mantenimiento)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} />
              Proveedor activo
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button type="submit" disabled={guardando || !form.nombre.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
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
