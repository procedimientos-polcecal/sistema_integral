"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/InfoTip";
import { comoSeLee, hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import {
  comoSeLeeElTurnoDelRobot,
  leyendaDeUnTurnoCubierto,
  leyendaDelEstado,
  minutosComoSeLee,
} from "@/lib/produccion/molinos/formato";
import type { CasillaDelDia } from "@/lib/produccion/molinos/consultas";
import { INFO_TURNO_DEL_ROBOT, InsigniaDeEstado, TarjetasDeIndicadores, formatoToneladas } from "./Piezas";
import type { MolinoDelDia } from "./page";

/**
 * Los `(i)` de los encabezados. El respaldo de cada uno está en
 * `docs/INFOTIPS.md`; salen de `docs/PRODUCCION.md`, sección «Los molinos».
 */
const INFO_PARADA =
  "Lo que le falta a la marcha para llegar a la duración teórica del corte (4 horas los de 20 a 24 y de 00 a 04, 8 horas los otros dos; la de toda la racha si es un acumulado). No se carga: se despeja. Un turno que el robot no informó, o inconsistente, muestra «—» porque sus horas no se afirman.";
const INFO_ESTADO =
  "Sin informar quiere decir que no hay dato de ese turno, así que no cuenta como parada ni entra en ningún indicador. Lo normal es verlo en el día en curso, porque el archivo del robot se corta a las 9:00.";

function fechaLegible(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00`).toLocaleDateString("es-AR", { weekday: "long" });
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${comoSeLee(fecha)}`;
}

/**
 * Lo que midió el PC Robot en cada molino un día.
 *
 * El punto de la pantalla es que **cada cosa rara se ve por lo que es** y nada
 * se esconde ni se promedia: un acumulado lleva su teórica de racha, un
 * inconsistente se ve con sus horas tachadas pero con sus toneladas, un turno
 * que el robot no informó dice que no es una parada, y un día en que la planta
 * no trabajó es un cartel y no cuatro renglones en cero. La aritmética viene
 * resuelta de `indicadoresDe`; acá sólo se despliega.
 */
export default function MolinosClient({ fecha, molinos }: { fecha: string; molinos: MolinoDelDia[] }) {
  const router = useRouter();
  const hoy = hoyEnArgentina();

  return (
    <div className="mx-auto max-w-5xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Molinos</h1>
        <p className="text-sm text-slate-500">
          Lo que midió el PC Robot en cada molino, turno por turno. No es el parte de fábrica de{" "}
          <Link href="/produccion/dia" className="underline">El día</Link>: aquel cuenta producto terminado y esto
          cuenta lo que se muele.
        </p>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <Link
          href={`/produccion/molinos?fecha=${sumarDias(fecha, -1)}`}
          aria-label="Día anterior"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Anterior
        </Link>
        <div className="text-center">
          <div className="text-base font-semibold text-slate-900">{fechaLegible(fecha)}</div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
            <input
              type="date"
              aria-label="Ir a un día"
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={fecha}
              onChange={(e) => e.target.value && router.push(`/produccion/molinos?fecha=${e.target.value}`)}
            />
            {fecha !== hoy && (
              <Link href="/produccion/molinos" className="text-xs font-medium text-[var(--primary)] hover:underline">
                Ir a hoy
              </Link>
            )}
            <Link
              href={`/produccion/molinos/mes?mes=${fecha.slice(0, 7)}`}
              className="text-xs font-medium text-[var(--primary)] hover:underline"
            >
              Ver el mes
            </Link>
          </div>
        </div>
        <Link
          href={`/produccion/molinos?fecha=${sumarDias(fecha, 1)}`}
          aria-label="Día siguiente"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Siguiente →
        </Link>
      </div>

      {molinos.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">No hay ningún molino activo en el catálogo.</div>
      )}

      {molinos.map((m) => (
        <section key={m.id} className="space-y-3">
          <h2 className="section-title">{m.nombre}</h2>
          {m.dia.condicion === "no_operativo" && (
            <div className="card border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
              <strong>Día no operativo.</strong> El robot no informó ningún turno del {m.nombre} este día: la planta no
              trabajó. No se cuenta como una parada ni como cuatro turnos en cero, y no entra en las horas ni en la
              utilización.
            </div>
          )}
          {m.dia.condicion === "sin_datos" && (
            <div className="card p-4 text-sm text-slate-600">
              Todavía no hay datos del robot para este día en el {m.nombre}: es anterior al primer día que se importó, o
              posterior al último. No quiere decir que la planta no haya trabajado.
            </div>
          )}
          {m.dia.condicion === "con_datos" && m.dia.indicadores && (
            <>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">
                          Turno del robot
                          <InfoTip text={INFO_TURNO_DEL_ROBOT} className="ml-1" />
                        </th>
                        <th className="px-3 py-2 text-right">Toneladas</th>
                        <th className="px-3 py-2 text-right">Marcha</th>
                        <th className="px-3 py-2 text-right">
                          Parada
                          <InfoTip text={INFO_PARADA} className="ml-1" />
                        </th>
                        <th className="px-3 py-2 text-left">
                          Estado
                          <InfoTip text={INFO_ESTADO} className="ml-1" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {m.dia.casillas.map((c) => (
                        <FilaDelTurno key={c.turno} c={c} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <TarjetasDeIndicadores i={m.dia.indicadores} />
            </>
          )}
        </section>
      ))}
    </div>
  );
}

function FilaDelTurno({ c }: { c: CasillaDelDia }) {
  const nombre = comoSeLeeElTurnoDelRobot(c.turno);
  const dato = c.dato;

  // Sin renglón propio: lo cubrió un acumulado posterior.
  if (!dato) {
    return (
      <>
        <tr className="bg-slate-50/60">
          <td className="px-3 py-2 font-medium text-slate-700">{nombre}</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2"><span className="text-xs text-slate-500">Cubierto</span></td>
        </tr>
        <Leyenda texto={leyendaDeUnTurnoCubierto(c.cubiertoPor?.fecha ?? null, c.cubiertoPor?.turno ?? null)} />
      </>
    );
  }

  const leyenda = leyendaDelEstado(dato.estado, dato);

  if (dato.estado === "huerfano") {
    return (
      <>
        <tr>
          <td className="px-3 py-2 font-medium text-slate-700">{nombre}</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2 text-right text-slate-400">—</td>
          <td className="px-3 py-2"><InsigniaDeEstado estado="huerfano" /></td>
        </tr>
        {leyenda && <Leyenda texto={leyenda} />}
      </>
    );
  }

  const inconsistente = dato.estado === "inconsistente";
  return (
    <>
      <tr>
        <td className="px-3 py-2 font-medium text-slate-900">{nombre}</td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatoToneladas(dato.kg / 1000)}</td>
        {/* Las horas de un inconsistente no se afirman: se muestra lo que dijo el robot, tachado. */}
        <td className={`px-3 py-2 text-right font-mono tabular-nums ${inconsistente ? "text-slate-400 line-through" : ""}`}>
          {minutosComoSeLee(dato.minutosMarcha)}
        </td>
        <td className="px-3 py-2 text-right font-mono tabular-nums">
          {inconsistente ? <span className="text-slate-400">—</span> : minutosComoSeLee(dato.minutosTeoricos - dato.minutosMarcha)}
        </td>
        <td className="px-3 py-2"><InsigniaDeEstado estado={dato.estado} /></td>
      </tr>
      {leyenda && <Leyenda texto={leyenda} />}
    </>
  );
}

function Leyenda({ texto }: { texto: string }) {
  return (
    <tr>
      <td colSpan={5} className="bg-slate-50 px-3 py-1.5 text-xs text-slate-600">{texto}</td>
    </tr>
  );
}
