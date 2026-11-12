"use client";

import { useMemo, useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import Select from "@/components/Select";
import {
  periodoSugerido, type Catalogo, type EstadoDeLaTarea, type RenglonDelCatalogo,
} from "@/lib/mantenimiento/catalogoConfirmado";

/**
 * El catálogo de tareas preventivas, para confirmarlo.
 *
 * ── LO QUE ESTA PANTALLA NO HACE, Y VA DICHO ARRIBA ────────────────────────
 *
 * Confirmar una tarea **todavía no genera ninguna orden**. El enganche con el
 * motor de planes periódicos es el paso siguiente, y hacerlo antes de que el
 * catálogo esté confirmado daría órdenes automáticas sobre tareas que nadie
 * miró. Eso está en el cartel de arriba y no en un tooltip: quien confirma
 * cincuenta tareas creyendo que el sistema va a empezar a emitirlas se entera
 * tarde y mal.
 *
 * ── TRES ESTADOS, Y DESCARTAR NO ES NO HACER NADA ──────────────────────────
 *
 * Una tarea propuesta la trae el historial. Confirmarla la vuelve parte del
 * catálogo. **Descartarla también se guarda**, y ésa es la que no es obvia: sin
 * esa fila la tarea vuelve mañana, y pasado, y la lista se vuelve algo que
 * nadie termina. «Volver a proponer» borra la decisión, que no es lo mismo que
 * descartar: descartar es «ya la miré y no va», esto es «me equivoqué».
 *
 * ── EL RITMO MEDIDO Y EL PERÍODO SON DOS COSAS ─────────────────────────────
 *
 * La columna «cada» es lo que **pasa hoy**, medido del historial; el campo de
 * período es lo que **alguien decide**. Se muestran al lado a propósito: que no
 * coincidan es información —el ritmo se movió desde que se fijó el plan— y
 * taparlo con un solo número la perdería. El campo arranca con el sugerido,
 * redondeado a cómo se habla («cada 3 semanas» y no «cada 24 días»).
 */

const FILTROS = [
  { valor: "propuesta", label: "Por decidir" },
  { valor: "confirmada", label: "Confirmadas" },
  { valor: "descartada", label: "Descartadas" },
  { valor: "", label: "Todas" },
] as const;

type Equipo = { id: string; etiqueta: string };

export default function TareasPreventivasClient({
  puedeEditar, equipos,
}: {
  puedeEditar: boolean;
  equipos: Equipo[];
}) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState<string>("propuesta");
  const [guardando, setGuardando] = useState<string | null>(null);

  /**
   * Lo que se tipeó y todavía no se guardó, por renglón. Vive fuera del
   * catálogo porque el catálogo se reemplaza entero con la respuesta de cada
   * guardado: si el texto viviera ahí, confirmar una fila borraría lo que
   * alguien estaba escribiendo en otra.
   */
  const [editado, setEditado] = useState<Record<string, { nombre?: string; periodo?: string }>>({});

  const nombreDeEquipo = useMemo(
    () => new Map(equipos.map((e) => [e.id, e.etiqueta])),
    [equipos]
  );

  const cargar = useCargar(async (vigente) => {
    const res = await fetch("/api/mantenimiento/tareas-preventivas");
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    if (!res.ok) {
      setError(body.error ?? "No se pudo leer el catálogo.");
      return;
    }
    setError("");
    setCatalogo(body);
  }, []);

  const clave = (r: RenglonDelCatalogo) => `${r.equipmentId}|${r.accion}|${r.componente}`;

  const visibles = useMemo(() => {
    if (!catalogo) return [];
    return filtro ? catalogo.renglones.filter((r) => r.estado === filtro) : catalogo.renglones;
  }, [catalogo, filtro]);

  async function decidir(r: RenglonDelCatalogo, estado: "CONFIRMADA" | "DESCARTADA") {
    const k = clave(r);
    const suyo = editado[k] ?? {};
    const periodo = suyo.periodo ?? String(periodoSugerido(r.intervaloMedido) ?? r.periodoDecidido ?? "");

    setGuardando(k);
    setError("");
    const res = await fetch("/api/mantenimiento/tareas-preventivas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        equipment_id: r.equipmentId,
        accion: r.accion,
        componente: r.componente,
        nombre: (suyo.nombre ?? r.nombre).trim(),
        estado,
        periodo_dias: estado === "CONFIRMADA" ? periodo : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(null);

    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar la decisión.");
      return;
    }
    // El renglón ya no está en edición: lo que se guardó es lo que vale.
    setEditado((e) => {
      const { [k]: _, ...resto } = e;
      return resto;
    });
    if (body.renglones) setCatalogo(body);
    else cargar();
  }

  async function volverAProponer(r: RenglonDelCatalogo) {
    const k = clave(r);
    setGuardando(k);
    setError("");
    const res = await fetch("/api/mantenimiento/tareas-preventivas", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        equipment_id: r.equipmentId, accion: r.accion, componente: r.componente,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo volver a proponer la tarea.");
      return;
    }
    if (body.renglones) setCatalogo(body);
    else cargar();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Tareas preventivas</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Lo que el historial muestra que se viene haciendo. Confirmá las que son de verdad.
        </p>
      </div>

      {/*
        Arriba y en texto visible, no en un tooltip: es lo que separa esta
        pantalla de lo que alguien podría creer que hace.
      */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1">
        <p>
          <strong>Confirmar una tarea todavía no genera órdenes.</strong> Esto arma el catálogo;
          engancharlo con los mantenimientos periódicos es el paso siguiente.
        </p>
        <p>
          La propuesta se recalcula de las OT de los últimos 365 días cada vez que se abre esta
          pantalla. Lo único que se guarda es la decisión.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {catalogo && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <label className="mb-1 block text-xs text-slate-500">Mostrar</label>
            <Select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="input">
              {FILTROS.map((f) => (
                <option key={f.valor} value={f.valor}>{f.label}</option>
              ))}
            </Select>
          </div>
          <p className="text-sm text-slate-600">
            <strong>{catalogo.resumen.propuestas}</strong> por decidir
            {" · "}{catalogo.resumen.confirmadas} confirmadas
            {" · "}{catalogo.resumen.descartadas} descartadas
          </p>
        </div>
      )}

      {catalogo === null && !error && (
        <p className="text-sm text-slate-500">Leyendo el historial…</p>
      )}

      {catalogo && (
        <div className="overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-3 py-3 text-left font-medium text-slate-600">Tarea</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600">Equipo</th>
                <th className="px-3 py-3 text-right font-medium text-slate-600 whitespace-nowrap">Veces</th>
                <th className="px-3 py-3 text-right font-medium text-slate-600 whitespace-nowrap">Cada</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600 whitespace-nowrap">Período</th>
                <th className="px-3 py-3 text-left font-medium text-slate-600" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((r) => {
                const k = clave(r);
                const suyo = editado[k] ?? {};
                const sugerido = periodoSugerido(r.intervaloMedido);
                const enCurso = guardando === k;

                return (
                  <tr key={k} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      {puedeEditar ? (
                        /* El ancho va en el envoltorio: `.input` declara
                           `width: 100%` fuera de toda capa y le gana a
                           cualquier `w-*` que se le ponga al lado. */
                        <div className="min-w-[14rem]">
                          <input
                            value={suyo.nombre ?? r.nombre}
                            onChange={(e) =>
                              setEditado((x) => ({ ...x, [k]: { ...suyo, nombre: e.target.value } }))
                            }
                            className="input"
                          />
                        </div>
                      ) : (
                        <span className="font-medium text-slate-900">{r.nombre}</span>
                      )}
                      {r.motivo && (
                        <p className="mt-1 text-xs text-slate-500">{r.motivo}</p>
                      )}
                    </td>

                    <td className="px-3 py-2 text-slate-600">
                      {nombreDeEquipo.get(r.equipmentId) ?? r.equipmentId}
                      {r.sinRespaldoEnElHistorial && (
                        <p className="mt-0.5 text-xs text-amber-700">
                          No aparece en los últimos 365 días
                        </p>
                      )}
                    </td>

                    <td className="px-3 py-2 text-right text-slate-700">{r.veces || "—"}</td>

                    <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                      {r.intervaloMedido === null ? "—" : `~${r.intervaloMedido} d`}
                    </td>

                    <td className="px-3 py-2">
                      {puedeEditar ? (
                        <div className="w-24">
                          <input
                            type="number"
                            min="1"
                            max="3650"
                            placeholder={sugerido === null ? "—" : String(sugerido)}
                            value={suyo.periodo ?? (r.periodoDecidido === null ? "" : String(r.periodoDecidido))}
                            onChange={(e) =>
                              setEditado((x) => ({ ...x, [k]: { ...suyo, periodo: e.target.value } }))
                            }
                            className="input"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-700">
                          {r.periodoDecidido === null ? "—" : `${r.periodoDecidido} d`}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2">
                      {puedeEditar && (
                        <div className="flex flex-wrap gap-2">
                          {r.estado !== "confirmada" && (
                            <button
                              onClick={() => decidir(r, "CONFIRMADA")}
                              disabled={enCurso}
                              className="btn-primary"
                            >
                              Confirmar
                            </button>
                          )}
                          {r.estado !== "descartada" && (
                            <button
                              onClick={() => decidir(r, "DESCARTADA")}
                              disabled={enCurso}
                              className="btn-secondary"
                            >
                              Descartar
                            </button>
                          )}
                          {r.estado !== "propuesta" && (
                            <button
                              onClick={() => volverAProponer(r)}
                              disabled={enCurso}
                              className="btn-ghost"
                            >
                              Volver a proponer
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {visibles.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    {filtro === "propuesta"
                      ? "No queda ninguna tarea por decidir."
                      : "No hay tareas con ese filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {catalogo && (
        <p className="text-xs text-slate-500">
          «Cada» es el ritmo medido en el historial. «Período» es el que se decide, y arranca
          con el sugerido redondeado a cómo se habla. Que no coincidan quiere decir que el
          ritmo se movió desde que se fijó.
        </p>
      )}
    </div>
  );
}
