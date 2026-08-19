import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./ResetPasswordForm";

/**
 * Pantalla para definir una contrasena nueva.
 *
 * El canje del `?code=` lo hace /auth/confirm, que es un Route Handler y puede
 * escribir cookies. Si el codigo llega igual hasta aca —pasa cuando el Site URL
 * de Supabase no coincide con la URL de la app y el link cae en el destino por
 * defecto— se reenvia alli en vez de fallar.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (code) redirect(`/auth/confirm?code=${encodeURIComponent(code)}&next=/reset-password`);

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();

  return <ResetPasswordForm sesionLista={Boolean(data.session)} />;
}
