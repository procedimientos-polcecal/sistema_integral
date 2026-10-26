"use client";

import { useEffect, useState } from "react";
import { URGENCIAS } from "@/lib/mantenimiento/avisos";
import Select from "@/components/Select";

/**
 * Con qué campos abre el formulario.
 *
 * Mismo criterio que `ValoresIniciales` del RI: lo que ya está escrito de otro
 * lado no se vuelve a tipear. Lo usa el asistente, que arma la URL y no escribe
 * en la base.
 *
 * El sector no va acá: sale solo al elegir el equipo, porque la máquina sabe
 * dónde está.
 */
export interface ValoresInicialesAviso {
  equipo?: string;
  descripcion?: string;
  urgencia?: string;
}

/**
 * Cargar un aviso: alguien vio que algo anda mal.
 *
 * Es el primer eslabón del módulo y hasta ahora sólo se podía hacer abriendo la
 * planilla. El número se lo pone el sistema leyendo el último de la planilla.
 */
export default function NuevoAvisoModal({
  inicial, quienAviso, areas, areaInicial, onCerrar, onCreado,
}: {
  /** Precargado desde la URL. Se puede editar todo antes de enviar. */
  inicial?: ValoresInicialesAviso;
  /**
   * «Nombre Apellido» de quien tiene la sesión. Arranca escrito y se puede
   * cambiar: Martín carga lo que le cuentan en Producción, y a veces quien vio
   * la falla es otro. Precargado corta las ortografías distintas de la misma
   * persona, que ya eran cuatro.
   */
  quienAviso?: string;
  /** Las áreas entre las que se elige: las de `compras_areas`. */
  areas: { id: string; nombre: string }[];
  /**
   * El área con la que arranca, que sale de `areaPorDefecto()`: `""` si quien
   * carga no tiene ninguna o tiene más de una. En esos dos casos se elige a
   * mano y el formulario dice por qué.
   */
  areaInicial?: string;
  onCerrar: () => void;
  onCreado: (oaNumber: string) => void;
}) {
  const [equipos, setEquipos] = useState<{ id: string; code: string | null; name: string; sector_id: string | null }[]>([]);
  const [sectores, setSectores] = useState<{ id: string; nombre: string; codigo: string | null }[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [campos, setCampos] = useState({
    equipo_raw: inicial?.equipo ?? "",
    sector_raw: "",
    sector_id: "",
    descripcion: inicial?.descripcion ?? "",
    urgencia: inicial?.urgencia ?? (URGENCIAS[1] as string),
    quien_aviso: quienAviso ?? "",
    area_id: areaInicial ?? "",
    observaciones: "",
  });

  // UNA sola foto. La columna de la planilla es una celda y `filaDeAviso()` la
  // lee como un solo valor: una segunda foto se perdería sin que nadie se
  // entere, así que no se deja subir.
  const [foto, setFoto] = useState<{ link: string; nombre: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  // Lo que dijo la ruta sobre la foto, tal cual: si el bucket es privado, el
  // link no se abre desde la planilla y quien subió la foto tiene que saberlo.
  const [avisoDeLaFoto, setAvisoDeLaFoto] = useState("");

  const set = (clave: string, valor: string) => setCampos((c) => ({ ...c, [clave]: valor }));

  useEffect(() => {
    // Las mismas listas que usa el resto del módulo: elegir la máquina de un
    // desplegable es lo que hace que el aviso quede enlazada a ella.
    fetch("/api/mantenimiento/equipos-y-sectores")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setEquipos(d.equipos ?? []); setSectores(d.sectores ?? []); } })
      .catch(() => {});
  }, []);

  /** Al elegir el equipo se completa el sector: la máquina sabe dónde está. */
  function elegirEquipo(id: string) {
    const equipo = equipos.find((e) => e.id === id);
    if (!equipo) { set("equipo_raw", ""); return; }

    setCampos((c) => ({
      ...c,
      equipo_raw: `${equipo.code ?? ""} ${equipo.name}`.trim(),
      sector_id: equipo.sector_id ?? c.sector_id,
      sector_raw: sectores.find((s) => s.id === equipo.sector_id)?.nombre ?? c.sector_raw,
    }));
  }

  async function subirFoto(archivo: File) {
    setSubiendo(true);
    setError("");
    setAvisoDeLaFoto("");

    // El número del aviso lo pone la ruta al crearlo, así que todavía no existe:
    // la foto va a `avisos/sin-numero/` y no a `ordenes/sin-ot/`, que es de
    // otra cosa.
    const fd = new FormData();
    fd.append("file", archivo);
    fd.append("aviso", "sin-numero");

    try {
      const res = await fetch("/api/mantenimiento/fotos", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));

      // Si falla se dice con lo que contestó la ruta y el aviso se puede cargar
      // igual, sin foto: no vale perder lo escrito por una foto que no subió.
      if (!res.ok) { setError(body.error ?? "No se pudo subir la foto."); return; }

      setFoto({ link: body.link, nombre: archivo.name });
      // Sólo viene con `publica: false`. Se muestra sin traducir.
      if (body.publica === false && body.aviso) setAvisoDeLaFoto(String(body.aviso));
    } catch {
      setError("No se pudo subir la foto: se cortó la conexión.");
    } finally {
      setSubiendo(false);
    }
  }

  function quitarFoto() {
    setFoto(null);
    setAvisoDeLaFoto("");
  }

  async function crear() {
    if (!campos.descripcion.trim()) { setError("Contá qué pasa."); return; }
    // Sin elegir no se manda: la ruta lo resolvería sola desde las áreas de la
    // sesión, y con cero o dos queda en null, que es justo lo que acá se evita.
    if (areas.length > 0 && !campos.area_id) { setError("Elegí el área."); return; }
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/avisos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...campos,
        sector_id: campos.sector_id || null,
        area_id: campos.area_id || null,
        reference_photos: foto ? [foto.link] : [],
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo cargar el aviso."); return; }
    onCreado(body.oa_number);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">Nuevo aviso</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            El número se lo pone el sistema, siguiendo el último de la planilla.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Qué pasa</span>
          <textarea
            value={campos.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
            rows={2}
            placeholder="Pierde aceite por el retén del reductor"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Equipo</span>
            <Select
              onChange={(e) => elegirEquipo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin equipo</option>
              {equipos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code ? `${e.code} — ` : ""}{e.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Sector</span>
            <Select
              value={campos.sector_id}
              onChange={(e) => {
                set("sector_id", e.target.value);
                set("sector_raw", sectores.find((s) => s.id === e.target.value)?.nombre ?? "");
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin sector</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo ? `${s.codigo} — ` : ""}{s.nombre}
                </option>
              ))}
            </Select>
          </label>

          {/*
            "Sugerida" y no "Urgencia" a secas, a pedido.
            Quien avisa ve la máquina y sabe cuánto molesta, pero no sabe qué
            más hay en cola ni qué repuesto falta: la prioridad de verdad la
            arma Mantenimiento con el puntaje GUT de la OT. Sin esa palabra, el
            campo se lee como una orden —"lo puse en Alta, que lo arreglen
            hoy"— y la distancia entre lo que alguien eligió acá y lo que
            después pasa se siente como que el sistema lo ignoró.

            El VALOR no cambia: sigue siendo "🟠 Alta" tal cual, porque viaja
            literal a la columna F de la planilla. Lo que cambia es el rótulo.
          */}
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Urgencia sugerida</span>
            <Select
              value={campos.urgencia}
              onChange={(e) => set("urgencia", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {URGENCIAS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
            <span className="block text-xs text-slate-500">
              Es tu sugerencia. La prioridad final la define Mantenimiento.
            </span>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Área</span>
            <Select
              value={campos.area_id}
              onChange={(e) => set("area_id", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Elegí el área</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Quién avisa</span>
            <input
              value={campos.quien_aviso}
              onChange={(e) => set("quien_aviso", e.target.value)}
              placeholder="Tu nombre"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        {!areaInicial && areas.length > 0 && (
          // Se dice por qué hay que elegir. `areaPorDefecto` devuelve vacío con
          // cero áreas y con dos, y elegir una de dos sería adivinar: un área
          // equivocada no se nota, le esconde el aviso a quien tenía que verlo.
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No pudimos elegir tu área sola: no tenés ninguna asignada o cubrís más de
            una. Elegila vos arriba; el aviso le llega a quien mira esa área.
          </p>
        )}

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Observaciones</span>
          <input
            value={campos.observaciones}
            onChange={(e) => set("observaciones", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="space-y-1">
          <span className="block text-xs font-medium text-slate-600">Foto (opcional, una)</span>
          {foto ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="min-w-0 truncate">{foto.nombre}</span>
              <button
                type="button"
                onClick={quitarFoto}
                className="shrink-0 text-xs font-medium text-red-600 hover:underline"
              >
                Quitar
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={subiendo}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                e.target.value = "";
                if (archivo) subirFoto(archivo);
              }}
              className="w-full text-sm text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
            />
          )}
          {subiendo && <p className="text-xs text-slate-400">Subiendo…</p>}
          {avisoDeLaFoto && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {avisoDeLaFoto}
            </p>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Se escribe primero en la planilla de avisos, que es la base, y después acá.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={crear}
            disabled={guardando || subiendo}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Cargando…" : "Cargar el aviso"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
