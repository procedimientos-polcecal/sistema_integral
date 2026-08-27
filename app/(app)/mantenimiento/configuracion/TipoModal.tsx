"use client";

import { useState } from "react";

/**
 * Editar lo que lleva una clase de máquina.
 *
 * El catálogo viene del libro BD Equipos, pero lo que se aprende reparando no
 * vuelve al libro: alguien descubre que ese reductor lleva otro rodamiento y
 * hasta ahora no tenía dónde anotarlo.
 *
 * Los campos van agrupados como se los consulta —antes de abrir una máquina uno
 * mira los rodamientos, no las frecuencias— y no en el orden en que están en la
 * tabla.
 */

export interface Tipo {
  tipo_id: string;
  [campo: string]: string | null;
}

const GRUPOS: { titulo: string; campos: { clave: string; etiqueta: string }[] }[] = [
  {
    titulo: "Qué es",
    campos: [
      { clave: "nombre_tipo", etiqueta: "Nombre" },
      { clave: "categoria", etiqueta: "Categoría" },
      { clave: "descripcion_funcion", etiqueta: "Para qué sirve" },
    ],
  },
  {
    titulo: "Cómo se mueve",
    campos: [
      { clave: "accionamiento", etiqueta: "Accionamiento" },
      { clave: "potencia_kw_tipica", etiqueta: "Potencia típica (kW)" },
      { clave: "tension_v", etiqueta: "Tensión (V)" },
      { clave: "velocidad_rpm_tipica", etiqueta: "RPM típicas" },
      { clave: "amperaje_nominal_a", etiqueta: "Amperaje nominal (A)" },
      { clave: "tiene_reductor", etiqueta: "¿Tiene reductor?" },
      { clave: "relacion_reduccion", etiqueta: "Relación de reducción" },
      { clave: "tipo_correa", etiqueta: "Tipo de correa" },
      { clave: "cant_correas", etiqueta: "Cantidad de correas" },
    ],
  },
  {
    titulo: "Rodamientos",
    campos: [
      { clave: "rodamiento_lado_motor", etiqueta: "Lado motor" },
      { clave: "rodamiento_lado_carga", etiqueta: "Lado carga" },
      { clave: "rodamiento_intermedio", etiqueta: "Intermedio" },
    ],
  },
  {
    titulo: "Lubricación",
    campos: [
      { clave: "lubricante_tipo", etiqueta: "Lubricante" },
      { clave: "lubricante_marca_ref", etiqueta: "Marca de referencia" },
      { clave: "frecuencia_lubricacion", etiqueta: "Cada cuánto" },
    ],
  },
  {
    titulo: "Filtros e insumos",
    campos: [
      { clave: "tiene_filtro_aceite", etiqueta: "¿Filtro de aceite?" },
      { clave: "tiene_filtro_aire", etiqueta: "¿Filtro de aire?" },
      { clave: "tiene_filtro_hidraulico", etiqueta: "¿Filtro hidráulico?" },
      { clave: "insumo_especial_1", etiqueta: "Insumo especial" },
      { clave: "insumo_especial_2", etiqueta: "Otro insumo" },
    ],
  },
  {
    titulo: "Cuándo hay que preocuparse",
    campos: [
      { clave: "temperatura_max_rodamiento_c", etiqueta: "Temperatura máxima (°C)" },
      { clave: "vibracion_max_mm_s", etiqueta: "Vibración máxima (mm/s)" },
    ],
  },
  {
    titulo: "Cada cuánto revisarlo",
    campos: [
      { clave: "freq_inspeccion_visual", etiqueta: "Inspección visual" },
      { clave: "freq_lubricacion", etiqueta: "Lubricación" },
      { clave: "freq_revision_mayor", etiqueta: "Revisión mayor" },
    ],
  },
];

export default function TipoModal({
  tipo, onCerrar, onGuardado,
}: {
  /** `null` para crear uno nuevo. */
  tipo: Tipo | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = tipo === null;

  const [codigo, setCodigo] = useState(tipo?.tipo_id ?? "");
  const [campos, setCampos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const g of GRUPOS) for (const c of g.campos) inicial[c.clave] = tipo?.[c.clave] ?? "";
    inicial.notas_tecnicas = tipo?.notas_tecnicas ?? "";
    return inicial;
  });

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const set = (clave: string, valor: string) => setCampos((c) => ({ ...c, [clave]: valor }));

  async function guardar() {
    if (esNuevo && !codigo.trim()) { setError("Falta el código del tipo."); return; }
    if (!campos.nombre_tipo?.trim()) { setError("Falta el nombre."); return; }

    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/tipos", {
      method: esNuevo ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...campos, tipo_id: esNuevo ? codigo.trim() : tipo.tipo_id }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {esNuevo ? "Nuevo tipo de equipo" : `Tipo ${tipo.tipo_id}`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Lo que lleva esta clase de máquina. Es lo que se mira antes de abrir una.
            </p>
          </div>
          <button onClick={onCerrar} className="text-xl leading-none text-slate-400 hover:text-slate-600">×</button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        {esNuevo && (
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Código</span>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="CT, RM, AP…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-xs text-slate-400">
              Tiene que ser el mismo que usa el libro BD Equipos: si no coincide, la próxima
              importación crea otro al lado.
            </span>
          </label>
        )}

        {GRUPOS.map((grupo) => (
          <div key={grupo.titulo}>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              {grupo.titulo}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {grupo.campos.map((c) => (
                <label key={c.clave} className="block space-y-0.5">
                  <span className="block text-xs text-slate-600">{c.etiqueta}</span>
                  <input
                    value={campos[c.clave] ?? ""}
                    onChange={(e) => set(c.clave, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>
        ))}

        <label className="block space-y-1">
          <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
            Notas técnicas
          </span>
          <textarea
            value={campos.notas_tecnicas ?? ""}
            onChange={(e) => set("notas_tecnicas", e.target.value)}
            rows={2}
            placeholder="Lo que hay que saber y no entra en ningún campo"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex gap-2 pt-1">
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
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
