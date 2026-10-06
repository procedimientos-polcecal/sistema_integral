import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { idsOrDummy } from "@/lib/rrhh/dashboardHelpers";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";
import { traerTodo } from "@/lib/core/paginado";
import { sumarDias } from "@/lib/core/fechas";
import {
  traerAcarreos, traerBochones, traerConsumosDe, traerFleteros,
  traerPesadas, traerTarifasAcarreo, traerVoladuras, traerYacimientos,
} from "@/lib/cantera/consultas";
import { armarFilaBochon, armarFilaVoladura, contarAvisos } from "@/lib/cantera/tablero";
import { resumenPorFletero, type AcarreoPlano } from "@/lib/cantera/acarreo";
import { agruparPesadasPorFleteroTipoMes } from "@/lib/cantera/pesadas";
import type { Consumo } from "@/lib/cantera/types";
import { filtrarDescartadas } from "@/lib/home/notificaciones";
import { traerCargas, traerEquiposTallerVial, traerServices } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas, resumenMensualPorEquipo } from "@/lib/tallerVial/combustible";
import { resumenServicePorEquipo, ultimaLecturaPorEquipo } from "@/lib/tallerVial/service";

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

  const hoy = utcDateOnlyFrom(new Date());
  const hoyStr = hoy.toISOString().slice(0, 10);
  const mesActual = hoyStr.slice(0, 7);

  const [rrhh, remises, mantenimiento, compras, inventario, produccion, despacho, facturacion, cantera, tallerVial] =
    await Promise.all([
      modulos.has("rrhh") ? resumenRrhh(supabase, hoy, hoyStr) : Promise.resolve(null),
      modulos.has("remises") ? resumenRemises(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("mantenimiento") ? resumenMantenimiento(supabase) : Promise.resolve(null),
      modulos.has("compras") ? resumenCompras(supabase) : Promise.resolve(null),
      modulos.has("inventario") ? resumenInventario(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("produccion") ? resumenProduccion(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("despacho") ? resumenDespacho(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("facturacion") ? resumenFacturacion(supabase, hoyStr) : Promise.resolve(null),
      modulos.has("cantera") ? resumenCantera(supabase, mesActual) : Promise.resolve(null),
      modulos.has("taller_vial") ? resumenTallerVial(supabase, mesActual) : Promise.resolve(null),
    ]);

  // Notificaciones reales: solo lo que amerita atención, no un contador decorativo.
  const notificaciones: { id: string; titulo: string; cantidad: number; href: string }[] = [];
  if (rrhh && rrhh.sinClasificarHoy > 0) {
    notificaciones.push({
      id: "rrhh-sin-clasificar",
      titulo: "Ausencias sin clasificar hoy",
      cantidad: rrhh.sinClasificarHoy,
      href: "/rrhh/asistencia?tab=dia",
    });
  }
  // Decía "mantenimientos vencidos" y salía de la misma tabla de una fila que
  // el titular. Dejarla ahí mostraría el número inútil en la misma pantalla de
  // la que se lo sacó.
  if (mantenimiento && mantenimiento.atrasadas > 0) {
    notificaciones.push({
      id: "mant-atrasadas",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: mantenimiento.atrasadas,
      href: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  }

  if (compras && compras.esperandoAprobacion > 0) {
    notificaciones.push({
      id: "compras-por-aprobar",
      titulo: "Requerimientos esperando aprobación",
      cantidad: compras.esperandoAprobacion,
      href: "/compras/aprobaciones",
    });
  }

  // Un movimiento que no llegó a la planilla no es un aviso decorativo: el
  // stock sale de las fórmulas de allá, así que la próxima sincronización lo
  // revierte. Hay que anotarlo a mano o resolver por qué no se pudo escribir.
  if (inventario && inventario.sinLlegarALaPlanilla > 0) {
    notificaciones.push({
      id: "inv-sin-planilla",
      titulo: "Movimientos que no llegaron a la planilla",
      cantidad: inventario.sinLlegarALaPlanilla,
      href: "/inventario/movimientos",
    });
  }

  /*
   * Una orden sin cerrar es un camión que se fue sin que nadie marcara la
   * salida. No es sólo un dato faltante: el espejo escribe **al cerrar**, así
   * que esa orden todavía no está en la planilla, y la planilla es de donde lee
   * quien no entra al sistema. Se avisa de las de días anteriores y no de las de
   * hoy, que están abiertas porque el camión está ahí.
   */
  if (despacho && despacho.abiertasDeDiasAnteriores > 0) {
    notificaciones.push({
      id: "despacho-sin-cerrar",
      titulo: "Órdenes de carga sin cerrar de días anteriores",
      cantidad: despacho.abiertasDeDiasAnteriores,
      href: "/despacho",
    });
  }

  if (facturacion && facturacion.sinVincular > 0) {
    notificaciones.push({
      id: "facturacion-sin-vincular",
      titulo: "Facturas en el buzón sin vincular a una compra",
      cantidad: facturacion.sinVincular,
      href: "/facturacion?estado=recibida",
    });
  }

  if (despacho && despacho.sinLlegarALaPlanilla > 0) {
    notificaciones.push({
      id: "despacho-sin-planilla",
      titulo: "Órdenes de carga que no llegaron a la planilla",
      cantidad: despacho.sinLlegarALaPlanilla,
      href: "/despacho/ordenes",
    });
  }

  if (cantera && cantera.sinConciliar > 0) {
    notificaciones.push({
      id: "cantera-sin-conciliar",
      titulo: "Registros de cantera con factura sin conciliar o a revisar",
      cantidad: cantera.sinConciliar,
      href: "/cantera/registros",
    });
  }

  if (tallerVial && tallerVial.sinEquipoReconocido > 0) {
    notificaciones.push({
      id: "taller-vial-sin-equipo",
      titulo: "Cargas de combustible sin un equipo reconocido",
      cantidad: tallerVial.sinEquipoReconocido,
      href: "/taller-vial/cargas",
    });
  }

  if (tallerVial && tallerVial.serviceVencidos > 0) {
    notificaciones.push({
      id: "taller-vial-service-vencido",
      titulo: "Equipos con el service de 250 hs vencido",
      cantidad: tallerVial.serviceVencidos,
      href: "/taller-vial/services",
    });
  }

  if (tallerVial && tallerVial.serviceProximos > 0) {
    notificaciones.push({
      id: "taller-vial-service-proximo",
      titulo: "Equipos por vencer el service de 250 hs",
      cantidad: tallerVial.serviceProximos,
      href: "/taller-vial/services",
    });
  }

  const { data: descartes } = await supabase
    .from("notificaciones_descartes")
    .select("notificacion_id, cantidad_vista")
    .eq("usuario_id", user.id);

  return NextResponse.json({
    rrhh, remises, mantenimiento, compras, inventario, produccion, despacho, facturacion, cantera, tallerVial,
    notificaciones: filtrarDescartadas(notificaciones, descartes ?? []),
  });
}

async function resumenRrhh(supabase: Awaited<ReturnType<typeof createClient>>, hoy: Date, hoyStr: string) {
  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const empleadoIds = (empleados ?? []).map((e) => e.id);

  const { data: calculos } = await supabase
    .from("calculos_diarios")
    .select("ausente, justificada")
    .in("empleado_id", idsOrDummy(empleadoIds))
    .eq("fecha", hoyStr);

  const totalActivos = empleadoIds.length;
  const ausentesHoy = (calculos ?? []).filter((c) => c.ausente).length;
  const sinClasificarHoy = (calculos ?? []).filter((c) => c.ausente && c.justificada === null).length;
  return { empleadosActivos: totalActivos, presentesHoy: totalActivos - ausentesHoy, ausentesHoy, sinClasificarHoy };
}

async function resumenRemises(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const [{ count: vehiculosActivos }, { data: asistenciaHoy }] = await Promise.all([
    supabase.from("vehiculos").select("id", { count: "exact", head: true }).eq("activo", true),
    supabase.from("remises_asistencia").select("empleado_id").eq("fecha", hoyStr),
  ]);
  const empleadosConTurnoHoy = new Set((asistenciaHoy ?? []).map((a) => a.empleado_id)).size;
  return { vehiculosActivos: vehiculosActivos ?? 0, empleadosConTurnoHoy };
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
  // corre adentro del mismo `Promise.all` que junta los seis resúmenes del
  // Inicio, y el `.catch` de `InicioClient` limpia la pantalla entera ante
  // cualquier rechazo — un error de Producción apagaría también RRHH,
  // Mantenimiento, Compras e Inventario, que sí contestaron bien. Se devuelve
  // `null`: la tarjeta de Producción queda sin datos, el mismo trato que ya
  // tiene un módulo al que el usuario no tiene acceso, y el resto del Inicio
  // no se entera.
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
 * `ordenesDeHoy` es el volumen del día —unas 25 en el relevamiento, con picos de
 * 49— y sirve para saber de un vistazo si la balanza está cargando o si nadie
 * abrió la pantalla.
 *
 * Los otros dos son alarmas, y las dos son sobre la planilla. Una orden abierta
 * de un día anterior no llegó a la planilla porque el espejo escribe al cerrar;
 * una con `sheets_pendiente` no llegó porque Google rechazó la escritura.
 * Ninguna de las dos se resuelve sola, y en las dos la planilla está mostrando
 * un camión de menos.
 *
 * `abiertasDeDiasAnteriores` cuenta **sólo las que nacieron en el sistema**
 * (`cargado_por` no nulo). Del histórico importado hay 345 de 1.702 sin salida
 * del predio, y ésas no son un olvido accionable: la planilla nunca tuvo esa
 * hora. Contarlas haría que el Inicio abriera con un 345 que nadie puede bajar.
 */
/**
 * El buzón de facturas.
 *
 * El titular es **lo que entró hoy**, que es el ritmo del día. La alarma son las
 * que quedaron sin vincular a un requerimiento: una factura en el buzón que
 * nadie enganchó a una compra es la que después aparece en Odoo sin que nadie
 * sepa de qué era.
 */
async function resumenFacturacion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  hoyStr: string
) {
  const [{ count: deHoy }, { count: sinVincular }, { count: sinProveedor }] = await Promise.all([
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).gte("created_at", `${hoyStr}T00:00:00`),
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("requerimiento_id", null).eq("estado", "recibida"),
    // Sin proveedor es un CUIT que no está en el padrón: se arregla cargándole
    // el CUIT al proveedor, y entonces la próxima se engancha sola.
    supabase.from("facturas_proveedor")
      .select("id", { count: "exact", head: true }).is("proveedor_id", null),
  ]);

  return {
    entraronHoy: deHoy ?? 0,
    sinVincular: sinVincular ?? 0,
    sinProveedor: sinProveedor ?? 0,
  };
}

/**
 * Lo que Cantera tiene sin resolver, más el volumen del mes.
 *
 * El titular es el mismo aviso que ordena el tablero de Registros
 * (`contarAvisos` de `lib/cantera/tablero.ts`): facturas sin conciliar o a
 * revisar. Las toneladas voladas y el acarreo a pagar del mes salen de las
 * mismas cuentas que arma la página de inicio del módulo
 * (`app/(app)/cantera/page.tsx`), reproducidas acá porque ninguna vive
 * detrás de una vista liviana de sólo contar filas — piden los montos ya
 * calculados.
 */
async function resumenCantera(supabase: Awaited<ReturnType<typeof createClient>>, mesActual: string) {
  const [yacimientos, vs, bs, fleteros, tarifasAcarreo, acarreosDelMes, pesadasDelMes] = await Promise.all([
    traerYacimientos(supabase, true),
    traerVoladuras(supabase, {}),
    traerBochones(supabase, {}),
    traerFleteros(supabase, true),
    traerTarifasAcarreo(supabase),
    traerAcarreos(supabase, { mes: mesActual }),
    traerPesadas(supabase, { mes: mesActual }),
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

  const toneladasMes = filasVoladura
    .filter((f) => (f.vol_fecha ?? "").startsWith(mesActual))
    .reduce((s, f) => s + (f.toneladas ?? 0), 0);

  const acarreosPlanos: AcarreoPlano[] = [
    ...acarreosDelMes.map((a) => ({ fleteroId: a.fletero_id, tipo: a.tipo, mes: a.mes, cantidad: a.cantidad })),
    ...agruparPesadasPorFleteroTipoMes(pesadasDelMes),
  ];
  const acarreoAPagarMes = fleteros.reduce(
    (s, f) => s + resumenPorFletero(acarreosPlanos, tarifasAcarreo, f.id, mesActual).totalMonto,
    0
  );

  return { sinConciliar, toneladasMes: Math.round(toneladasMes), acarreoAPagarMes: Math.round(acarreoAPagarMes) };
}

async function resumenDespacho(supabase: Awaited<ReturnType<typeof createClient>>, hoyStr: string) {
  const [{ count: ordenesDeHoy }, { count: abiertas }, { count: sinLlegar }] = await Promise.all([
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true }).eq("fecha", hoyStr),
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true })
      .lt("fecha", hoyStr).is("salida_predio", null).not("cargado_por", "is", null),
    supabase.from("despacho_ordenes_carga")
      .select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null),
  ]);

  return {
    ordenesDeHoy: ordenesDeHoy ?? 0,
    abiertasDeDiasAnteriores: abiertas ?? 0,
    sinLlegarALaPlanilla: sinLlegar ?? 0,
  };
}

/**
 * El combustible cargado este mes en Taller Vial, cuántas cargas quedaron
 * sin un equipo reconocido (texto suelto como "empresa piparo" en vez de un
 * código EM) y cuántos equipos tienen el service de 250 hs vencido — las tres
 * son alarmas: la primera porque esa carga no entra en ningún resumen por
 * equipo hasta que alguien la corrija, la segunda porque un service vencido
 * es justamente lo que no hay que dejar pasar.
 */
async function resumenTallerVial(supabase: Awaited<ReturnType<typeof createClient>>, mesActual: string) {
  const [todasLasCargas, equipos, todosLosServices] = await Promise.all([
    traerCargas(supabase, {}),
    traerEquiposTallerVial(supabase),
    traerServices(supabase),
  ]);
  const cargasDelMes = todasLasCargas.filter((c) => c.fecha.startsWith(mesActual));
  const conTrabajo = calcularTrabajoEntreCargas(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ id: c.id, equipoId: c.equipo_id!, fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
  );
  const resumen = resumenMensualPorEquipo(conTrabajo, mesActual);

  const horometroActualPorEquipo = ultimaLecturaPorEquipo(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ equipoId: c.equipo_id!, fecha: c.fecha, lectura: c.lectura }))
  );
  const servicePorEquipo = resumenServicePorEquipo(
    equipos.map((e) => e.id),
    todosLosServices.map((s) => ({ id: s.id, equipoId: s.equipo_id, tier: s.tier, fecha: s.fecha, horometro: s.horometro })),
    horometroActualPorEquipo
  );
  const de250 = servicePorEquipo.map((r) => r.escalones.find((e) => e.tier === 250)!);

  return {
    litrosDelMes: Math.round(cargasDelMes.reduce((s, c) => s + c.litros, 0)),
    equiposConCargaEsteMes: resumen.length,
    sinEquipoReconocido: todasLasCargas.filter((c) => c.equipo_id === null).length,
    serviceVencidos: de250.filter((e) => e.lectura === "VENCIDO").length,
    serviceProximos: de250.filter((e) => e.lectura === "PROXIMO").length,
  };
}
