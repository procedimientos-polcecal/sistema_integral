import InfoTip from "@/components/InfoTip";
import type { EstadoDeTurno } from "@/lib/produccion/molinos/types";
import type { Indicadores } from "@/lib/produccion/molinos/indicadores";

const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 1 });

export const formatoToneladas = (t: number) => `${num1.format(t)} t`;
export const formatoEntero = (n: number) => num0.format(n);

/** Los tres estados que no son normales, cada uno con su color: se distinguen de un vistazo. */
const ESTILO_DEL_ESTADO: Record<Exclude<EstadoDeTurno, "normal">, { texto: string; clase: string }> = {
  acumulado: { texto: "Acumulado", clase: "border-sky-200 bg-sky-50 text-sky-800" },
  inconsistente: { texto: "Inconsistente", clase: "border-amber-300 bg-amber-50 text-amber-800" },
  huerfano: { texto: "Sin informar", clase: "border-slate-300 bg-slate-100 text-slate-600" },
};

export function InsigniaDeEstado({ estado }: { estado: EstadoDeTurno }) {
  if (estado === "normal") return <span className="text-xs text-slate-500">Normal</span>;
  const e = ESTILO_DEL_ESTADO[estado];
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>
  );
}

function Tarjeta({ rotulo, valor, nota, info }: { rotulo: string; valor: string; nota?: string; info?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {rotulo}
        {info && <InfoTip text={info} className="ml-1" />}
      </div>
      <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-slate-500">{nota}</div>}
    </div>
  );
}

/**
 * Lo que cada `(i)` de las tarjetas afirma sale de `docs/PRODUCCION.md`, sección
 * «Los molinos», y del encabezado de `indicadores.ts`; el registro con el
 * respaldo de cada texto está en `docs/INFOTIPS.md`.
 */
export const INFO_TURNO_DEL_ROBOT =
  "Son los cuatro cortes del contador del robot (20 a 24, 00 a 04, 04 a 12 y 12 a 20), no los dos turnos del parte de fábrica: comparten horas de reloj pero no son lo mismo. El robot cuenta la piedra que entra al molino y el parte cuenta producto terminado, así que las toneladas del robot y las del parte no se suman ni se restan. Los cortes de 20 a 24 y de 00 a 04 sólo existen en el robot.";
const INFO_TONELADAS =
  "La etiqueta MATERIAL del robot sólo es confiable cuando el turno molió un material, y en Filler 1 hay turnos que molieron dos. Por eso no se guarda y ninguna pantalla muestra toneladas por material (el reparto correcto sí se guarda). En una medición de octubre de 2026, usarla dejaba el 11,3 % de las toneladas de ese molino en el material equivocado.";
const INFO_NO_TRABAJADAS =
  "No se cargan: salen de restar la marcha a la duración teórica de cada turno. Un día sin ninguna fila se toma como planta cerrada y no suma horas, pero sólo si queda entre el primer y el último día con datos del molino; fuera de ese rango es «sin datos». Un turno en cero dentro de un día con filas sí cuenta como parada. Quedan afuera los turnos inconsistentes y los que el robot no informó.";
const INFO_UTILIZACION =
  "Horas de marcha sobre horas teóricas de los mismos turnos que cuentan. Marcar un día como «planta parada» en Paradas sin explicar no la cambia: sólo saca esos turnos de la cola de lo que falta explicar. Da «—», y no cero, si no hay horas teóricas con qué calcularla.";
const INFO_PRODUCTIVIDAD =
  "Toneladas sobre horas de marcha. Las toneladas cuentan las de los turnos inconsistentes y las horas no, a propósito: las toneladas las midió una balanza y lo que falla en esos turnos es el reloj del robot. Da «—», y no cero, si no hubo horas de marcha.";

/**
 * Los cinco indicadores de un molino. Un `null` es "no hay con qué calcularlo"
 * y se escribe "—": un cero se leería como "el molino rindió cero".
 */
export function TarjetasDeIndicadores({ i }: { i: Indicadores }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Tarjeta rotulo="Toneladas" valor={formatoToneladas(i.toneladas)} nota="incluye las de turnos inconsistentes" info={INFO_TONELADAS} />
      <Tarjeta rotulo="Horas de marcha" valor={`${num1.format(i.horasDeMarcha)} h`} />
      <Tarjeta rotulo="Horas no trabajadas" valor={`${num1.format(i.horasNoTrabajadas)} h`} info={INFO_NO_TRABAJADAS} />
      <Tarjeta rotulo="Utilización" valor={i.utilizacion === null ? "—" : pct1.format(i.utilizacion)} nota="marcha sobre teórica" info={INFO_UTILIZACION} />
      <Tarjeta rotulo="Productividad" valor={i.productividad === null ? "—" : `${num2.format(i.productividad)} t/h`} nota="por hora de marcha" info={INFO_PRODUCTIVIDAD} />
    </div>
  );
}
