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

function Tarjeta({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{rotulo}</div>
      <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-slate-500">{nota}</div>}
    </div>
  );
}

/**
 * Los cinco indicadores de un molino. Un `null` es "no hay con qué calcularlo"
 * y se escribe "—": un cero se leería como "el molino rindió cero".
 */
export function TarjetasDeIndicadores({ i }: { i: Indicadores }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Tarjeta rotulo="Toneladas" valor={formatoToneladas(i.toneladas)} nota="incluye las de turnos inconsistentes" />
      <Tarjeta rotulo="Horas de marcha" valor={`${num1.format(i.horasDeMarcha)} h`} />
      <Tarjeta rotulo="Horas no trabajadas" valor={`${num1.format(i.horasNoTrabajadas)} h`} />
      <Tarjeta rotulo="Utilización" valor={i.utilizacion === null ? "—" : pct1.format(i.utilizacion)} nota="marcha sobre teórica" />
      <Tarjeta rotulo="Productividad" valor={i.productividad === null ? "—" : `${num2.format(i.productividad)} t/h`} nota="por hora de marcha" />
    </div>
  );
}
