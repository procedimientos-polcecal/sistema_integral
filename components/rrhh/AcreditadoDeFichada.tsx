import { textoAcreditado, type Acreditado, type CalculoDelDiaLeido } from "@/lib/rrhh/fichadas/acreditado";

/**
 * Lo que se acredita de una marcación, para mostrar junto a la marca real.
 *
 * El rango sólo aparece cuando difiere de la marca: repetirlo cuando coincide
 * es ruido. La tardanza, el retiro anticipado y las horas fijadas a mano no se
 * deducen acá: las dice `calculos_diarios` (ver `lib/rrhh/fichadas/acreditado`).
 * Un día que todavía no se calculó se avisa aparte, porque no es lo mismo que
 * un día sin tardanza.
 */
export default function AcreditadoDeFichada({
  acreditado,
  calculo,
  prefijo,
}: {
  acreditado: Acreditado;
  calculo: CalculoDelDiaLeido;
  prefijo?: string;
}) {
  const t = textoAcreditado(acreditado, calculo);

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {t.sinSalida ? (
        <span className="text-slate-400" title="Una marcación sin salida no suma horas: hay que completarla.">
          Sin salida: no acredita horas
        </span>
      ) : t.horasFijadasAMano ? (
        <span
          className="text-slate-800"
          title="RRHH fijó las horas de este día a mano: se liquidan esas y no lo que acreditaría el cálculo automático."
        >
          {prefijo}
          {t.horas} (fijadas a mano)
        </span>
      ) : t.rango ? (
        <span
          className="text-slate-800"
          title="El motor acredita desde el horario del turno porque la marca cayó dentro del margen de tolerancia."
        >
          {prefijo}
          {t.rango} · {t.horas}
        </span>
      ) : t.horas ? (
        <span className="text-slate-400" title="La marca ya coincide con lo que se acredita.">
          {prefijo}
          {t.horas}
        </span>
      ) : null}
      {t.tardanza && (
        <span
          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 whitespace-nowrap"
          title="Llegó fuera del margen del turno: se acredita desde la hora que fichó y no desde el horario pactado."
        >
          Tardanza
        </span>
      )}
      {t.retiroAnticipado && (
        <span
          className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 whitespace-nowrap"
          title="Se fue fuera del margen del turno: se acredita hasta la hora que fichó y no hasta el horario pactado."
        >
          Retiro anticipado
        </span>
      )}
      {t.diaSinCalcular && (
        <span
          className="text-[11px] italic text-slate-400"
          title="Este día todavía no se recalculó: no se sabe si hubo tardanza o retiro anticipado, ni qué horas se liquidan."
        >
          día sin calcular
        </span>
      )}
    </span>
  );
}
