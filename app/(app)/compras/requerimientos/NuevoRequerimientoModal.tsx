"use client";

import { useState } from "react";
import { PRIORIDADES, PRIORIDAD_LABELS } from "@/lib/compras/constants";
import { recortarParaPantalla } from "@/lib/compras/texto";

type Opcion = { id: string; nombre: string };

/**
 * Con qué campos abre el formulario.
 *
 * Lo usa la orden de trabajo cuando el pañol no tiene un repuesto: el nombre,
 * el código y la cantidad ya están del otro lado, y volver a escribirlos es
 * donde el código se pierde y el RI termina diciendo "rodamiento" a secas.
 *
 * **El área y quién paga no se pueden precargar y es a propósito.** Son
 * decisiones de quien pide, y elegirlas por él es cómo un pedido de
 * Mantenimiento entra como si fuera de Producción.
 */
export interface ValoresIniciales {
  descripcion?: string;
  codigo?: string;
  cantidad?: string;
  detalle?: string;
  ubicacionId?: string;
}

/**
 * Alta de un requerimiento. Es el formulario que hoy vive en Google Forms, así
 * que se mantiene igual de corto: sólo descripción y área son obligatorias.
 */
export default function NuevoRequerimientoModal({
  areas, empresas, ubicaciones, inicial, onClose, onSaved,
}: {
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
  /** Precargado desde otra pantalla. Se puede editar todo antes de enviar. */
  inicial?: ValoresIniciales;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [areaId, setAreaId] = useState("");
  const [cantidad, setCantidad] = useState(inicial?.cantidad ?? "");
  const [codigo, setCodigo] = useState(inicial?.codigo ?? "");
  const [fechaNecesidad, setFechaNecesidad] = useState("");
  // Sin valor por defecto: las define quien aprueba. Se pueden sugerir.
  const [prioridad, setPrioridad] = useState("");
  const [paga, setPaga] = useState("");
  const [detalle, setDetalle] = useState(inicial?.detalle ?? "");
  const [imagenUrl, setImagenUrl] = useState("");

  const [ubicacionId, setUbicacionId] = useState(inicial?.ubicacionId ?? "");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /**
   * El pedido se guardó pero la planilla no se enteró.
   *
   * No es un error —el pedido existe— pero tampoco se puede cerrar el
   * formulario como si nada: quien lo cargó tiene que saber que en la planilla
   * todavía no está. Se reintenta solo en cada sincronización.
   */
  const [aviso, setAviso] = useState("");

  /**
   * El pedido ya se creó y este formulario no se puede volver a enviar.
   *
   * No es lo mismo que `aviso`: un alta puede salir perfecta y no dejar aviso.
   * Lo que este estado impide es el alta DUPLICADA. Con el aviso en pantalla,
   * `guardando` volvía a `false` y el submit seguía habilitado; volver a apretar
   * "Crear requerimiento" insertaba **un segundo requerimiento**, con otro N° de
   * RI y otra fila en la planilla. La idempotencia del alta protege contra
   * escribir dos veces la fila del *mismo* pedido, no contra dos pedidos, y
   * quien ve un cartel de que algo no salió bien lo más natural que puede hacer
   * es apretar de nuevo.
   */
  const [creado, setCreado] = useState(false);

  /**
   * Cerrar cuando el pedido ya existe **tiene que recargar**.
   *
   * En las tres pantallas que abren este modal, `onClose` sólo cierra y `onSaved`
   * es la que recarga el listado. Con el aviso en pantalla, el fondo y "Cancelar"
   * llamaban a `onClose`: el pedido que sí se había creado no aparecía en la
   * lista, y eso se lee como "no se guardó" — que es justo la lectura que hace
   * que alguien lo cargue de nuevo.
   */
  const cerrar = () => (creado ? onSaved() : onClose());

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    // Red por si el submit llega igual (un Enter en un campo, o el navegador
    // reenviando): una vez que el POST volvió 201 no se manda nada más.
    if (creado || guardando) return;
    setGuardando(true);
    setError("");
    // También el aviso: sin esto, un segundo intento que sí anda dejaba en
    // pantalla el cartel del primero.
    setAviso("");

    // El `fetch` puede rechazar —se corta la red con el POST ya en vuelo— y sin
    // este `catch` la excepción se escapaba de `enviar`: `guardando` quedaba en
    // `true` para siempre y el formulario se trababa en "Guardando…". Lo peor no
    // era el botón muerto: el pedido pudo haberse creado igual del otro lado, y
    // quien lo cargó, sin nada en pantalla, lo carga de nuevo y quedan dos RI.
    // Por eso el mensaje dice que hay que ir a mirar antes de reintentar.
    let res: Response;
    try {
      res = await fetch("/api/compras/requerimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descripcion: descripcion.trim(),
          area_id: areaId || null,
          cantidad: cantidad ? Number(cantidad) : null,
          codigo: codigo.trim() || null,
          fecha_necesidad: fechaNecesidad || null,
          prioridad: prioridad || null,
          empresa_id: paga === "AMBAS" ? null : paga || null,
          paga_ambas: paga === "AMBAS",
          detalle_extra: detalle.trim() || null,
          imagen_url: imagenUrl.trim() || null,
          ubicacion_id: ubicacionId || null,
        }),
      });
    } catch {
      setGuardando(false);
      setError(
        "Se cortó la conexión antes de saber si el pedido se guardó. Mirá el " +
          "listado antes de cargarlo de nuevo: puede haber quedado creado."
      );
      return;
    }

    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el requerimiento.");
      return;
    }
    // El pedido existe. Desde acá el formulario ya no puede mandar nada.
    setCreado(true);
    if (body.aviso_sheets) {
      setAviso(body.aviso_sheets);
      return;
    }
    onSaved();
  }

  return (
    <div
      onClick={cerrar}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-10 w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Nuevo requerimiento interno</h2>
          <p className="text-sm text-slate-500">
            El N° de RI se asigna solo y el pedido queda pendiente de aprobación.
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-4 px-6 py-5">
          <Campo label="Qué se necesita" requerido>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              required
              autoFocus
              placeholder="Correa B58, rodamiento 6309, bolsas de papel…"
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Área que pide" requerido>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                required
              >
                <option value="">Elegir área…</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Campo>

            <Campo label="Cantidad">
              <input
                type="number" min="0" step="any"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </Campo>

            <Campo label="Código de artículo">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Opcional"
              />
            </Campo>

            <Campo label="Para cuándo se necesita">
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={fechaNecesidad}
                onChange={(e) => setFechaNecesidad(e.target.value)}
              />
            </Campo>

            <Campo label="Prioridad sugerida">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value)}
              >
                <option value="">Sin definir</option>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>{PRIORIDAD_LABELS[p].label}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Quién paga (sugerido)">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={paga}
                onChange={(e) => setPaga(e.target.value)}
              >
                <option value="">Sin definir</option>
                {empresas.map((e2) => <option key={e2.id} value={e2.id}>{e2.nombre}</option>)}
                <option value="AMBAS">Ambas</option>
              </select>
            </Campo>
          </div>

          {/* Dónde se necesita */}
          <Campo label="Dónde se necesita">
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={ubicacionId}
              onChange={(e) => setUbicacionId(e.target.value)}
            >
              <option value="">Sin especificar</option>
              {ubicaciones.map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              ¿Falta un lugar en la lista? Pedile a Compras que lo agregue, así todos
              lo escriben igual y se puede filtrar por ubicación.
            </p>
          </Campo>

          <Campo label="Detalle extra">
            <textarea
              rows={3}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Medidas, marca, proveedor sugerido, para qué se usa…"
            />
          </Campo>

          <Campo label="Enlace a una foto o plano">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={imagenUrl}
              onChange={(e) => setImagenUrl(e.target.value)}
              placeholder="https://drive.google.com/…"
            />
          </Campo>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {aviso && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-semibold">El pedido se guardó, pero la planilla no se enteró.</p>
              {/* `break-words` y recorte: el motivo trae el mensaje de Google
                  sin traducir, y ése puede ser una URL de activación de la API
                  sin un solo espacio, que no corta y rompe el ancho del bloque.
                  El texto completo queda en `sheets_pendiente`; acá va lo que
                  entra, y el resto en el `title` para no perderlo del todo. */}
              <p className="mt-1 break-words" title={aviso}>
                {recortarParaPantalla(aviso)}
              </p>
              {/* No manda a Compras → Configuración: esa página redirige a
                  cualquiera sin permiso de edición de Compras, que son
                  justamente las nueve áreas para las que existe este
                  formulario. Lo accionable para esa persona es no cargarlo de
                  nuevo y, si mañana sigue sin aparecer, avisarle a Compras. */}
              <p className="mt-1 text-xs">
                El pedido ya tiene su N° de RI: <strong>no hay que volver a
                cargarlo</strong>. La planilla se reintenta sola en cada
                sincronización. Si Compras no lo ve ahí, avisales y pasales este
                mensaje.
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Entendido
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={cerrar}
              disabled={guardando}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {creado ? "Cerrar" : "Cancelar"}
            </button>
            <button
              type="submit"
              disabled={guardando || creado || !descripcion.trim() || !areaId}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : creado ? "Ya se creó" : "Crear requerimiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Campo({
  label, requerido, children,
}: {
  label: string;
  requerido?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{requerido && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
