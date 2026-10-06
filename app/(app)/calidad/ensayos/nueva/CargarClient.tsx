"use client";

import { useRouter } from "next/navigation";
import FormularioDeMuestra, {
  valoresVacios,
  type ValoresDeLaMuestra,
} from "../FormularioDeMuestra";
import type { Limite, ProductoDeEnsayo } from "@/lib/calidad/ensayos/types";

export default function CargarClient({
  productos,
  limites,
  hoy,
}: {
  productos: ProductoDeEnsayo[];
  limites: Limite[];
  hoy: string;
}) {
  const router = useRouter();

  async function guardar(v: ValoresDeLaMuestra): Promise<string | null> {
    const res = await fetch("/api/calidad/ensayos/muestras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...v, retenidos: v.retenidos }),
    });

    if (!res.ok) return (await res.json()).error ?? "No se pudo guardar la muestra.";

    const { id } = await res.json();
    router.push(`/calidad/ensayos/${id}`);
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Cargar muestra</h1>
        <p className="text-sm text-slate-500">
          Se tipean las mediciones —los pesos, los gramos, los ml— y el resultado sale solo.
        </p>
      </div>

      <FormularioDeMuestra
        productos={productos}
        limites={limites}
        inicial={valoresVacios(hoy)}
        textoDelBoton="Guardar muestra"
        onGuardar={guardar}
      />
    </div>
  );
}
