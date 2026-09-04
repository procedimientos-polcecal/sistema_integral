/**
 * El desplegable de varios valores se mudó a `components/`: lo usan ahora el
 * listado de requerimientos y el de órdenes de trabajo, y una pantalla de
 * Mantenimiento no puede importar de la carpeta de Compras.
 *
 * Este archivo queda como puente para no tocar `RequerimientosClient.tsx`, que
 * estaba a medio editar en otra sesión cuando se hizo la mudanza. Se puede
 * borrar cuando ese import apunte directo a `@/components/MultiSelect`.
 */
export { default } from "@/components/MultiSelect";
export type { OpcionMulti } from "@/components/MultiSelect";
