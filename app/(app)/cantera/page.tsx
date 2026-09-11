import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerBochones,
  traerConsumosDe,
  traerDatosParaInforme,
  traerVoladuras,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { serieMensual } from "@/lib/cantera/informe";
import { armarFilaBochon, armarFilaVoladura, contarAvisos } from "@/lib/cantera/tablero";
import type { Consumo } from "@/lib/cantera/types";
import { ChipCruce } from "./registros/CanteraClient";

const ars = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const money = (v: number | null) => (v == null ? "—" : `$ ${ars.format(v)}`);

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * La página de inicio del módulo: un adelanto real de Registros y del
 * Informe, no una lista de links sueltos — el usuario pidió explícitamente
 * "no esos 4 cuadros aburridos". El sidebar sigue teniendo su desplegable
 * (`lib/core/nav.ts`) para ir directo a cualquier sección; esta pantalla es
 * la puerta de entrada del módulo, con los mismos números que se verían
 * abriendo Registros o el Informe, para no tener que entrar a mirar si hay
 * algo pendiente.
 */
export default async function CanteraInicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const [yacimientos, vs, bs, { voladuras: vParaInforme, bochones: bParaInforme }] = await Promise.all([
    traerYacimientos(supabase, true),
    traerVoladuras(supabase, {}),
    traerBochones(supabase, {}),
    traerDatosParaInforme(supabase),
  ]);
  const porId = new Map(yacimientos.map((y) => [y.id, y]));

  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const filasVoladura = vs.map((v) =>
    armarFilaVoladura(v, porId.get(v.yacimiento_id) ?? null, consumosPorCodigo.get(v.codigo) ?? [])
  );
  const filasBochon = bs.map((b) => armarFilaBochon(b, porId.get(b.yacimiento_id) ?? null));
  const conteo = contarAvisos(filasVoladura, filasBochon);

  // `traerVoladuras`/`traerBochones` ya vienen ordenadas por fecha de voladura
  // descendente (consultas.ts): las primeras 5 son el adelanto que interesa.
  const ultimasVoladuras = filasVoladura.slice(0, 5);
  const ultimosBochones = filasBochon.slice(0, 3);

  const serie = serieMensual(vParaInforme, bParaInforme);
  const ultimoMes = serie.at(-1) ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold">Cantera</h1>

      {/* ── Estado general, de un vistazo ── */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tarjeta valor={String(conteo.sinConciliar)} label="a conciliar" alerta={conteo.sinConciliar > 0} />
        <Tarjeta valor={String(conteo.desvios)} label="toneladas fuera de rango" alerta={conteo.desvios > 0} />
        <Tarjeta
          valor={ultimoMes ? num1.format(ultimoMes.toneladas) : "—"}
          label={ultimoMes ? `toneladas en ${nombreDeMes(ultimoMes.mes)}` : "sin datos del mes"}
        />
        <Tarjeta
          valor={ultimoMes?.usdPorTon != null ? `US$ ${num1.format(ultimoMes.usdPorTon)}` : "—"}
          label="por tonelada, último mes"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Adelanto de Registros ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Registros</h2>
            <Link href="/cantera/registros" className="text-xs text-slate-500 underline">Ver todos →</Link>
          </div>
          <p className="mt-1 text-xs text-slate-500">Las últimas voladuras cargadas, de todas las canteras.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {ultimasVoladuras.map((v) => (
              <li key={v.codigo}>
                <Link href={`/cantera/voladuras/${v.codigo}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:bg-slate-50">
                  <span className="font-mono">{v.codigo}</span>
                  <span className="text-xs text-slate-400">{v.yacimiento}</span>
                  <span className="flex-1 text-right text-xs text-slate-500">{v.vol_fecha ?? "sin volar"}</span>
                  <span className="whitespace-nowrap">
                    <ChipCruce lectura={v.crucePerf} /> <ChipCruce lectura={v.cruceVol} />
                  </span>
                </Link>
              </li>
            ))}
            {ultimasVoladuras.length === 0 && (
              <li className="py-4 text-center text-sm text-slate-400">Todavía no hay voladuras cargadas.</li>
            )}
          </ul>
          {ultimosBochones.length > 0 && (
            <>
              <p className="mt-3 text-xs font-semibold text-slate-500">Bochones recientes</p>
              <ul className="mt-1 divide-y divide-slate-100">
                {ultimosBochones.map((b) => (
                  <li key={b.codigo}>
                    <Link href={`/cantera/bochones/${b.codigo}`} className="flex items-center justify-between gap-2 py-1.5 text-sm hover:bg-slate-50">
                      <span className="font-mono">{b.codigo}</span>
                      <span className="text-xs text-slate-400">{b.yacimiento}</span>
                      <span className="flex-1 text-right text-xs text-slate-500">{b.fecha ?? "—"}</span>
                      <ChipCruce lectura={b.cruce} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {permisos.puedeEditar && (
            <div className="mt-3 flex gap-2">
              <Link href="/cantera/voladuras/nueva" className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white">Cargar voladura</Link>
              <Link href="/cantera/bochones/nuevo" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">Cargar bochón</Link>
            </div>
          )}
        </section>

        {/* ── Adelanto del Informe ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Informe mensual</h2>
            <Link href="/cantera/informes" className="text-xs text-slate-500 underline">Ver informe →</Link>
          </div>
          {ultimoMes ? (
            <>
              <p className="mt-1 text-xs text-slate-500">{nombreDeMes(ultimoMes.mes)}, el último con datos cargados.</p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-slate-500">Toneladas</dt>
                  <dd className="text-lg font-semibold text-slate-900">{num1.format(ultimoMes.toneladas)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">USD/tonelada</dt>
                  <dd className="text-lg font-semibold text-slate-900">{ultimoMes.usdPorTon != null ? num1.format(ultimoMes.usdPorTon) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Perforación</dt>
                  <dd className="text-sm text-slate-700">{money(ultimoMes.perforacionUsd)} <span className="text-xs text-slate-400">USD</span></dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Voladura</dt>
                  <dd className="text-sm text-slate-700">{money(ultimoMes.voladuraUsd)} <span className="text-xs text-slate-400">USD</span></dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                {serie.length} {serie.length === 1 ? "mes cargado" : "meses cargados"} en total — el histórico completo, con
                gráficos, está en el informe.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Todavía no hay datos para armar un informe.</p>
          )}
        </section>
      </div>

      {/* ── Catálogos, sólo admin ── */}
      {permisos.esAdmin && (
        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/cantera/yacimientos" className="text-slate-600 underline">Canteras</Link>
          <Link href="/cantera/insumos" className="text-slate-600 underline">Insumos</Link>
        </div>
      )}
    </div>
  );
}

function Tarjeta({ valor, label, alerta }: { valor: string; label: string; alerta?: boolean }) {
  return (
    <div className="card p-3">
      <div className={`text-2xl font-bold tabular-nums ${alerta ? "text-amber-700" : "text-slate-900"}`}>{valor}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
