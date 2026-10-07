import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { reconciliarTokens, horaStringToDate, type DiaMarcacionesTokens } from "../excelImport";
import { recalcularEmpleadoPeriodo } from "../engine/recalcular";
import { formatHHMM } from "../dates";
import {
  decidirQueAplicar, claveDia, motivoDeProteccion, elegirAbiertoPrevio,
  type TurnoNuevo, type ContextoDeDecision, type FichadaGuardada, type FichadaAbierta, type DiaSalteado,
} from "./decidir";

/** Los días de un empleado, ya ordenados ascendente. */
export interface DiasDeEmpleado {
  empleadoId: string;
  legajo: string;
  dias: DiaMarcacionesTokens[];
}

export interface ResultadoAplicar {
  insertados: number;
  reemplazados: number;
  salteados: DiaSalteado[];
  avisos: string[];
}

/** Un (empleado, día) que este lote toca o quiere tocar. */
interface DiaEnJuego {
  empleadoId: string;
  fecha: string; // "YYYY-MM-DD"
}

/** Una fichada abierta de un lote anterior que este lote cierra con un `update`. */
interface Cierre {
  id: string;
  empleadoId: string;
  legajo: string;
  fecha: Date; // el día de la entrada: es al que se imputan las horas
  fechaSalida: Date;
  horaSalida: Date;
}

/**
 * Cuántas fechas van en un `.in()` de borrado. Una fecha ocupa ~11 caracteres
 * de la URL, así que 200 son ~2 KB: lejos del límite en el que PostgREST
 * responde un 400 sin decir por qué. Y 200 días por empleado dan, como mucho,
 * unas mil filas devueltas por el `.select("id")` del borrado: el corte de las
 * 1000 filas no se alcanza con fichadas de verdad.
 */
const FECHAS_POR_BORRADO = 200;

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * El alta de fichadas, compartida por los dos caminos de carga: el import de
 * Excel y la sincronización con Lenox.
 *
 * Está acá y no en la ruta porque el Excel se queda como respaldo, y dos
 * caminos de escritura separados se van separando — y el que casi no se usa
 * es el que se pudre sin que nadie lo note.
 *
 * `admin` y no el cliente de sesión: el cron no tiene sesión. Por eso mismo
 * `recalcularEmpleadoPeriodo` recibe también el admin (acepta cualquier
 * `SupabaseClient`), cuando la ruta vieja le pasaba el de sesión.
 *
 * RIESGO ASUMIDO, no resuelto: el borrado y el alta no son atómicos. PostgREST
 * no ofrece una transacción de varias sentencias, y meter una función de
 * Postgres sólo para esto sería desproporcionado. Si un `insert` falla a mitad
 * de las tandas, los días a reemplazar ya están borrados y quedan vacíos (o a
 * medias, si falló la segunda tanda y no la primera), y el recálculo no corrió,
 * así que `calculos_diarios` queda desfasado de las fichadas. Se acepta porque
 * se cura solo: la próxima corrida —el cron de mañana, el botón, o volver a
 * subir el Excel— vuelve a borrar esos días y a insertarlos completos, y el
 * recálculo los alcanza. Lo que no se cura solo es un día que salga del rango
 * de la próxima corrida; el cron mira siete días. Por eso el error se tira con
 * lo que dijo la base y diciendo que ya se había borrado, y es quien llama el
 * que tiene que dejarlo escrito en el lote (`log_detalle`): un `throw` que
 * nadie anota es un día vacío que nadie sabe que está vacío.
 *
 * No se invierte el orden (insertar primero, borrar después lo viejo) porque
 * cambia un riesgo por otro peor: un fallo del borrado dejaría el día
 * duplicado, y las horas duplicadas se pagan.
 */
export async function aplicarDias(
  admin: SupabaseClient,
  empleados: DiasDeEmpleado[],
  opciones: { batchId: string; protegerCorregidos: boolean }
): Promise<ResultadoAplicar> {
  const conDatos = empleados.filter((e) => e.dias.length > 0);

  // Si de una carga anterior quedó un turno sin marcación de salida, se
  // encadena para que el primer dato de este lote pueda cerrarlo en vez de
  // quedar abierto para siempre. Una consulta para todos, no una por empleado.
  const abiertas = await abiertasPrevias(admin, conDatos);

  const turnos: TurnoNuevo[] = [];
  const cierres: Cierre[] = [];
  const avisos: string[] = [];
  // Qué días cubre cada turno, incluido el día de salida si cruzó medianoche.
  // `TurnoNuevo` no lleva `fechaSalida`, pero el recálculo la necesita: un
  // turno que arranca el viernes de noche y termina el sábado aporta horas al
  // sábado, y si el sábado no tiene turnos propios nadie lo recalcularía.
  const imputados: { empleadoId: string; fecha: Date; fechaSalida: Date }[] = [];

  for (const emp of conDatos) {
    const abierto = abiertas.get(emp.empleadoId) ?? null;
    const abiertoFecha = abierto ? new Date(abierto.fecha) : null;
    const abiertoPrevio = abierto
      ? { fecha: abiertoFecha!, entradaStr: formatHHMM(new Date(abierto.horaEntrada)) }
      : null;

    const { turnos: resueltos, avisos: avisosDelEmpleado } = reconciliarTokens(emp.dias, abiertoPrevio);

    for (const t of resueltos) {
      // El turno que cierra una fichada ya abierta se completa con un update:
      // esa fila ya existe y no entra por el camino de borrar-e-insertar. Acá
      // sólo se anota; se aplica más abajo, después de saber si ese día está
      // protegido. (Los días del lote son todos posteriores a la abierta, así
      // que un turno con su misma fecha sólo puede ser ella.)
      if (abierto && abiertoFecha && t.fecha.getTime() === abiertoFecha.getTime()) {
        if (t.salidaStr) {
          cierres.push({
            id: abierto.id,
            empleadoId: emp.empleadoId,
            legajo: emp.legajo,
            fecha: t.fecha,
            fechaSalida: t.fechaSalida,
            horaSalida: horaStringToDate(t.fechaSalida, t.salidaStr),
          });
        }
        continue;
      }
      turnos.push({
        empleadoId: emp.empleadoId,
        legajo: emp.legajo,
        fecha: t.fecha,
        horaEntrada: horaStringToDate(t.fecha, t.entradaStr),
        horaSalida: t.salidaStr ? horaStringToDate(t.fechaSalida, t.salidaStr) : null,
      });
      imputados.push({ empleadoId: emp.empleadoId, fecha: t.fecha, fechaSalida: t.fechaSalida });
    }

    for (const a of avisosDelEmpleado) {
      avisos.push(`Legajo ${emp.legajo}, ${fechaStr(a.fecha)}: ${a.mensaje}`);
    }
  }

  const ctx = await contextoDe(admin, [
    ...turnos.map((t) => ({ empleadoId: t.empleadoId, fecha: fechaStr(t.fecha) })),
    // El día de una fichada que se va a cerrar también se mira: cerrarla le
    // cambia las horas a ese día igual que insertar.
    ...cierres.map((c) => ({ empleadoId: c.empleadoId, fecha: fechaStr(c.fecha) })),
  ]);
  const decision = decidirQueAplicar(turnos, ctx, opciones.protegerCorregidos);

  // Borra las IMPORTADO de los (empleado, día) que se reemplazan — las MANUAL
  // nunca se tocan. Un borrado por empleado con las fechas en un `.in()`, y no
  // uno por día: el cron trae siete días por 68 empleados, que son 68
  // consultas y no 476. Con fechas de un rango acotado el `.in()` es seguro;
  // se corta en tandas igual porque el Excel puede traer un año entero.
  const fechasPorEmpleado = new Map<string, string[]>();
  for (const d of decision.diasABorrar) {
    const fechas = fechasPorEmpleado.get(d.empleadoId);
    if (fechas) fechas.push(d.fecha);
    else fechasPorEmpleado.set(d.empleadoId, [d.fecha]);
  }
  let reemplazados = 0;
  for (const [empleadoId, fechas] of fechasPorEmpleado) {
    for (let i = 0; i < fechas.length; i += FECHAS_POR_BORRADO) {
      const { data: borrados, error } = await admin
        .from("fichadas")
        .delete()
        .eq("empleado_id", empleadoId)
        .eq("origen", "IMPORTADO")
        .in("fecha", fechas.slice(i, i + FECHAS_POR_BORRADO))
        .select("id");
      // Sin esta guarda, un borrado que falla sigue de largo y el alta deja el
      // día duplicado: las horas duplicadas se pagan.
      if (error) throw new Error(`Borrando las fichadas a reemplazar: ${error.message}`);
      reemplazados += borrados?.length ?? 0;
    }
  }

  const filas = decision.aInsertar.map((t) => ({
    empleado_id: t.empleadoId,
    fecha: fechaStr(t.fecha),
    hora_entrada: t.horaEntrada.toISOString(),
    hora_salida: t.horaSalida ? t.horaSalida.toISOString() : null,
    origen: "IMPORTADO",
    import_batch_id: opciones.batchId,
  }));
  const tandas = Math.ceil(filas.length / 500);
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await admin.from("fichadas").insert(filas.slice(i, i + 500));
    if (error) {
      throw new Error(
        `Insertando fichadas (tanda ${i / 500 + 1} de ${tandas}; los días a reemplazar ya estaban borrados): ${error.message}`
      );
    }
  }

  // Rango a recalcular por empleado. Sale de los turnos que de verdad se
  // aplicaron —no de los de días salteados— y suma el día de salida de los que
  // cruzaron medianoche y el de las fichadas cerradas.
  const salteadas = new Set(decision.salteados.map((s) => claveDia(s.empleadoId, s.fecha)));
  const rangos = new Map<string, { min: Date; max: Date }>();
  function marcarRango(empleadoId: string, ...fechas: Date[]) {
    for (const f of fechas) {
      const r = rangos.get(empleadoId);
      if (!r) rangos.set(empleadoId, { min: f, max: f });
      else {
        if (f < r.min) r.min = f;
        if (f > r.max) r.max = f;
      }
    }
  }
  for (const im of imputados) {
    if (salteadas.has(claveDia(im.empleadoId, fechaStr(im.fecha)))) continue;
    marcarRango(im.empleadoId, im.fecha, im.fechaSalida);
  }

  // Cerrar una fichada abierta cambia las horas de su día, así que pasa por la
  // misma protección que insertar. Si no, una liquidación cerrada con un turno
  // nocturno sin salida se movería sola cuando entra la marca del día
  // siguiente: justo lo que la protección está para impedir.
  const cierresOmitidos: DiaSalteado[] = [];
  for (const c of cierres) {
    const fecha = fechaStr(c.fecha);
    const motivo = motivoDeProteccion(claveDia(c.empleadoId, fecha), ctx, opciones.protegerCorregidos);
    if (motivo) {
      cierresOmitidos.push({ empleadoId: c.empleadoId, legajo: c.legajo, fecha, motivo, divergencia: null });
      continue;
    }
    // `is null` por si alguien le cargó la salida a mano mientras tanto: no se pisa.
    const { error } = await admin
      .from("fichadas")
      .update({ hora_salida: c.horaSalida.toISOString() })
      .eq("id", c.id)
      .is("hora_salida", null);
    if (error) throw new Error(`Cerrando la fichada abierta del legajo ${c.legajo} (${fecha}): ${error.message}`);
    marcarRango(c.empleadoId, c.fecha, c.fechaSalida);
  }

  // Una sola vez por empleado, con su rango completo: tanto lo insertado como
  // lo cerrado. (El plan original recalculaba la fichada cerrada ahí mismo y
  // otra vez al final, dos veces las mismas ~10 consultas por empleado.)
  for (const [empleadoId, r] of rangos) {
    await recalcularEmpleadoPeriodo(admin, empleadoId, r.min, r.max);
  }

  for (const s of decision.salteados) {
    const motivo = s.motivo === "liquidado" ? "liquidación cerrada" : "corregido a mano";
    avisos.push(
      `Legajo ${s.legajo}, ${s.fecha}: no se tocó (${motivo})` +
        (s.divergencia ? ` — ${s.divergencia}` : "")
    );
  }
  for (const s of cierresOmitidos) {
    const motivo = s.motivo === "liquidado" ? "liquidación cerrada" : "corregido a mano";
    avisos.push(`Legajo ${s.legajo}, ${s.fecha}: no se cerró el turno que había quedado sin salida (${motivo})`);
  }

  return {
    insertados: decision.aInsertar.length,
    reemplazados,
    salteados: [...decision.salteados, ...cierresOmitidos],
    avisos,
  };
}

/**
 * Por empleado, la fichada abierta que `reconciliarTokens` puede encadenar.
 *
 * La consulta trae todas las abiertas anteriores al día más tardío de los
 * primeros días del lote, sin filtrar por empleado —no con un `.in()` de ids—,
 * y `elegirAbiertoPrevio` se queda con la que corresponde a cada uno.
 */
async function abiertasPrevias(
  admin: SupabaseClient,
  empleados: DiasDeEmpleado[]
): Promise<Map<string, FichadaAbierta>> {
  if (empleados.length === 0) return new Map();

  const primerDia = new Map(empleados.map((e) => [e.empleadoId, fechaStr(e.dias[0].fecha)]));
  const tope = [...primerDia.values()].sort().at(-1)!;

  const filas = await traerTodo<{ id: string; empleado_id: string; fecha: string; hora_entrada: string }>((d, h) =>
    admin.from("fichadas").select("id, empleado_id, fecha, hora_entrada")
      .is("hora_salida", null).lt("fecha", tope).order("id").range(d, h)
  );

  return elegirAbiertoPrevio(
    filas.map((f) => ({ id: f.id, empleadoId: f.empleado_id, fecha: f.fecha, horaEntrada: f.hora_entrada })),
    primerDia
  );
}

/**
 * Los días protegidos y lo guardado hoy, para los días que este lote toca.
 *
 * OJO CON `guardadas`, QUE TIENE UN CONTRATO IMPLÍCITO: para `decidir.ts`,
 * una clave ausente significa "ese día no tiene ninguna fichada", y con eso
 * avisa `"guardado sin fichadas, Lenox trae …"` — que es el caso real de la
 * marca fantasma que alguien borró y el cron recrearía. Si esta función no
 * leyera de verdad lo guardado de **todos** los días protegidos, cada día
 * salteado saldría con esa leyenda: una falsa alarma masiva que haría que
 * nadie vuelva a leer los avisos.
 *
 * Se cumple porque un día sólo se saltea si trajo al menos un turno, así que
 * está en `dias`, su fecha cae dentro de `[desde, hasta]` y su empleado está
 * en `delLote`; y porque lo guardado se lee entero (paginado y con orden) y
 * sólo se descarta por empleado *en memoria*, después de leerlo. Si alguien
 * cambia alguno de esos filtros, tiene que volver a comprobarlo.
 */
async function contextoDe(admin: SupabaseClient, dias: DiaEnJuego[]): Promise<ContextoDeDecision> {
  const vacio: ContextoDeDecision = {
    diasCorregidos: new Set(), diasLiquidados: new Set(), guardadas: new Map(),
  };
  if (dias.length === 0) return vacio;

  const fechasPorEmpleado = new Map<string, Set<string>>();
  for (const d of dias) {
    const fechas = fechasPorEmpleado.get(d.empleadoId);
    if (fechas) fechas.add(d.fecha);
    else fechasPorEmpleado.set(d.empleadoId, new Set([d.fecha]));
  }
  const fechas = dias.map((d) => d.fecha).sort();
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];

  // Se filtra por rango de fechas y no con un .in() de ids: con muchos ids
  // PostgREST arma una URL que rechaza con un 400 sin decir por qué.
  //
  // Y va con traerTodo y no con .limit(): PostgREST corta en 1000 filas y no
  // avisa. `fichadas` tiene 4.700 y crece todos los días; un mes de un lote
  // grande pasa el corte sin que nada falle, y el contexto incompleto se
  // traduce en días que se pisan porque "no estaban protegidos".
  // traerTodo recibe una función (desde, hasta) y le pasa .range() — ver la
  // firma en lib/core/paginado.ts:13.
  //
  // El `.order("id")` NO es decorativo. `.range()` es LIMIT/OFFSET, y sin un
  // orden determinístico Postgres no garantiza que dos páginas consecutivas
  // no repitan ni saltean filas. Acá eso no daría un error: daría una
  // divergencia falsa, o un "guardado sin fichadas" falso, en días que no
  // cambiaron — y entonces nadie vuelve a leer los avisos. `fichadas` ya
  // tiene 4.700 filas y crece todos los días, así que pasar las 1000 de una
  // página es cuestión de tiempo.
  const corregidos = await traerTodo<{ empleado_id: string; fecha: string }>((d, h) =>
    admin.from("rrhh_dias_corregidos").select("empleado_id, fecha")
      .gte("fecha", desde).lte("fecha", hasta).order("id").range(d, h)
  );
  const liquidaciones = await traerTodo<{ empleado_id: string; fecha_desde: string; fecha_hasta: string }>((d, h) =>
    admin.from("liquidaciones").select("empleado_id, fecha_desde, fecha_hasta")
      .eq("estado", "CERRADA").lte("fecha_desde", hasta).gte("fecha_hasta", desde).order("id").range(d, h)
  );
  const existentes = await traerTodo<{ empleado_id: string; fecha: string; hora_entrada: string; hora_salida: string | null }>((d, h) =>
    admin.from("fichadas").select("empleado_id, fecha, hora_entrada, hora_salida")
      .gte("fecha", desde).lte("fecha", hasta).order("id").range(d, h)
  );

  const diasCorregidos = new Set<string>();
  for (const c of corregidos) {
    if (fechasPorEmpleado.has(c.empleado_id)) diasCorregidos.add(claveDia(c.empleado_id, c.fecha));
  }

  const diasLiquidados = new Set<string>();
  for (const l of liquidaciones) {
    for (const f of fechasPorEmpleado.get(l.empleado_id) ?? []) {
      if (f >= l.fecha_desde && f <= l.fecha_hasta) diasLiquidados.add(claveDia(l.empleado_id, f));
    }
  }

  const guardadas = new Map<string, FichadaGuardada[]>();
  for (const f of existentes) {
    if (!fechasPorEmpleado.has(f.empleado_id)) continue;
    const clave = claveDia(f.empleado_id, f.fecha);
    if (!guardadas.has(clave)) guardadas.set(clave, []);
    guardadas.get(clave)!.push({ horaEntrada: f.hora_entrada, horaSalida: f.hora_salida });
  }

  return { diasCorregidos, diasLiquidados, guardadas };
}
