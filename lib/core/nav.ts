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
      { label: "Dashboard", href: "/rrhh", modulo: "rrhh" },
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
      { label: "Hoy", href: "/remises", modulo: "remises" },
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
      { label: "Dashboard", href: "/mantenimiento", modulo: "mantenimiento" },
      { label: "Equipos", href: "/mantenimiento/equipos", modulo: "mantenimiento" },
      { label: "Avisos", href: "/mantenimiento/avisos", modulo: "mantenimiento" },
      { label: "Órdenes de trabajo", href: "/mantenimiento/ordenes", modulo: "mantenimiento" },
      { label: "Órdenes de servicio", href: "/mantenimiento/ordenes-servicio", modulo: "mantenimiento" },
      { label: "Planificación", href: "/mantenimiento/planificacion", modulo: "mantenimiento" },
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
    // El tablero va primero: es la pantalla de entrada del módulo, la que dice
    // de un vistazo cuánto trabajo hay en cada etapa. El dashboard de gráficos
    // sigue en /compras, que es donde apunta el título del grupo.
    children: [
      { label: "Tablero", href: "/compras/tablero", modulo: "compras" },
      { label: "Requerimientos", href: "/compras/requerimientos", modulo: "compras" },
      { label: "Aprobaciones", href: "/compras/aprobaciones", modulo: "compras", soloAprobadorCompras: true },
      { label: "Para aprobar", href: "/compras/para-aprobar", modulo: "compras", soloAprobadorCompras: true },
      { label: "Proveedores", href: "/compras/proveedores", modulo: "compras" },
      { label: "Ubicaciones", href: "/compras/ubicaciones", modulo: "compras" },
      { label: "Configuración", href: "/compras/configuracion", modulo: "compras", soloAdmin: true },
    ],
  },
  // Sin `modulo`: cualquier usuario del SdG puede pedir un material y seguir
  // sus propios pedidos, aunque no trabaje en Compras. Pedir no compromete
  // nada; aprobar y comprar sí, y eso queda dentro del módulo.
  { label: "Mis pedidos", href: "/mis-pedidos" },
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
  if (item.soloAprobadorCompras) return ctx.esAprobadorCompras;
  if (item.soloAdmin) return item.modulo ? ctx.adminModulos.has(item.modulo) : ctx.esAdminGlobal;
  return true;
}
