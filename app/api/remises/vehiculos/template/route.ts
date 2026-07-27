import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/remises/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const rows = [
    ["Nombre/Vehículo", "Conductor", "Capacidad", "Teléfono"],
    ["Remise 1 - Ford Transit", "Carlos Rodríguez", 8, "351-555-9876"],
    ["Remise 2 - VW Crafter", "Luis Martínez", 12, "351-555-4321"],
  ];
  return xlsxResponse("plantilla_vehiculos.xlsx", "Vehículos", rows);
}
