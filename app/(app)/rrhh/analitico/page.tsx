import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AnaliticoClient from "./AnaliticoClient";
import { calcularResumenAnalitico } from "@/lib/rrhh/analiticoResumen";

export default async function AnaliticoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Las cinco tarjetas se calculan acá y viajan en el HTML.
  const resumenInicial = await calcularResumenAnalitico(supabase);

  return <AnaliticoClient resumenInicial={resumenInicial} />;
}
