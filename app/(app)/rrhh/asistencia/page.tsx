import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import AsistenciaClient from "./AsistenciaClient";

export default async function AsistenciaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <Suspense fallback={null}>
      <AsistenciaClient />
    </Suspense>
  );
}
