"use client";

import { useEffect, useState } from "react";
import { URGENCIAS } from "@/lib/mantenimiento/avisos";
import Select from "@/components/Select";
import { Modal, PieDeModal } from "@/components/Modal";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import { CartelDelResultado } from "@/app/cargar/envio";
import { mandarOEncolar, type Resultado } from "@/lib/core/mandarOEncolar";

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

/** Cómo se escribe un equipo en `equipo_raw`: el mismo texto de los dos lados. */
function nombreDelEquipo(equipo: { code: string | null; name: string }): string {
  return `${equipo.code ?? ""} ${equipo.name}`.trim();
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
  /** Cómo salió el envío. El `error` de arriba es sólo para lo que se valida acá adentro. */
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /*
   * Los ocho campos del aviso, recordados mientras la app esté abierta.
   *
   * **La clave distingue el alta en blanco de la prellenada desde el
   * asistente**, y por eso lleva el prellenado adentro: no hay registro de
   * origen del que sacar un id, así que el id es lo prellenado mismo. Sin eso,
   * lo escrito en un aviso en blanco le pisaría la descripción al que el
   * asistente abre con la suya — que es exactamente «el borrador aparece sobre
   * el registro que no es», sólo que acá el registro es el pedido.
   */
  const { valores: campos, cambiar, tocado, tirar } = useBorrador(
    claveDelBorrador(
      "mantenimiento-nuevo-aviso",
      inicial ? { tipo: "prellenado", id: JSON.stringify(inicial) } : null,
    ),
    {
      equipo_raw: inicial?.equipo ?? "",
      sector_raw: "",
      sector_id: "",
      descripcion: inicial?.descripcion ?? "",
      urgencia: inicial?.urgencia ?? (URGENCIAS[1] as string),
      quien_aviso: quienAviso ?? "",
      area_id: areaInicial ?? "",
      observaciones: "",
    },
  );

  // UNA sola foto. La columna de la planilla es una celda y `filaDeAviso()` la
  // lee como un solo valor: una segunda foto se perdería sin que nadie se
  // entere, así que no se deja subir.
  const [foto, setFoto] = useState<{ link: string; nombre: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  // Lo que dijo la ruta sobre la foto, tal cual: si el bucket es privado, el
  // link no se abre desde la planilla y quien subió la foto tiene que saberlo.
  const [avisoDeLaFoto, setAvisoDeLaFoto] = useState("");

  const set = (clave: keyof typeof campos, valor: string) => cambiar({ [clave]: valor });

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

    cambiar({
      equipo_raw: nombreDelEquipo(equipo),
      sector_id: equipo.sector_id ?? campos.sector_id,
      sector_raw: sectores.find((s) => s.id === equipo.sector_id)?.nombre ?? campos.sector_raw,
    });
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

  /**
   * Manda el aviso y, si no hay con qué, lo deja en la cola del teléfono.
   *
   * **ANTES ACÁ HABÍA UN `fetch` SUELTO Y SIN `try`.** Sin señal el `await`
   * tiraba, el error se escapaba de esta función y el modal quedaba colgado
   * con el spinner puesto y lo escrito adentro: no mostraba mal el error, no
   * mostraba ninguno. Desde el 02/11/2026 eso lo resuelve `mandarOEncolar`,
   * que es el mismo camino que usa la pantalla sin señal — y por eso no se
   * decide nada acá: si el envío se cayó por conexión, el aviso queda
   * esperando y sale solo cuando vuelva.
   */
  async function crear() {
    if (!campos.descripcion.trim()) { setError("Contá qué pasa."); return; }
    // Sin elegir no se manda: la ruta lo resolvería sola desde las áreas de la
    // sesión, y con cero o dos queda en null, que es justo lo que acá se evita.
    if (areas.length > 0 && !campos.area_id) { setError("Elegí el área."); return; }
    setGuardando(true);
    setError("");
    setResultado(null);

    const salida = await mandarOEncolar("aviso", {
      ...campos,
      sector_id: campos.sector_id || null,
      area_id: campos.area_id || null,
      reference_photos: foto ? [foto.link] : [],
    });
    setGuardando(false);

    // Lo que entró cierra el modal, como siempre. Lo que quedó esperando y lo
    // que se rechazó se cuentan con el mismo cartel que la pantalla sin señal,
    // y no con un texto propio: es la misma situación y ya está redactada ahí,
    // incluido el caso en que la fila igual quedó escrita.
    // Lo que entró ya no hay que recordarlo. Lo que quedó esperando o se
    // rechazó sí: el modal sigue abierto con el cartel y lo escrito tiene que
    // seguir ahí.
    if (salida.estado === "mandada") { tirar(); onCreado(salida.numero); return; }
    setResultado(salida);
  }

  return (
    // El fondo, la X y Escape salen conservando: lo cargado queda y aparece
    // igual al volver a abrir. Sólo «Cancelar» tira.
    <Modal titulo="Nuevo aviso" alSalir={onCerrar} tocado={tocado}>
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-400">
          El número se lo pone el sistema, siguiendo el último de la planilla.
        </p>

        <CartelDelResultado tipo="aviso" resultado={resultado} />

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
            {/* Controlado por `equipo_raw`, que es lo que se guarda: antes era
                un desplegable sin `value`, y con borrador eso dejaría el campo
                con un equipo y la lista diciendo «Sin equipo». */}
            <Select
              value={equipos.find((e) => nombreDelEquipo(e) === campos.equipo_raw)?.id ?? ""}
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

        <PieDeModal className="flex gap-2">
          <button
            onClick={crear}
            disabled={guardando || subiendo}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Cargando…" : "Cargar el aviso"}
          </button>
          {/* El único que tira. */}
          <button
            onClick={() => { tirar(); onCerrar(); }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </PieDeModal>
      </div>
    </Modal>
  );
}
