import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { recalcularEmpleadoPeriodo } from "../engine/recalcular";
import { diaIso, fechaArgentinaDe } from "../dates";
import {
  decidirQueAplicar, claveDia, motivoDeProteccion, elegirAbiertoPrevio, avisoDeAbiertasViejas,
  rangoDeRecalculo, diasLiquidadosDe, armarTurnos, turnosYaEmparejados, textoDeMotivo,
  type TramoImputado, type ContextoDeDecision, type FichadaGuardada, type FichadaAbierta, type DiaSalteado,
  type DiasDeEmpleado, type LoteAAplicar, type TurnoNuevo,
} from "./decidir";

export type { DiasDeEmpleado, TurnoNuevo, LoteAAplicar };

export interface ResultadoAplicar {
  insertados: number;
  reemplazados: number;
  salteados: DiaSalteado[];
  avisos: string[];
  /**
   * Cosas que una persona tiene que hacer y que no son un error de la corrida:
   * hoy, las fichadas que quedaron abiertas de antes y no se pueden cerrar con
   * estos datos. Van aparte de `avisos` para que quien llama pueda mostrarlas
   * sin contarlas como errores ni hacer fallar la sincronización.
   *
   * El texto depende del primer día del lote —el "antes del" y cuáles fichadas
   * cuentan como viejas—, así que dos llamadas con rangos distintos dan textos
   * distintos y no se pueden deduplicar comparándolos. Hoy `aplicarDias` se
   * llama una vez por corrida y el caso no se da; quien parta un lote en varias
   * llamadas tiene que decidir cuál conservar.
   */
  pendientes: string[];
}

/** Un (empleado, día) que este lote toca o quiere tocar. */
interface DiaEnJuego {
  empleadoId: string;
  fecha: string; // "YYYY-MM-DD"
}

/**
 * Cuántas fechas van en un `.in()` de borrado. Una fecha ocupa ~11 caracteres
 * de la URL, así que 200 son ~2 KB: lejos del límite en el que PostgREST
 * responde un 400 sin decir por qué. Y 200 días por empleado dan, como mucho,
 * unas mil filas devueltas por el `.select(...)` del borrado: el corte de las
 * 1000 filas no se alcanza con fichadas de verdad.
 */
const FECHAS_POR_BORRADO = 200;

/** Filas por `insert`, para no armar un request gigante. */
const FILAS_POR_TANDA = 500;

/**
 * El alta de fichadas, compartida por los dos caminos de carga: el import de
 * Excel y la sincronización con Lenox.
 *
 * Está acá y no en la ruta porque el Excel se queda como respaldo, y dos
 * caminos de escritura separados se van separando — y el que casi no se usa
 * es el que se pudre sin que nadie lo note.
 *
 * `admin` y no un cliente de sesión: el cron no tiene sesión. Por eso mismo
 * `recalcularEmpleadoPeriodo` recibe también el admin (acepta cualquier
 * `SupabaseClient`).
 *
 * RIESGOS ASUMIDOS, no resueltos: nada de esto es atómico. PostgREST no ofrece
 * una transacción de varias sentencias, y meter una función de Postgres sólo
 * para esto sería desproporcionado. Hay tres puntos donde un fallo deja el
 * trabajo a medias, en este orden:
 *
 * 1. **Falla el borrado en el empleado N.** Los empleados 1 a N-1 ya tienen sus
 *    días vacíos, sin alta y sin recálculo; el resto no se tocó.
 * 2. **Falla una tanda del `insert`.** Los días a reemplazar ya están borrados
 *    y quedan vacíos (o a medias, si la primera tanda entró y la segunda no).
 *    El recálculo no corrió.
 * 3. **Falla el `update` de un cierre, o el recálculo de un empleado.** Las
 *    fichadas ya están confirmadas y `calculos_diarios` queda desfasado de
 *    ellas. Un cierre que falla frena ahí. Un recálculo que falla NO frena a
 *    los demás: se intenta con todos los empleados, se juntan los fallos y se
 *    tira un solo error al final con los legajos que fallaron.
 *
 * Se aceptan porque se curan solos, cada uno por su razón verificable:
 * - 1 y 2: `decidirQueAplicar` no omite los días que ya están idénticos, así
 *   que la próxima corrida vuelve a borrar esos días y a insertarlos completos,
 *   y el recálculo los alcanza. Funciona con el cron de mañana, con el botón, o
 *   volviendo a subir el Excel.
 * - 3, el recálculo, si el fallo fue transitorio: la corrida siguiente
 *   recalcula el rango de lo que inserta, que cubre esos días salvo el más
 *   viejo, que sale de la ventana (ver abajo).
 *
 * Lo que NO se cura solo: un recálculo que falla por los datos de un empleado
 * y no por la red, que se repite todos los días hasta que alguien mira ese
 * dato —por eso no puede frenar a los que siguen en la lista, y por eso el
 * error nombra los legajos—; un día que quede fuera del rango de la próxima
 * corrida (el cron mira siete días); y el cierre de una fichada abierta cuyo
 * `update` falló. Ese cierre sólo se reintenta si la próxima corrida arranca el
 * mismo día; si el rango ya avanzó, esa fichada deja de ser la del "día
 * anterior" y pasa a `pendientes` ("hay que cerrarlas a mano"), que es donde
 * una persona la ve. Un día vacío por fuera del rango sólo se arregla con el
 * botón.
 *
 * Por eso cada error se tira con lo que dijo la base, sin traducir, y diciendo
 * qué quedó a medias; y es quien llama el que tiene que dejarlo escrito en el
 * lote (`log_detalle`): un `throw` que nadie anota es un día vacío que nadie
 * sabe que está vacío.
 *
 * Recibe un `LoteAAplicar`: marcas crudas a reconciliar o turnos ya
 * emparejados. Por qué hay dos está explicado en ese tipo.
 *
 * No se invierte el orden (insertar primero, borrar después lo viejo) porque
 * cambia un riesgo por otro peor: un fallo del borrado dejaría el día
 * duplicado, y las horas duplicadas se pagan.
 */
export async function aplicarDias(
  admin: SupabaseClient,
  lote: LoteAAplicar,
  opciones: { batchId: string; protegerCorregidos: boolean }
): Promise<ResultadoAplicar> {
  // Dos formas de entrar, y el motivo está en `LoteAAplicar`: marcas crudas que
  // hay que reconciliar, o turnos que el origen ya emparejó. Desde acá en
  // adelante es todo lo mismo.
  let armado: ReturnType<typeof armarTurnos>;
  let legajoPorEmpleado: Map<string, string>;
  let pendiente: string | null = null;
  if (lote.tipo === "marcas") {
    const conDatos = lote.empleados.filter((e) => e.dias.length > 0);
    // Si de una carga anterior quedó un turno sin marcación de salida, se
    // encadena para que el primer dato de este lote pueda cerrarlo en vez de
    // quedar abierto para siempre. Una consulta para todos, no una por empleado.
    const previas = await abiertasPrevias(admin, conDatos);
    pendiente = previas.pendiente;
    armado = armarTurnos(conDatos, previas.encadenables);
    legajoPorEmpleado = new Map(conDatos.map((e) => [e.empleadoId, e.legajo]));
  } else {
    armado = turnosYaEmparejados(lote.turnos);
    legajoPorEmpleado = new Map(lote.turnos.map((t) => [t.empleadoId, t.legajo]));
  }
  const { turnos, cierres, imputados, avisos } = armado;

  const ctx = await contextoDe(admin, [
    ...turnos.map((t) => ({ empleadoId: t.empleadoId, fecha: diaIso(t.fecha) })),
    // El día de una fichada que se va a cerrar también se mira: cerrarla le
    // cambia las horas a ese día igual que insertar.
    ...cierres.map((c) => ({ empleadoId: c.empleadoId, fecha: diaIso(c.fecha) })),
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
  let empleadosVaciados = 0;
  // Lo borrado también cuenta para el recálculo: una fichada vieja que cruzaba
  // medianoche deja de existir, y el día siguiente tiene que perder esas horas
  // aunque la versión nueva ya no cruce y no traiga turnos propios ese día.
  const borradas: TramoImputado[] = [];
  for (const [empleadoId, fechas] of fechasPorEmpleado) {
    for (let i = 0; i < fechas.length; i += FECHAS_POR_BORRADO) {
      const { data: borrados, error } = await admin
        .from("fichadas")
        .delete()
        .eq("empleado_id", empleadoId)
        .eq("origen", "IMPORTADO")
        .in("fecha", fechas.slice(i, i + FECHAS_POR_BORRADO))
        .select("id, fecha, hora_salida");
      // Sin esta guarda, un borrado que falla sigue de largo y el alta deja el
      // día duplicado: las horas duplicadas se pagan.
      if (error) {
        const hecho =
          empleadosVaciados === 0 && i === 0
            ? "todavía no se había borrado nada"
            : `ya se habían vaciado los días de ${empleadosVaciados} de ${fechasPorEmpleado.size} empleados, sin alta ni recálculo`;
        throw new Error(
          `Borrando las fichadas a reemplazar del legajo ${legajoPorEmpleado.get(empleadoId) ?? empleadoId} (${hecho}): ${error.message}`
        );
      }
      for (const b of (borrados ?? []) as { fecha: string; hora_salida: string | null }[]) {
        const fecha = new Date(b.fecha);
        borradas.push({
          empleadoId,
          fecha,
          fechaSalida: b.hora_salida ? fechaArgentinaDe(new Date(b.hora_salida)) : fecha,
        });
      }
      reemplazados += borrados?.length ?? 0;
    }
    empleadosVaciados++;
  }

  const filas = decision.aInsertar.map((t) => ({
    empleado_id: t.empleadoId,
    fecha: diaIso(t.fecha),
    hora_entrada: t.horaEntrada.toISOString(),
    hora_salida: t.horaSalida ? t.horaSalida.toISOString() : null,
    origen: "IMPORTADO",
    import_batch_id: opciones.batchId,
  }));
  const tandas = Math.ceil(filas.length / FILAS_POR_TANDA);
  for (let i = 0; i < filas.length; i += FILAS_POR_TANDA) {
    const { error } = await admin.from("fichadas").insert(filas.slice(i, i + FILAS_POR_TANDA));
    if (error) {
      throw new Error(
        `Insertando fichadas (tanda ${i / FILAS_POR_TANDA + 1} de ${tandas}, ${i} de ${filas.length} filas ya insertadas; ` +
          `los días a reemplazar ya estaban borrados y el recálculo no corrió): ${error.message}`
      );
    }
  }

  // Lo que se recalcula: los turnos que de verdad se aplicaron —no los de días
  // salteados— con su día de salida, las fichadas borradas con el suyo, y más
  // abajo las cerradas. El rango sale de `rangoDeRecalculo`, que tiene tests.
  const salteadas = new Set(decision.salteados.map((s) => claveDia(s.empleadoId, s.fecha)));
  const aRecalcular: TramoImputado[] = [
    ...imputados.filter((im) => !salteadas.has(claveDia(im.empleadoId, diaIso(im.fecha)))),
    ...borradas,
  ];

  // Cerrar una fichada abierta cambia las horas de su día, así que pasa por la
  // misma protección que insertar. Si no, una liquidación cerrada con un turno
  // nocturno sin salida se movería sola cuando entra la marca del día
  // siguiente: justo lo que la protección está para impedir.
  const cierresOmitidos: DiaSalteado[] = [];
  let cierresAplicados = 0;
  for (const c of cierres) {
    const fecha = diaIso(c.fecha);
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
    if (error) {
      throw new Error(
        `Cerrando la fichada abierta del legajo ${c.legajo} (${fecha}); las ${decision.aInsertar.length} fichadas ya estaban ` +
          `insertadas y los días borrados; ${
            cierresAplicados === 0
              ? "ningún cierre anterior se había aplicado"
              : `${cierresAplicados} cierres anteriores sí se aplicaron`
          }, y ni ellos ni nada de lo insertado se recalculó: ${error.message}`
      );
    }
    cierresAplicados++;
    aRecalcular.push({ empleadoId: c.empleadoId, fecha: c.fecha, fechaSalida: c.fechaSalida });
  }

  // Una sola vez por empleado, con su rango completo: tanto lo insertado como
  // lo cerrado.
  //
  // Un fallo no frena a los que siguen: si viene de los datos de un empleado se
  // repite todos los días, y cortar acá dejaría sin recalcular, en cada corrida
  // y sin que nada lo note, a todos los que vienen después en la lista.
  const rangos = rangoDeRecalculo(aRecalcular);
  const fallos = new Map<string, string[]>(); // mensaje de la base -> legajos
  for (const [empleadoId, r] of rangos) {
    try {
      await recalcularEmpleadoPeriodo(admin, empleadoId, r.min, r.max);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const legajo = legajoPorEmpleado.get(empleadoId) ?? empleadoId;
      const legajos = fallos.get(mensaje);
      if (legajos) legajos.push(legajo);
      else fallos.set(mensaje, [legajo]);
    }
  }
  if (fallos.size > 0) {
    const cuantos = [...fallos.values()].reduce((n, l) => n + l.length, 0);
    throw new Error(
      `Recalculando: las fichadas ya estaban guardadas, pero calculos_diarios queda desfasado para ` +
        `${cuantos} de ${rangos.size} empleados (los demás sí se recalcularon). ` +
        // Agrupado por mensaje: si es la base la que cayó, son 68 veces el mismo texto.
        [...fallos].map(([mensaje, legajos]) => `Legajos ${legajos.join(", ")}: ${mensaje}`).join(" | ")
    );
  }

  for (const s of decision.salteados) {
    avisos.push(
      `Legajo ${s.legajo}, ${s.fecha}: no se tocó (${textoDeMotivo(s.motivo)})` +
        (s.divergencia ? ` — ${s.divergencia}` : "")
    );
  }
  for (const s of cierresOmitidos) {
    avisos.push(
      `Legajo ${s.legajo}, ${s.fecha}: no se cerró el turno que había quedado sin salida (${textoDeMotivo(s.motivo)})`
    );
  }

  return {
    insertados: decision.aInsertar.length,
    reemplazados,
    salteados: [...decision.salteados, ...cierresOmitidos],
    avisos,
    pendientes: pendiente ? [pendiente] : [],
  };
}

/**
 * Las fichadas abiertas de antes del lote: cuáles se encadenan y el aviso de
 * las que ya no se pueden cerrar.
 *
 * La consulta trae todas las abiertas anteriores al día más tardío de los
 * primeros días del lote, sin filtrar por empleado —no con un `.in()` de ids—,
 * y la capa pura reparte: `elegirAbiertoPrevio` se queda con la que se puede
 * encadenar de cada uno y `avisoDeAbiertasViejas` resume el resto en una línea.
 */
async function abiertasPrevias(
  admin: SupabaseClient,
  empleados: DiasDeEmpleado[]
): Promise<{ encadenables: Map<string, FichadaAbierta>; pendiente: string | null }> {
  if (empleados.length === 0) return { encadenables: new Map(), pendiente: null };

  const primerDia = new Map(empleados.map((e) => [e.empleadoId, diaIso(e.dias[0].fecha)]));
  const legajos = new Map(empleados.map((e) => [e.empleadoId, e.legajo]));
  const tope = [...primerDia.values()].sort().at(-1)!;

  const filas = await traerTodo<{ id: string; empleado_id: string; fecha: string; hora_entrada: string }>((d, h) =>
    admin.from("fichadas").select("id, empleado_id, fecha, hora_entrada")
      .is("hora_salida", null).lt("fecha", tope).order("id").range(d, h)
  );
  const abiertas = filas.map((f) => ({ id: f.id, empleadoId: f.empleado_id, fecha: f.fecha, horaEntrada: f.hora_entrada }));

  return {
    encadenables: elegirAbiertoPrevio(abiertas, primerDia),
    pendiente: avisoDeAbiertasViejas(abiertas, primerDia, legajos),
  };
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

  const diasLiquidados = diasLiquidadosDe(
    liquidaciones.map((l) => ({ empleadoId: l.empleado_id, desde: l.fecha_desde, hasta: l.fecha_hasta })),
    fechasPorEmpleado
  );

  const guardadas = new Map<string, FichadaGuardada[]>();
  for (const f of existentes) {
    if (!fechasPorEmpleado.has(f.empleado_id)) continue;
    const clave = claveDia(f.empleado_id, f.fecha);
    if (!guardadas.has(clave)) guardadas.set(clave, []);
    guardadas.get(clave)!.push({ horaEntrada: f.hora_entrada, horaSalida: f.hora_salida });
  }

  return { diasCorregidos, diasLiquidados, guardadas };
}
