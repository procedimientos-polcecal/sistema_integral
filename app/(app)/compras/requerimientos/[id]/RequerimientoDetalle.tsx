"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ESTADOS_COMPRA, COMPRA_LABELS, APROBACION_LABELS, PRIORIDAD_LABELS, PRIORIDADES, etiquetaPrioridad,
  moneda, fecha, fechaHora, diasRestantes, etiquetaEmpresa,
} from "@/lib/compras/constants";
import type {
  RequerimientoConRelaciones, HistorialItem, Cotizacion, EstadoCompra, Prioridad,
} from "@/lib/compras/types";
import Comparativa from "./Comparativa";
import type { CotizacionDolar } from "@/lib/compras/dolar";
import type { ProveedorElegible } from "@/lib/compras/comparativa";
import SelectorProveedor from "../../SelectorProveedor";
import type { EntradaAlPanol } from "@/lib/inventario/types";

export default function RequerimientoDetalle({
  requerimiento: r, historial, cotizaciones, proveedores, empresas, puedeEditar, puedeAprobar,
  esAsignado, aprobadores, dolar, entradasAlPanol = [],
}: {
  requerimiento: RequerimientoConRelaciones;
  /** Lo que el pañol registró contra este RI. Vacío si no entró nada todavía. */
  entradasAlPanol?: EntradaAlPanol[];
  historial: HistorialItem[];
  cotizaciones: Cotizacion[];
  proveedores: ProveedorElegible[];
  empresas: { id: string; nombre: string }[];
  puedeEditar: boolean;
  puedeAprobar: boolean;
  esAsignado: boolean;
  aprobadores: { id: string; nombre: string; apellido: string }[];
  /** Con qué convertir los presupuestos que vinieron en dólares. */
  dolar: CotizacionDolar | null;
}) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const [estadoCompra, setEstadoCompra] = useState<EstadoCompra>(r.estado_compra);
  const [proveedorId, setProveedorId] = useState(r.proveedor_id ?? "");
  const [costoIva, setCostoIva] = useState(r.costo_iva !== null ? String(r.costo_iva) : "");
  const [costoEnvio, setCostoEnvio] = useState(r.costo_envio !== null ? String(r.costo_envio) : "");
  const [comparativaUrl, setComparativaUrl] = useState(r.comparativa_url ?? "");
  const [ocNumero, setOcNumero] = useState(r.oc_numero ?? "");
  const [asignadoA, setAsignadoA] = useState(r.compra_asignada_a ?? "");

  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [mostrarRechazo, setMostrarRechazo] = useState(false);

  // Los define quien aprueba: el área pide, gerencia decide urgencia y quién paga.
  // Arrancan como estén: si nadie las definió, vacías. Hay que elegir para
  // poder aprobar — es la decisión que la aprobación tiene que dejar tomada.
  const [prioridad, setPrioridad] = useState<Prioridad | "">(r.prioridad ?? "");
  const [paga, setPaga] = useState<string>(
    r.empresa_id ?? (r.paga_ambas ? "AMBAS" : "")
  );

  async function guardar(cambios: Record<string, unknown>) {
    setGuardando(true);
    setError("");
    const res = await fetch(`/api/compras/requerimientos/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    setGuardando(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el cambio.");
      return false;
    }
    // El cambio quedó guardado, pero la planilla puede haber rechazado alguna
    // celda protegida. Hay que decirlo: si no, se asume que quedó sincronizada.
    setAviso(body.aviso_sheets ?? null);
    router.refresh();
    return true;
  }

  const dias = diasRestantes(r.fecha_necesidad);
  const total = (r.costo_iva ?? 0) + (r.costo_envio ?? 0);
  const resuelto = r.estado_aprobacion === "APROBADA" || r.estado_aprobacion === "DENEGADA";

  return (
    <div className="space-y-4">
      <Link href="/compras/requerimientos" className="text-sm text-slate-500 hover:text-slate-900">
        ← Volver a requerimientos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-400">RI N° {r.nro_ri}</span>
            <Chip {...etiquetaPrioridad(r.prioridad)} />
            <span className="text-xs text-slate-500">Paga: {etiquetaEmpresa(r.empresas?.nombre, r.paga_ambas)}</span>
          </div>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{r.descripcion}</h1>
          <p className="text-sm text-slate-500">
            {r.compras_areas?.nombre ?? "Sin área"} · Cargado el {fechaHora(r.fecha)}
            {r.solicitante_nombre ? ` por ${r.solicitante_nombre}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Chip {...APROBACION_LABELS[r.estado_aprobacion]} />
          <Chip {...COMPRA_LABELS[r.estado_compra]} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {aviso && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {aviso}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Datos del pedido */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Datos del requerimiento
            </h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato label="Código de artículo" valor={r.codigo} mono />
              <Dato label="Cantidad" valor={r.cantidad !== null ? String(r.cantidad) : null} />
              <Dato
                label="Dónde se necesita"
                valor={r.compras_ubicaciones?.nombre ?? r.ubicacion_raw}
              />
              <Dato
                label="Para cuándo"
                alerta={dias !== null && dias < 0 && r.estado_compra !== "RECIBIDO"}
                valor={
                  r.fecha_necesidad
                    ? `${fecha(r.fecha_necesidad)}${
                        dias !== null && r.estado_compra !== "RECIBIDO"
                          ? dias < 0 ? ` · vencido hace ${Math.abs(dias)} d`
                          : dias === 0 ? " · es hoy"
                          : ` · faltan ${dias} d`
                          : ""
                      }`
                    : null
                }
              />
            </dl>

            {r.detalle_extra && (
              <div className="mt-5">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Detalle extra</div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{r.detalle_extra}</p>
              </div>
            )}

            {r.imagen_url && (
              <div className="mt-5">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Adjunto</div>
                <a href={r.imagen_url} target="_blank" rel="noopener noreferrer"
                   className="break-all text-sm text-[var(--primary)] hover:underline">
                  {r.imagen_url}
                </a>
              </div>
            )}
          </section>

          {/* Gestión de compra */}
          {puedeEditar && r.estado_aprobacion === "APROBADA" && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Gestión de compra
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Estado de la compra">
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={estadoCompra}
                    onChange={(e) => setEstadoCompra(e.target.value as EstadoCompra)}
                  >
                    {ESTADOS_COMPRA.filter((e) => e !== "DENEGADO").map((e) => (
                      <option key={e} value={e}>{COMPRA_LABELS[e].label}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Proveedor elegido">
                  <SelectorProveedor
                    proveedores={proveedores}
                    valor={proveedorId}
                    onCambio={setProveedorId}
                    placeholder="Sin definir"
                  />
                </Campo>
                <Campo label="Costo + IVA">
                  <input type="number" step="0.01" min="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={costoIva} onChange={(e) => setCostoIva(e.target.value)} placeholder="0.00" />
                </Campo>
                <Campo label="Costo de envío">
                  <input type="number" step="0.01" min="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={costoEnvio} onChange={(e) => setCostoEnvio(e.target.value)} placeholder="0.00" />
                </Campo>
                <Campo label="N° de orden de compra">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={ocNumero} onChange={(e) => setOcNumero(e.target.value)} placeholder="Opcional" />
                </Campo>
                <Campo label="A quién le toca aprobarla">
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={asignadoA}
                    onChange={(e) => setAsignadoA(e.target.value)}
                  >
                    <option value="">Sin asignar</option>
                    {aprobadores.map((a) => (
                      <option key={a.id} value={a.id}>{a.nombre} {a.apellido}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">
                    Es lo que va entre paréntesis en el estado de la planilla, y sólo esa
                    persona puede aprobar la compra.
                  </p>
                </Campo>
                <Campo label="Enlace a la comparativa">
                  <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={comparativaUrl} onChange={(e) => setComparativaUrl(e.target.value)} placeholder="https://…" />
                </Campo>
              </div>

              <button
                onClick={() =>
                  guardar({
                    estado_compra: estadoCompra,
                    proveedor_id: proveedorId || null,
                    costo_iva: costoIva === "" ? null : Number(costoIva),
                    costo_envio: costoEnvio === "" ? null : Number(costoEnvio),
                    comparativa_url: comparativaUrl.trim() || null,
                    oc_numero: ocNumero.trim() || null,
                    compra_asignada_a: asignadoA || null,
                  })
                }
                disabled={guardando}
                className="mt-4 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
              >
                {guardando ? "Guardando…" : "Guardar cambios de compra"}
              </button>
            </section>
          )}

          <Comparativa
            dolar={dolar}
            requerimiento={r}
            cotizaciones={cotizaciones}
            proveedores={proveedores}
            puedeEditar={puedeEditar}
            esAsignado={esAsignado}
          />
        </div>

        {/* Columna lateral */}
        <div className="space-y-4">
          {/* Aprobación */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aprobación</h2>

            {resuelto ? (
              <div className="space-y-1 text-sm text-slate-600">
                <div>
                  <strong>{APROBACION_LABELS[r.estado_aprobacion].label}</strong>
                  {r.aprobador ? ` por ${r.aprobador}` : ""}
                </div>
                {r.aprobado_en && <div className="text-xs text-slate-400">{fechaHora(r.aprobado_en)}</div>}
                {r.motivo_rechazo && <div className="pt-1 text-red-600">Motivo: {r.motivo_rechazo}</div>}
              </div>
            ) : puedeAprobar ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">Este requerimiento espera tu decisión.</p>

                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">
                    Confirmá la urgencia y quién paga: lo que cargó el área es una
                    sugerencia.
                  </p>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Prioridad
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={prioridad}
                      onChange={(e) => setPrioridad(e.target.value as Prioridad)}
                    >
                      <option value="">Elegir…</option>
                      {PRIORIDADES.map((p) => (
                        <option key={p} value={p}>{PRIORIDAD_LABELS[p].label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Quién paga
                    </span>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      value={paga}
                      onChange={(e) => setPaga(e.target.value)}
                    >
                      <option value="">Elegir…</option>
                      {empresas.map((e2) => (
                        <option key={e2.id} value={e2.id}>{e2.nombre}</option>
                      ))}
                      <option value="AMBAS">Ambas</option>
                    </select>
                  </label>
                </div>

                <button
                  onClick={() =>
                    guardar({
                      estado_aprobacion: "APROBADA",
                      prioridad,
                      empresa_id: paga === "AMBAS" ? null : paga,
                      paga_ambas: paga === "AMBAS",
                    })
                  }
                  disabled={guardando || !prioridad || !paga}
                  title={!prioridad || !paga ? "Elegí la prioridad y quién paga" : undefined}
                  className="w-full rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                >
                  Aprobar
                </button>

                {!mostrarRechazo ? (
                  <button
                    onClick={() => setMostrarRechazo(true)}
                    disabled={guardando}
                    className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Denegar
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      rows={2}
                      className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Motivo del rechazo"
                      value={motivoRechazo}
                      onChange={(e) => setMotivoRechazo(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMostrarRechazo(false)}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await guardar({
                            estado_aprobacion: "DENEGADA",
                            motivo_rechazo: motivoRechazo.trim(),
                          });
                          if (ok) setMostrarRechazo(false);
                        }}
                        disabled={guardando || !motivoRechazo.trim()}
                        className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Pendiente de aprobación.</p>
            )}
          </section>

          {/* Resumen de compra */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Compra</h2>
            <dl className="space-y-3">
              <Dato label="Proveedor" valor={r.proveedores?.nombre} />
              <Dato label="Costo + IVA" valor={r.costo_iva !== null ? moneda(r.costo_iva) : null} mono />
              <Dato label="Envío" valor={r.costo_envio ? moneda(r.costo_envio) : null} mono />
              {total > 0 && <Dato label="Total" valor={moneda(total)} mono destacado />}
              <Dato label="N° de orden de compra" valor={r.oc_numero} mono />
              <Dato label="Fecha de pedido" valor={r.fecha_pedido ? fecha(r.fecha_pedido) : null} />
              <Dato label="Fecha de recepción" valor={r.fecha_recepcion ? fecha(r.fecha_recepcion) : null} />
              {r.comparativa_url && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Comparativa</dt>
                  <dd>
                    <a href={r.comparativa_url} target="_blank" rel="noopener noreferrer"
                       className="text-sm text-[var(--primary)] hover:underline">
                      Ver comparativa
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* ── Lo que entró al pañol ─────────────────────────
              Una entrada al pañol con este N° de RI es la recepción de este
              pedido. El sistema lo informa y ofrece marcarlo; **no lo decide
              solo**: una entrega parcial cerraría un pedido entero, y si esto
              está completo lo sabe quien lo recibió. Mismo criterio que los
              proveedores sin reconocer y las ubicaciones sin enlazar. */}
          {entradasAlPanol.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Entró al pañol
              </h2>
              <ul className="space-y-2">
                {entradasAlPanol.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-700">
                      <span className="font-mono text-xs text-slate-500">{e.codigo}</span>{" "}
                      {e.descripcion ?? ""}
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {e.cantidad} · {e.fecha ? fecha(e.fecha) : "sin fecha"}
                    </span>
                  </li>
                ))}
              </ul>

              {r.estado_compra !== "RECIBIDO" ? (
                puedeEditar && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-500">
                      El pañol registró la entrada de este material. Si el pedido
                      está completo, marcalo como recibido — puede haber venido
                      sólo una parte, así que lo decidís vos.
                    </p>
                    <button
                      onClick={() => guardar({ estado_compra: "RECIBIDO" })}
                      disabled={guardando}
                      className="mt-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                    >
                      {guardando ? "Guardando…" : "Marcar como recibido"}
                    </button>
                  </div>
                )
              ) : (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-green-700">
                  Marcado como recibido
                  {r.fecha_recepcion ? ` el ${fecha(r.fecha_recepcion)}` : ""}.
                </p>
              )}
            </section>
          )}

          {/* Historial */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</h2>
            {historial.length === 0 ? (
              <p className="text-sm text-slate-400">Sin movimientos registrados.</p>
            ) : (
              <ol className="space-y-3">
                {historial.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                    <div className="text-slate-900">
                      {h.campo === "estado_aprobacion"
                        ? "Aprobación"
                        : h.campo === "estado_compra"
                          ? "Compra"
                          : h.campo === "creacion"
                            ? "Creado"
                            : h.campo}
                      {/* La creación no cambia un valor: pasa a existir. */}
                      {h.valor_nuevo && <>{": "}<strong>{h.valor_nuevo}</strong></>}
                    </div>
                    <div className="text-xs text-slate-400">
                      {fechaHora(h.created_at)}{h.usuario_nombre ? ` · ${h.usuario_nombre}` : ""}
                    </div>
                    {h.nota && <div className="text-xs text-slate-600">{h.nota}</div>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      {label}
    </span>
  );
}

function Dato({
  label, valor, mono, alerta, destacado,
}: {
  label: string;
  valor?: string | null;
  mono?: boolean;
  alerta?: boolean;
  destacado?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={[
          mono ? "font-mono" : "",
          destacado ? "text-base font-bold" : "text-sm",
          alerta ? "text-red-600" : valor ? "text-slate-900" : "text-slate-400",
        ].join(" ")}
      >
        {valor || "—"}
      </dd>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
