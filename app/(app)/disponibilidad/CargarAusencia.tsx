"use client";

import { useState } from "react";
import Select from "@/components/Select";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/tiposAusencia";

export interface EmpleadoParaCargar {
  id: string;
  nombre: string;
}

/**
 * Cargar una ausencia desde Disponibilidad, para quien tiene edición en RRHH.
 *
 * **POSTEA A `/api/rrhh/ausencias` Y NO A UNA RUTA PROPIA**, y eso es lo más
 * importante de este archivo. Esa ruta no sólo inserta: adentro llama a
 * `altaDeAusencia`, que además sincroniza el período de vacaciones y
 * **recalcula la liquidación** del empleado para ese rango. Una segunda puerta
 * de alta que se olvidara de cualquiera de las dos cosas daría de alta la
 * ausencia igual, sin error, y el sueldo saldría mal — el propio encabezado de
 * esa ruta cuenta que ya pasó tener «una mitad defendida y la otra no».
 *
 * **ACÁ SE ESCRIBE EL MOTIVO, Y ESO NO CONTRADICE A LA PANTALLA.** Disponibilidad
 * es el lugar donde el motivo no se *muestra*; quien lo escribe es RRHH, que es
 * exactamente quien puede verlo. Este formulario se le dibuja sólo a quien tiene
 * edición en RRHH, y lo que se carga acá sigue sin aparecer en la lista de
 * «Quién no viene» ni en el mensual abierto.
 *
 * Las dos reglas condicionales son del alta y no de la pantalla; se repiten acá
 * para dar un mensaje antes del viaje, pero quien manda es el servidor.
 */
export default function CargarAusencia({
  empleados,
  alGuardar,
}: {
  empleados: EmpleadoParaCargar[];
  /** Se llama después de un alta exitosa, para que la lista vuelva a pedirse. */
  alGuardar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [empleadoId, setEmpleadoId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tipo, setTipo] = useState("");
  const [justificada, setJustificada] = useState(true);
  const [observaciones, setObservaciones] = useState("");
  const [anio, setAnio] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  const pideAnio = tipo === "VACACIONES" && justificada;
  const pideObservaciones = tipo === "OTRA";

  const limpiar = () => {
    setEmpleadoId("");
    setDesde("");
    setHasta("");
    setTipo("");
    setJustificada(true);
    setObservaciones("");
    setAnio("");
    setError("");
  };

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setHecho("");

    if (!empleadoId || !desde || !hasta || !tipo) {
      setError("Faltan la persona, las dos fechas y el tipo.");
      return;
    }
    if (hasta < desde) {
      setError("La fecha de fin no puede ser anterior a la de inicio.");
      return;
    }
    if (pideObservaciones && !observaciones.trim()) {
      setError("Para el tipo «Otra» hay que aclarar el motivo en observaciones.");
      return;
    }
    if (pideAnio && !/^\d{4}$/.test(anio)) {
      setError("Para Vacaciones hay que indicar a qué año corresponden los días.");
      return;
    }

    setGuardando(true);
    try {
      const r = await fetch("/api/rrhh/ausencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: empleadoId,
          fechaDesde: desde,
          fechaHasta: hasta,
          tipo,
          justificada,
          observaciones: observaciones.trim() || null,
          ...(pideAnio ? { anioCorrespondiente: Number(anio) } : {}),
        }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) {
        setError(cuerpo?.error ?? "No se pudo cargar la ausencia.");
        return;
      }
      const quien = empleados.find((e) => e.id === empleadoId)?.nombre ?? "la persona";
      // Se nombra el rango a propósito: si cae fuera de la semana que la
      // pantalla está mostrando, la lista no va a cambiar y sin esto parecería
      // que no se guardó nada.
      setHecho(`Cargada: ${quien}, del ${desde} al ${hasta}.`);
      limpiar();
      alGuardar();
    } catch {
      setError("No se pudo cargar la ausencia. Revisá la conexión y volvé a probar.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-secondary" onClick={() => setAbierto(true)}>
          Cargar una ausencia
        </button>
        {hecho ? <p className="text-sm text-emerald-700">{hecho}</p> : null}
      </div>
    );
  }

  return (
    <form onSubmit={guardar} className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Cargar una ausencia</h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setAbierto(false);
            limpiar();
          }}
        >
          Cerrar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">Quién</span>
          <Select value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className="input">
            <option value="">Elegir…</option>
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">Motivo</span>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input">
            <option value="">Elegir…</option>
            {TIPOS_AUSENCIA.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="input" />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="input" />
        </label>

        {pideAnio ? (
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Año que corresponden</span>
            <input
              type="number"
              inputMode="numeric"
              value={anio}
              onChange={(e) => setAnio(e.target.value)}
              placeholder="2026"
              className="input"
            />
          </label>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={justificada} onChange={(e) => setJustificada(e.target.checked)} />
        Justificada
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-slate-600">
          Observaciones{pideObservaciones ? " (obligatorias para «Otra»)" : ""}
        </span>
        <textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          rows={2}
          className="input"
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <p className="text-xs text-slate-500">
          Se carga igual que desde RRHH: recalcula la liquidación del período.
        </p>
      </div>
    </form>
  );
}
