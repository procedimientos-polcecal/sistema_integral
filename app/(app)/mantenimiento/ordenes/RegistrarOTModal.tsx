"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import Select from "@/components/Select";
import { instanteDeArgentina } from "@/lib/core/fechas";
import FallaDeLaOT, { type LaFalla } from "@/components/FallaDeLaOT";
import { avisoDelPendiente } from "@/lib/mantenimiento/reintentoDePendientes";
import { loQueImpideCerrar } from "@/lib/mantenimiento/cierreDeOT";
import { comoSeLee } from "@/lib/core/fechas";
import {
  elCierreEsAnteriorAlInicio,
  loQueFaltaPorElCierreAdelantado,
} from "@/lib/mantenimiento/cierreAnteriorAlInicio";

/**
 * Registrar el trabajo de una orden.
 *
 * Es el momento en que la OT deja de ser un pedido y pasa a ser algo que se
 * hizo: quién lo hizo, cuánto tardó, qué encontró. Queda de los dos lados —en
 * el sistema como ejecución y en la planilla, que sigue siendo la base—.
 */

const RESULTADOS = [
  { valor: "completado", label: "Completado" },
  { valor: "parcial", label: "Parcial" },
  { valor: "cancelado", label: "Cancelado" },
] as const;

/** A qué estado de la OT lleva cada resultado. */
const ESTADO_SEGUN: Record<string, string> = {
  completado: "REALIZADO",
  parcial: "EN_PROCESO",
  cancelado: "SUSPENDIDA",
};

const hoy = () => {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
};

export default function RegistrarOTModal({
  orden, onCerrar, onRegistrada,
}: {
  orden: {
    id: string;
    ot_number: number | null;
    equipo_raw: string | null;
    descripcion: string | null;
    horas: number | null;
    contratista: string | null;
    operario_1: string | null;
    operario_2: string | null;
    operario_3: string | null;
    /*
     * Obligatorias y no opcionales: si el listado dejara de traerlas, reabrir
     * una OT y volver a cerrarla le borraria la falla sin un solo error. Que
     * esten declaradas asi deja dicho de que depende este modal. (La pantalla
     * guarda la orden como `any`, asi que esto documenta mas de lo que obliga;
     * la lectura que las trae es el `select("*")` de GET /ordenes.)
     */
    falla_modo: string | null;
    falla_causa: string | null;
    falla_detalle: string | null;
    /**
     * Cuándo empezó. No se edita acá: es el piso contra el que se compara la
     * fecha de cierre, porque un trabajo no se cierra antes de empezar.
     *
     * Obligatoria y no opcional por lo mismo que las tres de arriba: si el
     * listado dejara de traerla, el control de abajo no se caería — leería
     * `undefined` y diría «la orden no dice cuándo empezó» sobre órdenes que sí
     * lo dicen, trabando el registro del trabajo sin un solo error.
     */
    fecha_ejecucion: string | null;
    /**
     * Las dos que ya tiene la orden, para precargar el modal con ellas y no con
     * lo que se le ocurra a la pantalla.
     *
     * Obligatorias y no opcionales por lo mismo que las de arriba, y acá la
     * consecuencia es peor que un cartel de más: este modal manda todos sus
     * campos en cada guardado, y el PATCH exige la justificación cuando el
     * cierre queda antes del inicio. Si el listado dejara de traer
     * `cierre_justificacion`, reabrir una OT adelantada para corregirle las
     * horas mandaría el campo vacío y recibiría un 400 —o borraría la que
     * había—, sin un solo error de tipos. Y si dejara de traer `fecha_cierre`,
     * la fecha volvería a arrancar en hoy y se movería en silencio.
     */
    fecha_cierre: string | null;
    cierre_justificacion: string | null;
  };
  onCerrar: () => void;
  onRegistrada: () => void;
}) {
  const [resultado, setResultado] = useState<string>("completado");
  /*
   * Arranca en la fecha de cierre que la orden ya tiene, y en hoy sólo si no
   * tiene. Antes arrancaba siempre en hoy, así que reabrir una OT cerrada para
   * corregirle las horas le movía la fecha de cierre al día de hoy, en
   * silencio. Es un cambio de comportamiento en una pantalla que nadie pidió
   * cambiar, y está acá porque sin él «corregir una OT vieja no la obliga a
   * justificar nada de nuevo» no se sostiene: una orden cerrada antes de su
   * inicio se reabriría con la fecha de hoy, que ya no es anterior.
   */
  const [cuando, setCuando] = useState(orden.fecha_cierre ?? hoy());
  // Precargada por lo mismo que la fecha: si arrancara vacía, corregir las
  // horas de una OT adelantada mandaría "" y borraría el motivo guardado.
  const [justificacion, setJustificacion] = useState(orden.cierre_justificacion ?? "");
  const [horas, setHoras] = useState(orden.horas != null ? String(orden.horas) : "");
  const [contratista, setContratista] = useState(orden.contratista ?? "");
  const [operario1, setOperario1] = useState(orden.operario_1 ?? "");
  const [operario2, setOperario2] = useState(orden.operario_2 ?? "");
  const [operario3, setOperario3] = useState(orden.operario_3 ?? "");
  const [observaciones, setObservaciones] = useState("");
  /*
   * Precargada y no vacía: este modal se abre cada vez que una orden se da por
   * realizada y manda todos sus campos en cada guardado, así que arrancar en
   * blanco le borraría la falla a quien reabre una OT para corregir las horas.
   * Vaciar el desplegable sigue siendo "borrala": viaja como "" y la ruta lo
   * guarda como null.
   */
  const [falla, setFalla] = useState<LaFalla>({
    falla_modo: orden.falla_modo ?? "",
    falla_causa: orden.falla_causa ?? "",
    falla_detalle: orden.falla_detalle ?? "",
  });

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // La foto del trabajo hecho. Va a Drive y su link a la planilla, que es donde
  // la busca quien no entra al sistema.
  const [foto, setFoto] = useState<{ link: string; nombre: string } | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  // Las listas de Configuración: se elige de ellas en vez de escribir. Es lo
  // que evita que "Candia" y "CANDIA" terminen siendo dos personas distintas.
  const [operarios, setOperarios] = useState<{ id: string; slot: number; nombre: string }[]>([]);
  const [contratistas, setContratistas] = useState<{ id: string; nombre: string }[]>([]);

  const traerListas = useCargar(async (vigente) => {
    const [o, c] = await Promise.all([
      fetch("/api/mantenimiento/operarios"),
      fetch("/api/mantenimiento/proveedores"),
    ]);
    const operariosBody = o.ok ? await o.json() : null;
    const contratistasBody = c.ok ? await c.json() : null;
    if (!vigente()) return;
    if (operariosBody) setOperarios(operariosBody.data ?? []);
    if (contratistasBody) setContratistas(contratistasBody.data ?? []);
  }, []);

  async function subirFoto(archivo: File) {
    setSubiendo(true);
    setError("");

    const fd = new FormData();
    fd.append("file", archivo);
    fd.append("ot", String(orden.ot_number ?? ""));

    const res = await fetch("/api/mantenimiento/fotos", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setSubiendo(false);

    if (!res.ok) { setError(body.error ?? "No se pudo subir la foto."); return; }
    setFoto({ link: body.link, nombre: archivo.name });
    // El link sólo se escribe en la planilla si se puede abrir desde afuera.
    if (body.aviso) setAviso(body.aviso);
  }

  /**
   * Lo que impide cerrar, **calculado en cada render**.
   *
   * Se pidió que la alerta salte apenas estén las dos fechas y no recién al
   * guardar, y por eso vive acá y no adentro de `guardar()`. Es una función
   * pura de lo que la pantalla ya tiene —la fecha de inicio de la orden y la
   * que se está eligiendo—, así que no necesita estado propio ni un efecto:
   * un `useEffect` con `setState` sería un segundo render para guardar algo
   * que ya se sabe, que es lo que marca `react-hooks/set-state-in-effect`.
   *
   * La fecha de inicio no se edita acá, así que de las dos sólo se mueve una:
   * la alerta aparece y desaparece al cambiar el día, sin apretar nada.
   *
   * **Y desde el 12/11/2026 depende también de lo que se escriba**: el cartel
   * rojo se apaga cuando la justificación explica. Sin pasarla, la pantalla
   * mostraría a la vez el campo que pide el motivo y el cartel que dice que
   * igual no se puede guardar — que es el estado que esta tarea vino a sacar.
   */
  const impideCerrar = loQueImpideCerrar(orden.fecha_ejecucion, cuando, justificacion);

  // Sale y entra con las dos fechas, como la alerta de arriba.
  const pideJustificacion = elCierreEsAnteriorAlInicio(cuando, orden.fecha_ejecucion);

  async function guardar() {
    if (!observaciones.trim() && resultado !== "completado") {
      setError("Contá qué pasó: un trabajo parcial o cancelado sin explicación no sirve después.");
      return;
    }

    // Antes de postear nada, por lo mismo que el control de las fechas de más
    // abajo: la ejecución se guarda primero y no se deshace, así que un rechazo
    // del servidor dejaría el trabajo registrado y la orden sin cerrar.
    const faltaElPorQue = loQueFaltaPorElCierreAdelantado({
      fecha_cierre: cuando,
      fecha_ejecucion: orden.fecha_ejecucion,
      cierre_justificacion: justificacion,
    });
    if (faltaElPorQue.length > 0) {
      setError(`Falta ${faltaElPorQue.join(", ")}.`);
      return;
    }

    // ── ANTES DE LA EJECUCIÓN, Y POR ESO ESTÁ ACÁ Y NO ABAJO ─────────────────
    //
    // La misma función que corre el servidor, para que lo que se ve en
    // pantalla sea lo mismo que va a contestar la ruta. Pero acá no es sólo
    // comodidad: **esta pantalla hace dos escrituras y la primera no se
    // deshace.** La ejecución se guarda primero —es el registro de lo que se
    // hizo y no depende de la planilla— y recién después se cierra la OT. Si
    // el 400 del cierre llegara después, el trabajo quedaría registrado con
    // una fecha imposible y la orden abierta, que es exactamente el estado del
    // que esta pantalla ya avisa («El trabajo quedó registrado, pero...»).
    if (impideCerrar.length > 0) {
      setError(`No se puede guardar porque ${impideCerrar.join(", ")}.`);
      return;
    }

    setGuardando(true);
    setError("");

    // Primero la ejecución: es el registro de lo que se hizo y no depende de
    // que la planilla esté disponible.
    const ejecucion = await fetch("/api/mantenimiento/ejecuciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_order_id: orden.id,
        execution_status: resultado,
        // `cuando` es sólo la fecha ("YYYY-MM-DD") porque el campo es un
        // `type="date"`, pero `executed_at` es `timestamptz`: mandarla pelada
        // hace que Postgres la lea como medianoche UTC, o sea las 21:00 del
        // día ANTERIOR acá, y la pantalla muestra un día menos. Se manda como
        // medianoche de Argentina. (`fecha_cierre`, más abajo, sí es una
        // columna `date` y va tal cual.)
        executed_at: instanteDeArgentina(`${cuando}T00:00`),
        duration_hours: horas ? Number(horas) : null,
        observations: observaciones.trim() || null,
      }),
    });
    if (!ejecucion.ok) {
      const body = await ejecucion.json().catch(() => ({}));
      setGuardando(false);
      setError(body.error ?? "No se pudo registrar el trabajo.");
      return;
    }

    // Después la OT, que además escribe en la planilla.
    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: orden.id,
        estado: ESTADO_SEGUN[resultado],
        fecha_cierre: cuando,
        cierre_justificacion: justificacion.trim() || null,
        horas: horas ? Number(horas) : null,
        contratista: contratista.trim() || null,
        operario_1: operario1.trim() || null,
        operario_2: operario2.trim() || null,
        operario_3: operario3.trim() || null,
        observaciones: observaciones.trim() || null,
        // Las tres claves son las de la base: viajan sin traducir.
        ...falla,
        foto_url: foto?.link ?? undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) {
      setError(`El trabajo quedó registrado, pero no se pudo cerrar la OT: ${body.error ?? ""}`);
      return;
    }
    // Quedó todo bien en la app y lo único que falta es la planilla. Qué decir
    // depende de si el sistema va a insistir: desde que el PATCH anota el
    // pendiente, fallar acá es lo normal —la fila del master llega por
    // `IMPORTRANGE` y tarda— y el reintento la termina solo. Pedirle a alguien
    // que la complete a mano en ese caso era mandarlo a escribir dos veces.
    const avisoDeLaPlanilla = avisoDelPendiente(
      body.planilla_error, Boolean(body.planilla_reintentando)
    );
    if (avisoDeLaPlanilla) {
      setAviso(`Se registró todo. ${avisoDeLaPlanilla}`);
      return;
    }
    onRegistrada();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">Registrar el trabajo</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            OT #{orden.ot_number ?? "—"} · {orden.equipo_raw ?? orden.descripcion ?? ""}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {aviso && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>{aviso}</p>
            <button onClick={onRegistrada} className="font-semibold underline">Entendido</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Cómo salió">
            <Select
              value={resultado}
              onChange={(e) => setResultado(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {RESULTADOS.map((r) => <option key={r.valor} value={r.valor}>{r.label}</option>)}
            </Select>
          </Campo>

          <Campo etiqueta="Cuándo">
            {/*
              **Sin `min`, desde el 12/11/2026.** Tenía la fecha de inicio de la
              OT para que el calendario dejara los días anteriores en gris, y
              eso dejó de corresponder cuando se pidió poder cerrar antes del
              inicio explicando por qué: el calendario no deja ni *elegir* un
              día en gris, así que con el `min` puesto el campo de justificación
              que aparece abajo era inalcanzable desde esta pantalla. Quien
              decide sigue siendo `loQueImpideCerrar`, acá arriba y en el
              servidor; lo que se perdió, dicho, es la defensa barata contra el
              dedo que erra por un día, y lo que la reemplaza es tener que
              escribir el motivo.
            */}
            <input
              type="date"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {/*
              Y esto se queda, aunque ya no haya gris que explicar: quien
              registra el trabajo no tiene la fecha de inicio delante —está en
              la ficha de la OT— y sin ella no puede saber si lo que está
              eligiendo cae antes. Sacado el `min`, es lo único que lo dice
              antes de que aparezca el campo del motivo.
            */}
            {orden.fecha_ejecucion && (
              <p className="mt-1 text-xs text-slate-400">
                Empezó el {comoSeLee(orden.fecha_ejecucion)}
              </p>
            )}
          </Campo>

          <Campo etiqueta="Horas">
            <input
              type="number"
              min="0"
              step="0.5"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              placeholder="—"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </Campo>

          <Campo etiqueta="Contratista">
            <Select
              value={contratista}
              onChange={(e) => setContratista(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Lo hizo personal propio</option>
              {/* Si la OT ya traía uno que no está en la lista, se suma para
                  no perderlo al guardar. */}
              {[...new Set([
                ...contratistas.map((c) => c.nombre),
                ...(contratista ? [contratista] : []),
              ])].sort().map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Campo>
        </div>

        {/* ── LA ALERTA, EN EL MOMENTO Y NO AL GUARDAR ─────────────────────
            Se pidió que salte apenas estén las dos fechas. Va **debajo de la
            grilla y no adentro de la celda**: la grilla es de dos columnas, y
            ahí el mensaje —que nombra las dos fechas enteras— entra partido en
            pedazos de 150 px.

            El botón de guardar sigue habilitado a propósito. Deshabilitarlo
            dejaría el porqué acá arriba y el botón mudo abajo, que en un
            teléfono es media pantalla de distancia; apretarlo repite el mismo
            texto donde la persona está mirando, y el guardado igual no pasa:
            lo frena `guardar()` y, si llegara, el servidor. */}
        {impideCerrar.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            No se puede guardar porque {impideCerrar.join(", ")}.
          </div>
        )}

        {/* Debajo de la grilla y no adentro de la celda de la fecha, por lo
            mismo que la alerta: en media columna el rótulo se parte. */}
        {pideJustificacion && (
          <Campo etiqueta="Por qué se cierra antes de la fecha de inicio">
            <textarea
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              className="input min-h-20"
            />
          </Campo>
        )}

        <Campo etiqueta="Quiénes lo hicieron">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              [operario1, setOperario1],
              [operario2, setOperario2],
              [operario3, setOperario3],
            ].map(([valor, set], i) => {
              // Cada columna de la orden tiene su propia lista de gente.
              const suyos = operarios.filter((o) => o.slot === i + 1).map((o) => o.nombre);
              const elegido = valor as string;
              return (
                <Select
                  key={i}
                  value={elegido}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Operario {i + 1}</option>
                  {[...new Set([...suyos, ...(elegido ? [elegido] : [])])].sort().map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              );
            })}
          </div>
        </Campo>

        <Campo etiqueta="Qué se hizo y qué se encontró">
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            placeholder="Se cambió el rodamiento del lado motor; el acople está gastado y va a haber que cambiarlo."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Campo>

        <FallaDeLaOT falla={falla} onCambiar={setFalla} deshabilitado={guardando} />

        <Campo etiqueta="Foto del trabajo">
          {foto ? (
            <div className="flex items-center gap-2 text-sm">
              <a
                href={foto.link}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-blue-600 hover:underline"
              >
                {foto.nombre}
              </a>
              <button
                onClick={() => setFoto(null)}
                className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                title="Sacar la foto"
              >×</button>
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
        </Campo>

        <div className="flex gap-2 pt-1">
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Registrar"}
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

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-slate-600">{etiqueta}</span>
      {children}
    </label>
  );
}
