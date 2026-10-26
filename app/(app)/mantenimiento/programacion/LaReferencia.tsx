"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { useConfirm } from "@/components/ConfirmProvider";
import { useCargar } from "@/lib/core/useCargar";
import { comoSeLee, semanaDe } from "@/lib/core/fechas";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import { OFICIO_TEXTO, TURNO_TEXTO, diaMes, llamar, type Persona } from "./programacionComun";

/**
 * La referencia del ciclo: de qué semana se cuenta todo lo demás.
 *
 * Sin ella no hay ciclo que calcular —no se puede saber qué grupo está en 4 a
 * 12 ni dónde está cada electricista—, así que cuando falta esta sección se
 * abre sola y la grilla no se dibuja.
 *
 * ── POR QUÉ SE VE SIEMPRE Y NO SÓLO CUANDO FALTA ────────────
 *
 * Hasta el 26/10/2026 esto se mostraba **únicamente** si no había referencia
 * cargada, y la ruta sólo tenía un `POST` que rechazaba un segundo lunes igual.
 * O sea: el ancla se cargaba una vez y no se podía ni ver ni corregir nunca
 * más. Y la carga una persona de memoria —qué grupo estaba en 4 a 12 es cara o
 * ceca si no se acuerda, más tres electricistas en tres turnos—: si erraba
 * cualquiera de las cuatro cosas, **todas las semanas quedaban mal**, hacia
 * adelante y hacia atrás, sin un solo error en pantalla. Que la grilla se vea
 * completa no quiere decir que diga la verdad, y esta sección es el único lugar
 * donde eso se puede comprobar.
 *
 * Se muestra plegada, como el padrón: ocupa un renglón hasta que alguien la
 * abre.
 *
 * ── LAS DOS FORMAS DE CAMBIARLA NO SON LA MISMA ─────────────
 *
 * Están separadas a propósito, porque lo que le pasa al pasado es distinto:
 *
 *   - **Corregir la que rige** (`PUT`) pisa la fila: lo que la pantalla mostró
 *     de esas semanas cambia, incluidas las que ya pasaron. Es para un ancla
 *     mal cargada, que es dato falso y no historia.
 *   - **Volver a anclar desde otra semana** (`POST`) deja la anterior donde
 *     está y agrega una nueva: las semanas previas se siguen viendo como se
 *     vieron. Es para cuando el ciclo **cambió de verdad** —entró o se fue un
 *     electricista, se dieron vuelta los grupos—.
 *
 * Elegir mal entre las dos es lo único que esta pantalla no puede deshacer
 * sola, así que cada una dice en su propio recuadro qué semanas toca, y las dos
 * piden confirmación antes de escribir.
 *
 * Todas las reglas (que el lunes sea lunes, que sean tres electricistas
 * distintos del padrón y vigentes ese día) las pone
 * `/api/mantenimiento/programacion/referencia`; acá sólo se muestran sus
 * mensajes. Esta pantalla no toca la base.
 */

/** Un ancla como la devuelve el `GET` de la ruta. */
interface Ancla {
  id: string;
  lunes: string;
  grupo_en_4a12: Grupo;
  electricista_4a12_id: string;
  electricista_8a16_id: string;
  electricista_12a20_id: string;
  nombre_4a12: string;
  nombre_8a16: string;
  nombre_12a20: string;
}

type Modo = "alta" | "correccion" | "nueva";

export default function LaReferencia({
  lunesDeHoy, personas, abiertaAlPrincipio, alCambiar,
}: {
  /** El lunes de la semana en curso. */
  lunesDeHoy: string;
  /** El padrón de la semana que se está mirando: de ahí salen los electricistas. */
  personas: Persona[];
  abiertaAlPrincipio: boolean;
  /** Cambió la referencia: hay que volver a pedir la semana. */
  alCambiar: () => void;
}) {
  const confirmar = useConfirm();
  const electricistas = personas.filter((p) => p.oficio === "electricista");

  const [abierta, setAbierta] = useState(abiertaAlPrincipio);
  const [anclas, setAnclas] = useState<Ancla[] | null>(null);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);

  const [modo, setModo] = useState<Modo | null>(null);
  const [lunes, setLunes] = useState(lunesDeHoy);
  const [grupo, setGrupo] = useState<Grupo>("A");
  const [e412, setE412] = useState("");
  const [e816, setE816] = useState("");
  const [e1220, setE1220] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCargar(async (vigente) => {
    const r = await llamar("/api/mantenimiento/programacion/referencia", "GET");
    if (!vigente()) return;
    if (!r.ok) {
      setErrorDeCarga(r.error);
      return;
    }
    setErrorDeCarga(null);
    const filas = r.data.data as Ancla[];
    setAnclas(filas);
    // Sin ninguna cargada, el formulario de alta se abre solo: es lo único que
    // hay para hacer acá, y esconderlo detrás de un botón más sería un clic de
    // peaje en la única pantalla que destraba la programación entera.
    if (filas.length === 0) {
      setModo("alta");
      setLunes(lunesDeHoy);
    }
  }, []);

  // La que manda: la ruta las devuelve de la más nueva a la más vieja.
  const actual = anclas?.[0] ?? null;
  const falta = anclas !== null && anclas.length === 0;

  function abrirFormulario(cual: Modo) {
    setError(null);
    setModo(cual);
    if (cual === "correccion" && actual) {
      setLunes(actual.lunes);
      setGrupo(actual.grupo_en_4a12);
      setE412(actual.electricista_4a12_id);
      setE816(actual.electricista_8a16_id);
      setE1220(actual.electricista_12a20_id);
      return;
    }
    setLunes(lunesDeHoy);
    setGrupo(actual?.grupo_en_4a12 ?? "A");
    setE412("");
    setE816("");
    setE1220("");
  }

  async function guardar() {
    // Esto es sólo para no hacer ir y volver a la ruta por algo que se ve acá:
    // la que defiende es la ruta.
    const elegidos = [e412, e816, e1220];
    if (elegidos.some((e) => !e)) {
      setError("Falta elegir el electricista de cada turno");
      return;
    }
    if (new Set(elegidos).size !== 3) {
      setError("Cada turno lleva un electricista distinto");
      return;
    }
    if (enviando) return;

    const esCorreccion = modo === "correccion";
    if (modo !== "alta") {
      const ok = await confirmar({
        title: esCorreccion ? "Corregir la referencia" : "Volver a anclar el ciclo",
        message: esCorreccion
          ? `Las semanas desde el ${comoSeLee(lunes)} —y las anteriores, si no hay otra referencia más vieja— ` +
            "van a mostrar otros turnos, incluidas las que ya pasaron. Queda anotado en el registro de auditoría."
          : `Desde el ${comoSeLee(lunes)} en adelante la pantalla va a mostrar esta rotación. Lo anterior se ` +
            "sigue viendo como está. Queda anotado en el registro de auditoría.",
        confirmText: esCorreccion ? "Corregir" : "Anclar",
        danger: esCorreccion,
      });
      if (!ok) return;
    }

    setEnviando(true);
    setError(null);
    const cuerpo = {
      lunes,
      grupoEn4a12: grupo,
      electricista4a12Id: e412,
      electricista8a16Id: e816,
      electricista12a20Id: e1220,
    };
    const r = esCorreccion
      ? await llamar("/api/mantenimiento/programacion/referencia", "PUT", { id: actual!.id, ...cuerpo })
      : await llamar("/api/mantenimiento/programacion/referencia", "POST", cuerpo);
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setModo(null);
    recargar();
    alCambiar();
  }

  const porOficio = (o: Oficio) => personas.filter((p) => p.oficio === o);

  const resumen = actual
    ? `semana del ${diaMes(actual.lunes)} · grupo ${actual.grupo_en_4a12} en ${TURNO_TEXTO["4-12"]}`
    : falta
      ? "falta cargarla"
      : "";

  return (
    <section className={`card ${falta ? "border-amber-300" : ""}`}>
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => setAbierta(!abierta)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">La referencia del ciclo</span>
          {resumen && <span className="block truncate text-xs text-slate-500">{resumen}</span>}
        </span>
        <span aria-hidden className="shrink-0 text-slate-400">{abierta ? "▲" : "▼"}</span>
      </button>

      {abierta && (
        <div className="space-y-4 border-t border-slate-100 p-4">
          {errorDeCarga && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errorDeCarga}</p>}
          {anclas === null && !errorDeCarga && <p className="text-sm text-slate-400">Cargando…</p>}

          {falta && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-sm font-semibold text-amber-900">Falta cargar la semana de referencia</h3>
              <p className="mt-1 text-sm text-amber-900">
                Sin ella no se sabe qué grupo está en cada turno ni dónde está cada electricista, y no se puede armar
                la semana. Decí cómo está la semana en curso (la del {diaMes(lunesDeHoy)}) y desde ahí se calculan
                todas las demás.
              </p>
            </div>
          )}

          {actual && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-800">Lo que rige hoy</h3>
              <ul className="space-y-0.5 text-sm text-slate-700">
                <li>
                  <span className="font-medium">Semana del {comoSeLee(actual.lunes)}</span>: grupo{" "}
                  {actual.grupo_en_4a12} en {TURNO_TEXTO["4-12"]}
                </li>
                <li>Electricista de {TURNO_TEXTO["4-12"]}: {actual.nombre_4a12}</li>
                <li>Electricista de {TURNO_TEXTO["8-16"]}: {actual.nombre_8a16}</li>
                <li>Electricista de {TURNO_TEXTO["12-20"]}: {actual.nombre_12a20}</li>
              </ul>
              <p className="text-xs text-slate-500">
                De acá sale la rotación de todas las semanas: las posteriores a ese lunes y también las anteriores,
                mientras no haya otra referencia más vieja. Si alguna de estas cuatro cosas está mal, la grilla se
                dibuja igual de completa y muestra a la gente en turnos en los que no está.
                {anclas && anclas.length > 1 && ` Hay ${anclas.length} referencias cargadas; las más viejas siguen rigiendo sus propias semanas.`}
              </p>
              {modo === null && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className="btn-secondary" onClick={() => abrirFormulario("correccion")}>
                    Corregir la que rige
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => abrirFormulario("nueva")}>
                    Volver a anclar desde otra semana
                  </button>
                </div>
              )}
            </div>
          )}

          {/* A quién tiene el taller: sin esto no se puede elegir con qué llenar el formulario. */}
          {(falta || modo !== null) && (
            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-1 text-sm font-semibold text-slate-800">
                El taller tiene {personas.length} {personas.length === 1 ? "persona" : "personas"} en la semana que se
                mira
              </h3>
              {personas.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No hay nadie del taller vigente en esta semana. Cargá el padrón (abajo, en &ldquo;El taller&rdquo;)
                  antes de armar la referencia.
                </p>
              ) : (
                <ul className="space-y-1 text-sm text-slate-700">
                  {(["mecanico", "lubricador", "electricista"] as Oficio[]).map((o) =>
                    porOficio(o).length === 0 ? null : (
                      <li key={o}>
                        <span className="font-medium">{OFICIO_TEXTO[o]}s:</span>{" "}
                        {porOficio(o).map((p) => `${p.nombre}${p.grupo ? ` (${p.grupo})` : ""}`).join(", ")}
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
          )}

          {/* El formulario. En el alta el lunes no se elige: es la semana en curso. */}
          {modo !== null && (
            <div className="space-y-3 rounded-lg border border-slate-300 p-3">
              <h3 className="text-sm font-semibold text-slate-800">
                {modo === "alta"
                  ? `La semana del ${diaMes(lunes)}`
                  : modo === "correccion"
                    ? "Corregir la referencia que rige"
                    : "Volver a anclar el ciclo"}
              </h3>

              {modo === "correccion" && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                  Esto pisa la referencia que hay. Cambia lo que la pantalla muestra de <strong>todas</strong> las
                  semanas desde ese lunes —y de las anteriores, si no hay otra más vieja—, incluidas las que ya
                  pasaron. Es para un ancla mal cargada. Si el ciclo cambió de verdad, usá &ldquo;volver a anclar
                  desde otra semana&rdquo;.
                </p>
              )}
              {modo === "nueva" && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Esto agrega una referencia nueva y deja la anterior donde está: desde ese lunes en adelante manda
                  ésta, y las semanas previas se siguen viendo como se vieron. Es para cuando el ciclo cambió —entró o
                  se fue un electricista, se dieron vuelta los grupos—.
                </p>
              )}

              {modo !== "alta" && (
                <div>
                  <label htmlFor="ref-lunes" className="mb-1 block text-xs text-slate-500">
                    Desde qué semana (se toma el lunes de la semana que elijas)
                  </label>
                  <div className="w-44">
                    <input
                      id="ref-lunes"
                      type="date"
                      value={lunes}
                      onChange={(e) => setLunes(e.target.value ? semanaDe(e.target.value)[0] : lunes)}
                      className="input"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="ref-grupo" className="mb-1 block text-xs text-slate-500">
                  Grupo que está en {TURNO_TEXTO["4-12"]} esa semana
                </label>
                <Select id="ref-grupo" className="input" value={grupo} onChange={(e) => setGrupo(e.target.value as Grupo)}>
                  <option value="A">Grupo A</option>
                  <option value="B">Grupo B</option>
                </Select>
              </div>

              {([
                ["ref-e412", `Electricista de ${TURNO_TEXTO["4-12"]}`, e412, setE412],
                ["ref-e816", `Electricista de ${TURNO_TEXTO["8-16"]}`, e816, setE816],
                ["ref-e1220", `Electricista de ${TURNO_TEXTO["12-20"]}`, e1220, setE1220],
              ] as const).map(([id, rotulo, valor, poner]) => (
                <div key={id}>
                  <label htmlFor={id} className="mb-1 block text-xs text-slate-500">{rotulo}</label>
                  <Select id={id} className="input" value={valor} onChange={(e) => poner(e.target.value)}>
                    <option value="">Elegir…</option>
                    {electricistas.map((p) => (
                      <option key={p.empleadoId} value={p.empleadoId}>{p.nombre}</option>
                    ))}
                    {/*
                      Un electricista que ya no está en el padrón de la semana que se mira igual
                      figura en la referencia: sin esto, abrir la corrección le vaciaría el campo
                      sin decir nada y guardar lo cambiaría por otro sin querer.
                    */}
                    {actual &&
                      [
                        [actual.electricista_4a12_id, actual.nombre_4a12],
                        [actual.electricista_8a16_id, actual.nombre_8a16],
                        [actual.electricista_12a20_id, actual.nombre_12a20],
                      ]
                        .filter(([eid]) => eid === valor && !electricistas.some((p) => p.empleadoId === eid))
                        .map(([eid, nombre]) => (
                          <option key={eid} value={eid}>{nombre} (ya no está en el padrón)</option>
                        ))}
                  </Select>
                </div>
              ))}

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

              <div className="flex gap-2">
                {!falta && (
                  <button type="button" className="btn-secondary flex-1" disabled={enviando} onClick={() => setModo(null)}>
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={enviando || electricistas.length === 0}
                  onClick={() => void guardar()}
                >
                  {modo === "correccion" ? "Guardar la corrección" : "Cargar la referencia"}
                </button>
              </div>
            </div>
          )}

          {modo !== null && electricistas.length < 3 && (
            <p className="text-sm text-slate-500">
              La referencia pide tres electricistas distintos, y el padrón de la semana que se mira tiene{" "}
              {electricistas.length}. Sumalos abajo, en &ldquo;El taller&rdquo;, o mirá una semana en la que estén.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
