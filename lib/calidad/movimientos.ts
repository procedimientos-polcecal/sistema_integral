import type { TipoDeMovimiento, TipoDeCarbon } from "./types";

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

export interface Saldos {
  vegetal: number;
  residual: number;
  /** Despejado, no guardado: es la suma de los otros dos. */
  total: number;
}

/** Lo mínimo que `saldosDelLibro` necesita de un movimiento. */
interface ParaSumar {
  carbon: TipoDeCarbon;
  toneladas: number;
}

/**
 * Los dos saldos, y el total.
 *
 * Es una suma y nada más, y eso es a propósito: el signo ya viene guardado en
 * `toneladas`, así que no hay regla que aplicar acá. En la planilla vieja esto
 * eran fórmulas por fila que acumulaban celda contra celda, y por eso el saldo
 * mostraba `355.8569999999998` — y por eso, cuando el ajuste en más no tuvo
 * dónde entrar, alguien pudo pisar una celda y romper la cadena sin que nada
 * avisara.
 *
 * **Los `sin_separar` no caen acá**, y no porque se los excluya: porque no son
 * ninguno de los dos tipos que se suman.
 */
export function saldosDelLibro(movimientos: ParaSumar[]): Saldos {
  let vegetal = 0;
  let residual = 0;

  for (const m of movimientos) {
    if (m.carbon === "vegetal") vegetal += m.toneladas;
    else if (m.carbon === "residual") residual += m.toneladas;
  }

  vegetal = aTresDecimales(vegetal);
  residual = aTresDecimales(residual);
  return { vegetal, residual, total: aTresDecimales(vegetal + residual) };
}

export interface ConSaldo<T> {
  movimiento: T;
  fecha: string;
  saldoVegetal: number;
  saldoResidual: number;
  saldoTotal: number;
}

/**
 * Cada movimiento con el saldo que queda **después** de él.
 *
 * Ordena por fecha y, dentro del día, por el orden en que se cargaron. El saldo
 * que significa algo es **el del cierre de cada día**: inventar un orden
 * intradiario que el circuito real no tiene sería inventar precisión.
 */
export function saldoCorrido<T extends ParaSumar & { fecha: string; cargado_en: string }>(
  movimientos: T[]
): ConSaldo<T>[] {
  const ordenados = [...movimientos].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.cargado_en.localeCompare(b.cargado_en)
  );

  let vegetal = 0;
  let residual = 0;

  return ordenados.map((m) => {
    if (m.carbon === "vegetal") vegetal = aTresDecimales(vegetal + m.toneladas);
    else if (m.carbon === "residual") residual = aTresDecimales(residual + m.toneladas);
    return {
      movimiento: m,
      fecha: m.fecha,
      saldoVegetal: vegetal,
      saldoResidual: residual,
      saldoTotal: aTresDecimales(vegetal + residual),
    };
  });
}
