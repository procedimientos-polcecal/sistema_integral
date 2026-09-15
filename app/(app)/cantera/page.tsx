import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerAcarreos,
  traerBochones,
  traerConsumosDe,
  traerDatosParaInforme,
  traerFleteros,
  traerPesadas,
  traerTarifasAcarreo,
  traerVoladuras,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { serieMensual } from "@/lib/cantera/informe";
import { armarFilaBochon, armarFilaVoladura, contarAvisos } from "@/lib/cantera/tablero";
import { resumenPorFletero, resumenAnualPorTipo, type AcarreoPlano } from "@/lib/cantera/acarreo";
import { agruparPesadasPorFleteroTipoMes, agruparPesadasPorTipoMes } from "@/lib/cantera/pesadas";
import type { Consumo } from "@/lib/cantera/types";
import { ChipCruce } from "./registros/CanteraClient";
import InicioGrafico from "./InicioGrafico";
import ResumenesAnuales from "./ResumenesAnuales";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * La página de inicio del módulo: un adelanto real de Registros y del
 * Informe, no una lista de links sueltos — el usuario lo pidió dos veces:
 * primero que no fueran "cuadros aburridos", después que las estadísticas
 * fueran representativas y que el informe se viera con un gráfico, no con
 * números en una lista. El sidebar (`lib/core/nav.ts`) sigue teniendo su
 * desplegable para ir directo a cualquier sección; esto es la puerta de
 * entrada, con los mismos datos que se verían abriendo Registros o el
 * Informe, para no tener que entrar a mirar si hay algo pendiente.
 */
export default async function CanteraInicioPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>;
}) {
  const { anio: anioParam } = await searchParams;
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
  // descendente (consultas.ts): las primeras son el adelanto que interesa.
  const ultimasVoladuras = filasVoladura.slice(0, 5);
  const ultimosBochones = filasBochon.slice(0, 3);

  const serie = serieMensual(vParaInforme, bParaInforme);
  // "Hoy" en un componente de servidor se resuelve una vez por request: no es
  // estado que pueda dar un resultado distinto a mitad de un mismo render, así
  // que la regla de purity no aplica acá (mismo caso que
  // compras/configuracion/page.tsx).
  // eslint-disable-next-line react-hooks/purity
  const hoy = new Date();
  const mesActual = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, "0")}`;
  const delMesActual = serie.find((f) => f.mes === mesActual) ?? null;
  const serieReciente = serie.slice(-6);
  const anio = anioParam && /^\d{4}$/.test(anioParam) ? anioParam : String(hoy.getUTCFullYear());

  // Se trae el histórico entero una sola vez (paginado con traerTodo, así que
  // no pega contra el límite de 1000 filas de PostgREST) y de ahí se sacan
  // tanto el mes en curso (para las métricas) como el año elegido (para el
  // resumen anual) — evita traer las pesadas dos veces.
  const [fleteros, tarifasAcarreo, acarreosTodos, pesadasTodas] = await Promise.all([
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, {}),
    traerPesadas(supabase, {}),
  ]);
  const acarreosDelMes = acarreosTodos.filter((a) => a.mes.slice(0, 7) === mesActual);
  const pesadasDelMes = pesadasTodas.filter((p) => p.fecha.slice(0, 7) === mesActual);
  const acarreosPlanos: AcarreoPlano[] = [
    ...acarreosDelMes.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadasDelMes),
  ];
  const totalAcarreoMes = fleteros.reduce(
    (s, f) => s + resumenPorFletero(acarreosPlanos, tarifasAcarreo, f.id, mesActual).totalMonto,
    0
  );

  // Resumen anual: "Por fletero" (RESUMEN ANUAL POR FLETERO) y "De
  // materiales" (RESUMEN ANUAL DE MATERIALES) de la planilla real, ahora acá
  // en vez de en `/cantera/acarreo/resumen` — se sacó esa pestaña a pedido.
  const acarreosDelAnioPlanos: AcarreoPlano[] = [
    ...acarreosTodos.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadasTodas),
  ].filter((a) => a.mes.startsWith(anio));
  const MESES_DEL_ANIO = Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`);
  const filasFleteros = fleteros.map((f) => {
    const porMes = MESES_DEL_ANIO.map((mes) => resumenPorFletero(acarreosDelAnioPlanos, tarifasAcarreo, f.id, mes).totalMonto);
    return { fletero: f, porMes, totalAnual: porMes.reduce((s, v) => s + v, 0) };
  });
  const filasMateriales = resumenAnualPorTipo(
    [
      ...acarreosTodos.map((a) => ({ tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
      ...agruparPesadasPorTipoMes(pesadasTodas),
    ],
    anio
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Cantera</h1>
        <div className="flex gap-1.5">
          <Link href="/cantera/acarreo" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
            Acarreo
          </Link>
          {permisos.esAdmin && (
            <>
              <Link href="/cantera/yacimientos" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                Canteras
              </Link>
              <Link href="/cantera/insumos" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                Insumos
              </Link>
              <Link href="/cantera/fleteros" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                Fleteros
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Lo que importa de un vistazo ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica
          color="#1E7D34"
          valor={delMesActual ? num1.format(delMesActual.toneladas) : "0"}
          label={`Toneladas voladas · ${nombreDeMes(mesActual)}`}
        />
        <Metrica
          color="#7E22CE"
          valor={delMesActual?.usdPorTon != null ? `US$ ${num1.format(delMesActual.usdPorTon)}` : "—"}
          label="Costo por tonelada este mes"
        />
        <Metrica
          color={conteo.sinConciliar > 0 ? "#B45309" : "#1E7D34"}
          valor={String(conteo.sinConciliar)}
          label="Facturas a conciliar o revisar"
          href="/cantera/registros"
        />
        <Metrica
          color="#0891B2"
          valor={`$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(totalAcarreoMes)}`}
          label="Acarreo a pagar este mes"
          href="/cantera/acarreo"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Adelanto de Registros ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Registros</h2>
            <Link href="/cantera/registros" className="text-xs text-slate-500 underline">Ver todos →</Link>
          </div>
          {conteo.desvios > 0 && (
            <p className="mt-1 text-xs text-amber-700">{conteo.desvios} con toneladas fuera de rango.</p>
          )}
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

        {/* ── Adelanto del Informe: gráfico, no una lista de números ── */}
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Informe mensual</h2>
            <Link href="/cantera/informes" className="text-xs text-slate-500 underline">Ver informe →</Link>
          </div>
          {serieReciente.length > 0 ? (
            <div className="mt-3 h-52">
              <InicioGrafico datos={serieReciente} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Todavía no hay datos para armar un informe.</p>
          )}
        </section>
      </div>

      <ResumenesAnuales anio={anio} filasFleteros={filasFleteros} filasMateriales={filasMateriales} />
    </div>
  );
}

function Metrica({
  color, valor, label, href,
}: { color: string; valor: string; label: string; href?: string }) {
  const contenido = (
    <>
      <div className="text-3xl font-bold tabular-nums" style={{ color }}>{valor}</div>
      <div className="mt-0.5 text-sm text-slate-500">{label}</div>
    </>
  );
  const clases = "card block p-4 transition hover:-translate-y-0.5 hover:shadow-lg";
  const estilo = { borderTop: `3px solid ${color}` };
  return href ? (
    <Link href={href} className={clases} style={estilo}>{contenido}</Link>
  ) : (
    <div className={clases} style={estilo}>{contenido}</div>
  );
}
