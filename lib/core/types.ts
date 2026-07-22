export type Rol = "admin_sistema" | "admin" | "encargado" | "operario";
export type Modulo = "rrhh" | "mantenimiento" | "remises";
export type NivelAcceso = "lectura" | "edicion" | "admin";

export interface Empresa {
  id: string;
  nombre: "POLCECAL" | "POLYSAN";
  activo: boolean;
}

export interface Sector {
  id: string;
  empresa_id: string;
  nombre: string;
  activo: boolean;
}

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  activo: boolean;
}

export interface UsuarioModulo {
  id: string;
  usuario_id: string;
  modulo: Modulo;
  nivel: NivelAcceso;
}
