"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/compras/constants";

/**
 * La ficha técnica del equipo: lo que se releva recorriendo la planta.
 *
 * Va aparte del alta del equipo porque son datos de otro momento y de otra
 * persona: quien da de alta la máquina sabe su nombre y su sector; la marca del
 * rodamiento la anota quien la abre.
 */

/** Los campos, agrupados como se los mira. */
const GRUPOS: { titulo: string; campos: { columna: string; etiqueta: string; tipo?: "numero" | "fecha" }[] }[] = [
  {
    titulo: "Identificación",
    campos: [
      { columna: "tipo_equipo", etiqueta: "Tipo" },
      { columna: "marca", etiqueta: "Marca" },
      { columna: "modelo", etiqueta: "Modelo" },
      { columna: "nro_serie", etiqueta: "N° de serie" },
      { columna: "anio_fabricacion", etiqueta: "Año de fabricación", tipo: "numero" },
      { columna: "anio_instalacion", etiqueta: "Año de instalación", tipo: "numero" },
      { columna: "origen_equipo", etiqueta: "Origen" },
      { columna: "descripcion_proceso", etiqueta: "Qué hace en el proceso" },
    ],
  },
  {
    titulo: "Eléctrico",
    campos: [
      { columna: "power_kw", etiqueta: "Potencia (kW)", tipo: "numero" },
      { columna: "tension_v", etiqueta: "Tensión (V)" },
      { columna: "intensidad_nominal_a", etiqueta: "Intensidad nominal (A)", tipo: "numero" },
      { columna: "rpm_motor", etiqueta: "RPM del motor", tipo: "numero" },
      { columna: "fp_cos_phi", etiqueta: "Factor de potencia", tipo: "numero" },
    ],
  },
  {
    titulo: "Mecánico",
    campos: [
      { columna: "relacion_reduccion", etiqueta: "Relación de reducción" },
      { columna: "rpm_salida", etiqueta: "RPM de salida", tipo: "numero" },
      { columna: "rodamiento_motor_de", etiqueta: "Rodamiento motor (DE)" },
      { columna: "rodamiento_motor_nde", etiqueta: "Rodamiento motor (NDE)" },
      { columna: "rodamiento_carga", etiqueta: "Rodamiento de carga" },
      { columna: "rodamiento_otro", etiqueta: "Otro rodamiento" },
    ],
  },
  {
    titulo: "Dónde está y quién la relevó",
    campos: [
      { columna: "ubicacion_fisica", etiqueta: "Ubicación física" },
      { columna: "nivel_altura_m", etiqueta: "Altura (m)", tipo: "numero" },
      { columna: "horas_marcha", etiqueta: "Horas de marcha", tipo: "numero" },
      { columna: "proveedor_repuesto_critico", etiqueta: "Proveedor del repuesto crítico" },
      { columna: "relevado_por", etiqueta: "Relevado por" },
      { columna: "fecha_ultimo_relevamiento", etiqueta: "Último relevamiento", tipo: "fecha" },
    ],
  },
];

type Valores = Record<string, string | number | null | undefined>;

export default function FichaTecnica({
  equipo, puedeEditar,
}: {
  equipo: Valores & { id: string };
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});

  const cuantosCargados = GRUPOS.flatMap((g) => g.campos)
    .filter((c) => equipo[c.columna] !== null && equipo[c.columna] !== undefined && equipo[c.columna] !== "")
    .length;
  const total = GRUPOS.flatMap((g) => g.campos).length;

  function empezar() {
    const iniciales: Record<string, string> = {};
    for (const grupo of GRUPOS) {
      for (const campo of grupo.campos) {
        iniciales[campo.columna] = String(equipo[campo.columna] ?? "");
      }
    }
    setCampos(iniciales);
    setEditando(true);
    setError("");
  }

  async function guardar() {
    setGuardando(true);
    setError("");

    // `tipo_equipo` lo escribe la importación desde el catálogo de tipos: acá
    // se muestra pero no se edita, para que no se despegue del tipo.
    const { tipo_equipo: _tipo, ...editables } = campos;

    const res = await fetch(`/api/mantenimiento/equipos/${equipo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ficha", campos: editables }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo guardar."); return; }
    setEditando(false);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          Ficha técnica
          <span className="ml-2 text-xs font-normal text-slate-400">
            {cuantosCargados} de {total} datos cargados
          </span>
        </h2>

        {puedeEditar && !editando && (
          <button
            onClick={empezar}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Editar
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {GRUPOS.map((grupo) => (
          <div key={grupo.titulo}>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              {grupo.titulo}
            </h3>
            <dl className="divide-y divide-slate-100">
              {grupo.campos.map((campo) => (
                <div key={campo.columna} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="text-xs text-slate-500">{campo.etiqueta}</dt>
                  <dd className="min-w-0 flex-1 text-right text-sm text-slate-800">
                    {editando && campo.columna !== "tipo_equipo" ? (
                      <input
                        value={campos[campo.columna] ?? ""}
                        onChange={(e) => setCampos((c) => ({ ...c, [campo.columna]: e.target.value }))}
                        type={campo.tipo === "fecha" ? "date" : "text"}
                        inputMode={campo.tipo === "numero" ? "decimal" : undefined}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                      />
                    ) : (
                      mostrar(equipo[campo.columna], campo.tipo)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {editando && (
        <div className="mt-4 flex gap-2">
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={() => setEditando(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

/** Un valor de la ficha, o una raya si todavía no se relevó. */
function mostrar(valor: unknown, tipo?: "numero" | "fecha") {
  if (valor === null || valor === undefined || valor === "") {
    return <span className="text-slate-300">—</span>;
  }
  return tipo === "fecha" ? fecha(String(valor)) : String(valor);
}
