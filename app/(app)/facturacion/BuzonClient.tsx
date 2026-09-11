"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { normalizarCuit } from "@/lib/core/cuit";
import { esNotaDeCredito, nombreDelComprobante } from "@/lib/facturacion/comprobante";
import type { EmpresaDelGrupo, ProveedorDelPadron } from "@/lib/facturacion/altaDeFactura";
import type { LecturaDeFactura } from "@/lib/facturacion/leerArchivo";
import type { FacturaEnPantalla, OrigenDeFactura } from "@/lib/facturacion/types";
import type { CandidatoDeOdoo } from "@/lib/odoo/sincronizarFacturas";
import LineasDeFactura from "./LineasDeFactura";
import BorradorEnOdoo from "./BorradorEnOdoo";

/** A qué Odoo le está hablando el sistema. Lo resuelve el servidor. */
interface DondeApuntaOdoo {
  base: string;
  url: string;
  esStaging: boolean;
}

/**
 * Cargar facturas al buzón, de a varias, y ver lo que ya entró.
 *
 * El QR se lee **acá, en el navegador**: para cuando la persona mira la
 * pantalla, los datos de cada archivo ya están puestos y lo único que queda es
 * lo que el comprobante no dijo. Si esto se hiciera en el servidor, cada
 * corrección costaría una subida entera.
 *
 * Los archivos se leen **de a uno y en orden**, no todos a la vez: rasterizar
 * una A4 a 3600 px ocupa el hilo del navegador, y veinte en paralelo dejarían la
 * pantalla congelada justo cuando hay que mirarla.
 */

type EstadoDeFila =
  | "leyendo"
  | "lista"
  | "sin-datos"
  | "guardando"
  | "guardada"
  | "duplicada"
  | "error";

interface Fila {
  id: string;
  archivo: File;
  estado: EstadoDeFila;
  lectura: LecturaDeFactura | null;
  /** Lo que la persona completa cuando el QR no lo dijo. */
  aMano: {
    empresaId: string;
    proveedorId: string;
    tipoComprobante: string;
    puntoVenta: string;
    numero: string;
    fecha: string;
    importeTotal: string;
  };
  nroRi: string;
  notas: string;
  mensaje: string | null;
}

const VACIO = {
  empresaId: "",
  proveedorId: "",
  tipoComprobante: "",
  puntoVenta: "",
  numero: "",
  fecha: "",
  importeTotal: "",
};

const ORIGENES: OrigenDeFactura[] = ["mail", "papel", "whatsapp", "carga manual"];

const ESTADO_ETIQUETA: Record<string, string> = {
  recibida: "En el buzón",
  vinculada: "Vinculada",
  informada: "Informada",
  contabilizada: "Contabilizada",
};

/** En el orden del circuito, que es como se lee el desplegable. */
const ESTADOS = ["recibida", "vinculada", "informada", "contabilizada"] as const;

export default function BuzonClient({
  puedeEditar,
  empresas,
  proveedores,
  facturas,
  estado,
  odoo,
  puedeConfirmar,
}: {
  puedeEditar: boolean;
  /** Postear el asiento en Odoo: sólo administradores. */
  puedeConfirmar: boolean;
  empresas: EmpresaDelGrupo[];
  proveedores: ProveedorDelPadron[];
  facturas: FacturaEnPantalla[];
  estado: string | null;
  odoo: DondeApuntaOdoo;
}) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [resumenOdoo, setResumenOdoo] = useState<string | null>(null);
  const [cola, setCola] = useState<Fila[]>([]);
  const [origen, setOrigen] = useState<OrigenDeFactura>("mail");
  const [leyendo, setLeyendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // Índices por CUIT: es como se resuelve el emisor y el receptor, igual que en
  // el servidor. Por nombre nunca — enlazar al que se le parece no se nota.
  const porCuit = useMemo(() => {
    const e = new Map<string, EmpresaDelGrupo>();
    for (const x of empresas) {
      const c = normalizarCuit(x.cuit);
      if (c) e.set(c, x);
    }
    const p = new Map<string, ProveedorDelPadron>();
    for (const x of proveedores) {
      const c = normalizarCuit(x.cuit);
      if (c) p.set(c, x);
    }
    return { empresas: e, proveedores: p };
  }, [empresas, proveedores]);

  const cambiar = useCallback((id: string, cambios: Partial<Fila>) => {
    setCola((antes) => antes.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  }, []);

  async function agregar(archivos: FileList | null) {
    if (!archivos || archivos.length === 0) return;

    const nuevas: Fila[] = Array.from(archivos).map((archivo, i) => ({
      id: `${Date.now()}-${i}-${archivo.name}`,
      archivo,
      estado: "leyendo",
      lectura: null,
      aMano: { ...VACIO },
      nroRi: "",
      notas: "",
      mensaje: null,
    }));

    setCola((antes) => [...antes, ...nuevas]);
    setLeyendo(true);

    // El lector se importa acá y no arriba: se lleva pdf.js puesto, que son más
    // de un mega, y quien sólo viene a mirar el buzón no tiene por qué bajarlo.
    const { leerFactura } = await import("@/lib/facturacion/leerArchivo");

    for (const fila of nuevas) {
      try {
        const lectura = await leerFactura(fila.archivo);
        cambiar(fila.id, {
          lectura,
          estado: lectura.cabecera ? "lista" : "sin-datos",
          mensaje: lectura.cabecera ? null : lectura.motivo,
        });
      } catch (e) {
        cambiar(fila.id, {
          estado: "sin-datos",
          mensaje: `No se pudo leer el archivo (${(e as Error).message}). Se puede cargar igual completando los datos.`,
        });
      }
    }

    setLeyendo(false);
  }

  /**
   * `refrescar` en false cuando se están cargando varias: recargar la lista del
   * servidor después de cada una serían 19 viajes para mostrar lo mismo que uno
   * al final.
   */
  async function guardar(fila: Fila, refrescar = true) {
    cambiar(fila.id, { estado: "guardando", mensaje: null });

    const cuerpo = new FormData();
    cuerpo.append("archivo", fila.archivo);
    if (fila.nroRi.trim()) cuerpo.append("nro_ri", fila.nroRi.trim());
    cuerpo.append(
      "datos",
      JSON.stringify({
        cabecera: fila.lectura?.cabecera ?? null,
        origen,
        notas: fila.notas || null,
        // El detalle leído del texto del PDF. El servidor le pone el producto
        // de Odoo a cada línea: el catálogo y lo aprendido viven allá.
        detalle: fila.lectura?.detalle
          ? { lineas: fila.lectura.detalle.lineas, cuadra: fila.lectura.detalle.cuadra }
          : null,
        aMano: {
          empresaId: fila.aMano.empresaId || null,
          proveedorId: fila.aMano.proveedorId || null,
          tipoComprobante: numeroODefault(fila.aMano.tipoComprobante),
          puntoVenta: numeroODefault(fila.aMano.puntoVenta),
          numero: numeroODefault(fila.aMano.numero),
          fecha: fila.aMano.fecha || null,
          importeTotal: numeroODefault(fila.aMano.importeTotal),
        },
      })
    );

    const r = await fetch("/api/facturacion/facturas", { method: "POST", body: cuerpo });
    const datos = await r.json().catch(() => ({}));

    if (r.status === 409) {
      cambiar(fila.id, { estado: "duplicada", mensaje: datos.mensaje ?? "Ya estaba en el buzón." });
      return;
    }
    if (!r.ok) {
      cambiar(fila.id, { estado: "error", mensaje: datos.error ?? "No se pudo cargar." });
      return;
    }

    cambiar(fila.id, {
      estado: "guardada",
      mensaje: (datos.avisos ?? []).join(" ") || null,
    });
    if (refrescar) router.refresh();
  }

  async function guardarTodas() {
    // De a una y en orden: el índice único de la base es el que decide si una
    // factura ya estaba, y en paralelo dos copias del mismo archivo llegarían
    // juntas y las dos pasarían el control de duplicado.
    for (const fila of cola) {
      if (fila.estado === "lista" || fila.estado === "sin-datos") await guardar(fila, false);
    }
    router.refresh();
  }

  const pendientes = cola.filter((f) => f.estado === "lista" || f.estado === "sin-datos");

  /**
   * Preguntarle a Odoo cuáles de estas facturas ya están cargadas allá.
   *
   * Existe además del cron diario porque el cron corre una vez por día —el plan
   * de Vercel no admite más— y cuando administración acaba de cargar un lote,
   * esperar hasta mañana para ver el buzón limpio es esperar de más.
   */
  async function sincronizarConOdoo() {
    setSincronizando(true);
    setResumenOdoo(null);
    const r = await fetch("/api/facturacion/odoo/sincronizar", { method: "POST" });
    const datos = await r.json().catch(() => ({}));
    setSincronizando(false);

    if (!r.ok) {
      setResumenOdoo(datos.error ?? "No se pudo consultar Odoo.");
      return;
    }

    const partes = [
      `${datos.revisadas} revisadas`,
      `${datos.vinculadas} reconocidas`,
      `${datos.contabilizadas} pasaron a contabilizadas`,
    ];
    if (datos.ambiguas) partes.push(`${datos.ambiguas} con más de un candidato`);
    setResumenOdoo(partes.join(" · "));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Facturas de proveedor</h1>
        <p className="text-sm text-slate-500">
          Subí el PDF o la foto y el sistema lee el QR: emisor, número, fecha, importe y a qué
          empresa se le facturó. Lo que el comprobante no diga, se completa acá.
        </p>
        {/*
         * Producción y staging se distinguen sólo por dos variables de entorno, y
         * lo que se escribe de un lado es la contabilidad real del grupo. Que eso
         * dependa de mirar un `.env` es demasiado frágil para una pantalla que
         * crea borradores de factura.
         */}
        {odoo.esStaging && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Los borradores se están creando en <strong>{odoo.base}</strong>, que es una copia de
            prueba: lo que se cree acá no aparece en el Odoo de verdad.
          </p>
        )}
      </div>

      {puedeEditar && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-500">
                Por dónde llegaron
              </label>
              <select
                value={origen}
                onChange={(e) => setOrigen(e.target.value as OrigenDeFactura)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {ORIGENES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>

            <div className="grow">
              <label className="block text-xs uppercase tracking-wide text-slate-500">
                Los archivos
              </label>
              <input
                ref={entrada}
                type="file"
                multiple
                accept="application/pdf,image/*"
                onChange={(e) => {
                  agregar(e.target.files);
                  if (entrada.current) entrada.current.value = "";
                }}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {pendientes.length > 1 && (
              <button
                onClick={guardarTodas}
                disabled={leyendo}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Cargar las {pendientes.length}
              </button>
            )}
          </div>

          <p className="mt-2 text-xs text-slate-400">
            Se pueden elegir todas juntas. Se leen de a una, en orden, para no trabar la pantalla.
          </p>

          {cola.length > 0 && (
            <ul className="mt-4 space-y-3">
              {cola.map((fila) => (
                <FilaDeCarga
                  key={fila.id}
                  fila={fila}
                  empresas={empresas}
                  proveedores={proveedores}
                  porCuit={porCuit}
                  onCambiar={cambiar}
                  onGuardar={guardar}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {estado ? `Facturas ${ESTADO_ETIQUETA[estado]?.toLowerCase() ?? estado}` : "Lo que entró"}
            <span className="ml-2 font-normal text-slate-400">{facturas.length}</span>
          </h2>
          <div className="flex gap-2 text-xs">
            <Link
              href="/facturacion"
              className={`rounded-lg px-2 py-1 ${estado ? "text-slate-500 hover:bg-slate-100" : "bg-slate-900 text-white"}`}
            >
              Todas
            </Link>
            <Link
              href="/facturacion?estado=recibida"
              className={`rounded-lg px-2 py-1 ${estado === "recibida" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              Sin vincular
            </Link>
            {puedeEditar && (
              <button
                disabled={sincronizando}
                onClick={sincronizarConOdoo}
                className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-40 hover:bg-slate-50"
              >
                {sincronizando ? "Preguntándole a Odoo…" : "Sincronizar con Odoo"}
              </button>
            )}
          </div>
        </div>

        {resumenOdoo && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{resumenOdoo}</p>
        )}

        {facturas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            Todavía no entró ninguna.
          </p>
        ) : (
          <ul className="space-y-2">
            {facturas.map((f) => (
              <FilaDelBuzon
                key={f.id}
                factura={f}
                puedeEditar={puedeEditar}
                puedeConfirmar={puedeConfirmar}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Un archivo de la cola: lo que se leyó, lo que falta, y el botón de cargar. */
function FilaDeCarga({
  fila,
  empresas,
  proveedores,
  porCuit,
  onCambiar,
  onGuardar,
}: {
  fila: Fila;
  empresas: EmpresaDelGrupo[];
  proveedores: ProveedorDelPadron[];
  porCuit: { empresas: Map<string, EmpresaDelGrupo>; proveedores: Map<string, ProveedorDelPadron> };
  onCambiar: (id: string, cambios: Partial<Fila>) => void;
  onGuardar: (fila: Fila) => void;
}) {
  const c = fila.lectura?.cabecera ?? null;

  // Los mismos cruces que hace el servidor, para que la pantalla muestre ya
  // resuelto lo que va a quedar guardado.
  const proveedor = c?.cuitEmisor ? porCuit.proveedores.get(c.cuitEmisor) : undefined;
  const empresa = c?.cuitReceptor ? porCuit.empresas.get(c.cuitReceptor) : undefined;

  const set = (campo: keyof Fila["aMano"], valor: string) =>
    onCambiar(fila.id, { aMano: { ...fila.aMano, [campo]: valor } });

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex gap-3">
        {fila.lectura?.vistaPrevia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fila.lectura.vistaPrevia}
            alt=""
            className="h-24 w-auto rounded border border-slate-200 object-contain"
          />
        ) : (
          <div className="grid h-24 w-16 place-items-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            {fila.estado === "leyendo" ? "…" : "—"}
          </div>
        )}

        <div className="min-w-0 grow">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{fila.archivo.name}</div>
              <div className="text-xs text-slate-500">
                {fila.estado === "leyendo" && "Leyendo el QR…"}
                {c && (
                  <>
                    {nombreDelComprobante(c)}
                    {esNotaDeCredito(c.tipoComprobante) && " · resta"}
                    {" · "}
                    {proveedor?.nombre ?? `CUIT ${c.cuitEmisor}`}
                    {" · "}
                    {c.fecha}
                    {" · "}
                    {plata(c.importeTotal)}
                    {empresa && ` · ${empresa.nombre}`}
                  </>
                )}
              </div>
            </div>

            <Insignia estado={fila.estado} />
          </div>

          {c?.reparado && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              El QR venía roto y se reparó campo por campo. Mirá el importe y la fecha contra el
              papel.
            </p>
          )}

          {fila.mensaje && (
            <p
              className={`mt-1 rounded px-2 py-1 text-xs ${
                fila.estado === "error"
                  ? "bg-rose-50 text-rose-800"
                  : fila.estado === "duplicada"
                    ? "bg-sky-50 text-sky-900"
                    : "bg-slate-50 text-slate-600"
              }`}
            >
              {fila.mensaje}
            </p>
          )}

          {(fila.estado === "lista" || fila.estado === "sin-datos") && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              {/* Sólo se pide lo que el comprobante no dijo. */}
              {!empresa && (
                <Campo etiqueta="Empresa">
                  <select
                    value={fila.aMano.empresaId}
                    onChange={(e) => set("empresaId", e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">—</option>
                    {empresas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}

              {!proveedor && (
                <Campo etiqueta="Proveedor">
                  <select
                    value={fila.aMano.proveedorId}
                    onChange={(e) => set("proveedorId", e.target.value)}
                    className="max-w-56 rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="">—</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}

              {!c && (
                <>
                  <Campo etiqueta="Tipo">
                    <select
                      value={fila.aMano.tipoComprobante}
                      onChange={(e) => set("tipoComprobante", e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">—</option>
                      <option value="1">Factura A</option>
                      <option value="6">Factura B</option>
                      <option value="11">Factura C</option>
                      <option value="3">NC A</option>
                      <option value="8">NC B</option>
                      <option value="13">NC C</option>
                      <option value="2">ND A</option>
                    </select>
                  </Campo>
                  <Campo etiqueta="Pto vta">
                    <input
                      value={fila.aMano.puntoVenta}
                      onChange={(e) => set("puntoVenta", e.target.value)}
                      inputMode="numeric"
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </Campo>
                  <Campo etiqueta="Número">
                    <input
                      value={fila.aMano.numero}
                      onChange={(e) => set("numero", e.target.value)}
                      inputMode="numeric"
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </Campo>
                  <Campo etiqueta="Fecha">
                    <input
                      type="date"
                      value={fila.aMano.fecha}
                      onChange={(e) => set("fecha", e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </Campo>
                  <Campo etiqueta="Importe">
                    <input
                      value={fila.aMano.importeTotal}
                      onChange={(e) => set("importeTotal", e.target.value)}
                      inputMode="decimal"
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </Campo>
                </>
              )}

              <Campo etiqueta="Nº RI">
                <input
                  value={fila.nroRi}
                  onChange={(e) => onCambiar(fila.id, { nroRi: e.target.value })}
                  inputMode="numeric"
                  placeholder="opcional"
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Campo>

              <button
                onClick={() => onGuardar(fila)}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
              >
                Cargar
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Una factura ya cargada: qué es, y lo que queda por hacer con ella. */
function FilaDelBuzon({
  factura,
  puedeEditar,
  puedeConfirmar,
}: {
  factura: FacturaEnPantalla;
  puedeEditar: boolean;
  puedeConfirmar: boolean;
}) {
  const router = useRouter();
  const [nroRi, setNroRi] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [candidatos, setCandidatos] = useState<CandidatoDeOdoo[] | null>(null);
  const [verDetalle, setVerDetalle] = useState(false);
  const [verBorrador, setVerBorrador] = useState(false);

  async function parchear(cambios: Record<string, unknown>) {
    setOcupado(true);
    setAviso(null);
    const r = await fetch(`/api/facturacion/facturas/${factura.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cambios),
    });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo guardar.");
      return;
    }
    setNroRi("");
    router.refresh();
  }

  /**
   * Cambiar el estado a mano.
   *
   * Cuando la factura ya está enlazada a un asiento posteado de Odoo, el estado
   * lo manda Odoo: la sincronización lo va a volver a poner en "Contabilizada".
   * Se avisa en vez de impedirlo — a veces hace falta sacarlo un momento, por
   * ejemplo para volver a crear el borrador.
   */
  async function cambiarEstado(nuevo: string) {
    await parchear({ estado: nuevo });

    if (
      nuevo !== "contabilizada" &&
      factura.odoo_move_id &&
      factura.odoo_estado === "posted"
    ) {
      setNota(
        "Ojo: esta factura está enlazada a un asiento ya posteado en Odoo, " +
          "así que la próxima sincronización la va a volver a marcar como contabilizada."
      );
    }
  }

  async function abrir() {
    const r = await fetch(`/api/facturacion/facturas/${factura.id}`);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo abrir el archivo.");
      return;
    }
    window.open(datos.link, "_blank", "noopener");
  }

  /** Crear el borrador en Odoo con lo que ya sabe el buzón. */
  async function empujar() {
    setOcupado(true);
    setAviso(null);
    setNota(null);
    const r = await fetch(`/api/facturacion/facturas/${factura.id}/odoo`, { method: "POST" });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo crear el borrador en Odoo.");
      return;
    }
    // Los avisos no son errores: el borrador existe, pero hay algo para mirar.
    if (datos.avisos?.length) setNota(datos.avisos.join(" "));
    router.refresh();
  }

  /** Los candidatos de Odoo, para las que cargó administración por su cuenta. */
  async function buscarEnOdoo() {
    setOcupado(true);
    setAviso(null);
    const r = await fetch(`/api/facturacion/facturas/${factura.id}/odoo`);
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo consultar Odoo.");
      return;
    }
    setCandidatos(datos.candidatos ?? []);
    if (datos.motivo) setAviso(datos.motivo);
  }

  async function vincularEnOdoo(c: CandidatoDeOdoo) {
    setOcupado(true);
    const r = await fetch(`/api/facturacion/facturas/${factura.id}/odoo`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        odoo_move_id: c.odooMoveId,
        odoo_nombre: c.nombre,
        odoo_estado: c.estado,
      }),
    });
    const datos = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo vincular.");
      return;
    }
    setCandidatos(null);
    router.refresh();
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">
            {nombreDelComprobante({
              tipoComprobante: factura.tipo_comprobante,
              puntoVenta: factura.punto_venta,
              numero: factura.numero,
            })}
            {esNotaDeCredito(factura.tipo_comprobante) && (
              <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">
                resta
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            {factura.proveedor ?? (factura.cuit_emisor ? `CUIT ${factura.cuit_emisor}` : "sin proveedor")}
            {" · "}
            {factura.fecha ?? "sin fecha"}
            {" · "}
            {plata(factura.importe_total)} {factura.moneda !== "ARS" && factura.moneda}
            {" · "}
            {factura.empresa ?? "empresa sin definir"}
            {" · "}
            <span className="text-slate-400">
              {factura.origen} · {factura.identificado_por === "qr" ? "leída del QR" : "a mano"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            * El estado se edita en los dos sentidos, y no es un detalle: hasta
            * que fue un desplegable, marcar "Ya esta en Odoo" por error no tenia
            * vuelta atras —el boton que lo ponia desaparecia justo despues—, y
            * la factura quedaba fuera de la cola para siempre.
            */}
          {puedeEditar ? (
            <select
              value={factura.estado}
              disabled={ocupado}
              onChange={(e) => cambiarEstado(e.target.value)}
              className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
            >
              {ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ESTADO_ETIQUETA[e]}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {ESTADO_ETIQUETA[factura.estado] ?? factura.estado}
            </span>
          )}

          {factura.requerimiento ? (
            <Link
              href={`/compras/requerimientos/${factura.requerimiento_id}`}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              RI {factura.requerimiento}
            </Link>
          ) : (
            puedeEditar && (
              <div className="flex items-center gap-1">
                <input
                  value={nroRi}
                  onChange={(e) => setNroRi(e.target.value)}
                  placeholder="Nº RI"
                  inputMode="numeric"
                  className="w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                />
                <button
                  disabled={ocupado || !nroRi.trim()}
                  onClick={() => parchear({ nro_ri: Number(nroRi) })}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40"
                >
                  Vincular
                </button>
              </div>
            )
          )}

          {/* El detalle se trae recién cuando alguien lo abre: son ~700 filas
              de catálogo de Odoo por empresa y no hacen falta para ver el buzón. */}
          <button
            onClick={() => setVerDetalle((v) => !v)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            {verDetalle ? "Ocultar el detalle" : "El detalle"}
          </button>

          {factura.archivo_url && (
            <button
              onClick={abrir}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Ver el archivo
            </button>
          )}

          {/*
           * El bloque de Odoo. Cuando la factura ya tiene asiento, el enlace: el
           * número de una orden o de un asiento no identifica nada por sí solo
           * —staging y producción tienen los dos el mismo— y un enlace sí.
           */}
          {factura.odoo_move_id ? (
            // Abre el borrador **adentro del sistema**. El enlace a Odoo sigue
            // estando, adentro del panel: revisar no debería obligar a cambiar
            // de aplicación, pero corregir sí se hace allá.
            <button
              onClick={() => setVerBorrador((v) => !v)}
              className="rounded-lg border border-teal-300 bg-teal-50 px-2 py-1 text-xs text-teal-800 hover:bg-teal-100"
            >
              {factura.odoo_estado === "posted"
                ? `En Odoo${factura.odoo_nombre && factura.odoo_nombre !== "/" ? `: ${factura.odoo_nombre}` : ""}`
                : "Ver el borrador de Odoo"}
            </button>
          ) : (
            puedeEditar && (
              <>
                <button
                  disabled={ocupado}
                  onClick={empujar}
                  className="rounded-lg border border-teal-300 bg-teal-50 px-2 py-1 text-xs text-teal-800 disabled:opacity-40 hover:bg-teal-100"
                >
                  Crear el borrador en Odoo
                </button>
                <button
                  disabled={ocupado}
                  onClick={buscarEnOdoo}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                >
                  Buscar en Odoo
                </button>
              </>
            )
          )}

        </div>
      </div>

      {factura.notas && <p className="mt-1 text-xs text-slate-500">{factura.notas}</p>}
      {factura.odoo_pendiente && (
        <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {factura.odoo_pendiente}
        </p>
      )}
      {nota && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{nota}</p>}
      {aviso && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{aviso}</p>}

      {verDetalle && (
        <LineasDeFactura
          facturaId={factura.id}
          puedeEditar={puedeEditar}
          onCerrar={() => setVerDetalle(false)}
        />
      )}

      {verBorrador && factura.odoo_move_id && (
        <BorradorEnOdoo
          facturaId={factura.id}
          puedeConfirmar={puedeConfirmar}
          onCerrar={() => setVerBorrador(false)}
          onConfirmado={() => {
            setVerBorrador(false);
            router.refresh();
          }}
        />
      )}

      {/*
       * Los candidatos se muestran con el motivo por el que están en la lista.
       * Es lo que permite elegir con criterio: "el número coincide" es una
       * certeza y "es del mismo proveedor" es apenas un punto de partida.
       */}
      {candidatos && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {candidatos.length === 0 ? (
            <p className="text-xs text-slate-500">
              No hay ninguna factura de ese proveedor en Odoo en los últimos meses.
            </p>
          ) : (
            <ul className="space-y-1">
              {candidatos.map((c) => (
                <li key={c.odooMoveId} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-white px-1.5 py-0.5 text-slate-500">{c.porque}</span>
                  <span className="text-slate-700">{c.nombre !== "/" ? c.nombre : "borrador"}</span>
                  <span className="text-slate-500">{c.fecha ?? "sin fecha"}</span>
                  <span className="text-slate-500">{plata(c.importeTotal)}</span>
                  {c.numero && <span className="text-slate-600">{c.numero}</span>}
                  {c.referencia && <span className="text-slate-400">{c.referencia}</span>}
                  <button
                    disabled={ocupado}
                    onClick={() => vincularEnOdoo(c)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 disabled:opacity-40"
                  >
                    Es ésta
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setCandidatos(null)}
            className="mt-1 text-xs text-slate-400 underline"
          >
            cerrar
          </button>
        </div>
      )}
    </li>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-slate-400">{etiqueta}</span>
      {children}
    </label>
  );
}

function Insignia({ estado }: { estado: EstadoDeFila }) {
  const estilos: Record<EstadoDeFila, string> = {
    leyendo: "bg-slate-100 text-slate-500",
    lista: "bg-emerald-50 text-emerald-700",
    "sin-datos": "bg-amber-50 text-amber-800",
    guardando: "bg-slate-100 text-slate-500",
    guardada: "bg-emerald-600 text-white",
    duplicada: "bg-sky-100 text-sky-800",
    error: "bg-rose-100 text-rose-800",
  };
  const texto: Record<EstadoDeFila, string> = {
    leyendo: "leyendo",
    lista: "leída del QR",
    "sin-datos": "hay que completar",
    guardando: "cargando",
    guardada: "en el buzón",
    duplicada: "ya estaba",
    error: "no se pudo",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${estilos[estado]}`}>
      {texto[estado]}
    </span>
  );
}

/** Un número que puede no ser un número: el campo va vacío y no en `NaN`. */
function numeroODefault(valor: string): number | null {
  const limpio = valor.replace(/\./g, "").replace(",", ".").trim();
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function plata(valor: number | null | undefined): string {
  if (typeof valor !== "number") return "—";
  return valor.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
}
