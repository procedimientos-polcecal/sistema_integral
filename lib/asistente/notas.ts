/**
 * Lo que el esquema no dice y el modelo no puede adivinar.
 *
 * El catálogo generado tiene nombres y tipos; esto tiene el significado y las
 * trampas. Es lo único de todo el asistente que se escribe a mano a propósito:
 * son exactamente las cosas que un desarrollador nuevo también pregunta.
 *
 * Se agrega de a poco, con las preguntas que salieron mal en la mano. Una tabla
 * sin nota no rompe nada.
 */
export const NOTAS: Record<string, string> = {
  equipos:
    "Las máquinas de planta. Viene del sistema en inglés que renombró la 029: las " +
    "columnas son `name`, `code` e `is_active`, NO nombre/codigo/activo.",

  compras_requerimientos:
    "Los pedidos de materiales (RI). **El estado son dos campos y no uno**: " +
    "`estado_aprobacion` (PENDIENTE, EN_REVISION, APROBADA, DENEGADA) y " +
    "`estado_compra` (SIN_INICIAR, PARA_COMPRAR, EN_COMPARATIVA, PEDIDO, RECIBIDO, " +
    "DENEGADO, APROBADO, EN_ESPERA). Preguntar por 'pendientes' casi siempre es " +
    "estado_aprobacion = 'PENDIENTE'. `nro_ri` es el número que usa la gente.",

  productos:
    "El catálogo único que comparten Producción y Despacho. `kg_por_unidad` puede " +
    "ser null a propósito: la bolsa son 25 kg y el bolsón sigue sin confirmar. " +
    "`odoo_product_id` en null es un producto que Odoo no vende con ese nombre.",

  inventario_articulos:
    "El pañol. Son unos 2.800, así que filtrá por `codigo` o por `descripcion ilike`, " +
    "no los traigas todos.",

  inventario_movimientos:
    "Entradas y salidas del pañol. `fecha` puede faltar: el kardex de la planilla " +
    "no siempre la trae, y se dejó nullable en vez de inventarla.",

  avisos:
    "El primer eslabón de Mantenimiento: alguien vio que algo anda mal. De un aviso " +
    "sale después una orden de trabajo.",

  ordenes_trabajo:
    "Las OT. Los campos de persona apuntan a `usuarios`, no a `empleados`.",

  despacho_ordenes_carga:
    "Cada camión que entró al predio. Los tiempos de carga y de permanencia son " +
    "restas entre las horas, no columnas guardadas.",

  produccion_partes:
    "Un parte por fecha y turno. Los turnos son '4_12' y '12_20'.",

  facturas_proveedor:
    "El buzón de facturas de proveedor. El SdG propone y Odoo confirma: un asiento " +
    "posteado es inmutable y no se deshace desde el sistema.",

  empleados:
    "Catálogo del núcleo, compartido por los diez módulos. Columnas en castellano: " +
    "`nombre`, `apellido`, `legajo`, `activo`.",

  cantera_finanzas:
    "NO son datos de plata: es el padrón de quiénes pueden conciliar una factura de " +
    "cantera contra la de Odoo. Una sola columna, `usuario_id`. Igual que " +
    "`compras_aprobadores` y `os_aprobadores`.",
};

/**
 * Lo que vale para todo el esquema y no para una tabla.
 *
 * Va arriba del catálogo, una sola vez.
 */
export const NOTAS_GENERALES = `
- Un enlace (columna que termina en _id) en NULL significa "no se reconoció con
  certeza", no "no hay". En este sistema se prefiere dejar en null antes que
  enlazar a lo que se le parece.
- Casi todas las tablas tienen \`activo\` o \`is_active\`: salvo que pregunten por
  histórico, filtrá por los activos.
- Para agrupar por mes: date_trunc('month', fecha::timestamp). El cast explícito
  hace falta cuando la columna es date.
- La consulta devuelve como mucho 200 filas, y el corte no avisa. Si el conteo
  puede pasarse, agregá (count, sum, group by) en vez de traer las filas: un
  resultado truncado se ve igual que uno completo.
`.trim();
