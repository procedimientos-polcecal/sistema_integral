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
 * `nucleo` son los catálogos compartidos: los leen los diez módulos.
 *
 * Derivado de la base real cruzando `information_schema.tables` con
 * `pg_policies`, no de leer las migraciones: el mapa escrito a mano tenía tres
 * tablas que ya no existen y quince de menos, incluido el módulo Calidad
 * entero.
 */
export type Ambito = Modulo | "nucleo";

export const MODULO_DE_TABLA: Record<string, Ambito> = {
  // ── Núcleo: catálogos que comparten los diez módulos ──
  empresas: "nucleo",
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
  remises_push_tokens: "remises",

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

  // ── Compras ──
  compras_areas: "compras",
  compras_requerimientos: "compras",
  compras_cotizaciones: "compras",
  compras_historial: "compras",
  compras_sincronizaciones: "compras",
  compras_ubicaciones: "compras",
  compras_aprobadores: "compras",
  compras_odoo_ordenes: "compras",
  compras_producto_odoo: "compras",
  usuario_areas_compras: "compras",

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

  // ── Despacho ──
  despacho_ordenes_carga: "despacho",
  despacho_recepciones: "despacho",
  despacho_recepcion_proveedores: "despacho",

  // ── Facturación ──
  facturas_proveedor: "facturacion",
  facturas_proveedor_lineas: "facturacion",

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

  // ── Calidad ──
  calidad_conteos: "calidad",
  calidad_movimientos: "calidad",
  calidad_carbonilleros: "calidad",
  calidad_productos_odoo: "calidad",
  calidad_odoo_sin_reconocer: "calidad",
  calidad_envases_articulos: "calidad",
  calidad_envases_movimientos: "calidad",
  calidad_envases_proveedores: "calidad",
  calidad_envases_referencias: "calidad",
  calidad_envases_referencias_historial: "calidad",

  // `asistente_consultas` queda afuera a propósito: el asistente no necesita
  // consultar su propia bitácora, y que no pueda evita el bucle bobo de que
  // alguien le pregunte qué preguntaron los demás.
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
