import { anioSinFeriadosCargados } from "./diasHabiles";
import type { Ausencia } from "./diasDeAusencia";
import {
  reporteAnual,
  reporteMensual,
  reportePorcentual,
  type EmpleadoDelReporte,
  type HorasDeSector,
} from "./reportes";

/**
 * Los tres reportes de ausentismo de un mes, más los avisos que hay que
 * mostrar **donde se ve el número**.
 *
 * Es pura: recibe todo leído. Quien la llama (`leerReportes`, de `lecturas.ts`)
 * tiene que pasar a TODOS los empleados, también a los inactivos: alguien que
 * se fue en agosto igual faltó en marzo, y sin él esas ausencias se vuelven
 * huérfanas y desaparecen del número. Eso se avisa abajo si pasa.
 */

/**
 * Lo que RRHH va a comparar apenas vea el número: el de la planilla. No va a
 * dar igual y la razón tiene que estar dicha, porque si no la conclusión
 * natural es que el sistema está mal.
 */
export const AVISO_TODOS_LOS_SECTORES =
  "El total incluye a todos los sectores. La planilla que esto reemplaza sólo contaba una lista fija de 17, " +
  "así que estos números no van a coincidir con los de la planilla: los del sistema son los completos.";

export function armarReportes(datos: {
  ausencias: Ausencia[];
  empleados: EmpleadoDelReporte[];
  feriados: readonly string[];
  horas: HorasDeSector[];
  /** "YYYY-MM", ya validado. El anual llega hasta este mes. */
  mes: string;
}) {
  const { ausencias, empleados, feriados, horas, mes } = datos;
  const anio = Number(mes.slice(0, 4));

  const mensual = reporteMensual(ausencias, empleados, mes);
  const anual = reporteAnual(ausencias, empleados, anio, mes, feriados);
  const porcentual = reportePorcentual(ausencias, empleados, mes, horas, feriados);

  const avisos: string[] = [AVISO_TODOS_LOS_SECTORES];

  // `anioSinFeriadosCargados` y no `mesesSinFeriados`: septiembre no tiene
  // feriado nacional, así que ésa daría un aviso falso todos los años y todos
  // aprenderían a ignorarlo.
  if (anioSinFeriadosCargados(anio, feriados)) {
    avisos.push(
      `El año ${anio} no tiene ningún feriado cargado: los días hábiles salen de más y el porcentual sale más bajo de lo que es. ` +
        "Hay que cargar los feriados en RRHH.",
    );
  }

  // Una ausencia de alguien que no está en `empleados` no entra en ningún
  // número. Con todos los empleados leídos no debería pasar; si pasa, no se
  // calla.
  const huerfanas = Math.max(
    mensual.ausenciasHuerfanas,
    anual.ausenciasHuerfanas,
    porcentual.ausenciasHuerfanas,
  );
  if (huerfanas > 0) {
    avisos.push(
      `${huerfanas} ${huerfanas === 1 ? "ausencia es" : "ausencias son"} de personas que no están en el padrón de empleados y no entran en ningún número.`,
    );
  }

  return { mensual, anual, porcentual, avisos };
}

/**
 * Quién ve los reportes **que nombran personas**: los `encargado`, los
 * `admin_sistema` y quien tenga acceso a RRHH, en cualquier nivel.
 *
 * El `rol` viene de `usuarios` y el nivel de `nivelRrhhDe` (null si no tiene
 * el módulo; un `admin_sistema` ya viene como `admin`).
 *
 * **No gobierna el mensual**, que es agregado por sector y sin nombres y lo ve
 * cualquiera que entre al sistema: ver `reportesQueVe`.
 */
export function puedeVerLosReportes(
  rol: string | null | undefined,
  nivelRrhh: "lectura" | "edicion" | "admin" | null,
): boolean {
  return rol === "encargado" || rol === "admin_sistema" || nivelRrhh !== null;
}

/**
 * Qué parte de los reportes le toca a quien pregunta.
 *
 * El spec reparte por **si el número nombra a alguien**, no por reporte: el
 * mensual es sector × motivo, agregado y sin nombres, y lo ve cualquiera que
 * entre al sistema; el anual es una fila por persona con sus días de ausencia
 * y ése sí está gateado. Esa tabla es la autoridad y dice, textual: «El
 * mensual por sector (agregado, sin nombres) → cualquiera que entre al
 * sistema».
 *
 * **El porcentual queda del lado cerrado aunque tampoco nombre a nadie**, y es
 * una decisión, no un descuido: el spec no lo nombra en esa tabla. Ante un
 * permiso que el spec no abrió explícitamente, se deja cerrado — abrirlo
 * después es un renglón, y enterarse de que se filtró no se deshace. Si se
 * quiere abierto, se abre acá y se dice en el spec.
 *
 * Los `avisos` van de los dos lados: explican el número del mensual, que es
 * justamente el que todos van a comparar contra la planilla.
 */
export function reportesQueVe(
  todo: ReturnType<typeof armarReportes>,
  puedeVerPorPersona: boolean,
): Partial<ReturnType<typeof armarReportes>> & Pick<ReturnType<typeof armarReportes>, "mensual" | "avisos"> {
  if (puedeVerPorPersona) return todo;
  return { mensual: todo.mensual, avisos: todo.avisos };
}
