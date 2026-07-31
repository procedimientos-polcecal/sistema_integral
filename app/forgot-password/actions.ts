"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function solicitarReset(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const origin = (await headers()).get("origin");

  const supabase = await createClient();
  // No se distingue el caso "email inexistente" en la respuesta a propósito,
  // para no revelar qué emails existen en el sistema.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  redirect("/forgot-password?enviado=1");
}
