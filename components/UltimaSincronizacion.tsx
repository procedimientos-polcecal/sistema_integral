import { haceCuanto } from "@/lib/core/haceCuanto";
import { fechaHora } from "@/lib/compras/constants";

/**
 * Cuándo se actualizó por última vez lo que espeja una planilla.
 *
 * Sin esto, quien mira no puede distinguir "no hay nada" de "todavía no llegó".
 * Y si la última corrida falló, la pantalla se ve exactamente igual que si
 * hubiera salido bien: por eso el error se dice, no se deduce de una fecha
 * vieja.
 *
 * El "hace 3 horas" es para leer de un vistazo; la fecha exacta queda en el
 * title, para cuando alguien necesita el dato preciso.
 */
export default function UltimaSincronizacion({
  cuando, ok = true, error, que = "Actualizado",
}: {
  cuando: string | null | undefined;
  ok?: boolean;
  error?: string | null;
  /** Cómo se lo nombra. Por defecto "Actualizado hace…". */
  que?: string;
}) {
  if (!cuando) {
    return <span className="text-xs text-slate-400">Sin sincronizar todavía</span>;
  }

  if (!ok) {
    return (
      <span
        className="text-xs font-semibold text-red-600"
        title={error ?? undefined}
      >
        La última actualización falló · {haceCuanto(cuando)}
      </span>
    );
  }

  return (
    <span className="text-xs text-slate-400" title={fechaHora(cuando)}>
      {que} {haceCuanto(cuando)}
    </span>
  );
}
