"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ETIQUETA_DEL_BOTON,
  ETIQUETA_DE_ESTADO,
  LUGARES_DE_DESCARGA,
  estadoDeLaRecepcion,
  netoDeLaRecepcion,
  proximoPaso,
} from "@/lib/despacho/recepcion";
import type { FilaDeRecepcion, ProveedorParaElAlta } from "./page";

/**
 * La balanza.
 *
 * **Un solo botón por fila**, el del próximo paso. Con un camión esperando,
 * tres botones son tres oportunidades de apretar el que no es, y un peso en el
 * campo equivocado no se ve hasta que la orden ya está confirmada en Odoo.
 *
 * Al cerrar, el número de orden se muestra **en grande**: es lo que el
 * carbonillero se lleva anotado y el motivo por el que la orden se crea en el
 * momento y no después.
 */
export default function RecepcionesClient({
  fecha,
  puedeEditar,
  esAdmin,
  filas,
  proveedores,
  empresas,
}: {
  fecha: string;
  puedeEditar: boolean;
  esAdmin: boolean;
  filas: FilaDeRecepcion[];
  proveedores: ProveedorParaElAlta[];
  empresas: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ordenReciente, setOrdenReciente] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pesando, setPesando] = useState<{ id: string; campo: "peso_bruto_kg" | "peso_tara_kg" } | null>(null);
  const [peso, setPeso] = useState("");
  const [creando, setCreando] = useState(false);

  async function llamar(url: string, metodo: string, cuerpo: Record<string, unknown>) {
    setError("");
    setAvisos([]);
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar.");
      return null;
    }
    if (json.aviso) setAvisos([json.aviso]);
    if (json.avisos) setAvisos(json.avisos);
    return json;
  }

  async function guardarPeso() {
    if (!pesando) return;
    setOcupado(pesando.id);
    const json = await llamar(`/api/despacho/recepciones/${pesando.id}`, "PATCH", {
      [pesando.campo]: peso,
    });
    setOcupado(null);
    if (json) {
      setPesando(null);
      setPeso("");
      router.refresh();
    }
  }

  async function cerrar(id: string) {
    setOcupado(id);
    const json = await llamar(`/api/despacho/recepciones/${id}`, "PATCH", { accion: "cerrar" });
    setOcupado(null);
    if (json) {
      setOrdenReciente(json.orden ?? null);
      router.refresh();
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Recepción de material</h1>
          <p className="text-sm text-slate-500">
            El camión en la balanza: bruto, descarga, tara. Al cerrar se crea la
            orden de compra en Odoo y se escribe la planilla.
          </p>
        </div>
        {puedeEditar && (
          <button
            onClick={() => setCreando(true)}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
          >
            + Llegó un camión
          </button>
        )}
      </div>

      {ordenReciente && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <p className="text-sm text-emerald-800">Orden creada en Odoo. El número para el remito:</p>
          <p className="text-3xl font-bold tracking-wide text-emerald-900">{ordenReciente}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {avisos.map((a, i) => (
        <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {a}
        </div>
      ))}

      {creando && (
        <Alta
          proveedores={proveedores}
          empresas={empresas}
          fecha={fecha}
          onCerrar={() => setCreando(false)}
          onCreado={(aviso) => {
            setCreando(false);
            if (aviso) setAvisos([aviso]);
            router.refresh();
          }}
          onError={setError}
        />
      )}

      {filas.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Hoy todavía no entró ningún camión.
        </p>
      ) : (
        <div className="space-y-2">
          {filas.map(({ recepcion, proveedor, atrasada }) => {
            const estado = estadoDeLaRecepcion(recepcion);
            const paso = proximoPaso(recepcion);
            const neto = netoDeLaRecepcion(recepcion);
            return (
              <div
                key={recepcion.id}
                className={`rounded-xl border bg-white px-4 py-3 ${
                  atrasada ? "border-amber-300" : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">
                      {proveedor}
                      {recepcion.odoo_product_nombre && (
                        <span className="ml-2 text-sm font-normal text-slate-500">
                          {recepcion.odoo_product_nombre.trim()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {atrasada && <span className="text-amber-700">{recepcion.fecha} · </span>}
                      {ETIQUETA_DE_ESTADO[estado]}
                      {recepcion.peso_bruto_kg !== null && ` · bruto ${recepcion.peso_bruto_kg} kg`}
                      {recepcion.peso_tara_kg !== null && ` · tara ${recepcion.peso_tara_kg} kg`}
                      {neto.toneladas !== null && ` · neto ${neto.toneladas} t`}
                      {recepcion.lugar_descarga && ` · ${recepcion.lugar_descarga}`}
                    </div>
                    {recepcion.odoo_purchase_name && (
                      <div className="text-xs font-semibold text-emerald-700">
                        {recepcion.odoo_purchase_name}
                        {recepcion.odoo_picking_id === null && " · sin recepción validada"}
                      </div>
                    )}
                    {recepcion.odoo_error && (
                      <div className="mt-1 text-xs text-red-700">Odoo: {recepcion.odoo_error}</div>
                    )}
                    {recepcion.sheets_pendiente && (
                      <div className="mt-1 text-xs text-red-700">
                        Planilla: {recepcion.sheets_pendiente}
                      </div>
                    )}
                    {neto.problema && (
                      <div className="mt-1 text-xs text-red-700">{neto.problema}</div>
                    )}
                  </div>

                  {puedeEditar && paso && (
                    <button
                      onClick={() =>
                        paso === "lista"
                          ? cerrar(recepcion.id)
                          : (setPesando({
                              id: recepcion.id,
                              campo: paso === "esperando_bruto" ? "peso_bruto_kg" : "peso_tara_kg",
                            }),
                            setPeso(""))
                      }
                      disabled={ocupado === recepcion.id}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                    >
                      {ocupado === recepcion.id ? "Guardando…" : ETIQUETA_DEL_BOTON[paso]}
                    </button>
                  )}
                </div>

                {pesando?.id === recepcion.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-700">
                        {pesando.campo === "peso_bruto_kg" ? "Peso bruto" : "Peso tara"} (kg)
                      </span>
                      <input
                        value={peso}
                        onChange={(e) => setPeso(e.target.value)}
                        inputMode="decimal"
                        autoFocus
                        className="mt-1 w-40 rounded-lg border border-slate-300 px-3 py-2 text-lg"
                      />
                    </label>
                    <button
                      onClick={guardarPeso}
                      disabled={ocupado === recepcion.id || peso.trim() === ""}
                      className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setPesando(null)}
                      className="px-2 py-2 text-sm text-slate-500 hover:text-slate-700"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {esAdmin && (
        <p className="text-xs text-slate-500">
          Qué producto de Odoo y qué nombre de planilla le corresponde a cada
          proveedor se carga en{" "}
          <Link href="/despacho/recepciones/proveedores" className="underline">
            proveedores de recepción
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Alta({
  proveedores,
  empresas,
  fecha,
  onCerrar,
  onCreado,
  onError,
}: {
  proveedores: ProveedorParaElAlta[];
  empresas: { id: string; nombre: string }[];
  fecha: string;
  onCerrar: () => void;
  onCreado: (aviso?: string) => void;
  onError: (e: string) => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  const [lugar, setLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [bruto, setBruto] = useState("");
  const [guardando, setGuardando] = useState(false);

  const elegido = proveedores.find((p) => p.id === proveedorId);

  async function guardar() {
    setGuardando(true);
    const res = await fetch("/api/despacho/recepciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fecha,
        proveedor_id: proveedorId,
        empresa_id: empresaId,
        lugar_descarga: lugar || null,
        notas: notas || null,
        peso_bruto_kg: bruto || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      onError(json.error ?? "No se pudo cargar el camión.");
      return;
    }
    onCreado(json.aviso);
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Llegó un camión</h2>
        <button onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-700">
          Cancelar
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Proveedor</span>
          <select
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.producto ? "" : " (sin producto configurado)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Empresa</span>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Dónde descarga</span>
          <select
            value={lugar}
            onChange={(e) => setLugar(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Todavía no se sabe</option>
            {LUGARES_DE_DESCARGA.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Peso bruto (kg)</span>
          <input
            value={bruto}
            onChange={(e) => setBruto(e.target.value)}
            inputMode="decimal"
            placeholder="Se puede pesar después"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-slate-700">Notas</span>
        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Lo que va en la columna Notas de la planilla"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      {elegido && !elegido.producto && (
        <p className="text-xs text-amber-700">
          Ese proveedor no tiene cargado qué producto de Odoo le corresponde: se
          va a poder pesar, pero no cerrar.
        </p>
      )}

      <button
        onClick={guardar}
        disabled={guardando || !proveedorId || !empresaId}
        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
      >
        {guardando ? "Guardando…" : "Cargar el camión"}
      </button>
    </div>
  );
}
