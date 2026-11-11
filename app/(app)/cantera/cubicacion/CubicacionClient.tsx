"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FilaCierreCubicacion, LecturaDeCubicacion } from "@/lib/cantera/cubicacion";
import { CLAVE_C1C3, MATERIALES_DE_CANTERA, type DesgloseDeMaterial, type ExistenciaDeMaterial } from "@/lib/cantera/cubicacionPorMaterial";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { numeroDeCampo } from "@/lib/cantera/numero";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const t = (v: number | null) => (v === null ? "—" : num0.format(v));

const COLOR_YACIMIENTO: Record<string, string> = {
  D1: "#1E7D34",
  D6: "#0891B2",
  C1: "#E8A020",
  C3: "#7E22CE",
  "C1+C3": "#B45309",
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

/** Una tarjeta del mes: un yacimiento (D1, D6; C1 y C3 antes del corte) o C1+C3 juntas (desde el corte). */
interface Tarjeta {
  clave: string;
  titulo: string;
  subtitulo: string;
  fila: FilaCierreCubicacion | null;
  /** Qué se manda al guardar: a qué ruta y con qué identificador. */
  destino: { tipo: "yacimiento"; yacimientoId: string } | { tipo: "c1c3" };
}

/** Lo que se escribe en el formulario de C1+C3: canteras y galpones, de cada material. */
type FormC1C3 = Record<string, { canteras: string; galpones: string }>;
const FORM_C1C3_VACIO: FormC1C3 = Object.fromEntries(MATERIALES_DE_CANTERA.map((m) => [m, { canteras: "", galpones: "" }]));

export default function CubicacionClient({
  yacimientos,
  filas,
  filasC1C3,
  desglose,
  existenciasPorMaterial,
  mesDeCorte,
  acarreoSinMaterial,
  puedeEditar,
}: {
  yacimientos: Yacimiento[];
  filas: FilaCierreCubicacion[];
  filasC1C3: FilaCierreCubicacion[];
  desglose: DesgloseDeMaterial[];
  existenciasPorMaterial: ExistenciaDeMaterial[];
  mesDeCorte: string;
  acarreoSinMaterial: { mes: string; toneladas: number }[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const meses = useMemo(() => [...new Set([...filas, ...filasC1C3].map((f) => f.mes))].sort(), [filas, filasC1C3]);
  const mesActual = hoyEnArgentina().slice(0, 7);
  const [mes, setMes] = useState(() => (meses.includes(mesActual) ? mesActual : meses[meses.length - 1] ?? mesActual));

  // Desde el mes de corte C1 y C3 se cierran juntas (la chocolata y la caliza
  // están mezcladas en los galpones); antes, cada una por su cuenta.
  const juntas = mes >= mesDeCorte;
  const tarjetas: Tarjeta[] = [
    ...yacimientos
      .filter((y) => !juntas || !["C1", "C3"].includes(y.codigo))
      .map((y): Tarjeta => ({
        clave: y.codigo,
        titulo: y.codigo,
        subtitulo: y.nombre,
        fila: filas.find((f) => f.mes === mes && f.yacimientoCodigo === y.codigo) ?? null,
        destino: { tipo: "yacimiento", yacimientoId: y.id },
      })),
    ...(juntas
      ? [{
          clave: CLAVE_C1C3,
          titulo: "C1 + C3",
          subtitulo: "chocolata y caliza",
          fila: filasC1C3.find((f) => f.mes === mes) ?? null,
          destino: { tipo: "c1c3" },
        } as Tarjeta]
      : []),
  ];

  const desgloseDelMes = desglose.filter((d) => d.mes === mes);
  const sinMaterial = acarreoSinMaterial.find((a) => a.mes === mes);

  const [editando, setEditando] = useState<string | null>(null); // clave de la tarjeta en edición
  const [valor, setValor] = useState(""); // existencia final en el yacimiento
  const [valorAcopio, setValorAcopio] = useState(""); // existencia final en el acopio por triturar
  const [formC1C3, setFormC1C3] = useState<FormC1C3>(FORM_C1C3_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Vacío es "sin medir"; un texto que no es número es un error. Lee con
   * `numeroDeCampo`: un `replace(",", ".")` propio entendía la coma pero no el
   * punto de miles, y "2.240" entraba como 2,24 (3 de las 16 cubicaciones
   * cargadas pasan las mil toneladas, la mayor 2240).
   */
  function numeroOpcional(texto: string): number | null | "invalido" {
    if (texto.trim() === "") return null;
    const n = numeroDeCampo(texto);
    return n !== null && n >= 0 ? n : "invalido";
  }

  async function guardar(tarjeta: Tarjeta) {
    let url: string;
    let cuerpo: unknown;

    if (tarjeta.destino.tipo === "c1c3") {
      // Los dos materiales, juntos: con uno solo la suma parecería completa y
      // daría un residuo falso. Si no hay caliza, se carga 0.
      const materiales = [];
      for (const m of MATERIALES_DE_CANTERA) {
        const canteras = numeroOpcional(formC1C3[m].canteras);
        const galpones = numeroOpcional(formC1C3[m].galpones);
        if (canteras === null || canteras === "invalido") {
          setError(`${m}: la existencia en las canteras tiene que ser un número (si no hay, 0)`);
          return;
        }
        if (galpones === "invalido") {
          setError(`${m}: la existencia en galpones y acopios tiene que ser un número`);
          return;
        }
        materiales.push({ material: m, existencia_final: canteras, existencia_acopio: galpones });
      }
      url = "/api/cantera/cubicacion/material";
      cuerpo = { mes, materiales };
    } else {
      const n = numeroOpcional(valor);
      if (n === null || n === "invalido") {
        setError("La existencia final del yacimiento tiene que ser un número");
        return;
      }
      const acopio = numeroOpcional(valorAcopio);
      if (acopio === "invalido") {
        setError("La existencia del acopio por triturar tiene que ser un número");
        return;
      }
      url = "/api/cantera/cubicacion";
      cuerpo = { yacimiento_id: tarjeta.destino.yacimientoId, mes, existencia_final: n, existencia_acopio: acopio };
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
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

  function empezarAEditar(tarjeta: Tarjeta) {
    setEditando(tarjeta.clave);
    setError(null);
    if (tarjeta.destino.tipo === "c1c3") {
      const previo = (m: string) => existenciasPorMaterial.find((e) => e.mes === mes && e.material === m);
      setFormC1C3(
        Object.fromEntries(
          MATERIALES_DE_CANTERA.map((m) => [
            m,
            {
              canteras: previo(m) ? String(previo(m)!.existenciaFinal) : "",
              galpones: previo(m)?.existenciaAcopio != null ? String(previo(m)!.existenciaAcopio) : "",
            },
          ])
        )
      );
    } else {
      setValor(tarjeta.fila?.existenciaYacimiento != null ? String(tarjeta.fila.existenciaYacimiento) : "");
      setValorAcopio(tarjeta.fila?.existenciaAcopio != null ? String(tarjeta.fila.existenciaAcopio) : "");
    }
  }

  // Últimos 6 meses cargados, del más reciente al más viejo, para el
  // historial de lecturas de un vistazo.
  const historial = [...meses].reverse().slice(0, 6);
  const columnasHistorial = [...yacimientos.map((y) => y.codigo), CLAVE_C1C3];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/cantera" className="text-xs text-slate-500 underline">← Cantera</Link>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-header">Cubicación</h1>
        <p className="page-subheader">Existencia inicial + voladuras − acarreo, contra la existencia medida (yacimiento + acopio por triturar).</p>
      </div>

      {/* ── Navegador de mes ── */}
      <div className="card mt-4 flex items-center justify-between p-3">
        <button className="btn-ghost" onClick={() => setMes((m) => moverMes(m, -1))}>
          ← Mes anterior
        </button>
        <span className="font-semibold text-slate-800">{nombreDeMes(mes)}</span>
        <button className="btn-ghost" onClick={() => setMes((m) => moverMes(m, 1))}>
          Mes siguiente →
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {juntas && (
        <p className="mt-3 text-xs text-slate-500">
          Desde {nombreDeMes(mesDeCorte)} C1 y C3 se cierran juntas: la chocolata y la caliza de las dos canteras están mezcladas
          en los galpones y al volar no se sabe cuánta es de cada una. El balance usa los totales; el reparto entre chocolata y
          caliza sale abajo, medido. Los meses anteriores se ven como estaban.
        </p>
      )}
      {juntas && sinMaterial && (
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {num0.format(sinMaterial.toneladas)} t acarreadas desde C1/C3 este mes tienen un tipo que no es ni chocolata ni caliza:
          cuentan en el balance pero no en el reparto de abajo.
        </p>
      )}

      {/* ── Cierre del mes, una tarjeta por yacimiento (o C1+C3 juntas) ── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tarjetas.map((tarjeta) => {
          const { fila } = tarjeta;
          const esC1C3 = tarjeta.destino.tipo === "c1c3";
          const color = COLOR_YACIMIENTO[tarjeta.clave] ?? "#64748B";
          const enEdicion = editando === tarjeta.clave;
          return (
            <div key={tarjeta.clave} className={`relative overflow-hidden card p-4 ${esC1C3 ? "sm:col-span-2" : ""}`}>
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  <span className="font-semibold text-slate-800">{tarjeta.titulo}</span>
                  <span className="text-xs text-slate-400">{tarjeta.subtitulo}</span>
                </div>
                <BadgeLectura lectura={fila?.lectura ?? null} />
              </div>

              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-slate-500">Exist. inicial</dt>
                <dd className="text-right font-mono tabular-nums text-slate-700">{t(fila?.existenciaInicial ?? null)}</dd>
                <dt className="text-slate-500">Voladuras</dt>
                <dd className="text-right font-mono tabular-nums text-slate-700">{t(fila?.voladuras ?? 0)}</dd>
                <dt className="text-slate-500">Acarreo</dt>
                <dd className="text-right font-mono tabular-nums text-slate-700">{t(fila?.acarreo ?? 0)}</dd>
                <dt className="font-medium text-slate-700">Stock teórico</dt>
                <dd className="text-right font-mono tabular-nums font-medium text-slate-900">{t(fila?.stockTeorico ?? null)}</dd>
              </dl>

              <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {!esC1C3 && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Existencia final acopio por triturar</span>
                      <span className="font-mono tabular-nums text-slate-700">{t(fila?.existenciaAcopio ?? null)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Existencia final yacimiento</span>
                      <span className="font-mono tabular-nums text-slate-700">{t(fila?.existenciaYacimiento ?? null)}</span>
                    </div>
                  </>
                )}
                <div className={`flex items-center justify-between text-sm ${esC1C3 ? "" : "border-t border-slate-100 pt-1.5"}`}>
                  <span className="font-medium text-slate-700">Existencia final total</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold tabular-nums text-slate-900">{t(fila?.existenciaFinal ?? null)}</span>
                    {puedeEditar && !enEdicion && (
                      <button className="text-xs text-slate-400 underline hover:text-slate-700" onClick={() => empezarAEditar(tarjeta)}>
                        {fila?.existenciaFinal != null || (esC1C3 && desgloseDelMes.some((d) => d.existenciaFinal !== null)) ? "Editar" : "Cargar"}
                      </button>
                    )}
                  </div>
                </div>

                {enEdicion && tarjeta.destino.tipo === "yacimiento" && (
                  <div className="mt-2 space-y-2">
                    <label className="block text-xs text-slate-600">
                      Existencia final acopio por triturar (opcional)
                      <input
                        autoFocus
                        className="input mt-1"
                        inputMode="decimal"
                        value={valorAcopio}
                        onChange={(e) => setValorAcopio(e.target.value)}
                        placeholder="Toneladas en reservas"
                      />
                    </label>
                    <label className="block text-xs text-slate-600">
                      Existencia final yacimiento
                      <input
                        className="input mt-1"
                        inputMode="decimal"
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && guardar(tarjeta)}
                        placeholder="Toneladas medidas en el yacimiento"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button className="btn-primary shrink-0" disabled={guardando} onClick={() => guardar(tarjeta)}>
                        Guardar
                      </button>
                      <button className="btn-ghost shrink-0" onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
                  </div>
                )}

                {enEdicion && tarjeta.destino.tipo === "c1c3" && (
                  <div className="mt-2 space-y-3">
                    <p className="text-xs text-slate-500">
                      Cargá los dos materiales a la vez: el balance usa la suma. Si no hay caliza en las canteras, 0.
                    </p>
                    {MATERIALES_DE_CANTERA.map((m, i) => (
                      <div key={m} className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:items-end">
                        <span className="text-sm font-medium text-slate-700">{m}</span>
                        <label className="block text-xs text-slate-600">
                          En las canteras
                          <input
                            autoFocus={i === 0}
                            className="input mt-1"
                            inputMode="decimal"
                            value={formC1C3[m].canteras}
                            onChange={(e) => setFormC1C3((f) => ({ ...f, [m]: { ...f[m], canteras: e.target.value } }))}
                            placeholder="Toneladas"
                          />
                        </label>
                        <label className="block text-xs text-slate-600">
                          En galpones y acopios (opcional)
                          <input
                            className="input mt-1"
                            inputMode="decimal"
                            value={formC1C3[m].galpones}
                            onChange={(e) => setFormC1C3((f) => ({ ...f, [m]: { ...f[m], galpones: e.target.value } }))}
                            onKeyDown={(e) => e.key === "Enter" && guardar(tarjeta)}
                            placeholder="Toneladas"
                          />
                        </label>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <button className="btn-primary shrink-0" disabled={guardando} onClick={() => guardar(tarjeta)}>
                        Guardar
                      </button>
                      <button className="btn-ghost shrink-0" onClick={() => setEditando(null)}>Cancelar</button>
                    </div>
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

              {/* El reparto entre chocolata y caliza: medido, no estimado. */}
              {esC1C3 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reparto por material</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Material</th>
                          <th className="text-right">Exist. inicial</th>
                          <th className="text-right">Acarreo</th>
                          <th className="text-right">Exist. final</th>
                          <th className="text-right">Salió de la cantera</th>
                          <th className="text-right">Parte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {MATERIALES_DE_CANTERA.map((m) => {
                          const d = desgloseDelMes.find((x) => x.material === m);
                          return (
                            <tr key={m}>
                              <td>{m}</td>
                              <td className="text-right font-mono tabular-nums">{t(d?.existenciaInicial ?? null)}</td>
                              <td className="text-right font-mono tabular-nums">{t(d?.acarreo ?? 0)}</td>
                              <td className="text-right font-mono tabular-nums">{t(d?.existenciaFinal ?? null)}</td>
                              <td className="text-right font-mono font-medium tabular-nums">{t(d?.extraidoImplicito ?? null)}</td>
                              <td className="text-right font-mono tabular-nums">{d?.parteDelTotal != null ? `${(d.parteDelTotal * 100).toFixed(0)}%` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    «Salió de la cantera» = existencia final − inicial + acarreo: cuánta piedra de cada tipo se extrajo en el mes, que
                    al volar no se sabe. Sin existencia inicial (el primer mes) no se puede calcular.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Historial: la lectura de cada yacimiento (y de C1+C3 desde el corte), últimos meses ── */}
      {historial.length > 0 && (
        <section className="mt-6">
          <h2 className="section-title">Historial</h2>
          <div className="card mt-2 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Mes</th>
                  {columnasHistorial.map((c) => (
                    <th key={c} className="text-center">{c === CLAVE_C1C3 ? "C1 + C3" : c}</th>
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
                    {columnasHistorial.map((c) => {
                      const esJuntas = c === CLAVE_C1C3;
                      const esC1C3Suelta = c === "C1" || c === "C3";
                      // Antes del corte C1 y C3 se cierran por separado y después juntas: lo que no aplica a ese mes va vacío.
                      if ((esJuntas && m < mesDeCorte) || (esC1C3Suelta && m >= mesDeCorte)) {
                        return <td key={c} className="text-center text-slate-300">—</td>;
                      }
                      const fila = (esJuntas ? filasC1C3 : filas).find((f) => f.mes === m && (esJuntas || f.yacimientoCodigo === c)) ?? null;
                      return (
                        <td key={c} className="text-center">
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
