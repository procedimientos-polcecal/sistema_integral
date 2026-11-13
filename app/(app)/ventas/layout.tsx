import { ConfirmProvider } from "@/components/ConfirmProvider";

/**
 * Sólo monta el `ConfirmProvider`.
 *
 * El nivel de acceso lo comprueba cada página con `nivelVentasDe`, así que acá
 * no hay nada que gatear —mismo caso que `agenda/layout.tsx`—. Sin esto,
 * `useConfirm()` **rompe en el primer clic**, que es exactamente lo que quiere
 * ese componente: antes devolvía `false` y un botón de borrar quedaba sin hacer
 * nada, sin error y sin aviso, durante nueve días.
 *
 * Acá el botón que lo usa es el de borrar un cliente, que se lleva en cascada
 * sus contactos, sus oportunidades y todo su registro de actividades: es el
 * último lugar donde conviene tener un diálogo que no aparece.
 */
export default function VentasLayout({ children }: { children: React.ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
