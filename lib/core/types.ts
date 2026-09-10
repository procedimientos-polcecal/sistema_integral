// `admin` se unificó con `encargado` el 10/09/2026. Después de que la
// 20260910084718 le sacara la pestaña Administración, los dos roles valían
// exactamente lo mismo: ni el código ni una policy los distinguía, y todo lo
// que podían hacer salía de `usuario_modulos`. Dos nombres para la misma cosa,
// y uno de ellos prometiendo un poder que ya no tenía.
//
// El valor `admin` sigue en el enum `user_role` de la base (001) porque
// Postgres no deja quitar un valor de un enum, pero quedó inerte: no lo ofrece
// la pantalla, no lo aceptan las rutas y no lo nombra ninguna policy.
export type Rol = "admin_sistema" | "encargado" | "operario";
export type Modulo = "rrhh" | "mantenimiento" | "remises" | "compras" | "inventario" | "produccion" | "despacho" | "facturacion" | "cantera";
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
