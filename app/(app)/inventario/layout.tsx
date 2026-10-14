import { ConfirmProvider } from "@/components/ConfirmProvider";

/**
 * Inventario era el único módulo sin este layout, y se notó tarde.
 *
 * `useConfirm()` sin proveedor devuelve el default del contexto —una promesa
 * que resuelve `false`—, así que el botón «Pedir» de los artículos que ya
 * tenían un RI abierto **no hacía nada**: el `if (!(await confirmar(…))) return`
 * cortaba siempre. Los que no tenían pedido funcionaban bien, que es lo que
 * hizo que pasara desapercibido nueve días en `/inventario/stock`.
 *
 * Se encontró probando en producción, no con tests: la lógica estaba bien y el
 * build pasaba. Lo que faltaba era montar el proveedor.
 */
export default function InventarioLayout({ children }: { children: React.ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
