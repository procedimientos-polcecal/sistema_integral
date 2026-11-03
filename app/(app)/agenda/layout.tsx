import { ConfirmProvider } from "@/components/ConfirmProvider";

/**
 * Sólo monta el `ConfirmProvider`: la Agenda no es un módulo con permisos, así
 * que no hay nivel que comprobar —a diferencia de `mantenimiento/layout.tsx`—.
 * Sin esto, `useConfirm()` rompe en el primer clic de «Borrar».
 */
export default function AgendaLayout({ children }: { children: React.ReactNode }) {
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
