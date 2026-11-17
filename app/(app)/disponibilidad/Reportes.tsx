"use client";

import { Fragment, useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { hoyEnArgentina, mesRelativo } from "@/lib/core/fechas";
import { TIPOS_AUSENCIA, labelTipoAusencia } from "@/lib/rrhh/tiposAusencia";
import type { ReportesCompletos, ReportesRecortados } from "@/lib/rrhh/ausentismo/armarReportes";
import { filasPorSector, motivoQueManda, titularDelMes } from "@/lib/rrhh/ausentismo/resumenDelMes";

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

export default function Reportes({ personalPorSector }: { personalPorSector: Record<string, number> }) {
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
          {/*
           * El orden importa y es el cambio: el titular primero, los avisos
           * después y las tablas al final. Antes eran tres tablas seguidas sin
           * nada que dijera por dónde empezar.
           */}
          <Titular
            titular={titularDelMes(
              // El recortado no trae `porMotivo`; para el titular sólo hacen
              // falta los días, así que se completa con un objeto vacío.
              datos.mensual.filas.map((f) => ({
                sector: f.sector,
                sectorId: f.sectorId,
                total: f.total,
                porMotivo: "porMotivo" in f ? f.porMotivo : {},
              })),
              datos.mensual.total,
              esCompleta(datos) ? datos.porcentual.general : null
            )}
            mes={mes}
          />
          <Avisos avisos={datos.avisos} />
          <PorSector
            filas={filasPorSector(
              datos.mensual.filas.map((f) => ({
                sector: f.sector,
                sectorId: f.sectorId,
                total: f.total,
                porMotivo: "porMotivo" in f ? f.porMotivo : {},
              })),
              esCompleta(datos) ? datos.porcentual.filas : null,
              personalPorSector
            )}
            totalDias={datos.mensual.total}
            mes={mes}
            conMotivos={esCompleta(datos)}
          />
          {esCompleta(datos) && <Anual anual={datos.anual} mes={mes} />}
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


/**
 * El titular: cómo fue el mes, en una frase, antes de cualquier tabla.
 *
 * Existe porque tres tablas seguidas no dicen por dónde empezar. La frase de la
 * concentración —«dos sectores son el 78 % del mes»— es la que convierte una
 * lista en algo que se entiende de un vistazo, y sale de los datos: no hay
 * ningún texto escrito a mano acá.
 *
 * Sin porcentual —quien no pasa el control— el titular sale igual, encabezado
 * por los días. No se deja un hueco ni se dice que falta algo.
 */
function Titular({ titular, mes }: { titular: ReturnType<typeof titularDelMes>; mes: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-bold leading-none text-slate-900">
          {titular.porcentual !== null ? pct(titular.porcentual) : entero(titular.dias)}
        </span>
        <span className="text-sm text-slate-600">
          {titular.porcentual !== null ? (
            <>
              de ausentismo en <strong>{nombreDelMes(mes)}</strong> · {entero(titular.dias)} días perdidos
            </>
          ) : (
            <>
              días de ausencia en <strong>{nombreDelMes(mes)}</strong>
            </>
          )}
        </span>
      </div>

      {titular.lider && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
          <strong className="text-slate-900">{titular.lider.sector}</strong> concentra{" "}
          <strong className="text-slate-900">
            {entero(titular.lider.dias)} de los {entero(titular.dias)} días
          </strong>
          {titular.dosPrimeros !== null && (
            <>
              {" "}
              y, con el segundo, suman el{" "}
              <strong className="text-slate-900">{pct(titular.dosPrimeros)}</strong> del mes
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}

/**
 * Una tabla por sector, con los días y el porcentual juntos.
 *
 * REEMPLAZA A DOS TABLAS QUE ESTABAN SEPARADAS y contestaban la misma pregunta.
 * El porqué está en `filasPorSector`: juntas muestran que **el orden cambia**
 * —un sector de 2 personas con 7 días está peor que uno de 11 con 35— y eso
 * separadas no lo veía nadie.
 *
 * **Los sectores sin ausencias no se dibujan**, pero se pueden desplegar: en
 * octubre de 2026 eran 7 de 15 filas en cero. Lo que NO se esconde son los
 * motivos: el detalle de una fila lista **los doce**, con sus ceros, porque que
 * un mes sin licencias no haga desaparecer esa columna es una decisión tomada
 * a propósito y escrita en `reportes.ts`.
 */
function PorSector({
  filas,
  totalDias,
  mes,
  conMotivos,
}: {
  filas: ReturnType<typeof filasPorSector>;
  totalDias: number;
  mes: string;
  /** Quien no pasa el control ve los días y la dotación, nunca el motivo ni el %. */
  conMotivos: boolean;
}) {
  const [verTodos, setVerTodos] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);

  const conDias = filas.filter((f) => f.dias > 0);
  const enCero = filas.length - conDias.length;
  const visibles = verTodos ? filas : conDias;

  return (
    <Seccion titulo={`Por sector · ${nombreDelMes(mes)}`}>
      <Nota>
        <p>
          Días de ausencia contados de calendario —fines de semana incluidos— y repartidos entre los dos meses
          cuando una ausencia los cruza. Una tardanza cuenta como un día, igual que en la planilla; por eso
          estos números pueden no coincidir con lo que muestra «Quién no viene».
        </p>
        {conMotivos && (
          <p>
            El <strong>%</strong> son las horas perdidas (8 por día de ausencia) sobre las horas a realizar del
            sector. <strong>Puede pasar de 100 % y no está topeado, a propósito:</strong> las horas perdidas
            salen de días de calendario y las horas a realizar de días hábiles, así que una licencia larga puede
            sumar más de lo que había para trabajar. Los valores que pasan de 100 % van resaltados; un número
            tapado sería inventado.
          </p>
        )}
      </Nota>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Sector</th>
                <th className="px-3 py-2 text-right">Gente</th>
                <th className="px-3 py-2 text-right">Días</th>
                {conMotivos && <th className="px-3 py-2 text-right">%</th>}
                {conMotivos && <th className="px-3 py-2 text-left">Motivo que manda</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((f) => {
                const clave = f.sectorId ?? f.sector;
                const manda = motivoQueManda(f.porMotivo);
                const estaAbierto = abierto === clave;
                return (
                  <Fragment key={clave}>
                    <tr
                      className={conMotivos && f.dias > 0 ? "cursor-pointer hover:bg-slate-50" : undefined}
                      onClick={
                        conMotivos && f.dias > 0 ? () => setAbierto(estaAbierto ? null : clave) : undefined
                      }
                    >
                      <td className="px-3 py-2 text-slate-900">
                        {conMotivos && f.dias > 0 && (
                          <span className="mr-1 inline-block w-3 text-slate-400">{estaAbierto ? "▾" : "▸"}</span>
                        )}
                        {f.sector}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {f.personal === null ? CELDA_SIN_DATO : entero(f.personal)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                        {f.dias === 0 ? CELDA_SIN_DATO : entero(f.dias)}
                      </td>
                      {conMotivos && (
                        <td
                          className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                            f.porcentual === null
                              ? ""
                              : f.porcentual > 100
                                ? "font-semibold text-amber-700"
                                : "font-medium text-slate-900"
                          }`}
                        >
                          {f.porcentual === null ? CELDA_SIN_DATO : pct(f.porcentual)}
                        </td>
                      )}
                      {conMotivos && (
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {manda.length === 0
                            ? CELDA_SIN_DATO
                            : manda.map((m) => `${labelTipoAusencia(m.tipo)} ${m.dias}`).join(" · ")}
                        </td>
                      )}
                    </tr>
                    {conMotivos && estaAbierto && (
                      <tr className="bg-slate-50">
                        <td colSpan={5} className="px-3 py-2">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 lg:grid-cols-4">
                            {TIPOS_AUSENCIA.map(([valor, etiqueta]) => {
                              const dias = f.porMotivo[valor] ?? 0;
                              return (
                                <div key={valor} className="flex justify-between gap-2">
                                  <span className={dias === 0 ? "text-slate-400" : "text-slate-700"}>
                                    {etiqueta}
                                  </span>
                                  <span
                                    className={`tabular-nums ${dias === 0 ? "text-slate-300" : "font-medium text-slate-900"}`}
                                  >
                                    {dias === 0 ? "–" : entero(dias)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t border-slate-300 bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{entero(totalDias)}</td>
                {conMotivos && <td className="px-3 py-2" />}
                {conMotivos && <td className="px-3 py-2" />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {enCero > 0 && (
        <button type="button" className="btn-ghost text-xs" onClick={() => setVerTodos(!verTodos)}>
          {verTodos
            ? `Ocultar los ${enCero} sectores sin ausencias`
            : `Ver también los ${enCero} ${enCero === 1 ? "sector" : "sectores"} sin ausencias`}
        </button>
      )}

      {!conMotivos && <p className="text-xs text-slate-500">El detalle por motivo lo lleva RRHH.</p>}
    </Seccion>
  );
}


/**
 * Una explicación del más-de-100 por sección, **puesta donde se ve el número**.
 * No está topeado a propósito: un número tapado sería inventado, pero uno sin
 * explicar parece un error.
 */
function Anual({ anual, mes }: { anual: ReportesCompletos["anual"]; mes: string }) {
  // Arranca en true: de las 71 filas del anual, 40 estaban en cero en octubre
  // de 2026. Mostrar 71 renglones de los que 40 no dicen nada es la misma
  // chatura que se vino a arreglar; las otras 40 siguen a un clic.
  const [soloQuienFalto, setSoloQuienFalto] = useState(true);
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
