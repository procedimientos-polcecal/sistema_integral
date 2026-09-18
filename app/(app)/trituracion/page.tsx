import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas, type ParteDB } from "@/lib/trituracion/consultas";
import { resumenMensual, toneladasPorMaterial, ultimosMeses, type ParteParaResumen } from "@/lib/trituracion/informe";
import { COLOR_CLARO, COLORES_TRITURACION, type FilaEvolucion } from "./GraficosTrituracion";
import { GraficoEvolucion, GraficoMateriales } from "./InicioGraficos";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
const NOMBRE_MES_CORTO = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
function corto(mes: string): string {
  return NOMBRE_MES_CORTO.format(new Date(`${mes}-01T00:00:00Z`)).replace(".", "");
}

function aResumen(partes: ParteDB[]): ParteParaResumen[] {
  return partes.map((p) => ({
    fecha: p.fecha,
    estado: p.estado as "opero" | "no_opero",
    horaInicio: p.hora_inicio,
    horaFin: p.hora_fin,
    horasMantenimiento: p.horas_mantenimiento,
    horasFaltaPiedra: p.horas_falta_piedra,
    horasProduccion: p.horas_produccion,
    horasOtro: p.horas_otro,
    toneladasProcesadas: p.toneladas_procesadas,
    camionesLlegados: p.camiones_llegados,
  }));
}

/**
 * Inicio del módulo, pensado como tablero: un vistazo global del mes (KPIs de
 * las 3 plantas juntas), después cada planta con su propio acento de color,
 * y dos gráficos para ver la tendencia sin tener que ir al informe completo.
 */
export default async function TrituracionInicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTrituracionDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const plantas = await traerPlantas(supabase);
  const colorDePlanta = new Map(plantas.map((p, i) => [p.id, COLORES_TRITURACION[i % COLORES_TRITURACION.length]]));

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const meses = ultimosMeses(mesActual, 6);
  const desde = `${meses[0]}-01`;
  const [anioHasta, mesHastaNum] = meses[meses.length - 1].split("-").map(Number);
  const hasta = new Date(Date.UTC(anioHasta, mesHastaNum, 0)).toISOString().slice(0, 10);

  // Se trae una sola vez el rango de 6 meses por planta y el mes corriente sale de filtrar acá —evita una segunda tanda de queries.
  const partesPorPlanta = await Promise.all(plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta })));

  const partesDelMesPorPlanta = partesPorPlanta.map((partes) => partes.filter((p) => p.fecha.startsWith(mesActual)));
  const todosLosPartesDelMes = partesDelMesPorPlanta.flat();
  const resumenGlobal = resumenMensual(aResumen(todosLosPartesDelMes));
  const pendientesTotal = todosLosPartesDelMes.filter((p) => p.sheets_pendiente).length;
  const materiales = toneladasPorMaterial(
    todosLosPartesDelMes.map((p) => ({ estado: p.estado as "opero" | "no_opero", material: p.material, toneladasProcesadas: p.toneladas_procesadas }))
  );

  const filasPorPlanta = plantas.map((planta, i) => {
    const resumen = resumenMensual(aResumen(partesDelMesPorPlanta[i]));
    return { planta, resumen, color: colorDePlanta.get(planta.id)! };
  });

  const evolucion: FilaEvolucion[] = meses.map((mes) => {
    const fila: FilaEvolucion = { mes: corto(mes) };
    plantas.forEach((p, i) => {
      fila[`p${p.codigo}`] = resumenMensual(aResumen(partesPorPlanta[i].filter((x) => x.fecha.startsWith(mes)))).toneladasTotal;
    });
    return fila;
  });
  const seriePlantas = plantas.map((p, i) => ({ key: `p${p.codigo}`, nombre: p.nombre, color: colorDePlanta.get(p.id) ?? COLORES_TRITURACION[i] }));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-header">Trituración</h1>
        <div className="flex gap-2">
          {permisos.esAdmin && (
            <Link href="/trituracion/plantas" className="text-xs text-slate-500 underline">Plantas</Link>
          )}
        </div>
      </div>
      <p className="page-subheader">
        Las 3 plantas de trituración: cuándo operó cada una, qué material procesó, de qué hora a qué hora y quién estuvo a cargo.
      </p>

      {/* ── KPIs globales del mes ── */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metrica color="#1E7D34" valor={`${num0.format(resumenGlobal.toneladasTotal)} t`} label={`Procesadas en ${nombreDeMes(mesActual)}`} />
        <Metrica color="#7E22CE" valor={String(resumenGlobal.diasOperativos)} label="Días operativos (3 plantas)" />
        <Metrica
          color="#0891B2"
          valor={resumenGlobal.disponibilidadPromedio !== null ? pct.format(resumenGlobal.disponibilidadPromedio) : "—"}
          label="Disponibilidad promedio"
        />
        <Metrica
          color={pendientesTotal > 0 ? "#B45309" : "#1E7D34"}
          valor={String(pendientesTotal)}
          label="Sin exportar a la planilla"
        />
      </div>

      {/* ── Cada planta, con su color ── */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {filasPorPlanta.map(({ planta, resumen, color }) => (
          <Link
            key={planta.id}
            href={`/trituracion/partes?planta=${planta.id}`}
            className="card block p-4 transition hover:-translate-y-0.5 hover:shadow-lg"
            style={{ borderTop: `3px solid ${color}`, background: `linear-gradient(180deg, ${COLOR_CLARO[color] ?? "#FFF"} 0%, #FFFFFF 70%)` }}
          >
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
              {planta.nombre}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums" style={{ color }}>{num0.format(resumen.toneladasTotal)} t</div>
            <div className="text-sm text-slate-500">procesadas este mes</div>
            <div className="mt-2 flex justify-between text-sm text-slate-600">
              <span>{resumen.diasOperativos} días operativos</span>
              <span className="font-medium" style={{ color: resumen.disponibilidadPromedio !== null ? color : undefined }}>
                {resumen.disponibilidadPromedio !== null ? pct.format(resumen.disponibilidadPromedio) : "—"} disp.
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Gráficos ── */}
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <section className="card overflow-hidden lg:col-span-3">
          <div style={{ backgroundColor: "#0891B2" }} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
            Toneladas por planta, últimos 6 meses
          </div>
          <div className="h-56 p-4">
            <GraficoEvolucion datos={evolucion} series={seriePlantas} />
          </div>
        </section>
        <section className="card overflow-hidden lg:col-span-2">
          <div style={{ backgroundColor: "#7E22CE" }} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
            Material procesado este mes
          </div>
          <div className="h-56 p-4">
            {materiales.length > 0 ? (
              <GraficoMateriales datos={materiales} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Sin toneladas cargadas este mes.</div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 flex gap-4">
        <Link href="/trituracion/partes" className="btn-primary">Cargar un parte</Link>
        <Link href="/trituracion/informes" className="btn-ghost">Informe mensual</Link>
      </div>
    </div>
  );
}

/**
 * Calcado de `app/(app)/cantera/page.tsx` y `app/(app)/taller-vial/page.tsx`
 * (valor + borde superior del mismo color), con un fondo tintado de más —a
 * pedido explícito del usuario, que seguía viendo la tarjeta "en negro" con
 * sólo el borde de 3px—, para que el color se note sin tener que mirar de
 * cerca.
 */
function Metrica({ color, valor, label }: { color: string; valor: string; label: string }) {
  return (
    <div className="card p-4" style={{ borderTop: `3px solid ${color}`, backgroundColor: COLOR_CLARO[color] ?? "#FFF" }}>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{valor}</div>
      <div className="mt-0.5 text-sm text-slate-600">{label}</div>
    </div>
  );
}
