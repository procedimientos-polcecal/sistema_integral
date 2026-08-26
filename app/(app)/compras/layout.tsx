import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { NivelComprasProvider } from "@/lib/compras/context";
import { ConfirmProvider } from "@/components/ConfirmProvider";

export default async function ComprasLayout({ children }: { children: React.ReactNode }) {
  // Las dos preguntas van deduplicadas por request: las páginas de adentro
  // vuelven a hacerlas y reciben lo mismo sin salir a la red otra vez.
  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { nivel } = await permisosComprasActuales();
  // Sin acceso al módulo se va a /mis-pedidos, que sí es para cualquier usuario.
  if (!nivel) redirect("/mis-pedidos");

  return (
    <NivelComprasProvider nivel={nivel}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </NivelComprasProvider>
  );
}
