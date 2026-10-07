import { addUtcDays, formatHHMM } from "../dates";

export interface TurnoNuevo {
  empleadoId: string;
  legajo: string; // sólo para que los mensajes se puedan leer
  fecha: Date; // día calendario (UTC-medianoche)
  horaEntrada: Date;
  horaSalida: Date | null;
}

/** Lo que ya está guardado en un día, reducido a lo único que se compara. */
export interface FichadaGuardada {
  horaEntrada: string; // ISO
  horaSalida: string | null; // ISO
}

export interface ContextoDeDecision {
  /** Claves `claveDia()` de los (empleado, día) que tocó una persona. */
  diasCorregidos: Set<string>;
  /** Claves `claveDia()` de los (empleado, día) dentro de una liquidación CERRADA. */
  diasLiquidados: Set<string>;
  /**
   * Lo guardado hoy, para poder decir en qué difiere cuando se saltea.
   *
   * Una clave ausente significa "ese día no tiene nada guardado", no "no se
   * sabe": es el caso de quien borró las fichadas de un día. Quien arma el
   * contexto tiene que haber leído de verdad los días protegidos; si no los
   * leyó, cada día salteado va a salir avisado como "guardado sin fichadas".
   */
  guardadas: Map<string, FichadaGuardada[]>;
}

export type MotivoSalteo = "corregido" | "liquidado";

export interface DiaSalteado {
  empleadoId: string;
  legajo: string;
  fecha: string; // "YYYY-MM-DD"
  motivo: MotivoSalteo;
  /** En qué difiere lo que trae Lenox de lo guardado. Null si coinciden. */
  divergencia: string | null;
}

export interface Decision {
  aInsertar: TurnoNuevo[];
  diasABorrar: { empleadoId: string; fecha: string }[];
  salteados: DiaSalteado[];
}

export function claveDia(empleadoId: string, fecha: string): string {
  return `${empleadoId}|${fecha}`;
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Un tramo de trabajo como lo lee una persona: "08:00–16:00".
 *
 * Se compara a precisión de minuto a propósito. Las marcaciones del reloj
 * llegan en minutos por el contrato de `DiaMarcacionesTokens`, y una fichada
 * corregida a mano también se carga en HH:MM. Una diferencia de segundos sólo
 * puede venir de un Excel con segundos, y avisarla daría un mensaje del estilo
 * "guardado 08:00–16:00, Lenox trae 08:00–16:00", que no le dice nada a nadie:
 * no hay forma de verla ni de actuar sobre ella.
 */
function tramo(entrada: string, salida: string | null): string {
  return `${formatHHMM(new Date(entrada))}–${salida ? formatHHMM(new Date(salida)) : "?"}`;
}

/**
 * Por qué un (empleado, día) no se puede tocar, o null si se puede.
 *
 * Se separó de `decidirQueAplicar` porque la pregunta no es sólo de los turnos
 * que se insertan: cerrar con un `update` una fichada que había quedado sin
 * salida también cambia las horas de un día, y tiene que pasar por la misma
 * puerta. Dos lugares que responden "¿esto está protegido?" cada uno a su
 * manera es como se desarma una protección.
 *
 * Si el día está en los dos, se informa "liquidado": el motivo le dice a quien
 * lee qué puede hacer. Un día corregido se libera sacándole la marca; uno
 * liquidado no se toca sin reabrir antes la liquidación. Decir "corregido"
 * mandaría a probar lo primero cuando lo segundo es lo que lo está frenando.
 */
export function motivoDeProteccion(
  clave: string,
  ctx: ContextoDeDecision,
  protegerCorregidos: boolean
): MotivoSalteo | null {
  if (ctx.diasLiquidados.has(clave)) return "liquidado";
  if (protegerCorregidos && ctx.diasCorregidos.has(clave)) return "corregido";
  return null;
}

/** Una fichada que quedó sin hora de salida. */
export interface FichadaAbierta {
  id: string;
  empleadoId: string;
  fecha: string; // "YYYY-MM-DD"
  horaEntrada: string; // ISO
}

function diaAnterior(fecha: string): string {
  return fechaStr(addUtcDays(new Date(fecha), -1));
}

/**
 * Para cada empleado, la fichada abierta que `reconciliarTokens` recibe como
 * `abiertoPrevio` para poder cerrarla con la primera marca nueva: la del día
 * inmediatamente anterior al primer día de su lote.
 *
 * Sólo ésa, porque el encadenamiento existe para el turno nocturno cuyo cierre
 * cae en el lote siguiente, y la guarda de 2 a 14 horas del cruce de medianoche
 * no deja cerrar con estos datos una abierta más vieja: pasarla sólo produce un
 * aviso que no lleva a ninguna acción. Esas las resume `avisoDeAbiertasViejas`.
 *
 * Es lo que antes hacía una consulta por empleado (`order fecha desc limit 1`).
 * Se trae todo junto y se elige acá: las abiertas son pocas (54 al 07/10/2026,
 * todas errores de carga) y 68 viajes secuenciales a la base dentro de un
 * cron no tienen razón de ser.
 *
 * Con dos abiertas el mismo día gana la de entrada más tarde: es la última
 * marca sin pareja, que es lo que el emparejamiento por posición deja
 * pendiente. La consulta vieja no definía ese caso.
 */
export function elegirAbiertoPrevio(
  abiertas: FichadaAbierta[],
  primerDiaPorEmpleado: Map<string, string>
): Map<string, FichadaAbierta> {
  const elegidas = new Map<string, FichadaAbierta>();
  for (const a of abiertas) {
    const primerDia = primerDiaPorEmpleado.get(a.empleadoId);
    if (primerDia === undefined || a.fecha !== diaAnterior(primerDia)) continue;

    const actual = elegidas.get(a.empleadoId);
    if (!actual || new Date(a.horaEntrada).getTime() > new Date(actual.horaEntrada).getTime()) {
      elegidas.set(a.empleadoId, a);
    }
  }
  return elegidas;
}

/**
 * Un solo aviso para las fichadas que quedaron abiertas de antes y que este
 * lote ya no puede cerrar, o null si no hay ninguna.
 *
 * Son un pendiente real —alguien las tiene que cerrar a mano—, pero no un
 * error de la corrida: por eso es un texto aparte y no un aviso por fichada.
 * Con 23 empleados en esa situación (07/10/2026), uno por fichada eran hasta
 * 23 líneas fijas en cada corrida diaria, todas iguales y ninguna diciendo qué
 * hacer; ese ruido tapa los avisos que sí importan. Una línea dice cuántas,
 * desde cuándo y qué hacer.
 *
 * Son las anteriores al día previo al primer día de su empleado: las que
 * `elegirAbiertoPrevio` descarta. Las de dentro del lote no cuentan, porque el
 * propio lote las reemplaza.
 */
export function avisoDeAbiertasViejas(
  abiertas: FichadaAbierta[],
  primerDiaPorEmpleado: Map<string, string>,
  legajoPorEmpleado: Map<string, string>,
  maxLegajos = 8
): string | null {
  const viejas = abiertas.filter((a) => {
    const primerDia = primerDiaPorEmpleado.get(a.empleadoId);
    return primerDia !== undefined && a.fecha < diaAnterior(primerDia);
  });
  if (viejas.length === 0) return null;

  // "Antes del" tiene que ser verdad para todas: se toma el primer día más
  // tardío entre los empleados afectados.
  const corte = viejas.map((a) => primerDiaPorEmpleado.get(a.empleadoId)!).sort().at(-1)!;
  const masVieja = viejas.map((a) => a.fecha).sort()[0];
  const legajos = [...new Set(viejas.map((a) => legajoPorEmpleado.get(a.empleadoId) ?? a.empleadoId))].sort();
  const lista =
    legajos.length > maxLegajos
      ? `${legajos.slice(0, maxLegajos).join(", ")} y ${legajos.length - maxLegajos} más`
      : legajos.join(", ");

  const cuantas = viejas.length === 1 ? "1 fichada quedó abierta" : `${viejas.length} fichadas quedaron abiertas`;
  const noSePuede = viejas.length === 1 ? "no se puede cerrar" : "no se pueden cerrar";
  return (
    `${cuantas} de antes del ${corte} (la más vieja, del ${masVieja}) y ${noSePuede} con estos datos ` +
    `(${legajos.length === 1 ? "legajo" : "legajos"} ${lista}). Hay que cerrarlas a mano.`
  );
}

/**
 * Qué se inserta, qué día se reemplaza, qué se saltea y qué se avisa.
 *
 * Es puro a propósito: toda esta lógica vivía adentro de
 * `app/api/rrhh/fichadas/import/confirm/route.ts` y por eso no tenía un solo
 * test. Ahora la usan los dos caminos de carga —el Excel y la sincronización
 * con Lenox—, que es lo que impide que se vayan separando.
 *
 * `protegerCorregidos` es false para el Excel: quien sube un archivo a mano
 * está haciendo una elección deliberada sobre un período, igual que siempre.
 * El cron no elige nada, así que para Lenox va true. La liquidación cerrada,
 * en cambio, se respeta en los dos casos: eso no es una elección, es un mes
 * ya pagado.
 */
export function decidirQueAplicar(
  turnos: TurnoNuevo[],
  ctx: ContextoDeDecision,
  protegerCorregidos: boolean
): Decision {
  // Repetidos dentro del propio lote. Misma firma que usaba la ruta.
  const firma = (t: TurnoNuevo) =>
    `${t.empleadoId}|${t.fecha.getTime()}|${t.horaEntrada.getTime()}|${t.horaSalida?.getTime() ?? "null"}`;
  const vistas = new Set<string>();
  const sinRepetir = turnos.filter((t) => {
    const f = firma(t);
    if (vistas.has(f)) return false;
    vistas.add(f);
    return true;
  });

  // Agrupado una sola vez: un mes de 68 empleados son miles de turnos, y
  // filtrar el lote entero por cada día salteado lo volvía cuadrático.
  const turnosPorDia = new Map<string, TurnoNuevo[]>();
  for (const t of sinRepetir) {
    const clave = claveDia(t.empleadoId, fechaStr(t.fecha));
    const delDia = turnosPorDia.get(clave);
    if (delDia) delDia.push(t);
    else turnosPorDia.set(clave, [t]);
  }

  const aInsertar: TurnoNuevo[] = [];
  const diasABorrar: { empleadoId: string; fecha: string }[] = [];
  const salteados: DiaSalteado[] = [];
  const diasVistos = new Set<string>();
  const diasYaSalteados = new Set<string>();

  for (const t of sinRepetir) {
    const fecha = fechaStr(t.fecha);
    const clave = claveDia(t.empleadoId, fecha);

    const motivo = motivoDeProteccion(clave, ctx, protegerCorregidos);

    if (motivo) {
      if (!diasYaSalteados.has(clave)) {
        diasYaSalteados.add(clave);
        salteados.push({
          empleadoId: t.empleadoId,
          legajo: t.legajo,
          fecha,
          motivo,
          divergencia: divergenciaDe(ctx.guardadas.get(clave) ?? [], turnosPorDia.get(clave) ?? []),
        });
      }
      continue;
    }

    aInsertar.push(t);
    if (!diasVistos.has(clave)) {
      diasVistos.add(clave);
      diasABorrar.push({ empleadoId: t.empleadoId, fecha });
    }
  }

  return { aInsertar, diasABorrar, salteados };
}

/**
 * En qué difiere lo que trae Lenox de lo guardado, en palabras. Null si
 * coinciden: avisar de algo que no cambió es ruido, y el ruido hace que nadie
 * lea los avisos que sí importan.
 *
 * Un día sin nada guardado SÍ se avisa. Es lo que queda cuando una persona
 * borró a propósito una marcación fantasma: el día está marcado como corregido,
 * no tiene fichadas, y Lenox sigue trayendo la que se borró. Callarlo sería
 * esconder justo lo que la protección está evitando, y el que lo borró nunca
 * se enteraría de que el reloj sigue diciendo otra cosa.
 *
 * `deLenox` nunca viene vacío: el día se conoce porque trajo al menos un turno.
 */
function divergenciaDe(guardadas: FichadaGuardada[], deLenox: TurnoNuevo[]): string | null {
  const trae = deLenox
    .map((t) => tramo(t.horaEntrada.toISOString(), t.horaSalida?.toISOString() ?? null))
    .sort();
  const guardado = guardadas.map((g) => tramo(g.horaEntrada, g.horaSalida)).sort();

  if (guardado.join(" · ") === trae.join(" · ")) return null;
  const loGuardado = guardado.length === 0 ? "sin fichadas" : guardado.join(" · ");
  return `guardado ${loGuardado}, Lenox trae ${trae.join(" · ")}`;
}
