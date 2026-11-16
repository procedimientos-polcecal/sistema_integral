import { ETAPAS, etapaDe, type ClaveDeEtapa, type Etapa } from "./etapas";

/**
 * El embudo: cuánto hay en cada etapa.
 *
 * ── EL MONTO NO SE CONVIERTE NUNCA ──────────────────────────
 *
 * Se suma **por moneda** y se muestran las dos. Convertir pediría una
 * cotización del día, y ahí hay dos salidas y las dos son malas: con la
 * cotización de hoy, el embudo del mes pasado cambia de valor cada vez que
 * alguien lo mira; con una cotización guardada junto al monto, el número
 * envejece sin que nada avise. Un total único es más cómodo de leer y es el
 * tipo de comodidad que después nadie sabe interpretar.
 *
 * Compras ya tuvo esta discusión y la resolvió igual
 * (`040_cotizaciones_en_dolares.sql`).
 *
 * ── PONDERADO Y SIN PONDERAR, SIEMPRE LOS DOS ───────────────
 *
 * El ponderado multiplica cada monto por la probabilidad de su etapa, que
 * **hoy es un supuesto y no una medición** (ver `etapas.ts`: no hay histórico
 * todavía). Por eso nunca se muestra solo: el número sin ponderar es el único
 * que no depende de ese supuesto, y el día que las probabilidades se calculen
 * de verdad la comparación entre los dos va a decir algo.
 *
 * ── LAS TONELADAS SON EL NÚMERO QUE ENTIENDE LA PLANTA ──────
 *
 * Se suman aparte y sin ponderar. Acá se vende material a granel: «tenemos 400
 * toneladas en negociación» le dice algo a producción que ningún monto le dice,
 * porque es lo que hay que fabricar. Una oportunidad sin toneladas cargadas no
 * suma cero toneladas: no suma, y el conteo de filas al lado lo deja ver.
 */

export interface OportunidadDelEmbudo {
  etapa: string;
  monto_estimado: number | null;
  moneda: string | null;
  toneladas_estimadas: number | null;
}

export interface MontosPorMoneda {
  ARS: number;
  USD: number;
}

export interface ColumnaDelEmbudo {
  etapa: Etapa;
  /** Cuántas oportunidades hay. Cuenta todas, tengan monto o no. */
  cantidad: number;
  /** Suma de los montos cargados, por moneda. Las que no tienen monto no suman. */
  monto: MontosPorMoneda;
  /** Lo mismo multiplicado por la probabilidad de la etapa. Ver arriba. */
  ponderado: MontosPorMoneda;
  /** Suma de las toneladas cargadas. Sin ponderar. */
  toneladas: number;
  /** Cuántas de las `cantidad` no tienen monto cargado. */
  sinMonto: number;
}

export interface Embudo {
  /** Una columna por etapa, siempre las seis y siempre en orden, aunque estén vacías. */
  columnas: ColumnaDelEmbudo[];
  /** El total de lo que sigue en juego: las cuatro etapas abiertas. */
  abiertas: {
    cantidad: number;
    monto: MontosPorMoneda;
    ponderado: MontosPorMoneda;
    toneladas: number;
  };
}

function montosVacios(): MontosPorMoneda {
  return { ARS: 0, USD: 0 };
}

/** Una moneda que no se reconoce se cuenta como pesos: es el default de la tabla. */
function monedaDe(valor: string | null | undefined): keyof MontosPorMoneda {
  return valor === "USD" ? "USD" : "ARS";
}

/**
 * Arma el embudo.
 *
 * **Devuelve las seis columnas aunque estén vacías**, y eso es el punto: una
 * etapa que desaparece del embudo porque no tiene nada no se nota, y lo que hay
 * que ver es justamente dónde se está haciendo el tapón. Un embudo con un hueco
 * en «Cotizada» cuenta una historia; una lista de cinco columnas no cuenta
 * ninguna.
 *
 * Una oportunidad con una etapa que no existe queda afuera de todas las
 * columnas y no se reparte en ninguna: es una fila a arreglar, no un dato que
 * se pueda ubicar, e inventarle una etapa la escondería.
 */
export function armarEmbudo(oportunidades: OportunidadDelEmbudo[]): Embudo {
  const porEtapa = new Map<ClaveDeEtapa, ColumnaDelEmbudo>(
    ETAPAS.map((etapa) => [
      etapa.clave,
      {
        etapa,
        cantidad: 0,
        monto: montosVacios(),
        ponderado: montosVacios(),
        toneladas: 0,
        sinMonto: 0,
      },
    ])
  );

  for (const o of oportunidades) {
    const etapa = etapaDe(o.etapa);
    if (!etapa) continue;
    const columna = porEtapa.get(etapa.clave)!;

    columna.cantidad += 1;

    if (o.monto_estimado == null) {
      columna.sinMonto += 1;
    } else {
      const moneda = monedaDe(o.moneda);
      columna.monto[moneda] += o.monto_estimado;
      columna.ponderado[moneda] += (o.monto_estimado * etapa.probabilidad) / 100;
    }

    if (o.toneladas_estimadas != null) columna.toneladas += o.toneladas_estimadas;
  }

  const columnas = [...porEtapa.values()].sort((a, b) => a.etapa.orden - b.etapa.orden);

  const abiertas = columnas
    .filter((c) => c.etapa.abierta)
    .reduce(
      (acc, c) => ({
        cantidad: acc.cantidad + c.cantidad,
        monto: { ARS: acc.monto.ARS + c.monto.ARS, USD: acc.monto.USD + c.monto.USD },
        ponderado: {
          ARS: acc.ponderado.ARS + c.ponderado.ARS,
          USD: acc.ponderado.USD + c.ponderado.USD,
        },
        toneladas: acc.toneladas + c.toneladas,
      }),
      { cantidad: 0, monto: montosVacios(), ponderado: montosVacios(), toneladas: 0 }
    );

  return { columnas, abiertas };
}

/**
 * Qué porcentaje de lo cerrado se ganó, en un período.
 *
 * **Sobre lo cerrado y no sobre todo**, que es la trampa clásica de este número:
 * contar las abiertas en el denominador hace que la tasa baje cada vez que
 * alguien carga una oportunidad nueva, o sea que trabajar más empeora el
 * indicador. Y devuelve `null` —y no 0— cuando no se cerró nada: «no hubo
 * cierres» y «se perdieron todos» son cosas distintas, y un 0 % en una pantalla
 * no se distingue del desastre.
 */
export function tasaDeConversion(oportunidades: { etapa: string }[]): number | null {
  let ganadas = 0;
  let cerradas = 0;
  for (const o of oportunidades) {
    if (o.etapa === "ganada") ganadas += 1;
    if (o.etapa === "ganada" || o.etapa === "perdida") cerradas += 1;
  }
  if (cerradas === 0) return null;
  return (ganadas / cerradas) * 100;
}
