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
      { label: "Empleados", href: "/rrhh/empleados", modulo: "rrhh" },
      { label: "Asistencia", href: "/rrhh/asistencia", modulo: "rrhh" },
      { label: "Liquidaciones", href: "/rrhh/liquidaciones", modulo: "rrhh" },
      { label: "Remises", href: "/rrhh/remises", modulo: "remises" },
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
