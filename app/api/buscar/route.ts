import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface Resultado {
  tipo: "empleado" | "equipo" | "vehiculo" | "chofer";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

const LIMITE = 6;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  // Sanitizar: quitar caracteres que rompen el filtro PostgREST (mismo criterio que app/api/mantenimiento/ordenes/route.ts).
  const safe = q.replace(/[,()*\\%]/g, "").trim();
  if (!safe || safe.length < 2) return NextResponse.json({ resultados: [] });

  // RLS filtra cada tabla según los módulos a los que el usuario ya tiene acceso —
  // no hace falta reimplementar el chequeo de módulos acá.
  const [empleados, equipos, vehiculos, choferes] = await Promise.all([
    supabase
      .from("empleados")
      .select("id, legajo, nombre, apellido")
      .or(`legajo.ilike.%${safe}%,nombre.ilike.%${safe}%,apellido.ilike.%${safe}%`)
      .eq("activo", true)
      .limit(LIMITE),
    supabase
      .from("equipos")
      .select("id, name, code")
      .or(`name.ilike.%${safe}%,code.ilike.%${safe}%`)
      .eq("is_active", true)
      .limit(LIMITE),
    supabase
      .from("vehiculos")
      .select("id, nombre")
      .ilike("nombre", `%${safe}%`)
      .eq("activo", true)
      .limit(LIMITE),
    supabase
      .from("choferes")
      .select("id, nombre, telefono")
      .ilike("nombre", `%${safe}%`)
      .eq("activo", true)
      .limit(LIMITE),
  ]);

  const resultados: Resultado[] = [
    ...(empleados.data ?? []).map((e) => ({
      tipo: "empleado" as const,
      id: e.id,
      label: `${e.apellido}, ${e.nombre}`,
      sublabel: `Legajo ${e.legajo}`,
      href: `/rrhh/empleados/${e.id}`,
    })),
    ...(equipos.data ?? []).map((e) => ({
      tipo: "equipo" as const,
      id: e.id,
      label: e.name,
      sublabel: e.code ? `Código ${e.code}` : "Equipo",
      href: `/mantenimiento/equipos/${e.id}`,
    })),
    ...(vehiculos.data ?? []).map((v) => ({
      tipo: "vehiculo" as const,
      id: v.id,
      label: v.nombre,
      sublabel: "Vehículo",
      href: `/remises/vehiculos`,
    })),
    ...(choferes.data ?? []).map((c) => ({
      tipo: "chofer" as const,
      id: c.id,
      label: c.nombre,
      sublabel: c.telefono ? `Chofer · ${c.telefono}` : "Chofer",
      href: `/remises/vehiculos`,
    })),
  ];

  return NextResponse.json({ resultados });
}
