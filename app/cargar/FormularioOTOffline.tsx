"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { loQueFaltaParaCrear, loQueSeContradice } from "@/lib/mantenimiento/altaDeOT";
import { borradorDesdeElCuerpo } from "@/lib/mantenimiento/borradorDeCarga";
import RepuestosDeLaOT from "@/components/RepuestosDeLaOT";
import FallaDeLaOT, { FALLA_VACIA, type LaFalla } from "@/components/FallaDeLaOT";
import { lineasDesdeElCuerpo, type LineaDeRepuesto } from "@/lib/mantenimiento/repuestosDeLaOT";
import { estadoSegunElCierre } from "@/lib/mantenimiento/cierreDeOT";
import {
  elCierreEsAnteriorAlInicio, loQueFaltaPorElCierreAdelantado,
} from "@/lib/mantenimiento/cierreAnteriorAlInicio";
import { PRIORIDADES_DE_OT, TIPOS_DE_OT, QUIENES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type {
  EquipoDelCatalogo,
  OperarioDelCatalogo,
  SectorDelCatalogo,
} from "./catalogos";
import { CartelDelResultado, loQueDijo, type Resultado } from "./envio";

/**
 * Los cuatro vocabularios, de `lib/`, no una copia. Es la misma razón por la
 * que `NuevaOTModal` los toma de ahí: lo que se elige tiene que ser lo que se
 * filtra, y dos vocabularios para lo mismo es cómo una OT creada desde la app
 * dejó de aparecer al filtrar por «Media».
 *
 * La prioridad se arregló el 16/10/2026; las otras tres, el 21/10, y acá el
 * agujero era peor que en el modal: **una OT cargada sin señal no se revisa en
 * el momento**. Se manda desde la cola horas o días después, así que una con
 * especialidad INSTRUMENTACIÓN —que el filtro no conocía— entraba, se
 * sincronizaba y no aparecía más, sin que nadie estuviera mirando la pantalla
 * para notarlo. Y como esta lista no ofrecía LUBRICACIÓN, un engrase cargado en
 * la planta no se podía clasificar como tal.
 *
 * El porqué medido de los cinco valores que se sumaron al vocabulario está en
 * los encabezados de `ordenes.ts` y `filtrosOt.ts`.
 */
const PRIORIDADES = PRIORIDADES_DE_OT;
/**
 * Los estados **sí** son una lista propia, y es a propósito: es un subconjunto
 * de `ESTADOS_DE_OT` —le falta SUSPENDIDA— porque una OT no nace suspendida, y
 * lleva etiquetas de pantalla que el vocabulario no tiene. Ofrecer menos no
 * abre el agujero de arriba; ofrecer de más, sí.
 */
const ESTADOS_OT = [
  { value: "POR_HACER", label: "Por hacer" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "REALIZADO", label: "Realizado" },
  { value: "ATRASADO", label: "Atrasado" },
];

/**
 * Cargar una orden de trabajo desde la pantalla que anda sin señal.
 *
 * TIENE LOS MISMOS CAMPOS QUE `NuevaOTModal` Y CONVIVE CON ÉL, por el mismo
 * motivo que el formulario de aviso: el modal vive dentro de la pantalla de
 * órdenes, que trae sus datos del servidor, y no se puede dibujar sin conexión.
 *
 * LO QUE NO HACE, Y ES A PROPÓSITO: no manda `aviso_id`. Una OT que nace de un
 * aviso se carga desde el aviso, que es donde está el botón; acá se carga una
 * orden suelta, que es lo que alguien necesita parado en la planta.
 *
 * Y CONVIVIR TIENE UN PRECIO QUE YA SE PAGÓ UNA VEZ: el 19/10/2026 otra sesión
 * sumó `loQueFaltaParaCrear` a la ruta y al modal, y este formulario no se
 * enteró. Con sus valores por defecto le faltaban el sector, el equipo, la
 * especialidad y la fecha de ejecución, así que toda OT cargada en la planta
 * iba a recibir un 400 —definitivo para la cola— y quedar parada. **Las dos
 * validaciones tienen que salir de la misma función**, que es la que corre la
 * ruta: cualquier otra cosa es esperar a que alguien se acuerde.
 */
export default function FormularioOTOffline({
  equipos,
  sectores,
  operarios,
  deshabilitado,
  borrador,
  onMandar,
}: {
  equipos: EquipoDelCatalogo[];
  sectores: SectorDelCatalogo[];
  operarios: OperarioDelCatalogo[];
  /** Sin dónde guardar o sin saber de quién sería la carga, no se acepta nada. */
  deshabilitado: boolean;
  /**
   * El cuerpo de una carga parada que se está editando, para arrancar con sus
   * valores. `CargarClient` remonta este componente con `key` cuando cambia:
   * así lo que se escribió en el formulario anterior no se arrastra.
   */
  borrador?: Record<string, unknown> | null;
  onMandar: (cuerpo: Record<string, unknown>) => Promise<Resultado>;
}) {
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [form, setForm] = useState(() => borradorDesdeElCuerpo(vacio(), borrador));
  /*
   * Los repuestos van aparte de `form`, igual que en el modal: `form` se
   * derrama entero al cuerpo y una lista no es un campo de texto.
   *
   * Y se recuperan con su propia función porque `borradorDesdeElCuerpo`
   * descarta los arreglos a propósito —un `String({})` daría «[object
   * Object]»—, así que una carga parada perdería los repuestos sin decir nada.
   */
  const [repuestos, setRepuestos] = useState<LineaDeRepuesto[]>(() => lineasDesdeElCuerpo(borrador));
  /*
   * La falla de una carga que quedó parada se recupera **acá**, leyendo el
   * cuerpo guardado, y no por `borradorDesdeElCuerpo`: esa función copia los
   * campos que estén en `vacio()`, y los tres de la falla no viven en el
   * formulario sino en su propio estado. Son texto plano, así que alcanza con
   * leerlos; es lo que con los repuestos no alcanzaba, porque viajan como
   * arreglo.
   */
  const [falla, setFalla] = useState<LaFalla>(() => ({
    falla_modo: String(borrador?.falla_modo ?? ""),
    falla_causa: String(borrador?.falla_causa ?? ""),
    falla_detalle: String(borrador?.falla_detalle ?? ""),
  }));

  function f(clave: keyof FormularioDeOT, valor: string | boolean) {
    setForm((previo) => {
      const siguiente = { ...previo, [clave]: valor } as FormularioDeOT;
      if (clave === "equipment_id" && typeof valor === "string" && valor) {
        const eq = equipos.find((e) => e.id === valor);
        if (eq) siguiente.sector_id = eq.sector_id ?? "";
      }
      return siguiente;
    });
  }

  /** Si esta orden nace cerrada. Lo decide la fecha, no el desplegable. */
  const cierraAlCrearse =
    estadoSegunElCierre(form.fecha_cierre, form.estado) === "REALIZADO" &&
    Boolean(form.fecha_cierre.trim());

  /** Si el cierre cae antes del inicio: entonces hay que decir por qué. */
  const cierreAdelantado = elCierreEsAnteriorAlInicio(form.fecha_cierre, form.fecha_ejecucion);

  /**
   * Lo que el formulario dice y se contradice, **calculado en cada render**.
   *
   * Se pidió que la alerta salte apenas estén las dos fechas y no recién al
   * mandar. Acá importa más que con señal, por lo mismo que el resto de los
   * controles de esta pantalla: sin conexión el que contesta es el servidor
   * horas o días después, y lo que contesta es un 400 definitivo para la cola.
   * Decirlo mientras la persona tiene el formulario delante es la diferencia
   * entre corregir un día y descubrirlo la semana que viene.
   *
   * Es una función pura de `form`, así que no necesita estado ni efecto, y
   * `loQueSeContradice` se calla mientras falte la fecha de inicio: no grita
   * mientras se completa.
   */
  const contradicciones = loQueSeContradice(form);

  /**
   * Y si lo que pasa es que falta el motivo, **que el cartel pida eso**.
   *
   * La misma elección que hicieron las dos rutas el 12/11/2026 —primero el
   * faltante, después la contradicción— traída a la pantalla, que es donde la
   * gente la mira. Sin esto, entre que alguien elige la fecha y escribe el
   * motivo ve «No se puede guardar porque la fecha de cierre … es anterior a la
   * de inicio» justo al lado del campo que lo levanta.
   *
   * Acá pesa más que con señal: un cartel que dice que no se puede guardar es,
   * en esta pantalla, un motivo para no mandar la carga — y la carga es lo
   * único que quien está en la planta se lleva.
   *
   * Habla sólo de la justificación y no de todo lo que falta —de eso se ocupa
   * `loQueFaltaParaCrear` al mandar—, porque esto corre en cada render.
   */
  const faltaElPorQue = loQueFaltaPorElCierreAdelantado(form);

  const equiposDelSector = form.sector_id
    ? equipos.filter((e) => e.sector_id === form.sector_id)
    : equipos;

  async function crear() {
    // **LA MISMA FUNCIÓN QUE CORRE LA RUTA, Y ÉSE ES EL PUNTO.** Son los
    // obligatorios de siempre más, si viene con fecha de cierre, las horas y
    // quién la hizo; todo junto y en un solo mensaje. Acá importa más que con
    // señal: sin conexión el que contesta es el servidor, horas o días después,
    // y lo que contesta es un 400 — definitivo para la cola, o sea una carga
    // parada por algo que se podía decir en el momento.
    const falta = loQueFaltaParaCrear(form);
    if (falta.length > 0) {
      setError(`Falta cargar ${falta.join(", ")}.`);
      return;
    }
    // Y después, con otro verbo: acá los datos están y lo que no cierra es lo
    // que dicen entre ellos —una fecha de fin o de cierre anterior al inicio—.
    // Vale el mismo argumento de arriba y con más fuerza: un 400 por esto es
    // definitivo para la cola, o sea una carga parada por algo que se podía
    // decir en el momento, con la pantalla delante.
    if (contradicciones.length > 0) {
      setError(`No se puede guardar porque ${contradicciones.join(", ")}.`);
      return;
    }

    setMandando(true);
    setError("");
    setResultado(null);

    const eq = equipos.find((e) => e.id === form.equipment_id);
    const sec = sectores.find((s) => s.id === form.sector_id);

    try {
      const salida = await onMandar({
        ...form,
        // Los renglones; la ruta arma con ellos el texto de la única celda que
        // la planilla tiene para esto.
        repuestos,
        // Las tres claves son las de la base. Si la orden no nace cerrada no
        // hubo falla que contar, y van vacías.
        ...(cierraAlCrearse ? falla : FALLA_VACIA),
        horas: form.horas ? Number(form.horas) : null,
        // El mismo cálculo que hace el servidor. Mandarlo igual es para que lo
        // que se vio en pantalla sea lo que viaja; quien decide es la ruta.
        estado: estadoSegunElCierre(form.fecha_cierre, form.estado),
        equipo_raw: eq ? `${eq.code} – ${eq.name}` : null,
        equipo_code: eq?.code ?? null,
        sector_raw: sec?.nombre ?? null,
        equipment_id: form.equipment_id || null,
        sector_id: form.sector_id || null,
      });
      setResultado(salida);
      // Se vacía salvo cuando la carga se rechazó: ahí lo escrito es lo único
      // que hay, y borrarlo obligaría a tipear todo de nuevo para corregir una
      // coma. Este formulario tiene dieciocho campos.
      if (salida.estado !== "rechazada") {
        setForm(vacio());
        setRepuestos([{ cantidad: "", nombre: "" }]);
      }
    } catch (e) {
      // Nada de acá debería tirar, pero si tira —`crypto.randomUUID` en un
      // contexto inseguro, por ejemplo— no puede quedarse en la consola: la
      // persona tiene que saber que la orden no se cargó.
      setError(`No se pudo cargar la orden: ${loQueDijo(e)}`);
    } finally {
      setMandando(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        El número sale de la planilla, en el servidor: acá no se inventa nunca.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <CartelDelResultado tipo="orden" resultado={resultado} />

      {/* LOS RÓTULOS DE LAS OPCIONES VACÍAS DICEN «Elegí…» Y NO «— Todos —».
          Decían eso, que es el rótulo de un **filtro**: en un filtro dejarlo
          vacío significa no filtrar, y acá significa una OT que no se puede
          contar contra ninguna máquina ni dar por atrasada nunca. Invitaban a
          dejar vacío justo el campo que la ruta rechaza con un 400. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Sector" required>
          <Select
            value={form.sector_id}
            onChange={(e) => f("sector_id", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">— Elegí el sector —</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo ? `${s.codigo} — ` : ""}
                {s.nombre}
              </option>
            ))}
          </Select>
        </F>
        <F label="Equipo" required>
          <Select
            value={form.equipment_id}
            onChange={(e) => f("equipment_id", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">— Elegí el equipo —</option>
            {equiposDelSector.map((eq) => (
              <option key={eq.id} value={eq.id}>
                {eq.code} – {eq.name}
              </option>
            ))}
          </Select>
        </F>
      </div>

      <F label="Descripción del trabajo" required>
        <textarea
          value={form.descripcion}
          onChange={(e) => f("descripcion", e.target.value)}
          rows={3}
          disabled={deshabilitado}
          className="input resize-none"
          placeholder="Describí el trabajo a realizar…"
        />
      </F>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <F label="Especialidad" required>
          <Select
            value={form.especialidad}
            onChange={(e) => f("especialidad", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">— Elegí la especialidad —</option>
            {ESPECIALIDADES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
        <F label="Tipo" required>
          <Select
            value={form.tipo}
            onChange={(e) => f("tipo", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            {TIPOS_DE_OT.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
        <F label="Quién realiza" required>
          <Select
            value={form.quien}
            onChange={(e) => f("quien", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            {QUIENES_DE_OT.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
      </div>

      <F label="Repuestos utilizados">
        <RepuestosDeLaOT
          lineas={repuestos}
          onCambiar={setRepuestos}
          deshabilitado={deshabilitado}
        />
      </F>


      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <F label="Fecha creación">
          <input
            type="date"
            value={form.fecha}
            onChange={(e) => f("fecha", e.target.value)}
            disabled={deshabilitado}
            className="input"
          />
        </F>
        {/* Obligatoria y no un adorno: sin ella la OT no se atrasa nunca, así
            que no aparece en ningún listado de lo que está vencido. */}
        <F label="Fecha de inicio" required>
          <input
            type="date"
            value={form.fecha_ejecucion}
            onChange={(e) => f("fecha_ejecucion", e.target.value)}
            disabled={deshabilitado}
            className="input"
          />
        </F>
        {/* Estimada —la real es la de cierre— y obligatoria desde el
            04/11/2026. Ojo con esta pantalla en particular: una carga encolada
            ANTES de esa fecha vuelve sin la clave y el servidor la va a
            rechazar nombrando el campo. Es visible y se arregla completándolo;
            medido ese día, las 13 cargas de la tabla estaban resueltas. */}
        {/* El `min` es la fecha de inicio: el calendario deja en gris los días
            anteriores, así que el dedo que erra por un día no llega ni a
            elegirlos. Acá importa más que con señal, por lo mismo que arriba:
            sin conexión el que contesta es el servidor horas o días después, y
            lo que contesta es un 400 definitivo para la cola. Igual no es la
            regla —un `min` se saltea tipeando—: quien decide es
            `loQueSeContradice`, en el submit y en el servidor.

            **Lo lleva la de fin y ya no la de cierre** (12/11/2026). Son dos
            reglas distintas: la de fin es la ventana estimada, que nadie pidió
            poder prometer al revés; la de cierre se puede dar vuelta desde que
            se explica por qué, y con el `min` puesto el camino normal al campo
            del motivo quedaba cerrado —el calendario no ofrece los días en
            gris, así que llegaba sólo quien tipeara la fecha a mano—. El submit
            sigue
            frenando lo que no se explica, así que la cola no se lleva nada que
            el servidor vaya a rechazar por esto. */}
        <F label="Fecha de fin (estimada)" required>
          <input
            type="date"
            value={form.fecha_fin}
            min={form.fecha_ejecucion || undefined}
            onChange={(e) => f("fecha_fin", e.target.value)}
            disabled={deshabilitado}
            className="input"
          />
        </F>
        <F label="Fecha cierre">
          <input
            type="date"
            value={form.fecha_cierre}
            onChange={(e) => f("fecha_cierre", e.target.value)}
            disabled={deshabilitado}
            className="input"
          />
        </F>
      </div>

      {/* ── LA ALERTA, EN EL MOMENTO Y NO AL MANDAR ─────────────────────────
          Pegada a las fechas, que es donde está mirando quien las acaba de
          completar, y no abajo de todo con el resto de los errores. Dice la
          misma frase que el cartel de abajo a propósito: éste cuando pasa,
          aquél si alguien aprieta igual.

          **Y cuál de las dos frases, en el mismo orden que el submit y que las
          dos rutas**: si lo que pasa es que falta el motivo, se dice eso; el
          impedimento queda para lo que de verdad impide —una fecha de fin dada
          vuelta—, que no lo arregla ningún texto. En ámbar y no en rojo porque
          lo que falta es un campo por completar, que está acá abajo. */}
      {faltaElPorQue.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Falta cargar {faltaElPorQue.join(", ")}.
        </div>
      ) : contradicciones.length > 0 ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          No se puede guardar porque {contradicciones.join(", ")}.
        </div>
      ) : null}

      {/* Debajo de las fechas y arriba de la falla: lo hacen aparecer las
          fechas, y en un teléfono una sección que se abre más arriba empuja
          hacia abajo el campo que se está completando. */}
      {cierreAdelantado && (
        <F label="Por qué se cierra antes de la fecha de inicio" required>
          <textarea
            value={form.cierre_justificacion}
            onChange={(e) => f("cierre_justificacion", e.target.value)}
            disabled={deshabilitado}
            className="input min-h-20"
            required
          />
        </F>
      )}

      {/* Debajo de la fecha de cierre y no arriba: es ella la que lo hace
          aparecer, y en un teléfono una sección que se abre más arriba empuja
          hacia abajo el campo que se está completando. */}
      {cierraAlCrearse && (
        <FallaDeLaOT falla={falla} onCambiar={setFalla} deshabilitado={deshabilitado} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Con fecha de cierre el estado deja de ser una pregunta: la orden ya
            se hizo. Se muestra fijo en vez de esconderse, para que lo que se ve
            sea lo que se guarda — el servidor aplica la misma regla, así que
            esconderlo dejaría la pantalla diciendo una cosa y la base otra. */}
        <F label="Estado inicial">
          {cierraAlCrearse ? (
            <p className="input flex items-center bg-slate-50 text-slate-600">
              Realizado{" "}
              <span className="ml-2 text-xs text-slate-400">— tiene fecha de cierre</span>
            </p>
          ) : (
            <Select
              value={form.estado}
              onChange={(e) => f("estado", e.target.value)}
              disabled={deshabilitado}
              className="input"
            >
              {ESTADOS_OT.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </F>
        <F label="Prioridad">
          <Select
            value={form.prioridad}
            onChange={(e) => f("prioridad", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            {PRIORIDADES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
        <F label="Horas estimadas">
          <input
            type="number"
            value={form.horas}
            onChange={(e) => f("horas", e.target.value)}
            disabled={deshabilitado}
            className="input"
            placeholder="—"
            min={0}
            step={0.5}
          />
        </F>
      </div>

      {(form.quien === "CONTRATADO" || form.quien === "MIXTO") && (
        <F label="Contratista">
          <input
            value={form.contratista}
            onChange={(e) => f("contratista", e.target.value)}
            disabled={deshabilitado}
            className="input"
          />
        </F>
      )}

      {/* Cada columna de la orden tiene su propia lista de gente: quién puede ir
          primero no es quién puede ir tercero. Es el mismo `slot` que usa el
          modal de registrar. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {([1, 2, 3] as const).map((slot) => {
          const campo = `operario_${slot}` as "operario_1" | "operario_2" | "operario_3";
          const elegido = form[campo];
          const suyos = operarios.filter((o) => o.slot === slot).map((o) => o.nombre);
          return (
            <F key={slot} label={`Operario ${slot}`}>
              <Select
                value={elegido}
                onChange={(e) => f(campo, e.target.value)}
                disabled={deshabilitado}
                className="input"
              >
                <option value="">—</option>
                {[...new Set([...suyos, ...(elegido ? [elegido] : [])])].sort().map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </F>
          );
        })}
      </div>

      {/* Va con el resto del formulario y no escondido entre los campos: decide
          si el trabajo frena la producción del sector. */}
      <label
        className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2"
        style={{
          borderColor: form.requiere_parada_sector ? "#FECACA" : "#E2E8F0",
          background: form.requiere_parada_sector ? "#FEF2F2" : "#fff",
        }}
      >
        <input
          type="checkbox"
          checked={form.requiere_parada_sector}
          onChange={(e) => f("requiere_parada_sector", e.target.checked)}
          disabled={deshabilitado}
        />
        <span
          className="text-sm font-medium"
          style={{ color: form.requiere_parada_sector ? "#DC2626" : "#374151" }}
        >
          Este trabajo requiere parar el sector
        </span>
      </label>

      <button
        onClick={crear}
        disabled={deshabilitado || mandando}
        className="btn-primary w-full disabled:opacity-50"
      >
        {mandando ? "Guardando…" : "Crear OT"}
      </button>
    </div>
  );
}

/**
 * Con qué arranca el formulario, y a qué vuelve después de cargar.
 *
 * Es una función y no una constante por la fecha: una constante de módulo se
 * evalúa una sola vez, así que una pantalla abierta desde ayer —que es lo
 * normal en un teléfono que no se cierra nunca— volvería a arrancar con la
 * fecha de ayer después de cargar una orden.
 */
type FormularioDeOT = ReturnType<typeof vacio>;

function vacio() {
  return {
    equipment_id: "",
    sector_id: "",
    especialidad: "",
    tipo: "CORRECTIVO",
    quien: "INTERNO",
    descripcion: "",
    fecha: hoyEnArgentina(),
    fecha_ejecucion: "",
    fecha_fin: "",
    fecha_cierre: "",
    cierre_justificacion: "",
    estado: "POR_HACER",
    contratista: "",
    horas: "",
    operario_1: "",
    operario_2: "",
    operario_3: "",
    prioridad: "🟡 Media",
    requiere_parada_sector: false,
  };
}

function F({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
