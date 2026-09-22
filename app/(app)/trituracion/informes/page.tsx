import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerPesadas } from "@/lib/cantera/consultas";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { resumenMensual, ultimosMeses, type ParteParaResumen } from "@/lib/trituracion/informe";
import { informeMensualPorPlanta, toneladasPorOrigen, type ParteParaInformeMensual } from "@/lib/trituracion/informeMensual";
import { llegadasPorDiaYPlanta, llegadoEnElMes } from "@/lib/trituracion/cruceCantera";
import { COLORES_TRITURACION } from "../GraficosTrituracion";
import BuscadorInformeMensual from "./BuscadorInformeMensual";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });
// Dos decimales — igual que la planilla real ("96,15%") — sólo para el informe mensual nuevo, más abajo.
const pct2 = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 2 });

// Los mismos dos colores que usa el informe de Cantera para sus secciones —
// acá alternan por tabla en vez de por perforación/voladura, no hay una
// correspondencia de significado, es el mismo lenguaje visual.
const VERDE = "#1E7D34";
const VERDE_CLARO = "#F0F8F5";
const AMBAR = "#B45309";
const AMBAR_CLARO = "#FFF7ED";

function aParteInforme(p: { fecha: string; estado: string; material: string | null; origen: string | null; horas_mantenimiento: number; horas_falta_piedra: number; horas_produccion: number; horas_otro: number; camiones_llegados: number | null; toneladas_procesadas: number | null }): ParteParaInformeMensual {
  return {
    fecha: p.fecha,
    estado: p.estado as "opero" | "no_opero",
    material: p.material,
    origen: p.origen,
    horasMantenimiento: p.horas_mantenimiento,
    horasFaltaPiedra: p.horas_falta_piedra,
    horasProduccion: p.horas_produccion,
    horasOtro: p.horas_otro,
    camionesLlegados: p.camiones_llegados,
    toneladasProcesadas: p.toneladas_procesadas,
  };
}

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
export default async function InformesTrituracionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
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

  const mesInforme = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const desdeInforme = `${mesInforme}-01`;
  const [anioInforme, mesInformeNum] = mesInforme.split("-").map(Number);
  const hastaInforme = new Date(Date.UTC(anioInforme, mesInformeNum, 0)).toISOString().slice(0, 10);

  const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];
  const [partesPorPlanta, pesadasPorAnio, partesDelMesPorPlanta] = await Promise.all([
    Promise.all(plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta }))),
    // Cantera es otro módulo: sin acceso ahí, RLS devuelve cero filas (no un
    // error) y la columna "Llegado" simplemente queda en "—".
    Promise.all(anios.map((anio) => traerPesadas(supabase, { anio }))),
    // Para el informe "oficial" (Tablas 1 a 6, más abajo) — un mes puntual, elegido aparte del histórico de 6 meses de arriba.
    Promise.all(plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde: desdeInforme, hasta: hastaInforme }))),
  ]);
  const llegadas = llegadasPorDiaYPlanta(
    pesadasPorAnio.flat().map((p) => ({ fecha: p.fecha, destino: p.destino, toneladas: p.toneladas, tipo: p.tipo }))
  );

  const partesDelMesInforme = partesDelMesPorPlanta.map((partes) => partes.map(aParteInforme));
  const informesPorPlanta = plantas.map((planta, i) => ({
    planta,
    color: COLORES_TRITURACION[i % COLORES_TRITURACION.length],
    informe: informeMensualPorPlanta(partesDelMesInforme[i], mesInforme),
  }));
  const origenes = toneladasPorOrigen(partesDelMesInforme.flat());
  const totalOrigenes = origenes.reduce((s, o) => s + o.toneladas, 0);
  const hayMaterialSinClasificar = informesPorPlanta.some(({ informe }) => informe.porMaterial.sinClasificar > 0);
  const consolidado = {
    diasOperativos: informesPorPlanta.reduce((s, { informe }) => s + informe.diasOperativos, 0),
    horasTeoricas: informesPorPlanta.reduce((s, { informe }) => s + informe.horasTeoricas, 0),
    horasReales: informesPorPlanta.reduce((s, { informe }) => s + informe.horasReales, 0),
    viajes: informesPorPlanta.reduce((s, { informe }) => s + informe.viajes, 0),
    toneladas: informesPorPlanta.reduce((s, { informe }) => s + informe.toneladas, 0),
    horasFaltaPiedra: informesPorPlanta.reduce((s, { informe }) => s + informe.horasFaltaPiedra, 0),
    horasMantenimiento: informesPorPlanta.reduce((s, { informe }) => s + informe.horasMantenimiento, 0),
    horasVarios: informesPorPlanta.reduce((s, { informe }) => s + informe.horasVarios, 0),
    dolomita: informesPorPlanta.reduce((s, { informe }) => s + informe.porMaterial.dolomita, 0),
    chocolata: informesPorPlanta.reduce((s, { informe }) => s + informe.porMaterial.chocolata, 0),
    caliza: informesPorPlanta.reduce((s, { informe }) => s + informe.porMaterial.caliza, 0),
    sinClasificar: informesPorPlanta.reduce((s, { informe }) => s + informe.porMaterial.sinClasificar, 0),
  };

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
      <h1 className="mt-1 text-xl font-semibold">Informe mensual</h1>
      <p className="mt-1 text-sm text-slate-500">Últimos 6 meses, por planta. Sólo se cuentan los días operativos. 🔴 &lt;60% · 🟡 60-79% · 🟢 ≥80% disponibilidad.</p>

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

      {/* ── Informe mensual "oficial": las mismas tablas que ya se armaban a mano en el Sheets (Informe Mensual/AGOSTO), con export a Excel ── */}
      <section className="mt-10 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700">Generar informe de un mes</h2>
        <p className="mt-1 text-xs text-slate-500">
          Las tablas que hoy se arman a mano en el Sheets ("Informe Mensual") — para exportarlas y escribir el informe.
        </p>
        <BuscadorInformeMensual mesGenerado={mesInforme} />
      </section>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
        <div style={{ backgroundColor: VERDE }} className="px-4 py-2 text-sm font-semibold text-white">
          INFORME DE PLANTAS DE TRITURACIÓN — {nombreCorto(mesInforme).toUpperCase()}
        </div>
        <div style={{ backgroundColor: VERDE_CLARO }} className="px-4 py-1.5 text-xs text-slate-500">
          Generado: {new Date().toLocaleString("es-AR")}
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-400">
            &quot;Horas teóricas&quot; acá es días operativos × 8, igual que la planilla histórica — no el horario real de cada parte que usan el resto de las pantallas del módulo.
            &quot;Productividad media&quot;, &quot;Utilización&quot; y &quot;Producción (Tn/h)&quot; pueden diferir de informes anteriores: la planilla armaba &quot;Hs reales&quot; a mano, sin una fórmula reproducible.
          </p>

          {/* ── Tabla N°1 — KPIs operacionales por planta ── */}
          <h3 className="mt-4 text-sm font-semibold text-slate-700">Tabla N°1 — KPIs operacionales por planta</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: VERDE }}>
                  {["Indicador", ...informesPorPlanta.map(({ planta }) => planta.nombre.toUpperCase())].map((c) => (
                    <th key={c} className="px-3 py-2 text-left text-xs font-semibold text-white">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { etiqueta: "Productividad media (t/h marcha)", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => i.productividadTHMarcha !== null ? num2.format(i.productividadTHMarcha) : "—" },
                  { etiqueta: "Toneladas por viaje", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => i.toneladasPorViaje !== null ? num2.format(i.toneladasPorViaje) : "—" },
                  { etiqueta: "Horas perdidas totales", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => num1.format(i.horasPerdidasTotal) },
                  { etiqueta: "% horas perdidas s/ teóricas", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => i.pctHorasPerdidas !== null ? pct2.format(i.pctHorasPerdidas) : "—" },
                  { etiqueta: "Días operativos", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => String(i.diasOperativos) },
                  { etiqueta: "Días con falta de piedra", valor: (i: (typeof informesPorPlanta)[number]["informe"]) => String(i.diasConFaltaPiedra) },
                ].map((fila, i) => (
                  <tr key={fila.etiqueta} style={{ backgroundColor: i % 2 === 1 ? VERDE_CLARO : undefined }}>
                    <td className="px-3 py-2 font-medium text-slate-700">{fila.etiqueta}</td>
                    {informesPorPlanta.map(({ planta, informe }) => (
                      <td key={planta.id} className="px-3 py-2 text-right font-mono tabular-nums">{fila.valor(informe)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Tabla N°2 — Datos operativos por planta ── */}
          <h3 className="mt-6 text-sm font-semibold text-slate-700">Tabla N°2 — Datos operativos por planta</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: AMBAR }}>
                  {["Planta", "Días operativos", "Hs teór.", "Hs reales", "Viajes", "Toneladas", "Producción (Tn/h)"].map((c, ci) => (
                    <th key={c} className={`px-3 py-2 text-xs font-semibold text-white ${ci === 0 ? "text-left" : "text-right"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {informesPorPlanta.map(({ planta, informe }, i) => (
                  <tr key={planta.id} style={{ backgroundColor: i % 2 === 1 ? AMBAR_CLARO : undefined }}>
                    <td className="px-3 py-2 font-medium text-slate-800">{planta.nombre.toUpperCase()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.diasOperativos}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.horasTeoricas)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.horasReales)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num0.format(informe.viajes)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.toneladas)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.productividadTHMarcha !== null ? num1.format(informe.productividadTHMarcha) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: AMBAR }} className="font-semibold text-white">
                  <td className="px-3 py-2">CONSOLIDADO</td>
                  <td className="px-3 py-2 text-right">{consolidado.diasOperativos}</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.horasTeoricas)}</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.horasReales)}</td>
                  <td className="px-3 py-2 text-right">{num0.format(consolidado.viajes)}</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.toneladas)}</td>
                  <td className="px-3 py-2 text-right">{consolidado.horasReales > 0 ? num1.format(consolidado.toneladas / consolidado.horasReales) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Tabla N°3 — Horas improductivas por causa ── */}
          <h3 className="mt-6 text-sm font-semibold text-slate-700">Tabla N°3 — Horas improductivas por causa</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: VERDE }}>
                  {["Planta", "Falta de piedra (hs)", "Mantenimiento (hs)", "Varios (hs)"].map((c, ci) => (
                    <th key={c} className={`px-3 py-2 text-xs font-semibold text-white ${ci === 0 ? "text-left" : "text-right"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {informesPorPlanta.map(({ planta, informe }, i) => (
                  <tr key={planta.id} style={{ backgroundColor: i % 2 === 1 ? VERDE_CLARO : undefined }}>
                    <td className="px-3 py-2 font-medium text-slate-800">{planta.nombre.toUpperCase()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.horasFaltaPiedra)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.horasMantenimiento)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(informe.horasVarios)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: VERDE }} className="font-semibold text-white">
                  <td className="px-3 py-2">CONSOLIDADO</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.horasFaltaPiedra)}</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.horasMantenimiento)}</td>
                  <td className="px-3 py-2 text-right">{num1.format(consolidado.horasVarios)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Tabla N°4 — Coeficientes de gestión del tiempo ── */}
          <h3 className="mt-6 text-sm font-semibold text-slate-700">Tabla N°4 — Coeficientes de gestión del tiempo</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: AMBAR }}>
                  {["Planta", "Disponibilidad", "Utilización", "Dirección", "Falta de piedra (%)", "Mantenimiento (%)", "Varios (%)"].map((c, ci) => (
                    <th key={c} className={`px-3 py-2 text-xs font-semibold text-white ${ci === 0 ? "text-left" : "text-right"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {informesPorPlanta.map(({ planta, informe }, i) => (
                  <tr key={planta.id} style={{ backgroundColor: i % 2 === 1 ? AMBAR_CLARO : undefined }}>
                    <td className="px-3 py-2 font-medium text-slate-800">{planta.nombre.toUpperCase()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.disponibilidad !== null ? pct2.format(informe.disponibilidad) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.utilizacion !== null ? pct2.format(informe.utilizacion) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.direccion !== null ? pct2.format(informe.direccion) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.pctFaltaPiedra !== null ? pct2.format(informe.pctFaltaPiedra) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.pctMantenimiento !== null ? pct2.format(informe.pctMantenimiento) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{informe.pctVarios !== null ? pct2.format(informe.pctVarios) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Tabla N°5 — Toneladas procesadas por material ── */}
          <h3 className="mt-6 text-sm font-semibold text-slate-700">Tabla N°5 — Toneladas procesadas por material</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: VERDE }}>
                  {["Planta", "Dolomita", "Chocolata", "Caliza", ...(hayMaterialSinClasificar ? ["Sin clasificar"] : []), "Total Procesado (Tn)"].map((c, ci) => (
                    <th key={c} className={`px-3 py-2 text-xs font-semibold text-white ${ci === 0 ? "text-left" : "text-right"}`}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {informesPorPlanta.map(({ planta, informe }, i) => (
                  <tr key={planta.id} style={{ backgroundColor: i % 2 === 1 ? VERDE_CLARO : undefined }}>
                    <td className="px-3 py-2 font-medium text-slate-800">{planta.nombre.toUpperCase()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num0.format(informe.porMaterial.dolomita)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num0.format(informe.porMaterial.chocolata)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num0.format(informe.porMaterial.caliza)}</td>
                    {hayMaterialSinClasificar && (
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{num0.format(informe.porMaterial.sinClasificar)}</td>
                    )}
                    <td className="px-3 py-2 text-right font-mono tabular-nums font-medium">{num0.format(informe.porMaterial.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: VERDE }} className="font-semibold text-white">
                  <td className="px-3 py-2">CONSOLIDADO</td>
                  <td className="px-3 py-2 text-right">{num0.format(consolidado.dolomita)}</td>
                  <td className="px-3 py-2 text-right">{num0.format(consolidado.chocolata)}</td>
                  <td className="px-3 py-2 text-right">{num0.format(consolidado.caliza)}</td>
                  {hayMaterialSinClasificar && <td className="px-3 py-2 text-right">{num0.format(consolidado.sinClasificar)}</td>}
                  <td className="px-3 py-2 text-right">{num0.format(consolidado.dolomita + consolidado.chocolata + consolidado.caliza + consolidado.sinClasificar)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Tabla N°6 — Toneladas acarreadas por cantera/origen ── */}
          <h3 className="mt-6 text-sm font-semibold text-slate-700">Tabla N°6 — Toneladas acarreadas por cantera</h3>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: AMBAR }}>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-white">Cantera</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-white">Toneladas</th>
                </tr>
              </thead>
              <tbody>
                {origenes.map((o, i) => (
                  <tr key={o.origen} style={{ backgroundColor: i % 2 === 1 ? AMBAR_CLARO : undefined }}>
                    <td className="px-3 py-2 font-mono text-slate-700">{o.origen}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{num1.format(o.toneladas)}</td>
                  </tr>
                ))}
                {origenes.length === 0 && (
                  <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-400">Sin origen cargado este mes.</td></tr>
                )}
              </tbody>
              {origenes.length > 0 && (
                <tfoot>
                  <tr style={{ backgroundColor: AMBAR }} className="font-semibold text-white">
                    <td className="px-3 py-2">TOTAL</td>
                    <td className="px-3 py-2 text-right">{num1.format(totalOrigenes)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
