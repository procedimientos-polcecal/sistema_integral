"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FilaCierreCubicacion, LecturaDeCubicacion } from "@/lib/cantera/cubicacion";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const t = (v: number | null) => (v === null ? "—" : num0.format(v));

const COLOR_YACIMIENTO: Record<string, string> = {
  D1: "#1E7D34",
  D6: "#0891B2",
  C1: "#E8A020",
  C3: "#7E22CE",
};

const ESTILO_LECTURA: Record<LecturaDeCubicacion, string> = {
  CIERRA: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ACEPTABLE: "bg-amber-50 text-amber-700 border-amber-200",
  REVISAR: "bg-red-50 text-red-700 border-red-200",
  "SIN ACTIVIDAD": "bg-slate-50 text-slate-500 border-slate-200",
};

function BadgeLectura({ lectura }: { lectura: LecturaDeCubicacion | null }) {
  if (lectura === null) {
    return <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-400">Pendiente</span>;
  }
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${ESTILO_LECTURA[lectura]}`}>
      {lectura}
    </span>
  );
}

/** El mes anterior/siguiente a "YYYY-MM", sin líos de zona horaria. */
function moverMes(mes: string, delta: number): string {
  const [anio, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(anio, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

interface Yacimiento {
  id: string;
  codigo: string;
  nombre: string;
}

export default function CubicacionClient({
  yacimientos,
  filas,
  puedeEditar,
}: {
  yacimientos: Yacimiento[];
  filas: FilaCierreCubicacion[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))].sort(), [filas]);
  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const [mes, setMes] = useState(() => (meses.includes(mesActual) ? mesActual : meses[meses.length - 1] ?? mesActual));

  const idPorCodigo = new Map(yacimientos.map((y) => [y.codigo, y.id]));
  const filasDelMes = yacimientos.map((y) => ({
    yacimiento: y,
    fila: filas.find((f) => f.mes === mes && f.yacimientoCodigo === y.codigo) ?? null,
  }));

  const [editando, setEditando] = useState<string | null>(null); // yacimientoCodigo en edición
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(yacimientoCodigo: string) {
    const yacimientoId = idPorCodigo.get(yacimientoCodigo);
    const n = Number(valor.replace(",", "."));
    if (!yacimientoId || !isFinite(n) || n < 0) {
      setError("La existencia final tiene que ser un número");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/cantera/cubicacion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yacimiento_id: yacimientoId, mes, existencia_final: n }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar");
      setEditando(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  // Últimos 6 meses cargados, del más reciente al más viejo, para el
  // historial de lecturas de un vistazo.
  const historial = [...meses].reverse().slice(0, 6);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Cubicación</h1>
        <p className="page-subheader">Existencia inicial + voladuras − acarreo, contra la existencia medida en el yacimiento.</p>
      </div>

      {/* ── Navegador de mes ── */}
      <div className="card mt-4 flex items-center justify-between p-3">
        <button
          className="btn-ghost"
          onClick={() => setMes((m) => moverMes(m, -1))}
        >
          ← Mes anterior
        </button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button
          className="btn-ghost"
          onClick={() => setMes((m) => moverMes(m, 1))}
        >
          Mes siguiente →
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* ── Cierre del mes, un yacimiento por tarjeta ── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {filasDelMes.map(({ yacimiento, fila }) => {
          const color = COLOR_YACIMIENTO[yacimiento.codigo] ?? "#64748B";
          const enEdicion = editando === yacimiento.codigo;
          return (
            <div key={yacimiento.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  <span className="font-semibold text-slate-800">{yacimiento.codigo}</span>
                  <span className="text-xs text-slate-400">{yacimiento.nombre}</span>
                </div>
                <BadgeLectura lectura={fila?.lectura ?? null} />
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-y-2 text-sm">
                <dt className="text-slate-500">Exist. inicial</dt>
                <dd className="col-span-2 text-right font-mono tabular-nums text-slate-700">{t(fila?.existenciaInicial ?? null)}</dd>
                <dt className="text-slate-500">Voladuras</dt>
                <dd className="col-span-2 text-right font-mono tabular-nums text-slate-700">{t(fila?.voladuras ?? 0)}</dd>
                <dt className="text-slate-500">Acarreo</dt>
                <dd className="col-span-2 text-right font-mono tabular-nums text-slate-700">{t(fila?.acarreo ?? 0)}</dd>
                <dt className="font-medium text-slate-700">Stock teórico</dt>
                <dd className="col-span-2 text-right font-mono tabular-nums font-medium text-slate-900">{t(fila?.stockTeorico ?? null)}</dd>
              </dl>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Existencia final</span>
                  {!enEdicion && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold tabular-nums text-slate-900">{t(fila?.existenciaFinal ?? null)}</span>
                      {puedeEditar && (
                        <button
                          className="text-xs text-slate-400 underline hover:text-slate-700"
                          onClick={() => {
                            setEditando(yacimiento.codigo);
                            setValor(fila?.existenciaFinal != null ? String(fila.existenciaFinal) : "");
                            setError(null);
                          }}
                        >
                          {fila?.existenciaFinal != null ? "Editar" : "Cargar"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {enEdicion && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      autoFocus
                      className="input"
                      inputMode="decimal"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && guardar(yacimiento.codigo)}
                      placeholder="Toneladas medidas"
                    />
                    <button className="btn-primary shrink-0" disabled={guardando} onClick={() => guardar(yacimiento.codigo)}>
                      Guardar
                    </button>
                    <button className="btn-ghost shrink-0" onClick={() => setEditando(null)}>Cancelar</button>
                  </div>
                )}
              </div>

              {fila && fila.residuo !== null && (
                <p className="mt-3 text-xs text-slate-500">
                  Residuo {t(fila.residuo)} t
                  {fila.porcentajeSobreVoladuras !== null && ` (${pct(fila.porcentajeSobreVoladuras)} de lo volado)`}
                  {fila.factorNominal !== null && fila.factorImplicito !== null && (
                    <> · factor nominal {num1.format(fila.factorNominal)} t/m, implícito {num1.format(fila.factorImplicito)} t/m</>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Historial: la lectura de cada yacimiento, últimos meses ── */}
      {historial.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Historial</h2>
          <div className="card mt-2 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Mes</th>
                  {yacimientos.map((y) => (
                    <th key={y.id} className="text-center">{y.codigo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historial.map((m) => (
                  <tr key={m} className={m === mes ? "bg-slate-50" : undefined}>
                    <td>
                      <button className="text-left underline decoration-slate-300 hover:decoration-slate-600" onClick={() => setMes(m)}>
                        {nombreDeMes(m)}
                      </button>
                    </td>
                    {yacimientos.map((y) => {
                      const fila = filas.find((f) => f.mes === m && f.yacimientoCodigo === y.codigo) ?? null;
                      return (
                        <td key={y.id} className="text-center">
                          <BadgeLectura lectura={fila?.lectura ?? null} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {meses.length === 0 && (
        <div className="empty-state mt-4">
          Todavía no hay ningún cierre cargado. {puedeEditar && "Elegí un mes y cargá la existencia final de cada yacimiento para arrancar."}
        </div>
      )}
    </div>
  );
}
