import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { informeMensualPorPlanta, toneladasPorOrigen, type ParteParaInformeMensual } from "@/lib/trituracion/informeMensual";
import BuscadorInformeMensual from "./BuscadorInformeMensual";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
// Dos decimales — igual que la planilla real ("96,15%").
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

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * El informe mensual "oficial" de plantas de trituración: las mismas 6
 * tablas que hoy se arman a mano en la pestaña "Informe Mensual"/"AGOSTO"
 * del Sheets (`lib/trituracion/informeMensual.ts` tiene las fórmulas
 * exactas, sacadas de la planilla real, no adivinadas), con export a Excel.
 * Mismo lenguaje visual que el informe de Cantera.
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
  const mesInforme = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const desdeInforme = `${mesInforme}-01`;
  const [anioInforme, mesInformeNum] = mesInforme.split("-").map(Number);
  const hastaInforme = new Date(Date.UTC(anioInforme, mesInformeNum, 0)).toISOString().slice(0, 10);

  const partesDelMesPorPlanta = await Promise.all(
    plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde: desdeInforme, hasta: hastaInforme }))
  );

  const partesDelMesInforme = partesDelMesPorPlanta.map((partes) => partes.map(aParteInforme));
  const informesPorPlanta = plantas.map((planta, i) => ({
    planta,
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

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/trituracion" className="text-xs text-slate-500 underline">← Trituración</Link>
      <h1 className="mt-1 text-xl font-semibold">Informe mensual</h1>
      <p className="mt-1 text-sm text-slate-500">Las mismas tablas que hoy se arman a mano en el Sheets, para exportarlas y escribir el informe.</p>

      <section className="mt-4 card p-4">
        <h2 className="text-sm font-semibold text-slate-700">Elegir mes</h2>
        <BuscadorInformeMensual mesGenerado={mesInforme} />
      </section>

      <div className="mt-6 overflow-hidden card">
        <div style={{ backgroundColor: VERDE }} className="px-4 py-2 text-sm font-semibold text-white">
          INFORME DE PLANTAS DE TRITURACIÓN — {nombreMes(mesInforme).toUpperCase()}
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
          <div className="mt-2 overflow-x-auto card">
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
          <div className="mt-2 overflow-x-auto card">
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
          <div className="mt-2 overflow-x-auto card">
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
          <div className="mt-2 overflow-x-auto card">
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
          <div className="mt-2 overflow-x-auto card">
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
          <div className="mt-2 overflow-x-auto card">
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
