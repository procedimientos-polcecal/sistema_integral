"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import InfoTip from "@/components/InfoTip";
import {
  DIAS_RECIENTE,
  PLAZOS,
  VENTANA_DIAS,
  type FilaMtbf,
  type RitmoCambiado,
} from "@/lib/mantenimiento/mtbf";
import {
  conComa,
  DIAS_DE_CALENDARIO,
  diasCorridos,
  fallasAntesDelGrafico,
  fechaCorta,
  porcentajeDeConfiabilidad,
  type ConfiabilidadDeLaFicha,
} from "@/lib/mantenimiento/mtbfVista";

/**
 * `recharts` aparte, como en el tablero: son ~350 KB y no tienen por qué
 * demorar el primer pintado de la ficha. `ssr: false` porque miden el contenedor.
 */
const FallasPorMes = dynamic(
  () => import("../../GraficosMantenimiento").then((m) => m.FallasPorMes),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-slate-100" /> }
);

export type ConfiabilidadProps = ConfiabilidadDeLaFicha;

/**
 * Cada cuánto falla este equipo.
 *
 * Cuatro estados que dicen cosas distintas, y por eso no se juntan: el equipo que
 * no falló (el MTBF es "más que lo observado"), el que falló pero con tan poca
 * historia que el número todavía no se publica, el normal, y el que no se pudo
 * calcular porque la lectura falló. Este último **nunca** se pinta como "sin
 * fallas": sería decirle a quien mira que la máquina anda bien sin saberlo.
 *
 * El aviso de ritmo cambiado es la mitad del valor de la tarjeta. El MTBF es el
 * de toda la ventana, y una máquina que venía fallando cada dos días y hace tres
 * meses falla una vez al mes muestra un número que ya no la describe: sin el
 * aviso, quien lo lee manda gente a intervenir algo que ya se arregló.
 *
 * El gráfico cubre 12 meses calendario y las fallas, los últimos 365 días, que
 * arrancan a mitad de un mes: la suma de las barras puede ser menor que la
 * cantidad de fallas, y no se presentan como el mismo total.
 */
export default function ConfiabilidadDelEquipo(props: ConfiabilidadProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          Confiabilidad de este equipo
          <InfoTip text="Tiempo medio entre fallas: los días observados divididos por la cantidad de fallas correctivas del equipo. 'Llega a N d' es la probabilidad de aguantar N días sin una correctiva, suponiendo que la tasa de falla es constante." />
        </h2>
        <Link href="/mantenimiento/mtbf" className="text-xs text-blue-500 hover:underline">
          Ver todos los equipos →
        </Link>
      </div>

      <div className="card overflow-hidden">
        <Cuerpo {...props} />

        <div className="border-t border-slate-100 bg-amber-50 px-4 py-3 text-xs text-amber-900 space-y-1">
          <p>
            <strong>{DIAS_DE_CALENDARIO.titulo}</strong> {DIAS_DE_CALENDARIO.detalle}
          </p>
          <p>Las probabilidades suponen una tasa de falla constante.</p>
        </div>
      </div>
    </section>
  );
}

function Cuerpo(props: ConfiabilidadProps) {
  if (!props.disponible) return <NoDisponible />;
  const { fila, diasObservados, mesEnCurso } = props;
  if (fila === null) return <SinFallas diasObservados={diasObservados} />;
  if (fila.mtbf === null) return <SinHistoria fila={fila} diasObservados={diasObservados} />;
  return <ConNumero fila={fila} mesEnCurso={mesEnCurso} diasObservados={diasObservados} />;
}

/**
 * La lectura de las órdenes falló. No hay número y tampoco hay "sin fallas":
 * se dice que no se pudo calcular y se manda a mirar las OT del equipo, que
 * están más abajo en la misma ficha.
 */
function NoDisponible() {
  return (
    <div className="px-4 py-4 space-y-1" role="status">
      <p className="text-sm font-semibold text-slate-800">No se pudo calcular la confiabilidad.</p>
      <p className="text-sm text-slate-500">
        Esto no quiere decir que el equipo no haya fallado. Recargá la página y, si sigue igual,
        revisá sus órdenes de trabajo más abajo.
      </p>
    </div>
  );
}

function SinFallas({ diasObservados }: { diasObservados: number }) {
  return (
    <div className="px-4 py-4">
      <p className="text-sm text-slate-600">
        Sin fallas correctivas en los últimos {VENTANA_DIAS} días.
      </p>
      {diasObservados > 0 && (
        <p className="mt-1 text-2xl font-bold text-slate-900">
          MTBF &gt; {diasObservados} d
          <span className="ml-2 text-sm font-normal text-slate-500">
            no falló en lo que se observó
          </span>
        </p>
      )}
    </div>
  );
}

function SinHistoria({ fila, diasObservados }: { fila: FilaMtbf; diasObservados: number }) {
  return (
    <div className="px-4 py-4 space-y-2">
      <p className="text-sm text-slate-700">
        Todavía no hay suficiente historia para publicar el MTBF: se observaron apenas {diasObservados}{" "}
        días.
      </p>
      <p className="text-sm text-slate-500">
        {fila.fallas} {fila.fallas === 1 ? "falla" : "fallas"} · la última el {fechaCorta(fila.ultima)}
      </p>
    </div>
  );
}

function ConNumero({
  fila, mesEnCurso, diasObservados,
}: { fila: FilaMtbf; mesEnCurso: string; diasObservados: number }) {
  // Hoy da 0 y alrededor del 1/12/2026 empieza a dar hasta un mes de fallas.
  const antesDelGrafico = fallasAntesDelGrafico(fila);

  return (
    <div className="px-4 py-4 space-y-4">
      {fila.ritmo && <AvisoDeRitmo ritmo={fila.ritmo} mtbf={fila.mtbf} />}

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-xs text-slate-500">MTBF</p>
          <p className="text-3xl font-bold text-slate-900">{diasCorridos(fila.mtbf)}</p>
        </div>
        {PLAZOS.map((dias, i) => (
          <div key={dias}>
            <p className="text-xs text-slate-500">Llega a {dias} d</p>
            <p className="text-xl font-semibold text-slate-800">
              {porcentajeDeConfiabilidad(fila.confiabilidades[i] ?? null)}
            </p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs text-slate-500 mb-1">
          Fallas por mes · el último mes está incompleto
        </p>
        <div className="h-[170px]">
          <FallasPorMes datos={fila.porMes} mesEnCurso={mesEnCurso} />
        </div>
        {antesDelGrafico > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            {antesDelGrafico === 1
              ? "Una falla queda antes del primer mes del gráfico"
              : `${antesDelGrafico} fallas quedan antes del primer mes del gráfico`}
            : las barras son 12 meses calendario y la ventana son {VENTANA_DIAS} días, así que
            suman {fila.fallas - antesDelGrafico} y no {fila.fallas}.
          </p>
        )}
      </div>

      <p className="text-sm text-slate-600">
        <strong>{fila.fallas}</strong> {fila.fallas === 1 ? "falla" : "fallas"} en {diasObservados} días
        {" · "}la última el {fechaCorta(fila.ultima)}
        {" · "}
        {fila.porEspecialidad.map((e) => `${e.especialidad} ${e.cantidad}`).join(", ")}
      </p>
    </div>
  );
}

/**
 * Lo que dice el número reciente y para dónde cambió. Quien llega acá con el
 * MTBF de la ventana en la cabeza tiene que enterarse antes de leerlo.
 */
function AvisoDeRitmo({ ritmo, mtbf }: { ritmo: RitmoCambiado; mtbf: number | null }) {
  const mejoro = ritmo.direccion === "mejoro";
  const color = mejoro
    ? "border-green-200 bg-green-50 text-green-900"
    : "border-red-200 bg-red-50 text-red-900";

  let detalle: string;
  if (ritmo.mtbfReciente === null || ritmo.factor === null) {
    detalle = `No falló en los últimos ${DIAS_RECIENTE} días: el MTBF de toda la ventana describe cómo era, no cómo está.`;
  } else if (mejoro) {
    detalle = `En los últimos ${DIAS_RECIENTE} días el MTBF fue de ${diasCorridos(ritmo.mtbfReciente)}, contra ${diasCorridos(mtbf)} de toda la ventana: las fallas están ${conComa(ritmo.factor, 1)} veces más espaciadas.`;
  } else {
    detalle = `En los últimos ${DIAS_RECIENTE} días el MTBF fue de ${diasCorridos(ritmo.mtbfReciente)}, contra ${diasCorridos(mtbf)} de toda la ventana: falla ${conComa(1 / ritmo.factor, 1)} veces más seguido.`;
  }

  return (
    <div role="status" className={`rounded-lg border px-3 py-2 text-sm ${color}`}>
      <p className="font-semibold">{mejoro ? "Mejoró su ritmo" : "Empeoró su ritmo"}</p>
      <p>{detalle}</p>
    </div>
  );
}
