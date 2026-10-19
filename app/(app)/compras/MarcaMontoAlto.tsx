import { esMontoAlto, porQueEsAlto, type MarcaManual } from "@/lib/compras/montoAlto";

/**
 * La marca de «Monto alto» de una fila del listado.
 *
 * Dice la palabra y no sólo un color: es una marca que se lee con el listado
 * mirado de lejos, y el color solo no le sirve a quien no distingue ámbar de
 * gris. El motivo va en el `title` —por el monto, o porque lo marcó una
 * persona— para que quien se pregunte «¿por qué éste?» lo encuentre sin entrar
 * a la ficha.
 *
 * Sólo se pinta cuando es alto. Lo desmarcado a mano no lleva marca en el
 * listado —no hay nada que avisar—; se revisa con el filtro y en la ficha.
 */
export default function MarcaMontoAlto({
  montoConocido, manual, umbral, className = "",
}: {
  montoConocido: number | null;
  manual: MarcaManual;
  umbral: number;
  /** Para separarla de lo que tiene arriba sin dejar un hueco cuando no se pinta. */
  className?: string;
}) {
  if (!esMontoAlto(montoConocido, manual, umbral)) return null;

  return (
    <span
      title={porQueEsAlto(montoConocido, manual, umbral) ?? undefined}
      className={`inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ${className}`}
    >
      Monto alto
    </span>
  );
}
