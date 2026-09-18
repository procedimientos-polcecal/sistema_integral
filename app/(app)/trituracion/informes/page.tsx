import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { resumenMensual, ultimosMeses, type ParteParaResumen } from "@/lib/trituracion/informe";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: "UTC" });
function nombreCorto(mes: string): string {
  return NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
}

/**
 * Informe mensual generado, por planta — reemplaza (sin tocarlas) las
 * pestañas `AGOSTO`/`Informe Mensual`/`julio` de la planilla, que hoy se
 * arman a mano. El cruce contra lo que Cantera registró como llegado a cada
 * planta queda pendiente (ver docs/superpowers/specs/2026-09-18-trituracion-design.md).
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

  const partesPorPlanta = await Promise.all(
    plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta }))
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
    return { planta, porMes };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/trituracion" className="text-xs text-slate-500 underline">← Trituración</Link>
      <h1 className="page-header mt-1">Informe mensual</h1>
      <p className="page-subheader">Últimos 6 meses, por planta. Sólo se cuentan los días operativos.</p>

      {filas.map(({ planta, porMes }) => (
        <section key={planta.id} className="mt-6">
          <h2 className="section-title">{planta.nombre}</h2>
          <div className="card mt-2 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="text-right">Días operativos</th>
                    <th className="text-right">Hs. teóricas</th>
                    <th className="text-right">Hs. paradas</th>
                    <th className="text-right">Disponibilidad</th>
                    <th className="text-right">Toneladas</th>
                    <th className="text-right">t/h real</th>
                  </tr>
                </thead>
                <tbody>
                  {meses.map((mes, i) => {
                    const r = porMes[i];
                    return (
                      <tr key={mes} style={{ backgroundColor: i % 2 === 1 ? "#F8FAFC" : undefined }}>
                        <td className="whitespace-nowrap">{nombreCorto(mes)}</td>
                        <td className="text-right font-mono tabular-nums">{r.diasOperativos}</td>
                        <td className="text-right font-mono tabular-nums">{num1.format(r.horasTeoricasTotal)}</td>
                        <td className="text-right font-mono tabular-nums">{num1.format(r.horasParadasTotal)}</td>
                        <td className="text-right font-mono tabular-nums">
                          {r.disponibilidadPromedio !== null ? pct.format(r.disponibilidadPromedio) : "—"}
                        </td>
                        <td className="text-right font-mono tabular-nums">{num0.format(r.toneladasTotal)}</td>
                        <td className="text-right font-mono tabular-nums">
                          {r.productividadRealPromedio !== null ? num1.format(r.productividadRealPromedio) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
