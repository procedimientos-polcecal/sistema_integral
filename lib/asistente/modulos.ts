import type { Modulo } from "@/lib/core/types";

/**
 * De qué módulo es cada tabla, para decidir qué le mostramos a quién.
 *
 * **Esto no es la barrera de permisos.** La barrera es que la consulta la
 * ejecuta la sesión del usuario con RLS: si el modelo pregunta por una tabla
 * que no le corresponde, la base devuelve cero filas. Este mapa hace que el
 * asistente sea *útil* —el prompt es chico y no le cuenta a un operario de
 * Remises que existe `liquidaciones`— no que sea *seguro*. Un bug acá no es
 * una filtración: es una pregunta sin respuesta.
 *
 * **Cierra por defecto.** Una tabla que no está acá no se le muestra a nadie, y
 * `scripts/generar-catalogo-asistente.mjs` la reporta al final de la corrida.
 * Es la diferencia entre que una tabla nueva quede invisible —molesto, y
 * alguien avisa— y que quede expuesta —silencioso, y nadie avisa.
 *
 * El criterio es **de qué módulo son las pantallas que la usan**, no qué policy
 * la gatea. No es lo mismo: medido el 16/09/2026, 30 de las 102 tablas tienen
 * la lectura abierta a cualquier autenticado —todo Compras por decisión de la
 * 018, los catálogos del núcleo, y buena parte de Mantenimiento, que quedó
 * así desde la 006 y la 029 no la cerró—. Aun así `equipos` se mapea a
 * mantenimiento: que la base te deje leerla no significa que a un usuario de
 * Remises le sirva verla nombrada en su prompt.
 *
 * `nucleo` es lo que no es de ningún módulo: los catálogos que comparten los
 * doce, más `auditoria`, que es de todos porque la escriben seis rutas de
 * módulos distintos.
 *
 * Derivado de la base real cruzando `information_schema.tables` con
 * `pg_policies`, no de leer las migraciones: el mapa escrito a mano tenía tres
 * tablas que ya no existen y quince de menos, incluido el módulo Calidad
 * entero.
 *
 * **Y volvió a atrasarse.** Al 22/10/2026 el catálogo tiene 129 tablas y el
 * mapa cubría 101: faltaban 29 y sobraba una. Dos de esas 29 no eran una
 * tabla suelta sino **dos módulos enteros** —`taller_vial` y `trituracion`,
 * que existen en el enum desde hace semanas y no tenían ni una tabla—, así
 * que a su gente el asistente le ofrecía nada más que el núcleo. Lo que
 * falló no fue el reporte del generador, que las cantaba todas: fue que
 * nadie lo leía, porque cantaba siempre las mismas. De ahí sale
 * `SIN_MAPEAR_A_PROPOSITO`, abajo.
 */
export type Ambito = Modulo | "nucleo";

export const MODULO_DE_TABLA: Record<string, Ambito> = {
  // ── Núcleo: lo que no es de ningún módulo ──
  empresas: "nucleo",
  // Una fila por aparato suscrito a las notificaciones. Era de Remises hasta
  // el 18/10/2026, cuando las notificaciones pasaron a ser de todo el sistema.
  push_suscripciones: "nucleo",
  sectores: "nucleo",
  empleados: "nucleo",
  productos: "nucleo",
  proveedores: "nucleo",
  proveedores_odoo: "nucleo",
  cotizaciones_dolar: "nucleo",
  sincronizaciones: "nucleo",
  usuarios: "nucleo",
  usuario_modulos: "nucleo",
  empresa_status_log: "nucleo",
  sectores_status_log: "nucleo",
  // No es un catálogo: es el registro de lo que no se deshace, y lo escriben
  // seis rutas de módulos distintos. Va en el núcleo porque no es de ninguno,
  // no porque lo comparta todo el mundo — de hecho **sólo `admin_sistema` lee
  // sus filas**, y por eso tiene nota en `notas.ts`: a cualquier otro le
  // devuelve cero filas, que no es lo mismo que "no pasó".
  auditoria: "nucleo",
  // La Agenda y la mensajería **son transversales y no módulos**: no están en
  // `MODULOS_ORDEN` y las ven los catorce, así que su lugar es el núcleo y no
  // un módulo que tendría que elegirse a dedo. Las cuatro las paga en el
  // prompt todo el mundo, y es correcto: todo el mundo las usa.
  //
  // La barrera sigue siendo RLS y acá es fina, no de módulo: un evento lo ve
  // su dueño o quien está invitado (`agenda_veo_evento`), y un mensaje lo gatea
  // un `case entidad_tipo` que espeja la tabla de destino —`mant_puede_ver()`
  // para una OT, `tiene_acceso_syh()` para una condición insegura—.
  agenda_eventos: "nucleo",
  agenda_invitados: "nucleo",
  mensajes: "nucleo",
  // Hace falta además de `mensajes` para poder contestar «a mí me mencionaron»:
  // sin ella no hay con qué cruzar. Su policy cuelga de la de `mensajes`, así
  // que no abre nada que aquélla no abra.
  mensajes_menciones: "nucleo",

  // ── RRHH ──
  rrhh_empleados_datos: "rrhh",
  rrhh_import_batches: "rrhh",
  rrhh_import_staging: "rrhh",
  jornadas: "rrhh",
  feriados: "rrhh",
  config_liquidacion: "rrhh",
  fichadas: "rrhh",
  calculos_diarios: "rrhh",
  ausencias: "rrhh",
  vacaciones: "rrhh",
  francos: "rrhh",
  liquidaciones: "rrhh",
  rrhh_dias_corregidos: "rrhh",
  rrhh_horas_a_realizar: "rrhh",
  // Una fila: a quiénes sale el correo de novedades de RR.HH. y con qué texto.
  // Es configuración, como `config_liquidacion` y `remises_config`, y va con
  // ellas y no afuera.
  rrhh_correo_novedades: "rrhh",

  // ── Remises ──
  choferes: "remises",
  vehiculos: "remises",
  hojas_ruta: "remises",
  asientos: "remises",
  remises_turnos: "remises",
  remises_empleados_datos: "remises",
  remises_asistencia: "remises",
  remises_plan_semana: "remises",
  remises_plantillas: "remises",
  remises_plantillas_grupos: "remises",
  remises_config: "remises",

  // ── Mantenimiento ──
  equipos: "mantenimiento",
  equipos_checklists: "mantenimiento",
  equipos_status_log: "mantenimiento",
  equipos_tipos: "mantenimiento",
  equipos_componentes: "mantenimiento",
  equipos_repuestos: "mantenimiento",
  mantenimientos_programados: "mantenimiento",
  mantenimientos_ejecuciones: "mantenimiento",
  mantenimiento_tarifas_hora: "mantenimiento",
  ordenes_trabajo: "mantenimiento",
  ordenes_trabajo_repuestos: "mantenimiento",
  mant_ri_de_repuesto: "mantenimiento",
  // Por qué una OT todavía no se hizo, con quién lo escribió y cuándo. Es un
  // historial y no se edita. Tiene nota: no es lo mismo que lo que se encontró
  // **al hacer** el trabajo, que lo escribe el registro de la ejecución.
  ordenes_trabajo_notas: "mantenimiento",
  mant_partes_contratista: "mantenimiento",
  mant_partes_contratista_renglones: "mantenimiento",
  mant_contratista_lugares: "mantenimiento",
  planificacion_diaria: "mantenimiento",
  planificacion_diaria_items: "mantenimiento",
  avisos: "mantenimiento",
  ordenes_servicio: "mantenimiento",
  os_comparativas: "mantenimiento",
  os_aprobadores: "mantenimiento",
  operarios: "mantenimiento",
  // La produccion semanal la gatea mant_puede_ver(), no produccion: es el
  // parte que Mantenimiento usa para calcular disponibilidad de equipos.
  produccion_semanal: "mantenimiento",
  // El ciclo que genera la OT siguiente al cerrarse la anterior, y el catálogo
  // al que apunta en vez de copiar los nombres.
  mant_ciclos_de_ot: "mantenimiento",
  mant_tareas_preventivas: "mantenimiento",
  // El cuaderno de un contratista: la carga del mes, sus renglones y las fotos
  // o el Excel de los que salió.
  mant_cuadernos: "mantenimiento",
  mant_cuadernos_renglones: "mantenimiento",
  mant_cuadernos_fotos: "mantenimiento",
  // La programación del taller: el padrón, la semana de referencia y las
  // pisadas que mueven a alguien un día suelto.
  mant_personal_taller: "mantenimiento",
  mant_programacion_referencia: "mantenimiento",
  mant_programacion_pisadas: "mantenimiento",
  // Mover una OT de fecha: el catálogo de razones y el historial de cada
  // postergación, con la fecha de antes y la de después. El historial **no
  // cubre a las cerradas** a propósito, así que contar sobre él subcuenta;
  // está en `notas.ts`, que es donde el modelo lo lee.
  mant_razones_de_postergacion: "mantenimiento",
  mant_reprogramaciones_ot: "mantenimiento",
  // Qué dice distinto la planilla de lo que dice el sistema, campo por campo.
  mantenimiento_divergencias: "mantenimiento",
  planificacion_diaria_operarios: "mantenimiento",

  // ── Compras ──
  compras_areas: "compras",
  compras_requerimientos: "compras",
  compras_cotizaciones: "compras",
  compras_historial: "compras",
  compras_sincronizaciones: "compras",
  compras_ubicaciones: "compras",
  compras_aprobadores: "compras",
  compras_consultados: "compras",
  compras_odoo_ordenes: "compras",
  compras_producto_odoo: "compras",
  usuario_areas_compras: "compras",
  compras_ajustes: "compras",
  // El reparto de un pedido entre varios proveedores. Tiene nota, y hace
  // falta: `compras_requerimientos.proveedor_id` sigue siendo el dueño, así
  // que contestar "a quién se le compró" mirando sólo una de las dos da mal.
  compras_requerimiento_proveedores: "compras",

  // ── Inventario ──
  inventario_articulos: "inventario",
  inventario_movimientos: "inventario",
  inventario_destinos: "inventario",
  inventario_solicitantes: "inventario",
  inventario_equipos: "inventario",

  // ── Producción ──
  produccion_partes: "produccion",
  produccion_renglon_productos: "produccion",
  produccion_renglones_papel: "produccion",
  produccion_deposito: "produccion",
  produccion_despachos: "produccion",
  // Los molinos que carga el robot. Es otra medición que el parte de
  // fábrica —piedra que entra al molino contra producto terminado— y sus
  // cuatro «turnos» son los cortes del contador, no los dos del parte.
  produccion_molinos: "produccion",
  produccion_molino_turnos: "produccion",
  produccion_molino_paradas: "produccion",

  // ── Despacho ──
  despacho_ordenes_carga: "despacho",
  despacho_recepciones: "despacho",
  despacho_recepcion_proveedores: "despacho",

  // ── Facturación ──
  facturas_proveedor: "facturacion",
  facturas_proveedor_lineas: "facturacion",
  facturacion_correo: "facturacion",

  // ── Cantera ──
  cantera_yacimientos: "cantera",
  cantera_voladuras: "cantera",
  cantera_bochones: "cantera",
  cantera_insumos: "cantera",
  cantera_consumos: "cantera",
  cantera_contratistas: "cantera",
  cantera_finanzas: "cantera",
  cantera_acarreos: "cantera",
  cantera_fleteros: "cantera",
  cantera_pesadas: "cantera",
  cantera_tarifas_acarreo: "cantera",
  cantera_destape: "cantera",
  cantera_cubicaciones: "cantera",
  cantera_costo_maquina_mensual: "cantera",
  cantera_cubicaciones_material: "cantera",

  // ── Calidad ──
  calidad_conteos: "calidad",
  calidad_movimientos: "calidad",
  calidad_carbonilleros: "calidad",
  calidad_productos_odoo: "calidad",
  // `calidad_odoo_sin_reconocer` estuvo acá hasta el 22/10/2026 y ya no existe
  // en la base: la reemplazó `calidad_planilla_sin_reconocer` cuando la
  // carbonilla se dio vuelta el 13/10 y la planilla pasó a mandar. Una entrada
  // fantasma no expone nada —`armarCatalogo` filtra contra el esquema real—
  // pero el reporte la canta en cada corrida, y un reporte con ruido fijo deja
  // de leerse.
  calidad_planilla_sin_reconocer: "calidad",
  calidad_envases_articulos: "calidad",
  calidad_envases_movimientos: "calidad",
  calidad_envases_proveedores: "calidad",
  calidad_envases_referencias: "calidad",
  calidad_envases_referencias_historial: "calidad",
  calidad_ensayos_muestras: "calidad",
  calidad_ensayos_productos: "calidad",
  calidad_ensayos_limites: "calidad",
  calidad_ensayos_retenidos: "calidad",

  // ── Taller Vial ──
  taller_vial_partes: "taller_vial",
  taller_vial_cargas: "taller_vial",
  taller_vial_reparaciones: "taller_vial",
  taller_vial_repuestos_asignados: "taller_vial",
  taller_vial_services: "taller_vial",
  taller_vial_estados_diarios: "taller_vial",

  // ── Trituración ──
  trituracion_partes: "trituracion",
  trituracion_plantas: "trituracion",

  // ── Seguridad e Higiene ──
  syh_condiciones: "seguridad_higiene",
  syh_peligros: "seguridad_higiene",
  syh_fotos: "seguridad_higiene",

  // ── Ventas ──
  ventas_clientes: "ventas",
  ventas_contactos: "ventas",
  ventas_oportunidades: "ventas",
  ventas_actividades: "ventas",
  // El enlace con el `res.partner` de Odoo, que lo hace una persona: el
  // cliente del CRM **no es** el de Odoo —acá están además los prospectos—,
  // así que sin esta tabla no hay forma de contestar cuál es cuál.
  ventas_clientes_odoo: "ventas",
};

/**
 * Las que quedan afuera a propósito, y por qué.
 *
 * Existe para que el reporte del generador distinga **lo que falta decidir**
 * de **lo que ya se decidió**. Sin esta lista las cuatro salían en cada
 * corrida junto a las nuevas, y un reporte que canta siempre lo mismo deja de
 * mirarse — que es exactamente cómo el catálogo llegó a estar 27 tablas
 * atrasado sin que nadie se enterara.
 *
 * El costo de mapear una tabla no es un permiso: RLS decide igual quién ve qué
 * fila. El costo es el prompt, que lo paga todo el que tenga ese módulo, y el
 * riesgo de que el modelo **conteste desde la tabla equivocada**. Estas cuatro
 * no pasan esa vara.
 */
export const SIN_MAPEAR_A_PROPOSITO: Record<string, string> = {
  asistente_consultas:
    "La bitácora del propio asistente. No necesita consultarse a sí mismo, y " +
    "que no pueda evita el bucle bobo de que alguien le pregunte qué " +
    "preguntaron los demás.",
  avisos_fotos:
    "La foto del día anterior que el cron compara para saber qué se movió. Es " +
    "andamiaje del resumen diario, no un dato que alguien consulte — y " +
    "mostrarla invita a contestar «qué cambió» desde una tabla que existe " +
    "para otra cosa.",
  cargas_offline:
    "La cola de lo que se cargó sin señal. Es un estado de tránsito: lo que " +
    "entró ya está en su tabla de destino, y lo que no entró se contesta " +
    "mejor desde el correo de la carga que no entró.",
  notificaciones_descartes:
    "Qué aviso descartó cada persona. No es dato del negocio y es de cada " +
    "uno; nadie le va a preguntar al asistente qué descartó su compañero.",
  avisos_vistos:
    "El vistazo anterior de cada aviso, contra el que se calcula «cuánto más " +
    "hay desde la última vez». Es la gemela de `avisos_fotos` y queda afuera " +
    "por lo mismo: es andamiaje de la campana, se pisa unas 56 veces por día " +
    "y su `cantidad` no cuenta cosas en varios avisos —en los de salud es una " +
    "racha de fallos y en los de ritmo, umbrales sin cargar—, así que " +
    "mostrarla invita a contestar «cuántos hay» con un número que no es eso.",
  agenda_canales:
    "Los canales de aviso que la Agenda abre contra Google para enterarse de " +
    "que alguien movió un evento. Son plomería y además **guardan un " +
    "secreto**: la columna `secreto` es con lo que se valida que un webhook " +
    "viene de Google. Lo que alguien querría preguntar está en " +
    "`agenda_eventos`.",
  agenda_divergencias_vistas:
    "Quién ya miró la divergencia de qué evento. Es de cada uno y no es dato " +
    "del negocio, el mismo caso que `notificaciones_descartes`.",
};

/** Null si nadie la mapeó — y entonces no se le muestra a nadie. */
export function moduloDe(tabla: string): Ambito | null {
  return MODULO_DE_TABLA[tabla] ?? null;
}

/**
 * Las tablas que un usuario con estos módulos puede ver nombradas.
 *
 * El mapa entra por parámetro para que `armarCatalogo` pueda testearse con uno
 * de juguete sin duplicar este filtro. Es la única definición de "qué ve quién"
 * del lado del prompt: si aparece una segunda, una de las dos va a quedar vieja.
 */
export function tablasVisibles(
  modulos: Modulo[],
  mapa: Record<string, Ambito> = MODULO_DE_TABLA
): string[] {
  const suyos = new Set<Ambito>([...modulos, "nucleo"]);
  return Object.keys(mapa)
    .filter((t) => suyos.has(mapa[t]))
    .sort();
}
