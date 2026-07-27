import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AnaliticoClient from "./AnaliticoClient";

export default async function AnaliticoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <AnaliticoClient />;
}
