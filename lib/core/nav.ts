import type { Modulo } from "./types";

export interface NavItem {
  label: string;
  href: string;
  // Módulo requerido para ver el item (undefined = siempre visible si hay sesión).
  modulo?: Modulo;
  // Restringe a usuarios con nivel "admin" en `modulo` (ej. Turnos/Feriados/
  // Configuración de RRHH: cualquier admin del módulo, no hace falta ser
  // admin_sistema/admin global).
  soloAdmin?: boolean;
  /**
   * Sólo para quien está en la lista de aprobadores de Compras.
   *
   * Aprobar no depende del nivel: administrar el módulo y autorizar un gasto son
   * cosas distintas y las hacen personas distintas.
   */
  soloAprobadorCompras?: boolean;
  /**
   * Para quien esté en **alguna** de las dos listas de aprobación.
   *
   * Aprobaciones muestra dos cosas que no las decide la misma gente: los
   * requerimientos, que aprueba `compras_aprobadores`, y las órdenes de
   * servicio, que aprueba `os_aprobadores`. Una pantalla que se ve sólo con la
   * primera dejaría afuera a quien fue puesto justamente para la segunda.
   *
   * Adentro, cada sección habilita sus botones según la lista que le toca:
   * entrar y poder decidir no son lo mismo.
   */
  soloAprobadorDeAlgo?: boolean;
  // Restringe a admin_sistema/admin global, sin importar el módulo (ej.
  // Usuarios: gestiona permisos de todos los módulos, no es RRHH-específico).
  soloAdminGlobal?: boolean;
  children?: NavItem[];
}

// Estructura de navegación del SdG. La visibilidad real se filtra por permisos.
export const NAV: NavItem[] = [
  { label: "Inicio", href: "/" },
  {
    label: "RRHH",
    href: "/rrhh",
    modulo: "rrhh",
    children: [
      {
        label: "Administración",
        href: "/rrhh/empleados",
        modulo: "rrhh",
        children: [
          { label: "Empleados", href: "/rrhh/empleados", modulo: "rrhh" },
          { label: "Turnos", href: "/rrhh/turnos", modulo: "rrhh", soloAdmin: true },
          { label: "Feriados", href: "/rrhh/feriados", modulo: "rrhh", soloAdmin: true },
        ],
      },
      {
        label: "Control",
        href: "/rrhh/fichadas",
        modulo: "rrhh",
        children: [
          { label: "Marcaciones", href: "/rrhh/fichadas", modulo: "rrhh" },
          { label: "Licencias", href: "/rrhh/ausencias?tab=licencias", modulo: "rrhh" },
          { label: "Ausencias", href: "/rrhh/ausencias?tab=injustificadas", modulo: "rrhh" },
        ],
      },
      {
        label: "Asistencia",
        href: "/rrhh/asistencia",
        modulo: "rrhh",
        children: [
          { label: "Por período", href: "/rrhh/asistencia?tab=periodo", modulo: "rrhh" },
          { label: "Por día", href: "/rrhh/asistencia?tab=dia", modulo: "rrhh" },
        ],
      },
      {
        label: "Vacaciones",
        href: "/rrhh/vacaciones",
        modulo: "rrhh",
        children: [
          { label: "Por empleado", href: "/rrhh/vacaciones?tab=balance", modulo: "rrhh" },
          { label: "Historial", href: "/rrhh/vacaciones?tab=historial", modulo: "rrhh" },
        ],
      },
      { label: "Francos", href: "/rrhh/francos", modulo: "rrhh" },
      { label: "Liquidaciones", href: "/rrhh/liquidaciones", modulo: "rrhh" },
      { label: "Configuración", href: "/rrhh/configuracion", modulo: "rrhh", soloAdmin: true },
      { label: "Analítico", href: "/rrhh/analitico", modulo: "rrhh" },
    ],
  },
  {
    label: "Remises",
    href: "/remises",
    modulo: "remises",
    children: [
      { label: "Hoy", href: "/remises/hoy", modulo: "remises" },
      { label: "Semana", href: "/remises/semana", modulo: "remises" },
      { label: "Empleados", href: "/remises/empleados", modulo: "remises" },
      { label: "Vehículos", href: "/remises/vehiculos", modulo: "remises" },
      { label: "Historial", href: "/remises/historial", modulo: "remises" },
      { label: "Configuración", href: "/remises/configuracion", modulo: "remises" },
    ],
  },
  {
    label: "Mantenimiento",
    href: "/mantenimiento",
    modulo: "mantenimiento",
    // El mismo orden que la app de Mantenimiento: se entra por el tablero, se
    // mira una máquina, y de ahí para abajo el trabajo — lo que se avisa, lo
    // que se hace y lo que se planifica.
    children: [
      { label: "Equipos", href: "/mantenimiento/equipos", modulo: "mantenimiento" },
      { label: "MTBF", href: "/mantenimiento/mtbf", modulo: "mantenimiento" },
      { label: "Avisos", href: "/mantenimiento/avisos", modulo: "mantenimiento" },
      { label: "Órdenes de trabajo", href: "/mantenimiento/ordenes", modulo: "mantenimiento" },
      /*
       * La única entrada estable a `/cargar`. Hasta acá no había ninguna: a esa
       * pantalla se llegaba porque el service worker la servía cuando no había
       * señal, o porque la barra de «hay algo esperando» aparecía. O sea que
       * quien quisiera abrirla **antes** de salir a la planta —que es cuando
       * sirve bajar los desplegables y dejar la sesión recordada— no tenía
       * cómo.
       *
       * Vive en el menú de Mantenimiento y no en el de otro módulo porque lo
       * que carga son avisos y órdenes de trabajo. Y cae debajo de las dos
       * pantallas de esas cosas, no arriba: con señal se carga por los modales
       * de siempre, y ésta es la de la excepción.
       *
       * OJO CON LA RUTA: `/cargar` está **fuera** del grupo `(app)`, así que
       * `estaDentroDe("/mantenimiento", "/cargar")` es falso y el menú de
       * Mantenimiento no se va a desplegar parado ahí. Es correcto y es a
       * propósito: esa pantalla tampoco tiene este menú, porque tiene que poder
       * dibujarse sin servidor.
       */
      { label: "Cargar sin señal", href: "/cargar", modulo: "mantenimiento" },
      { label: "Órdenes de servicio", href: "/mantenimiento/ordenes-servicio", modulo: "mantenimiento" },
      // Debajo de las órdenes de servicio porque es lo mismo visto por el otro
      // lado: allá se le pide un trabajo a un tercero, acá se carga el papel
      // con el que un tercero dice qué hizo cada día.
      { label: "Partes de contratista", href: "/mantenimiento/partes-contratista", modulo: "mantenimiento" },
      { label: "Planificación", href: "/mantenimiento/planificacion", modulo: "mantenimiento" },
      // La ve sólo el admin de Mantenimiento, que es el encargado del taller: la
      // semana de turnos y quién falta. No es una pantalla de consulta general.
      { label: "Programación", href: "/mantenimiento/programacion", modulo: "mantenimiento", soloAdmin: true },
      { label: "Producción", href: "/mantenimiento/produccion", modulo: "mantenimiento" },
      { label: "Historial", href: "/mantenimiento/historial", modulo: "mantenimiento" },
      {
        label: "Configuración",
        href: "/mantenimiento/configuracion",
        modulo: "mantenimiento",
        soloAdmin: true,
      },
    ],
  },
  {
    label: "Compras",
    href: "/compras",
    modulo: "compras",
    // El tablero primero —dice cuánto trabajo hay en cada etapa—, después el
    // trabajo del día a día. El dashboard de gráficos es la raíz del módulo,
    // fuera de esta lista, mismo caso que Cantera.
    children: [
      { label: "Tablero", href: "/compras/tablero", modulo: "compras" },
      { label: "Requerimientos", href: "/compras/requerimientos", modulo: "compras" },
      // Después de Requerimientos, que es el orden del circuito: se piden, se
      // aprueban, se compran, se reciben.
      { label: "Seguimiento", href: "/compras/seguimiento", modulo: "compras" },
      /**
       * Atajo a la sección de Mantenimiento, no una copia.
       *
       * La gestión de las órdenes de servicio va a pasar a Compras: es el mismo
       * trabajo que un requerimiento —se piden presupuestos y se baja una
       * comparativa— sólo que se pide un servicio en vez de un material. Por
       * ahora las gestionan los dos, así que el atajo apunta a la pantalla que
       * ya existe. Duplicarla dejaría dos copias diciendo cosas distintas de la
       * misma OS.
       *
       * Va gateado por `mantenimiento` y no por `compras` aunque viva en este
       * menú: el destino es una ruta de Mantenimiento y su layout manda a `/` a
       * quien no tenga el módulo. Mostrar un ítem que rebota es peor que no
       * mostrarlo. Y como el grupo Compras ya se filtra por su propio módulo,
       * el atajo pide las dos cosas: entrar a Compras y poder abrir la OS.
       */
      {
        label: "Órdenes de servicio",
        href: "/mantenimiento/ordenes-servicio",
        modulo: "mantenimiento",
      },
      { label: "Aprobaciones", href: "/compras/aprobaciones", modulo: "compras", soloAprobadorDeAlgo: true },
      { label: "Para aprobar", href: "/compras/para-aprobar", modulo: "compras", soloAprobadorCompras: true },
      { label: "Proveedores", href: "/compras/proveedores", modulo: "compras" },
      { label: "Ubicaciones", href: "/compras/ubicaciones", modulo: "compras" },
      { label: "Configuración", href: "/compras/configuracion", modulo: "compras", soloAdmin: true },
    ],
  },
  {
    label: "Inventario",
    href: "/inventario",
    modulo: "inventario",
    // El stock primero: es la pantalla que se abre en el celular parado en el
    // pañol, y la que reemplaza abrir el Sheets para ver si hay algo. La raíz
    // del módulo (`href` de arriba) es el dashboard — no está en esta lista a
    // propósito, mismo caso que Cantera: así clickear el nombre del módulo en
    // la barra lateral entra directo, en vez de sólo desplegar.
    children: [
      { label: "Stock", href: "/inventario/stock", modulo: "inventario" },
      // Después del stock y no al final: es la lista corta que sale del stock
      // —los que faltan **y** se usan— y quien entra a mirar si hay algo es el
      // mismo que después pide. No lleva `soloAdmin`: pedir un material lo puede
      // hacer cualquier usuario activo, que es como lo dejó la 018 a propósito,
      // y quien nota que algo se acabó es el que está parado en el pañol.
      { label: "Para reponer", href: "/inventario/reponer", modulo: "inventario" },
      { label: "Cargar movimiento", href: "/inventario/movimientos/nuevo", modulo: "inventario" },
      { label: "Movimientos", href: "/inventario/movimientos", modulo: "inventario" },
      { label: "Artículos", href: "/inventario/articulos", modulo: "inventario", soloAdmin: true },
      // La lista del pañol no es soloAdmin: quien nota que falta un nombre es
      // quien está cargando el movimiento, y hacerlo esperar termina en que lo
      // carga con otro nombre parecido.
      { label: "La lista del pañol", href: "/inventario/lista", modulo: "inventario" },
      { label: "Reservas de Taller Vial", href: "/inventario/reservas-taller-vial", modulo: "inventario" },
    ],
  },
  {
    label: "Producción",
    href: "/produccion",
    modulo: "produccion",
    // El día primero: es la pantalla que se abre para cargar el parte del
    // turno que acaba de terminar, que es el 95% de lo que se hace acá. La
    // raíz del módulo es el dashboard, fuera de esta lista — mismo caso que
    // Cantera e Inventario.
    children: [
      { label: "El día", href: "/produccion/dia", modulo: "produccion" },
      { label: "Resúmenes", href: "/produccion/resumenes", modulo: "produccion" },
      // Lo que midió el PC Robot en los molinos: no es el parte de fábrica de las
      // dos de arriba (aquel cuenta producto terminado, éste lo que se muele).
      { label: "Molinos", href: "/produccion/molinos", modulo: "produccion" },
      { label: "Molinos del mes", href: "/produccion/molinos/mes", modulo: "produccion" },
      { label: "Paradas sin explicar", href: "/produccion/molinos/sin-explicar", modulo: "produccion" },
      { label: "Renglones del parte", href: "/produccion/productos", modulo: "produccion", soloAdmin: true },
    ],
  },
  {
    label: "Calidad",
    href: "/calidad",
    modulo: "calidad",
    // Las dos planillas del sector, y **van para lados distintos**. En envases
    // manda la planilla —el stock es una fórmula que vive allá y el SdG la
    // lee—; en carbonilla la planilla se va, porque las entradas salen de Odoo
    // y de la balanza y acá manda el sistema.
    //
    // Por eso van como subgrupos y no como hijos planos: con catorce el menú
    // deja de leerse, y dos mitades que funcionan al revés puestas una al lado
    // de la otra invitan a suponer que funcionan igual.
    //
    // La raíz del módulo es el tablero y queda fuera de esta lista — mismo caso
    // que Cantera y Facturación. Antes la raíz era directamente el stock de
    // carbonilla, así que quien entraba por el menú caía en uno de los tres
    // frentes y los otros dos sólo existían si se desplegaba el submenú.
    //
    // Ver docs/CALIDAD.md, docs/CALIDAD-ENVASES.md y docs/CALIDAD-ENSAYOS.md.
    children: [
      {
        label: "Carbonilla",
        href: "/calidad/carbonilla",
        modulo: "calidad",
        // El stock primero: es la pantalla que se abre a la tarde para cargar
        // el consumo del día, que es lo que se hace 224 de 256 días. El libro
        // entero y los catálogos se miran después, no durante.
        children: [
          { label: "El stock", href: "/calidad/carbonilla", modulo: "calidad" },
          { label: "Movimientos", href: "/calidad/movimientos", modulo: "calidad" },
          // Desde el 13/10/2026 Odoo no mueve el stock: controla. Ésta es la
          // única pantalla que dice que un camión entró sin orden de compra.
          { label: "Conciliación", href: "/calidad/conciliacion", modulo: "calidad" },
          { label: "Carbonilleros", href: "/calidad/carbonilleros", modulo: "calidad", soloAdmin: true },
          { label: "Productos", href: "/calidad/productos", modulo: "calidad", soloAdmin: true },
        ],
      },
      {
        label: "Envases",
        href: "/calidad/envases",
        modulo: "calidad",
        children: [
          { label: "Stock", href: "/calidad/envases", modulo: "calidad" },
          { label: "Movimientos", href: "/calidad/envases/movimientos", modulo: "calidad" },
          { label: "Por período", href: "/calidad/envases/periodo", modulo: "calidad" },
          { label: "Proveedores", href: "/calidad/envases/proveedores", modulo: "calidad" },
        ],
      },
      {
        label: "Ensayos",
        href: "/calidad/ensayos",
        modulo: "calidad",
        // El tercer frente, y el único sin planilla: acá el SdG es el único
        // lugar. Conviene saberlo antes de tocar una ruta, porque los otros dos
        // espejan a Sheets y para lados contrarios.
        //
        // Las muestras primero: es la pantalla que se abre para ver si algo se
        // fue de límite. Los productos y los límites son configuración y se
        // miran una vez cada tanto, no durante.
        //
        // Ver docs/CALIDAD-ENSAYOS.md.
        children: [
          { label: "Las muestras", href: "/calidad/ensayos", modulo: "calidad" },
          { label: "Cargar muestra", href: "/calidad/ensayos/nueva", modulo: "calidad" },
          { label: "Indicadores", href: "/calidad/ensayos/indicadores", modulo: "calidad" },
          { label: "Reporte del día", href: "/calidad/ensayos/reporte", modulo: "calidad" },
          { label: "Productos", href: "/calidad/ensayos/productos", modulo: "calidad", soloAdmin: true },
          { label: "Límites", href: "/calidad/ensayos/limites", modulo: "calidad", soloAdmin: true },
        ],
      },
      // Lo de antes del SdG: los tres años que vivían en el Excel del
      // laboratorio. De sólo lectura, y la búsqueda encuentra también lo que
      // Ensayos carga hoy — quien atiende un reclamo no tiene por qué saber de
      // qué año es el dato antes de buscarlo. Ver docs/CALIDAD-HISTORICO.md.
      { label: "Histórico", href: "/calidad/historico", modulo: "calidad" },
    ],
  },
  {
    label: "Despacho",
    href: "/despacho",
    modulo: "despacho",
    // Los movimientos del día primero, y por lejos: es la pantalla que queda
    // abierta todo el día en la PC de la balanza y donde se cargan los cuatro
    // horarios de cada camión. El histórico se mira después, no durante. La
    // raíz del módulo es el dashboard, fuera de esta lista — mismo caso que
    // Cantera.
    children: [
      { label: "Movimientos diarios", href: "/despacho/movimientos", modulo: "despacho" },
      { label: "Órdenes de carga", href: "/despacho/ordenes", modulo: "despacho" },
      { label: "Recepción de material", href: "/despacho/recepciones", modulo: "despacho" },
      { label: "Productos", href: "/despacho/productos", modulo: "despacho", soloAdmin: true },
    ],
  },
  {
    label: "Facturación",
    href: "/facturacion",
    modulo: "facturacion",
    // El buzón primero, y por ahora es casi todo: es la pantalla donde se sube
    // la factura que acaba de llegar por mail, en papel o por WhatsApp. Lo que
    // queda por vincular se mira después, no durante. La raíz del módulo es
    // el dashboard, fuera de esta lista — mismo caso que Cantera.
    children: [
      { label: "El buzón", href: "/facturacion/buzon", modulo: "facturacion" },
      { label: "Sin vincular", href: "/facturacion/buzon?estado=recibida", modulo: "facturacion" },
    ],
  },
  {
    label: "Cantera",
    // `href` propio, distinto al de todos los `children`: es justamente esa
    // diferencia la que en `Sidebar.tsx` decide que el ítem se renderice como
    // un link que navega (a la página de inicio del módulo) y despliega, en
    // vez de sólo desplegar como el resto de los módulos — el usuario pidió
    // las dos cosas juntas: mantener el desplegable y que clickear "Cantera"
    // entre a una página propia con el adelanto de Registros y del informe.
    href: "/cantera",
    modulo: "cantera",
    children: [
      { label: "Registros", href: "/cantera/registros", modulo: "cantera" },
      { label: "Acarreo", href: "/cantera/acarreo", modulo: "cantera" },
      { label: "Destape", href: "/cantera/destape", modulo: "cantera" },
      { label: "Cubicación", href: "/cantera/cubicacion", modulo: "cantera" },
      { label: "Informe mensual", href: "/cantera/informes", modulo: "cantera" },
      { label: "Canteras", href: "/cantera/yacimientos", modulo: "cantera", soloAdmin: true },
      { label: "Insumos", href: "/cantera/insumos", modulo: "cantera", soloAdmin: true },
      { label: "Fleteros", href: "/cantera/fleteros", modulo: "cantera", soloAdmin: true },
      { label: "Tarifas de acarreo", href: "/cantera/tarifas-acarreo", modulo: "cantera", soloAdmin: true },
    ],
  },
  {
    label: "Taller Vial",
    href: "/taller-vial",
    modulo: "taller_vial",
    children: [
      { label: "Cargas", href: "/taller-vial/cargas", modulo: "taller_vial" },
      { label: "Estados", href: "/taller-vial/estados", modulo: "taller_vial" },
      { label: "Services", href: "/taller-vial/services", modulo: "taller_vial" },
      { label: "Reparaciones", href: "/taller-vial/reparaciones", modulo: "taller_vial" },
      { label: "Partes diarios", href: "/taller-vial/partes", modulo: "taller_vial" },
      { label: "Informe mensual", href: "/taller-vial/informes", modulo: "taller_vial" },
    ],
  },
  {
    label: "Trituración",
    href: "/trituracion",
    modulo: "trituracion",
    children: [
      { label: "Partes", href: "/trituracion/partes", modulo: "trituracion" },
      { label: "Informe mensual", href: "/trituracion/informes", modulo: "trituracion" },
      { label: "Plantas", href: "/trituracion/plantas", modulo: "trituracion", soloAdmin: true },
    ],
  },
  {
    label: "Seguridad e Higiene",
    href: "/seguridad-higiene",
    modulo: "seguridad_higiene",
    // La raíz del módulo es un tablero con una tarjeta por frente, y hoy hay
    // uno solo; queda fuera de esta lista — mismo caso que Calidad y Cantera.
    // Cuando llegue el segundo frente (accidentes, capacitaciones…) se agrega
    // acá junto con su tarjeta, sin mudar el primero.
    children: [
      { label: "Condiciones inseguras", href: "/seguridad-higiene/condiciones", modulo: "seguridad_higiene" },
    ],
  },
  // Sin `modulo`: cualquier usuario del SdG puede pedir un material y seguir
  // sus propios pedidos, aunque no trabaje en Compras. Pedir no compromete
  // nada; aprobar y comprar sí, y eso queda dentro del módulo.
  { label: "Mis pedidos", href: "/mis-pedidos" },
  // Sin `modulo`, por lo mismo: quien ve una máquina rota trabaja en Producción,
  // en Cantera o en el laboratorio y no tiene Mantenimiento. Contar que algo anda
  // mal no compromete nada; decidir qué se hace con eso —generar la OT,
  // desestimarlo— sí, y eso queda adentro del módulo.
  { label: "Mis avisos", href: "/mis-avisos" },
  // Los usuarios y las empresas son de todo el SdG, no de un módulo: se
  // administran acá y no repetidos dentro de cada uno. Estaban colgados de RRHH
  // y de Mantenimiento, que es donde alguien los fue necesitando primero.
  {
    label: "Administración",
    href: "/administracion",
    soloAdminGlobal: true,
    children: [
      { label: "Usuarios", href: "/administracion/usuarios", soloAdminGlobal: true },
      { label: "Empresas", href: "/administracion/empresas", soloAdminGlobal: true },
    ],
  },
];

export interface ContextoNav {
  modulos: Set<Modulo>;
  adminModulos: Set<Modulo>;
  esAdminGlobal: boolean;
  esAprobadorCompras: boolean;
  /** Está en `os_aprobadores`: puede aprobar o denegar una orden de servicio. */
  esAprobadorOS: boolean;
}

/**
 * Si un ítem se ve o no.
 *
 * Vive acá y no en el Sidebar porque el test lo estaba reimplementando: dos
 * copias de una regla de permisos es una copia de más, y la que se testea no era
 * la que corre.
 *
 * El módulo se comprueba primero: quien no tiene Compras no ve "Para aprobar"
 * aunque esté en la lista.
 */
export function puedeVerItem(item: NavItem, ctx: ContextoNav): boolean {
  if (item.modulo && !ctx.modulos.has(item.modulo)) return false;
  if (item.soloAdminGlobal) return ctx.esAdminGlobal;
  if (item.soloAprobadorDeAlgo) return ctx.esAprobadorCompras || ctx.esAprobadorOS;
  if (item.soloAprobadorCompras) return ctx.esAprobadorCompras;
  if (item.soloAdmin) return item.modulo ? ctx.adminModulos.has(item.modulo) : ctx.esAdminGlobal;
  return true;
}

/**
 * Si una ruta cae **dentro** de un sector: su propia página o cualquiera
 * debajo. Es lo que decide qué grupo del menú lateral se despliega solo.
 *
 * Mira el prefijo y no la igualdad porque las dos formas de entrar a un módulo
 * la necesitan, y con igualdad las dos dejaban el menú cerrado: la tarjeta del
 * Inicio lleva a la raíz (`/compras`), que no es el href de ningún hijo —los
 * trece grupos tienen esa forma—, y una página de detalle como
 * `/cantera/voladuras/ABC` no figura en el menú.
 *
 * La barra del final no es de adorno, y tiene dos trabajos. Sin ella
 * `/remises` daría verdadero para `/remisesX`; hoy ningún módulo es prefijo de
 * otro, pero eso es una propiedad de la lista de hoy y no una garantía. Y hace
 * que la raíz `/` del Inicio no contenga a todo el sistema, que es lo que
 * pasaría con un `startsWith` pelado.
 *
 * El query no cuenta: `/rrhh/ausencias?tab=licencias` y
 * `/rrhh/ausencias?tab=injustificadas` están las dos dentro de RRHH.
 */
export function estaDentroDe(href: string, pathname: string): boolean {
  const raiz = href.split("?")[0];
  return pathname === raiz || pathname.startsWith(`${raiz}/`);
}
