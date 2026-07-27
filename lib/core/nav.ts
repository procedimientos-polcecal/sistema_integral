import type { Modulo } from "./types";

export interface NavItem {
  label: string;
  href: string;
  // Módulo requerido para ver el item (undefined = siempre visible si hay sesión).
  modulo?: Modulo;
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
      { label: "Empleados", href: "/rrhh/empleados", modulo: "rrhh" },
      { label: "Fichadas", href: "/rrhh/fichadas", modulo: "rrhh" },
      { label: "Asistencia", href: "/rrhh/asistencia", modulo: "rrhh" },
      { label: "Ausencias", href: "/rrhh/ausencias", modulo: "rrhh" },
      { label: "Vacaciones", href: "/rrhh/vacaciones", modulo: "rrhh" },
      { label: "Francos", href: "/rrhh/francos", modulo: "rrhh" },
      { label: "Liquidaciones", href: "/rrhh/liquidaciones", modulo: "rrhh" },
      { label: "Analítico", href: "/rrhh/analitico", modulo: "rrhh" },
      { label: "Administración RRHH", href: "/rrhh/administracion", modulo: "rrhh" },
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
    // Solo admins; se filtra en el layout, no por módulo.
  },
];
