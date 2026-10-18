"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { estadoSegunElCierre, loQueFaltaParaCerrar } from "@/lib/mantenimiento/cierreDeOT";
import { PRIORIDADES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type {
  EquipoDelCatalogo,
  OperarioDelCatalogo,
  SectorDelCatalogo,
} from "./catalogos";
import { CartelDelResultado, loQueDijo, type Resultado } from "./envio";

const ESPECIALIDADES = ["MECÁNICO", "ELÉCTRICO", "INSTRUMENTACIÓN", "CIVIL", "OTRO"];
const TIPOS = ["PROGRAMADO", "CORRECTIVO", "PREDICTIVO", "MEJORA"];
const QUIEN_OPTIONS = ["INTERNO", "CONTRATADO", "MIXTO"];
/**
 * Las de `filtrosOt`, no una copia. Es la misma razón por la que `NuevaOTModal`
 * las toma de ahí: lo que se elige tiene que ser lo que se filtra, y dos
 * vocabularios para lo mismo es cómo una OT creada desde la app dejó de
 * aparecer al filtrar por «Media».
 */
const PRIORIDADES = PRIORIDADES_DE_OT;
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
 */
export default function FormularioOTOffline({
  equipos,
  sectores,
  operarios,
  deshabilitado,
  onMandar,
}: {
  equipos: EquipoDelCatalogo[];
  sectores: SectorDelCatalogo[];
  operarios: OperarioDelCatalogo[];
  /** Sin dónde guardar o sin saber de quién sería la carga, no se acepta nada. */
  deshabilitado: boolean;
  onMandar: (cuerpo: Record<string, unknown>) => Promise<Resultado>;
}) {
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [form, setForm] = useState(vacio);

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

  const equiposDelSector = form.sector_id
    ? equipos.filter((e) => e.sector_id === form.sector_id)
    : equipos;

  async function crear() {
    if (!form.descripcion.trim()) {
      setError("La descripción es requerida.");
      return;
    }

    // Una OT que nace con fecha de cierre ya se hizo, así que tiene que decir
    // cuánto llevó y quién la hizo. Todo junto y no de a uno: contestar tres
    // veces para que te digan tres cosas es lo que hace que la gente complete
    // de cualquier manera. Y acá importa más que con señal — sin conexión, el
    // que contesta de a una cosa es el servidor, horas o días después.
    const falta = loQueFaltaParaCerrar(form);
    if (falta.length > 0) {
      setError(
        `La orden tiene fecha de cierre, así que ya se hizo. Falta cargar ${falta.join(", ")}.`,
      );
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
      if (salida.estado !== "rechazada") setForm(vacio());
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Sector">
          <Select
            value={form.sector_id}
            onChange={(e) => f("sector_id", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">— Todos —</option>
            {sectores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codigo ? `${s.codigo} — ` : ""}
                {s.nombre}
              </option>
            ))}
          </Select>
        </F>
        <F label="Equipo">
          <Select
            value={form.equipment_id}
            onChange={(e) => f("equipment_id", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">— Sin asignar —</option>
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
        <F label="Especialidad">
          <Select
            value={form.especialidad}
            onChange={(e) => f("especialidad", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            <option value="">—</option>
            {ESPECIALIDADES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
        <F label="Tipo">
          <Select
            value={form.tipo}
            onChange={(e) => f("tipo", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            {TIPOS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
        <F label="Quién realiza">
          <Select
            value={form.quien}
            onChange={(e) => f("quien", e.target.value)}
            disabled={deshabilitado}
            className="input"
          >
            {QUIEN_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </F>
      </div>

      <F label="Repuesto utilizado">
        <input
          value={form.repuesto}
          onChange={(e) => f("repuesto", e.target.value)}
          disabled={deshabilitado}
          className="input"
          placeholder="Ej: Rodamiento 32222…"
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
        <F label="Fecha ejecución">
          <input
            type="date"
            value={form.fecha_ejecucion}
            onChange={(e) => f("fecha_ejecucion", e.target.value)}
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
    repuesto: "",
    fecha: hoyEnArgentina(),
    fecha_ejecucion: "",
    fecha_cierre: "",
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
