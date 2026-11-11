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

  auditoria:
    "El registro de lo que no se deshace: postear un asiento en Odoo, mover " +
    "permisos, cerrar una liquidación, ajustar stock, aprobar o denegar una " +
    "compra, borrar filas de un espejo. **Sólo `admin_sistema` la lee**: a " +
    "cualquier otro RLS le devuelve cero filas, y eso NO significa que la " +
    "acción no haya pasado. Si te vuelve vacía y quien pregunta no es " +
    "administrador, decí que no tenés acceso al registro, no que no hay nada.",

  compras_requerimiento_proveedores:
    "A qué proveedores se repartió un pedido, cuando se le compró a más de uno. " +
    "**No reemplaza a `compras_requerimientos.proveedor_id`, que sigue siendo " +
    "el dueño del dato**: la tabla se agregó el 19/10/2026 y por ahora sólo " +
    "suma. Para 'a quién se le compró' mirá las dos, porque un RI repartido " +
    "tiene acá sus proveedores y allá uno solo. `monto` en null es 'no se " +
    "sabe cuánto le tocó a éste', y va a estar null la mayoría de las veces.",

  sincronizaciones:
    "Cuándo corrió cada sincronización con su planilla, **también cuando falló**. " +
    "Es un registro GLOBAL y le escribe más de un despliegue: desde el " +
    "24/10/2026 hay un SEGUNDO despliegue de este repo en otra cuenta de Vercel " +
    "que tiene las credenciales de Supabase y no las de Google, y deja fallos " +
    "que no son de producción (53 corridas y 51 fallidas al 05/11/2026). Así " +
    "que **contar fallos sin filtrar da mal**: para lo que de verdad pasó en " +
    "producción, filtrá `canonico = true`, o `host like '%sistemapolcecalpolysan%'` " +
    "para las filas viejas. `canonico` en NULL no quiere decir 'no es el " +
    "canónico': quiere decir que la escribió un despliegue anterior a esa " +
    "columna, y hoy son casi todas. Si te preguntan cuántas vinieron del " +
    "despliegue bueno, `canonico = true` va a dar 0 hasta que el código esté " +
    "desplegado — decilo, no contestes que no hubo ninguna. Para 'la última vez " +
    "que se actualizó X' usá la vista `ultima_sincronizacion`, que ya resuelve " +
    "todo esto y se queda con una fila por recurso.",

  ordenes_trabajo_notas:
    "**Por qué una OT todavía no se hizo, y la conversación con Compras por un " +
    "repuesto que falta.** Son dos cosas en la misma tabla y las separa `tipo`: " +
    "`JUSTIFICACION` (el default, y lo único que había antes del 31/10/2026), " +
    "`PREGUNTA` y `RESPUESTA`. **Para 'por qué sigue abierta' filtrá " +
    "`tipo = 'JUSTIFICACION'`**: sin eso, la última fila de una orden puede ser " +
    "una pregunta a Compras y la justificación vigente queda tapada. De las " +
    "justificaciones, la última es la que vale. " +
    "Una `PREGUNTA` apunta al repuesto por `repuesto_id` y la contesta una " +
    "`RESPUESTA` con `responde_a`; `responde_a` también lo usa una `PREGUNTA` " +
    "cuando alguien insiste, y entonces la anterior queda superada. " +
    "Ojo con confundirla: todo esto es de ANTES de hacer el trabajo. Lo que se " +
    "encontró AL hacerlo lo escribe el registro de la ejecución, en otro lado.",

  ordenes_trabajo:
    "Las OT. Los campos de persona apuntan a `usuarios`, no a `empleados`. " +
    "**`tipo` es PROGRAMADO o CORRECTIVO**, en masculino y en mayúsculas: quien " +
    "pregunta dice «programadas» y «correctivas», y filtrar por esas palabras " +
    "devuelve cero filas sin ningún error. " +
    "**Para decir qué OT atacar primero o cuáles son las más urgentes, usá el puntaje " +
    "GUT y no `prioridad`**: `prioridad` (ALTA/MEDIA/BAJA) está vacía en el 92% de las " +
    "órdenes y ya no ordena nada. El puntaje GUT es `gut_gravedad * gut_urgencia * " +
    "gut_tendencia` (cada nota va de 1 a 5, el producto de 1 a 125) y es null si falta " +
    "cualquiera de las tres: una orden sin las tres notas está sin puntuar, no vale 0. " +
    "**`gut_orden` NO es el puntaje**: es la clave con la que la base ordena la lista, y " +
    "lleva 27 para las órdenes sin puntuar y +1000 para las que siguen abiertas (una " +
    "abierta sin puntuar tiene 1027). Sirve para ordenar, no para mostrar: no la " +
    "muestres ni la describas como puntaje; si hay que mostrar un puntaje, calculá el " +
    "producto de las tres notas. Abiertas son las que no están REALIZADO ni SUSPENDIDA, " +
    "y **'las más urgentes' o 'qué atacar primero' son las abiertas**: filtrá " +
    "`estado not in ('REALIZADO','SUSPENDIDA')`, porque una realizada de diciembre no es " +
    "urgente aunque tenga 125. Para ordenar usá `order by gut_orden desc`, que es la clave " +
    "correcta (abiertas primero, y entre ellas el mayor puntaje); o, si preferís el " +
    "producto, `order by gut_gravedad * gut_urgencia * gut_tendencia desc nulls last`: " +
    "sin `nulls last`, DESC pone los null primero y las 'más urgentes' salen siendo diez " +
    "órdenes sin puntaje.",

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
- Cuando el usuario nombre algo en texto libre —un lugar, una máquina, un
  proveedor, un producto— NO supongas que no existe porque no lo ves acá: este
  catálogo trae el esquema, no los datos. Buscalo con ILIKE en la tabla de
  catálogo que corresponda, de las que figuran más abajo, y recién después
  contestá. Preguntarle al usuario algo que podés averiguar con una consulta es
  la respuesta equivocada.
- Lo mismo vale para un ESTADO o un TIPO, y ahí la trampa es otra: **la palabra
  que usa quien pregunta no es el valor que hay guardado**. Dice «programadas» y
  la columna dice PROGRAMADO; dice «correctivas» y dice CORRECTIVO. Cambian el
  género, el número y las mayúsculas. Un \`where tipo in ('PROGRAMADA',
  'CORRECTIVA')\` **no da error: da cero filas**, que es indistinguible de que no
  haya pasado nada en ese mes.
  Así que antes de filtrar por un valor de texto que no esté escrito en estas
  notas, mirá cuáles son: \`select distinct <columna> from <tabla>\`. O mejor,
  cuando la pregunta es «cuántos de cada uno», no filtres: **agrupá por la
  columna** (\`group by tipo\`) y mostrá lo que venga. Sale más barato y no
  depende de acertar la palabra.
- Y antes de decir que no hay nada en un período, comprobá que el período tenga
  filas: \`select count(*) ... where <fecha> between …\` sin el filtro que
  sospechás. Si ahí hay filas y con tu filtro no, el que está mal es el filtro,
  no la base. «No hubo ninguna» es una afirmación fuerte y conviene ganársela.
- Para esa búsqueda usá un FRAGMENTO CORTO, y cortalo antes de cualquier vocal
  con tilde: '%tritura%' y no '%trituración%'. En esta base no están instaladas
  unaccent ni pg_trgm —se comprobó—, así que ILIKE distingue tildes: buscar
  'trituracion' no encuentra algo escrito "trituración". El fragmento sin tildes
  encuentra las dos formas y no depende de cómo lo haya escrito quien pregunta.
- Si esa búsqueda trae MÁS DE UNA fila, decí cuáles son y preguntá a cuál se
  refiere. No elijas la que mejor se parece: hay nombres casi repetidos de
  verdad, que difieren sólo en una mayúscula o en una palabra, y los registros
  quedan repartidos entre los dos. Quedarse con uno da un número que parece bien
  y está mal.
`.trim();
