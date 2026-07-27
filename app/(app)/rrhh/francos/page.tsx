import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import FrancosClient from "./FrancosClient";

export default async function FrancosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <FrancosClient />;
}
