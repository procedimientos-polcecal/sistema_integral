"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { hoyEnArgentina, mesRelativo } from "@/lib/core/fechas";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/tiposAusencia";
import type { ReportesCompletos, ReportesRecortados } from "@/lib/rrhh/ausentismo/armarReportes";

/**
 * LA RESPUESTA TIENE DOS FORMAS Y LAS DOS SON LO NORMAL.
 *
 * Quien pasa el control (`encargado`, `admin_sistema` o acceso a RRHH) recibe
 * los tres reportes. Quien no pasa —la mayoría— recibe, con 200 y no con 403,
 * sólo el mensual **sin desglose por motivo**, sin `anual` y sin `porcentual`.
 * Los tipos vienen de `armarReportes.ts` para que la forma tenga una sola
 * fuente de verdad.
 *
 * A quien no pasa no se le muestra un cartel de error ni un hueco: ve cuánto se
 * faltó en cada sector. Y **no se insinúa el motivo que no se muestra**: el
 * porqué del recorte está en `reportesQueVe` —«agregado» no es lo mismo que
 * anónimo cuando el sector tiene una sola persona—, y repetirlo acá, con el
 * ejemplo, sería hacer justo lo que se quiso evitar.
 */
type Respuesta = ReportesCompletos | ReportesRecortados;

function esCompleta(r: Respuesta): r is ReportesCompletos {
  return "anual" in r && "porcentual" in r;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const entero = (n: number) => n.toLocaleString("es-AR");
/** Escala 0–100 y sin tope: ver la nota de «puede pasar de 100». */
const pct = (n: number) =>
  `${n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const nombreDelMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

export default function Reportes() {
  const [mes, setMes] = useState(() => hoyEnArgentina().slice(0, 7));
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Ver `lib/core/useCargar.ts`: pasar de mes con las flechas dos veces seguidas
  // saca dos pedidos, y la pantalla no puede quedarse con el del mes anterior.
  useCargar(async (vigente) => {
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`/api/disponibilidad/reportes?mes=${mes}`);
      const cuerpo = await r.json().catch(() => null);
      if (!vigente()) return;
      if (!r.ok) {
        setError(cuerpo?.error ?? "No se pudieron traer los reportes.");
        setDatos(null);
      } else {
        setDatos(cuerpo as Respuesta);
      }
    } catch {
      if (!vigente()) return;
      setError("No se pudieron traer los reportes. Revisá la conexión y volvé a probar.");
      setDatos(null);
    }
    setCargando(false);
  }, [mes]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-300">
          <button
            onClick={() => setMes(mesRelativo(mes, -1))}
            aria-label="Mes anterior"
            className="bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ‹
          </button>
          <span className="min-w-[9rem] border-x border-slate-300 bg-white px-3 py-1.5 text-center text-sm font-semibold capitalize text-slate-900">
            {nombreDelMes(mes)}
          </span>
          <button
            onClick={() => setMes(mesRelativo(mes, 1))}
            aria-label="Mes siguiente"
            className="bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ›
          </button>
        </div>
        <button
          onClick={() => setMes(hoyEnArgentina().slice(0, 7))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Este mes
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {cargando && !datos && <p className="text-sm text-slate-500">Cargando…</p>}

      {datos && (
        <div className={cargando ? "space-y-6 opacity-60" : "space-y-6"}>
          <Avisos avisos={datos.avisos} />
          {esCompleta(datos) ? (
            <>
              <MensualCompleto mensual={datos.mensual} mes={mes} />
              <Anual anual={datos.anual} mes={mes} />
              <Porcentual porcentual={datos.porcentual} mes={mes} />
            </>
          ) : (
            <MensualSoloTotales mensual={datos.mensual} mes={mes} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Los avisos van **arriba de los números y a la vista**, no al pie.
 *
 * El primero dice que el total incluye a todos los sectores y no la lista fija
 * de 17 que tenía la planilla, así que **no va a coincidir con ella**. Puesto en
 * letra chica al final, la conclusión natural de quien compare es que el
 * sistema está mal.
 *
 * Es un `div` común y no un `.card`: `.card` declara su `border` y las
 * utilidades de color al lado no se aplican.
 */
function Avisos({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null;
  return (
    <div role="note" className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
      {avisos.map((a) => (
        <p key={a}>{a}</p>
      ))}
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

/** Lo que explica cómo se cuenta, justo debajo del título y antes de la tabla. */
function Nota({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1 text-sm text-slate-600">{children}</div>;
}

const CELDA_SIN_DATO = <span className="text-slate-300">–</span>;

function Mensual({ mes, children }: { mes: string; children: React.ReactNode }) {
  return (
    <Seccion titulo={`Ausentismo por sector · ${nombreDelMes(mes)}`}>
      <Nota>
        <p>
          Días de ausencia del mes, contados de calendario —fines de semana incluidos— y repartidos entre
          los dos meses cuando una ausencia los cruza. Una tardanza cuenta como un día, igual que en la
          planilla; por eso estos números pueden no coincidir con lo que muestra «Quién no viene».
        </p>
      </Nota>
      {children}
    </Seccion>
  );
}

/**
 * El mensual de quien no pasa el control: cuánto se faltó en cada sector.
 *
 * Es lo que sí puede ver, no un reporte a medias: no hay ningún hueco ni cartel
 * donde estarían las demás columnas. La única frase sobre el resto es que el
 * detalle por motivo lo lleva RRHH.
 */
function MensualSoloTotales({ mensual, mes }: { mensual: ReportesRecortados["mensual"]; mes: string }) {
  return (
    <Mensual mes={mes}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-right">Días de ausencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mensual.filas.map((f) => (
                <tr key={f.sectorId ?? f.sector}>
                  <td className="px-3 py-2 text-slate-900">{f.sector}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {f.total === 0 ? CELDA_SIN_DATO : entero(f.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{entero(mensual.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-500">El detalle por motivo lo lleva RRHH.</p>
    </Mensual>
  );
}

/**
 * El mensual completo: sector × motivo. Las columnas salen del enum
 * (`TIPOS_AUSENCIA`) y no de las claves de lo que llegó: un motivo con cero
 * días no tiene clave, y un mes sin licencias dejaría de mostrar esa columna.
 */
function MensualCompleto({ mensual, mes }: { mensual: ReportesCompletos["mensual"]; mes: string }) {
  return (
    <Mensual mes={mes}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left uppercase">Sector</th>
                {TIPOS_AUSENCIA.map(([valor, etiqueta]) => (
                  <th key={valor} className="px-2 py-2 text-right align-bottom font-medium">{etiqueta}</th>
                ))}
                <th className="px-3 py-2 text-right align-bottom uppercase">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mensual.filas.map((f) => (
                <tr key={f.sectorId ?? f.sector}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-900">{f.sector}</td>
                  {TIPOS_AUSENCIA.map(([valor]) => (
                    <td key={valor} className="px-2 py-2 text-right tabular-nums text-slate-700">
                      {f.porMotivo[valor] ? entero(f.porMotivo[valor]) : CELDA_SIN_DATO}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {entero(f.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2">Total</td>
                {TIPOS_AUSENCIA.map(([valor]) => (
                  <td key={valor} className="px-2 py-2 text-right tabular-nums">
                    {mensual.totalPorMotivo[valor] ? entero(mensual.totalPorMotivo[valor]) : CELDA_SIN_DATO}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{entero(mensual.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Mensual>
  );
}

/**
 * Una explicación del más-de-100 por sección, **puesta donde se ve el número**.
 * No está topeado a propósito: un número tapado sería inventado, pero uno sin
 * explicar parece un error.
 */
function Anual({ anual, mes }: { anual: ReportesCompletos["anual"]; mes: string }) {
  const [soloQuienFalto, setSoloQuienFalto] = useState(false);
  const mesFinal = Number(mes.slice(5, 7));
  const habiles = anual.filas[0]?.habiles ?? 0;
  const filas = soloQuienFalto ? anual.filas.filter((f) => f.total > 0) : anual.filas;

  return (
    <Seccion titulo={`Ausentismo por persona · ${mes.slice(0, 4)}, hasta ${MESES[mesFinal - 1]}`}>
      <Nota>
        <p>
          Se divide por los <strong>{entero(habiles)} días hábiles acumulados de enero a {MESES[mesFinal - 1]}</strong>,
          no por los del año entero: los meses posteriores a {MESES[mesFinal - 1]} van sin dato y no entran en el
          total.
        </p>
        <p>
          <strong>El porcentual puede pasar de 100 % y no está topeado, a propósito.</strong> Arriba se cuentan
          días de calendario (fines de semana incluidos, para que los números que RRHH ya conoce no se muevan) y
          abajo sólo días hábiles: 141 días contra 120 hábiles da 117,5 %. Un número tapado sería inventado.
        </p>
        <p>
          Cada ausencia se cuenta entera en el mes en que empieza y sin el día de regreso, así que una de un solo
          día cuenta cero, igual que en la planilla. Por eso este total no coincide con el del mensual.
        </p>
      </Nota>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={soloQuienFalto}
          onChange={(e) => setSoloQuienFalto(e.target.checked)}
        />
        Sólo quienes tienen días en el período
      </label>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left uppercase">Persona</th>
                <th className="px-3 py-2 text-left uppercase">Sector</th>
                {MESES_CORTOS.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium">{m}</th>
                ))}
                <th className="px-3 py-2 text-right uppercase">Total</th>
                <th className="px-3 py-2 text-right uppercase">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f) => (
                <tr key={f.empleadoId}>
                  <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2 text-slate-900">{f.nombre}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{f.sector ?? "Sin sector"}</td>
                  {f.porMes.map((n, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums text-slate-700">
                      {i + 1 > mesFinal || n === 0 ? CELDA_SIN_DATO : entero(n)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{entero(f.total)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                    f.porcentual > 100 ? "font-semibold text-amber-700" : "text-slate-700"
                  }`}>
                    {pct(f.porcentual)}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={MESES_CORTOS.length + 4} className="px-3 py-6 text-center text-slate-400">
                    Nadie tiene días en el período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Seccion>
  );
}

function Porcentual({ porcentual, mes }: { porcentual: ReportesCompletos["porcentual"]; mes: string }) {
  return (
    <Seccion titulo={`Horas perdidas por sector · ${nombreDelMes(mes)}`}>
      <Nota>
        <p>
          Horas perdidas (8 por cada día de ausencia) sobre las horas a realizar del sector: el personal por las
          horas del mes —días hábiles y sábados, o las que RRHH fijó para ese sector—. El general es ponderado,
          no el promedio de los sectores.
        </p>
        <p>
          <strong>El porcentual puede pasar de 100 % y no está topeado, a propósito.</strong> Las horas perdidas
          salen de días de calendario (fines de semana incluidos) y las horas a realizar de días hábiles, así que
          alguien con una licencia larga puede sumar más horas perdidas que horas a realizar. Los valores
          que pasan de 100 % van resaltados; un número tapado sería inventado.
        </p>
      </Nota>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-right">Personal</th>
                <th className="px-3 py-2 text-right">Horas a realizar</th>
                <th className="px-3 py-2 text-right">Horas perdidas</th>
                <th className="px-3 py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {porcentual.filas.map((f) => (
                <tr key={f.sectorId ?? f.sector}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-900">{f.sector}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{entero(f.personal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{entero(f.horasARealizar)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{entero(f.horasPerdidas)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                    f.porcentual > 100 ? "font-semibold text-amber-700" : "text-slate-700"
                  }`}>
                    {pct(f.porcentual)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2">General</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {entero(porcentual.filas.reduce((s, f) => s + f.personal, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {entero(porcentual.filas.reduce((s, f) => s + f.horasARealizar, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {entero(porcentual.filas.reduce((s, f) => s + f.horasPerdidas, 0))}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                  porcentual.general > 100 ? "text-amber-700" : ""
                }`}>
                  {pct(porcentual.general)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Seccion>
  );
}
