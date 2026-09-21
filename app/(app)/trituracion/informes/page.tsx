import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerPesadas } from "@/lib/cantera/consultas";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { resumenMensual, ultimosMeses, type ParteParaResumen } from "@/lib/trituracion/informe";
import { llegadasPorDiaYPlanta, llegadoEnElMes } from "@/lib/trituracion/cruceCantera";
import { COLORES_TRITURACION } from "../GraficosTrituracion";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
function nombreCorto(mes: string): string {
  return NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
}

// Tinte claro de cada color de planta, para la cebra de su tabla — mismo
// criterio que VERDE_CLARO/AMBAR_CLARO en el informe de Taller Vial.
const COLOR_CLARO: Record<string, string> = {
  "#1E7D34": "#F0F8F5",
  "#7E22CE": "#F6F0FC",
  "#0891B2": "#EDFAFD",
  "#C2410C": "#FFF3EC",
  "#B45309": "#FFF7ED",
};

function iconoDisponibilidad(d: number | null): string {
  if (d === null) return "";
  if (d >= 0.8) return "🟢";
  if (d >= 0.6) return "🟡";
  return "🔴";
}

/**
 * Informe mensual generado, por planta — reemplaza (sin tocarlas) las
 * pestañas `AGOSTO`/`Informe Mensual`/`julio` de la planilla, que hoy se
 * arman a mano. Mismo estilo de tabla que el informe de Taller Vial
 * (encabezado y cebra del color de la sección, fila de totales): acá cada
 * planta tiene su propio color en vez de "consumo"/"disponibilidad".
 *
 * "Llegado (Cantera)" cruza contra `cantera_pesadas` (lib/trituracion/cruceCantera.ts):
 * cuánto registró Cantera como acarreado con destino "PT {n}" ese mes. Es
 * sólo un cruce para mirar, no corrige nada solo — el material puede llegar
 * un mes y procesarse el siguiente, así que un desvío no es un error.
 */
export default async function InformesTrituracionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTrituracionDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const plantas = await traerPlantas(supabase);

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const meses = ultimosMeses(mesActual, 6);
  const desde = `${meses[0]}-01`;
  const [anioHasta, mesHastaNum] = meses[meses.length - 1].split("-").map(Number);
  const hasta = new Date(Date.UTC(anioHasta, mesHastaNum, 0)).toISOString().slice(0, 10);

  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];
  const [partesPorPlanta, pesadasPorAnio] = await Promise.all([
    Promise.all(plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta }))),
    // Cantera es otro módulo: sin acceso ahí, RLS devuelve cero filas (no un
    // error) y la columna "Llegado" simplemente queda en "—".
    Promise.all(anios.map((anio) => traerPesadas(supabase, { anio }))),
  ]);
  const llegadas = llegadasPorDiaYPlanta(
    pesadasPorAnio.flat().map((p) => ({ fecha: p.fecha, destino: p.destino, toneladas: p.toneladas, tipo: p.tipo }))
  );

  const filas = plantas.map((planta, i) => {
    const partes: ParteParaResumen[] = partesPorPlanta[i].map((p) => ({
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

    const porMes = meses.map((mes) => resumenMensual(partes.filter((p) => p.fecha.startsWith(mes))));
    const totalSeisMeses = resumenMensual(partes);
    const llegadoTotalSeisMeses = meses.reduce((s, mes) => s + llegadoEnElMes(llegadas, planta.codigo, mes), 0);
    const color = COLORES_TRITURACION[i % COLORES_TRITURACION.length];
    return { planta, porMes, totalSeisMeses, llegadoTotalSeisMeses, color, claro: COLOR_CLARO[color] ?? "#F8FAFC" };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/trituracion" className="text-xs text-slate-500 underline">← Trituración</Link>
      <h1 className="page-header mt-1">Informe mensual</h1>
      <p className="page-subheader">Últimos 6 meses, por planta. Sólo se cuentan los días operativos. 🔴 &lt;60% · 🟡 60-79% · 🟢 ≥80% disponibilidad.</p>

      {filas.map(({ planta, porMes, totalSeisMeses, llegadoTotalSeisMeses, color, claro }) => (
        <section key={planta.id} className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          <div style={{ backgroundColor: color }} className="flex items-center justify-between px-4 py-2">
            <span className="text-sm font-semibold text-white">{planta.nombre.toUpperCase()}</span>
            <span className="text-xs text-white/80">{num0.format(totalSeisMeses.toneladasTotal)} t en 6 meses</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: color }}>
                  {["Mes", "Días operativos", "Hs. teóricas", "Hs. paradas", "Disponibilidad", "Toneladas", "Llegado (Cantera)", "t/h real"].map((c, ci) => (
                    <th key={c} className={`px-3 py-2 text-xs font-semibold text-white ${ci === 0 ? "text-left" : "text-right"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meses.map((mes, i) => {
                  const r = porMes[i];
                  const llegado = llegadoEnElMes(llegadas, planta.codigo, mes);
                  return (
                    <tr key={mes} style={{ backgroundColor: i % 2 === 1 ? claro : undefined }}>
                      <td className="px-3 py-2 font-medium text-slate-800">{nombreCorto(mes)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.diasOperativos}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(r.horasTeoricasTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(r.horasParadasTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.disponibilidadPromedio !== null ? <>{iconoDisponibilidad(r.disponibilidadPromedio)} {pct.format(r.disponibilidadPromedio)}</> : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-medium" style={{ color }}>{num0.format(r.toneladasTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{llegado > 0 ? `${num0.format(llegado)} t` : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {r.productividadRealPromedio !== null ? num1.format(r.productividadRealPromedio) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: color }} className="font-semibold text-white">
                  <td className="px-3 py-2">TOTAL 6 MESES</td>
                  <td className="px-3 py-2 text-right">{totalSeisMeses.diasOperativos}</td>
                  <td className="px-3 py-2 text-right">{num1.format(totalSeisMeses.horasTeoricasTotal)}</td>
                  <td className="px-3 py-2 text-right">{num1.format(totalSeisMeses.horasParadasTotal)}</td>
                  <td className="px-3 py-2 text-right">
                    {totalSeisMeses.disponibilidadPromedio !== null ? pct.format(totalSeisMeses.disponibilidadPromedio) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{num0.format(totalSeisMeses.toneladasTotal)}</td>
                  <td className="px-3 py-2 text-right">{llegadoTotalSeisMeses > 0 ? `${num0.format(llegadoTotalSeisMeses)} t` : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {totalSeisMeses.productividadRealPromedio !== null ? num1.format(totalSeisMeses.productividadRealPromedio) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
