import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { traerTodo } from "@/lib/core/paginado";
import { comoSeLee, hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { ritmoPorModulo } from "@/lib/home/ritmo";
import { traerRitmo, diaDeReferenciaRrhh, equiposTallerVialSinService } from "@/lib/home/consultas";
import {
  traerBochones, traerConsumosDe, traerVoladuras, traerYacimientos,
} from "@/lib/cantera/consultas";
import { armarFilaBochon, armarFilaVoladura, contarAvisos } from "@/lib/cantera/tablero";
import type { Consumo } from "@/lib/cantera/types";

/** Resumen liviano para la página de Inicio: solo los números de los módulos a los que el usuario tiene acceso. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const { data: grants } = await supabase.from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);
  const rol = usuario.rol as Rol;
  const modulos = new Set(modulosVisibles(rol, (grants ?? []) as UsuarioModulo[]));

  // `hoyEnArgentina()` y no `utcDateOnlyFrom(new Date())`: Vercel corre en UTC,
  // así que entre las 21:00 y la medianoche argentina el servidor ya cree que es
  // mañana. La campana —`/api/home/avisos`— ya usa este criterio; con dos
  // distintos, la tarjeta de Despacho y el aviso de Despacho mostrarían días
  // diferentes en esa franja.
  const hoyStr = hoyEnArgentina();
  const mesActual = hoyStr.slice(0, 7);

  const [rrhh, remises, mantenimiento, compras, inventario, produccion,
         despacho, facturacion, cantera, calidad, tallerVial, trituracion, filasRitmo] =
    await Promise.all([
      modulos.has("rrhh") ? resumenRrhh(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("remises") ? resumenRemises(supabase) : Promise.resolve(null),
      modulos.has("mantenimiento") ? resumenMantenimiento(supabase) : Promise.resolve(null),
      modulos.has("compras") ? resumenCompras(supabase) : Promise.resolve(null),
      modulos.has("inventario") ? resumenInventario(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("produccion") ? resumenProduccion(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("despacho") ? resumenDespacho(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("facturacion") ? resumenFacturacion(supabase) : Promise.resolve(null),
      modulos.has("cantera") ? resumenCantera(supabase) : Promise.resolve(null),
      modulos.has("calidad") ? resumenCalidad(supabase) : Promise.resolve(null),
      modulos.has("taller_vial") ? resumenTallerVial(supabase) : Promise.resolve(null),
      modulos.has("trituracion") ? resumenTrituracion(supabase, mesActual) : Promise.resolve(null),
      traerRitmo(supabase),
    ]);

  return NextResponse.json({
    rrhh, remises, mantenimiento, compras, inventario, produccion,
    despacho, facturacion, cantera, calidad, tallerVial, trituracion,
    ritmo: ritmoPorModulo(filasRitmo),
  });
}

/**
 * Los ausentes del último día hábil con fichadas, no los de hoy.
 *
 * El titular era "Ausentes hoy" y el 06/10 decía **1**: a media mañana
 * `calculos_diarios` tenía 2 filas de 68 porque el día no está cerrado. El día
 * anterior había 66 — de 68 — porque las fichadas se cortaron el 30/09 y el
 * cálculo marca ausente a todo el mundo cuando no hay con qué comparar.
 *
 * `ultimoDiaHabilConFichadas` esquiva las tres trampas: hoy, los domingos (los
 * 36 que ya pasaron en 2026 tienen 0 ausentes) y los días sin fichadas importadas
 * (la importación anda a ráfagas). El rótulo nombra el día que
 * terminó eligiendo, así que mostrar uno viejo no engaña a nadie.
 */
async function resumenRrhh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hoyStr: string
) {
  const dia = await diaDeReferenciaRrhh(supabase, hoyStr);
  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const ids = (empleados ?? []).map((e) => e.id);
  const empleadosActivos = ids.length;

  if (!dia || empleadosActivos === 0) {
    return { empleadosActivos, dia: null, diaLegible: null, ausentes: 0, sinClasificar: 0 };
  }

  const { data: calculos } = await supabase
    .from("calculos_diarios")
    .select("ausente, justificada")
    .in("empleado_id", ids)
    .eq("fecha", dia);

  return {
    empleadosActivos,
    dia,
    diaLegible: comoSeLee(dia),
    ausentes: (calculos ?? []).filter((c) => c.ausente).length,
    sinClasificar: (calculos ?? []).filter((c) => c.ausente && c.justificada === null).length,
  };
}

/**
 * Remises no tiene una cola de trabajo que mirar: lo único accionable del módulo
 * es que se esté cargando, y de eso se ocupa la señal de ritmo. La tarjeta
 * muestra el padrón de vehículos, que es contexto y no un indicador.
 */
async function resumenRemises(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { count } = await supabase
    .from("vehiculos").select("id", { count: "exact", head: true }).eq("activo", true);
  return { vehiculosActivos: count ?? 0 };
}

/**
 * Lo que Mantenimiento tiene sin hacer.
 *
 * El titular era "mantenimientos vencidos" y medía una tabla con **una sola
 * fila**: hay un único mantenimiento programado cargado en todo el sistema, así
 * que ese número sólo podía decir 0 o 1. No es que no hubiera trabajo atrasado
 * —hay 12 órdenes en ATRASADO—, es que el indicador miraba donde no había nada.
 * Vuelve cuando la programación se use de verdad.
 *
 * Los tres de ahora se mueven todas las semanas y los tres piden hacer algo,
 * que es lo único que justifica ocupar la tarjeta del inicio.
 */
async function resumenMantenimiento(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [otCounts, avisos] = await Promise.all([
    Promise.all(
      ["POR_HACER", "EN_PROCESO", "ATRASADO"].map((estado) =>
        supabase.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("estado", estado)
      )
    ),
    // Los avisos se cuentan en memoria porque "sin orden" son dos columnas: la
    // sincronización guarda el número de la planilla como texto en
    // `ot_asignada` y sólo los generados desde la app llenan `work_order_id`.
    // Mirando una sola, los 141 avisos parecerían estar todos sin atender.
    traerTodo<{ work_order_id: string | null; ot_asignada: string | null }>((desde, hasta) =>
      supabase.from("avisos").select("work_order_id, ot_asignada").range(desde, hasta)
    ),
  ]);

  const [porHacer, enProceso, atrasadas] = otCounts.map((r) => r.count ?? 0);

  // Un guión suelto es cómo se escribe "acá no va nada" en la planilla.
  const tieneOrden = (a: { work_order_id: string | null; ot_asignada: string | null }) =>
    Boolean(a.work_order_id) || !["", "-"].includes(String(a.ot_asignada ?? "").trim());

  return {
    atrasadas,
    otPendientes: porHacer + enProceso + atrasadas,
    avisosSinOrden: avisos.filter((a) => !tieneOrden(a)).length,
  };
}

/**
 * El estado del circuito de compras.
 *
 * Sale de la misma vista que alimenta el tablero, así que los números del
 * inicio y los del tablero no pueden decir cosas distintas. Lo que espera
 * aprobación de gerencia se cuenta aparte: esa cola vive antes del circuito
 * de compra y no está en la vista.
 */
async function resumenCompras(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ data: porEstado }, { count: esperandoAprobacion }] = await Promise.all([
    supabase.from("compras_resumen_por_estado").select("estado_compra, cantidad"),
    supabase
      .from("compras_requerimientos")
      .select("id", { count: "exact", head: true })
      .in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"]),
  ]);

  const cantidad = (estado: string) =>
    Number((porEstado ?? []).find((f) => f.estado_compra === estado)?.cantidad ?? 0);

  // Lo que de verdad es trabajo por hacer: ni lo ya pedido, ni lo frenado a
  // propósito.
  const enCurso =
    cantidad("SIN_INICIAR") + cantidad("EN_COMPARATIVA") +
    cantidad("PARA_COMPRAR") + cantidad("APROBADO");

  return {
    enCurso,
    esperandoAprobacion: esperandoAprobacion ?? 0,
    paraComprar: cantidad("PARA_COMPRAR"),
  };
}

/**
 * Lo que el pañol tiene sin resolver.
 *
 * El titular es lo que está por debajo del stock de seguridad, que es la
 * consulta que más se hace y la que ordena el trabajo: son las compras que hay
 * que pedir. `faltante` es una columna generada —`stock_seguridad -
 * stock_actual`, acotada a cero—, así que se cuenta con un filtro y no
 * trayendo los 1.147 artículos.
 *
 * Los movimientos que no llegaron a la planilla van al lado y también son una
 * notificación: el stock sale de las fórmulas de allá, así que la próxima
 * sincronización los revierte. Normalmente es cero, y cuando no lo es hay que
 * hacer algo hoy.
 */
async function resumenInventario(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hoyStr: string
) {
  const [{ count: faltantes }, { count: movimientosHoy }, { count: sinLlegar }] = await Promise.all([
    supabase.from("inventario_articulos")
      .select("id", { count: "exact", head: true }).eq("activo", true).gt("faltante", 0),
    supabase.from("inventario_movimientos")
      .select("id", { count: "exact", head: true }).eq("fecha", hoyStr),
    supabase.from("inventario_movimientos")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);

  return {
    faltantes: faltantes ?? 0,
    movimientosHoy: movimientosHoy ?? 0,
    sinLlegarALaPlanilla: sinLlegar ?? 0,
  };
}

/**
 * Lo que Producción tiene sin cargar.
 *
 * Un parte que falta no es sólo un dato ausente: la producción del turno
 * siguiente se despeja contra el depósito del parte anterior, así que no se
 * puede calcular hasta que esté. Son 2 turnos por día — `TURNOS` en
 * `lib/produccion/turnos.ts` — y se mira una semana hacia atrás: 14 partes
 * posibles, y `partesFaltantes` es cuántos de esos no están.
 *
 * La planta no tiene un calendario de días sin producción — el diseño del
 * módulo (`lib/produccion/turnos.ts`) trata cada `(fecha, turno)` como un
 * valor más, sin excepción de fin de semana — así que un domingo cuenta igual
 * que cualquier otro día. Adivinar acá qué días "no cuentan" escondería el
 * caso real: si alguna vez sí hay producción un domingo y nadie carga el
 * parte, es exactamente el hueco que esta alarma tiene que mostrar.
 *
 * `sinLlegarALaPlanilla` no se acota a la semana: es historia completa, igual
 * que el mismo número en Inventario — mientras un parte tenga
 * `sheets_pendiente` sin resolver, la planilla que mira gerencia está mostrando
 * ese día en blanco.
 */
async function resumenProduccion(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const desde = sumarDias(hoyStr, -6);
  const [{ data: partes, error }, { count: sinLlegar }] = await Promise.all([
    supabase.from("produccion_partes").select("id").gte("fecha", desde).lte("fecha", hoyStr),
    supabase.from("produccion_partes").select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);
  // Sin chequear el error, una consulta fallida deja `partes` en null, `(partes
  // ?? []).length` en 0, y `partesFaltantes` sale en 14 — el peor caso posible
  // informado como si fuera un dato real. No se puede lanzar acá: esta función
  // corre adentro del mismo `Promise.all` que junta los resúmenes del Inicio, y
  // el `.catch` de `InicioClient` limpia la pantalla entera ante cualquier
  // rechazo — un error de Producción apagaría también RRHH, Mantenimiento,
  // Compras e Inventario, que sí contestaron bien. Se devuelve `null`: la
  // tarjeta de Producción queda sin datos, el mismo trato que ya tiene un módulo
  // al que el usuario no tiene acceso, y el resto del Inicio no se entera.
  if (error) {
    console.error("resumenProduccion: no se pudo traer produccion_partes:", error.message);
    return null;
  }

  return {
    partesFaltantes: Math.max(0, 14 - (partes ?? []).length),
    sinLlegarALaPlanilla: sinLlegar ?? 0,
  };
}

/**
 * Lo que Despacho tiene abierto.
 *
 * El titular era "órdenes de carga hoy" y marcaba 0 en el módulo más vivo del
 * sistema —1.998 órdenes, 331 el último mes—, porque la carga va a ráfagas. Lo
 * que queda son las dos alarmas, y las dos son sobre la planilla: una orden
 * abierta de un día anterior no llegó porque el espejo escribe al cerrar; una
 * con `sheets_pendiente` no llegó porque Google rechazó la escritura.
 *
 * `abiertasDeDiasAnteriores` cuenta **sólo las que nacieron en el sistema**
 * (`cargado_por` no nulo). Del histórico importado hay 358 de 1.998 sin salida
 * del predio, y ésas no son un olvido accionable: la planilla nunca tuvo esa
 * hora. Contarlas haría que el Inicio abriera con un 358 que nadie puede bajar.
 */
async function resumenDespacho(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const [{ count: abiertas }, { count: sinLlegar }] = await Promise.all([
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true })
      .lt("fecha", hoyStr).is("salida_predio", null).not("cargado_por", "is", null),
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);
  return { abiertasDeDiasAnteriores: abiertas ?? 0, sinLlegarALaPlanilla: sinLlegar ?? 0 };
}

/**
 * El buzón de facturas.
 *
 * El titular era "lo que entró hoy" y hay **2 facturas en todo el sistema**: iba
 * a decir 0 casi siempre. Lo que queda pide hacer algo: una factura que nadie
 * enganchó a una compra es la que después aparece en Odoo sin que nadie sepa de
 * qué era, y un CUIT fuera del padrón se arregla cargándoselo al proveedor para
 * que la próxima se enganche sola.
 */
async function resumenFacturacion(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ count: sinVincular }, { count: sinProveedor }] = await Promise.all([
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("requerimiento_id", null).eq("estado", "recibida"),
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("proveedor_id", null),
  ]);
  return { sinVincular: sinVincular ?? 0, sinProveedor: sinProveedor ?? 0 };
}

/**
 * Lo que Cantera tiene sin resolver.
 *
 * Es el mismo aviso que ordena el tablero de Registros (`contarAvisos` de
 * `lib/cantera/tablero.ts`): facturas sin conciliar o a revisar.
 *
 * Las toneladas voladas y el acarreo a pagar del mes **se sacaron del Inicio**.
 * Eran las que obligaban a traer `cantera_acarreos`, `cantera_pesadas` y
 * `cantera_tarifas_acarreo` enteras para calcular en memoria dos números que ya
 * están en la página de inicio del módulo, a un clic.
 */
async function resumenCantera(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [yacimientos, vs, bs] = await Promise.all([
    traerYacimientos(supabase, true),
    traerVoladuras(supabase, {}),
    traerBochones(supabase, {}),
  ]);
  const porId = new Map(yacimientos.map((y) => [y.id, y]));

  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const filasVoladura = vs.map((v) =>
    armarFilaVoladura(v, porId.get(v.yacimiento_id) ?? null, consumosPorCodigo.get(v.codigo) ?? [])
  );
  const filasBochon = bs.map((b) => armarFilaBochon(b, porId.get(b.yacimiento_id) ?? null));
  const { sinConciliar } = contarAvisos(filasVoladura, filasBochon);

  return { sinConciliar };
}

/**
 * Calidad, que no tenía tarjeta: quien sólo tiene ese módulo entraba al Inicio y
 * veía una grilla vacía, ni siquiera el cartel de "no tenés acceso" —porque
 * `modulos.length` no es 0—.
 *
 * El titular sale de **envases** y no de carbonilla: la bandeja de Odoo de
 * carbonilla (`calidad_odoo_sin_reconocer`) está vacía, y el stock de envases
 * bajo el mínimo es una cola corta y accionable, 3 de 28 artículos. `faltante`
 * es una columna generada, así que se cuenta con un filtro.
 *
 * Y en envases **manda la planilla**: un movimiento con `sheets_pendiente` no
 * llegó allá, y como el stock es una fórmula sobre el kardex, la próxima
 * sincronización lo borra de hecho.
 */
async function resumenCalidad(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ count: envasesBajoMinimo }, { count: sinLlegar }] = await Promise.all([
    supabase.from("calidad_envases_articulos")
      .select("id", { count: "exact", head: true }).eq("activo", true).gt("faltante", 0),
    supabase.from("calidad_envases_movimientos")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);
  return { envasesBajoMinimo: envasesBajoMinimo ?? 0, sinLlegarALaPlanilla: sinLlegar ?? 0 };
}

/**
 * Lo que Taller Vial tiene sin resolver.
 *
 * Una carga sin equipo reconocido —texto suelto como "empresa piparo" en vez de
 * un código EM— no entra en ningún resumen por equipo hasta que alguien la
 * corrija. Hoy son 3.
 *
 * LAS DOS ALARMAS DE SERVICE SE FUERON, Y POR QUÉ
 *
 * Eran "service de 250 hs vencido" y "service por vencer", y medido el
 * 07/10/2026 son el mismo caso que los "mantenimientos vencidos" que ya se
 * sacaron: 16 equipos activos, 805 cargas de combustible y **un solo service
 * registrado en todo el sistema**. El escalón de 250 hs, equipo por equipo, da
 * 15 de 16 en `null` y 1 en VENCIDO, así que `serviceVencidos` sólo podía decir
 * 0 o 1 y `serviceProximos` estaba clavado en 0.
 *
 * Y los 15 `null` eran la información que se perdía: no significan "está todo
 * bien", significan que a 15 de los 16 equipos **nunca se les anotó un
 * service** —13 con horómetro conocido, o sea trabajando y acumulando horas—.
 * Eso sí es una cola que alguien puede bajar, y es el indicador que quedó.
 *
 * El "1 vencido" no se perdió: sigue estando en `/taller-vial/services`, que es
 * donde tiene sentido mirarlo equipo por equipo.
 *
 * El efecto colateral es que esta función pasa a ser todo conteos baratos: ya no
 * hace falta traer las 805 cargas ni calcular el horómetro de cada equipo, que
 * era lo único que obligaba a leer historia.
 */
async function resumenTallerVial(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [{ count: sinEquipoReconocido }, { equiposSinService, equiposTotal }] = await Promise.all([
    supabase.from("taller_vial_cargas")
      .select("id", { count: "exact", head: true }).is("equipo_id", null),
    equiposTallerVialSinService(supabase),
  ]);

  return { sinEquipoReconocido: sinEquipoReconocido ?? 0, equiposSinService, equiposTotal };
}

/**
 * Trituración, que tampoco tenía tarjeta. Mismo problema de grilla vacía que
 * Calidad.
 *
 * El titular es lo que no se exportó a la planilla: en Trituración la planilla
 * es donde miran los que no entran al sistema, así que un parte que se quedó acá
 * es un día que allá figura en blanco. Los partes del mes van de secundaria,
 * como volumen.
 */
async function resumenTrituracion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  mesActual: string
) {
  const [{ count: sinLlegar }, { count: partesDelMes }] = await Promise.all([
    supabase.from("trituracion_partes")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
    supabase.from("trituracion_partes")
      .select("id", { count: "exact", head: true }).gte("fecha", `${mesActual}-01`),
  ]);
  return { sinLlegarALaPlanilla: sinLlegar ?? 0, partesDelMes: partesDelMes ?? 0 };
}
