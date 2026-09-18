import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { despejarParte } from "@/lib/trituracion/horas";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

/**
 * Inicio del módulo: un vistazo del mes corriente por planta. Mismo criterio
 * que Cantera — datos reales, no tarjetas sueltas sin contenido.
 */
export default async function TrituracionInicioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTrituracionDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const plantas = await traerPlantas(supabase);

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const [anio, mesNum] = mesActual.split("-").map(Number);
  const primerDia = `${mesActual}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);

  const partesPorPlanta = await Promise.all(
    plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde: primerDia, hasta: ultimoDia }))
  );

  const filas = plantas.map((planta, i) => {
    const partes = partesPorPlanta[i];
    const diasOperativos = partes.filter((p) => p.estado === "opero").length;
    const toneladas = partes.reduce((s, p) => s + (p.toneladas_procesadas ?? 0), 0);
    const disponibilidades = partes
      .map(
        (p) =>
          despejarParte({
            horaInicio: p.hora_inicio,
            horaFin: p.hora_fin,
            horasMantenimiento: p.horas_mantenimiento,
            horasFaltaPiedra: p.horas_falta_piedra,
            horasProduccion: p.horas_produccion,
            horasOtro: p.horas_otro,
            toneladasProcesadas: p.toneladas_procesadas,
            camionesLlegados: p.camiones_llegados,
          }).disponibilidad
      )
      .filter((d): d is number => d !== null);
    const disponibilidadPromedio =
      disponibilidades.length > 0 ? disponibilidades.reduce((s, d) => s + d, 0) / disponibilidades.length : null;
    const pendientes = partes.filter((p) => p.sheets_pendiente).length;

    return { planta, diasOperativos, toneladas, disponibilidadPromedio, pendientes };
  });

  return (
    <div className="mx-auto max-w-4xl">
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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {filas.map(({ planta, diasOperativos, toneladas, disponibilidadPromedio, pendientes }) => (
          <Link key={planta.id} href={`/trituracion/partes?planta=${planta.id}`} className="card p-4 hover:border-slate-300">
            <div className="font-semibold text-slate-800">{planta.nombre}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-[#0891B2]">{num0.format(toneladas)} t</div>
            <div className="text-sm text-slate-500">procesadas este mes</div>
            <div className="mt-2 flex justify-between text-sm text-slate-600">
              <span>{diasOperativos} días operativos</span>
              <span>{disponibilidadPromedio !== null ? pct.format(disponibilidadPromedio) : "—"} disp.</span>
            </div>
            {pendientes > 0 && (
              <div className="mt-2 text-xs text-amber-700">⚠ {pendientes} sin exportar a la planilla</div>
            )}
          </Link>
        ))}
      </div>

      <div className="mt-6 flex gap-4">
        <Link href="/trituracion/partes" className="btn-primary">Cargar un parte</Link>
        <Link href="/trituracion/informes" className="btn-ghost">Informe mensual</Link>
      </div>
    </div>
  );
}
