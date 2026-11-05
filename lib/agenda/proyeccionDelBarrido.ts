import { claveDelHueco, horarioApilado } from "./apilado";

/**
 * Lo que el barrido mandaría, **sin escribir nada**: a qué hora caería cada
 * orden. Es la corrida en seco de `scripts/mandar-las-ot-futuras.mts`.
 *
 * Sin red y sin base. Quien llama le pasa `ocupadosEnLaBase`, que cuenta los
 * eventos que el grupo ya tiene ese día, y esta función suma las órdenes que
 * ella misma va colocando. **Esa suma es lo único que no es una copia**: en la
 * corrida de verdad no hace falta, porque cada orden se escribe antes de contar
 * la siguiente y la base ya tiene la anterior (ver el encabezado de
 * `barridoDeNuevas`); en seco no se escribe, así que hay que llevarla.
 *
 * El grupo es el de `claveDelHueco` —día, especialidad y turno—, la misma
 * definición que usa `mandarLaOTAlCalendario`, y el horario sale de
 * `horarioApilado`. Si cambia uno de los dos, esto cambia con ellos y no por
 * separado.
 *
 * Supone que **todas salen bien**. Si una falla en la corrida de verdad, las
 * siguientes de su grupo suben un lugar; la proyección no lo puede saber.
 *
 * El tope cuenta lo que se crea, como el del barrido: una orden sin horario
 * (fecha imposible) no entra en la cuenta porque no mandaría ninguna invitación.
 */
export interface OrdenParaProyectar {
  id: string;
  ot_number: number | null;
  especialidad: string | null;
}

export interface Proyectada<O extends OrdenParaProyectar> {
  orden: O;
  fecha: string;
  inicio: string;
  fin: string;
  topeado: boolean;
}

export function proyectarElBarrido<O extends OrdenParaProyectar>(
  faltan: { orden: O; fecha: string }[],
  turno: string,
  ocupadosEnLaBase: (clave: string, orden: O, fecha: string) => number,
  tope: number
): { van: Proyectada<O>[]; quedan: number; sinHorario: O[] } {
  const van: Proyectada<O>[] = [];
  const sinHorario: O[] = [];
  const yaColocadas = new Map<string, number>();
  const deLaBase = new Map<string, number>();

  let i = 0;
  for (; i < faltan.length; i++) {
    if (van.length >= tope) break;
    const { orden, fecha } = faltan[i];
    const clave = claveDelHueco(fecha, orden.especialidad, turno);
    if (!deLaBase.has(clave)) deLaBase.set(clave, ocupadosEnLaBase(clave, orden, fecha));
    const propias = yaColocadas.get(clave) ?? 0;
    const horario = horarioApilado(fecha, deLaBase.get(clave)! + propias);
    if (!horario) {
      sinHorario.push(orden);
      continue;
    }
    yaColocadas.set(clave, propias + 1);
    van.push({ orden, fecha, ...horario });
  }
  return { van, quedan: faltan.length - i, sinHorario };
}
