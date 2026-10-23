/**
 * Arma la fila de `PLANTA {N}` que corresponde a un parte, en el orden real
 * de encabezados (relevado en vivo el 18/09/2026). Puro, sin red — lo usa
 * `espejo.ts`.
 *
 * El operario NO tiene columna acá: es dato nuevo del SdG, el Excel real
 * nunca lo tuvo. Las 7 columnas calculadas (horas teóricas, total de
 * paradas, horas reales, disponibilidad, ton/camión, las dos productividades)
 * son las que despeja `lib/trituracion/horas.ts` — se escriben calculadas,
 * no se vuelven a calcular en la planilla con una fórmula que pueda divergir.
 */

import { serialDelDia } from "@/lib/core/fechaDeSheets";
import { despejarParte } from "./horas";
import { ETIQUETA_ESTADO, type EstadoParte } from "./vocabulario";
import { textoParaLaCelda } from "@/lib/core/sheets";

export interface ParteParaPlanilla {
  fecha: string; // "YYYY-MM-DD"
  estado: EstadoParte;
  material: string | null;
  origen: string | null;
  horaInicio: string | null;
  horaFin: string | null;
  horasMantenimiento: number;
  horasFaltaPiedra: number;
  horasProduccion: number;
  horasOtro: number;
  camionesLlegados: number | null;
  toneladasProcesadas: number | null;
  observaciones: string | null;
}

/**
 * `USER_ENTERED`: la fecha va como serial, los números como número — nunca
 * como texto (trampa del núcleo).
 *
 * Y por lo mismo al revés: el material, el origen y las observaciones son
 * texto que tipea una persona y van por `textoParaLaCelda`. Las dos horas no,
 * aunque también las tipee: "7:30" tiene que entrar como hora, que es de lo
 * que depende la cuenta de horas teóricas de la planilla.
 */
export function filaParte(p: ParteParaPlanilla): (string | number)[] {
  const d = despejarParte({
    horaInicio: p.horaInicio,
    horaFin: p.horaFin,
    horasMantenimiento: p.horasMantenimiento,
    horasFaltaPiedra: p.horasFaltaPiedra,
    horasProduccion: p.horasProduccion,
    horasOtro: p.horasOtro,
    toneladasProcesadas: p.toneladasProcesadas,
    camionesLlegados: p.camionesLlegados,
  });

  const serial = serialDelDia(p.fecha);

  return [
    serial ?? p.fecha,
    ETIQUETA_ESTADO[p.estado],
    textoParaLaCelda(p.material),
    textoParaLaCelda(p.origen),
    p.horaInicio ?? "",
    p.horaFin ?? "",
    d.horasTeoricas ?? "",
    p.horasMantenimiento || "",
    p.horasFaltaPiedra || "",
    p.horasProduccion || "",
    p.horasOtro || "",
    d.horasParadasTotal || "",
    d.horasRealesTrabajadas ?? "",
    d.disponibilidad ?? "",
    p.camionesLlegados ?? "",
    p.toneladasProcesadas ?? "",
    d.tonPorCamion ?? "",
    d.productividadAbsoluta ?? "",
    d.productividadReal ?? "",
    textoParaLaCelda(p.observaciones),
  ];
}
