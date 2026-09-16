import type { TipoDeMovimiento } from "./types";

/**
 * El día desde el cual el libro distingue vegetal de residual.
 *
 * Antes de esta fecha las columnas `VEGETAL` y `RESIDUAL` de la planilla están
 * vacías: había un solo saldo. Los movimientos importados de antes llevan
 * `carbon = 'sin_separar'`, y un CHECK en la base impide que ese valor aparezca
 * con fecha posterior.
 */
export const CORTE_DE_LOS_TIPOS = "2025-12-15";

/** Tres decimales, que es `numeric(12,3)` en la base. */
function aTresDecimales(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface EfectoEnElSaldo {
  /** Con signo: exactamente lo que va a la columna `toneladas`. */
  toneladas: number | null;
  problema: string | null;
}

/**
 * De lo que una persona tipea al número con signo que se guarda.
 *
 * **El signo va guardado, no despejado.** Con eso el saldo es `SUM(toneladas)`
 * y no hay consulta que pueda calcularlo mal; la alternativa —guardar todo
 * positivo y aplicar el signo al leer— pone la regla en cada consulta, y la
 * consulta que se olvida es la que nadie mira.
 *
 * Esta función es el espejo exacto del CHECK `calidad_mov_signo`. Si una
 * cambia, la otra también.
 *
 * El consumo **se carga en positivo**: nadie escribe "menos treinta y siete
 * toneladas" cuando anota lo que se quemó. El ajuste sí se carga con su signo,
 * porque puede ser en más o en menos y esa es toda su gracia.
 */
export function efectoEnElSaldo(tipo: TipoDeMovimiento, tipeado: number): EfectoEnElSaldo {
  if (!Number.isFinite(tipeado)) {
    return { toneladas: null, problema: "Las toneladas tienen que ser un número." };
  }

  const n = aTresDecimales(tipeado);

  if (tipo === "entrada") {
    return n > 0
      ? { toneladas: n, problema: null }
      : { toneladas: null, problema: "Una entrada tiene que ser mayor que cero." };
  }

  if (tipo === "consumo") {
    return n > 0
      ? { toneladas: -n, problema: null }
      : {
          toneladas: null,
          problema:
            "El consumo se carga en positivo: es lo que se quemó. Si querés sumar stock, es un ajuste.",
        };
  }

  return n !== 0
    ? { toneladas: n, problema: null }
    : { toneladas: null, problema: "Un ajuste de cero no cambia nada." };
}
