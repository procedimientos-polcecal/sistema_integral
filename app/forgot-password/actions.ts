"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function solicitarReset(formData: FormData) {
  const email = String(formData.get("email") ?? "");

  // `origin` no viaja en todas las server actions; sin un respaldo, el link del
  // correo salía apuntando a "null/reset-password".
  const cabeceras = await headers();
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    cabeceras.get("origin") ??
    `https://${cabeceras.get("host") ?? "localhost:3000"}`;

  const supabase = await createClient();
  // No se distingue el caso "email inexistente" en la respuesta a propósito,
  // para no revelar qué emails existen en el sistema.
  await supabase.auth.resetPasswordForEmail(email, {
    // Va al canje del código, que es quien deja la sesión lista.
    redirectTo: `${base}/auth/confirm?next=/reset-password`,
  });

  redirect("/forgot-password?enviado=1");
}
