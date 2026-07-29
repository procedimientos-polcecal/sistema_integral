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
          { label: "Usuarios", href: "/administracion/usuarios", soloAdminGlobal: true },
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
    children: [
      { label: "Equipos", href: "/mantenimiento/equipos", modulo: "mantenimiento" },
      { label: "Mantenimientos", href: "/mantenimiento/mantenimientos", modulo: "mantenimiento" },
      { label: "Ejecuciones", href: "/mantenimiento/ejecuciones", modulo: "mantenimiento" },
      { label: "Historial", href: "/mantenimiento/historial", modulo: "mantenimiento" },
      { label: "Órdenes de trabajo", href: "/mantenimiento/ordenes", modulo: "mantenimiento" },
      { label: "Planificación diaria", href: "/mantenimiento/planificacion", modulo: "mantenimiento" },
    ],
  },
  {
    label: "Administración",
    href: "/administracion",
    soloAdminGlobal: true,
  },
];
