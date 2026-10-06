"use client";

import { useRouter } from "next/navigation";
import FormularioDeMuestra, { type ValoresDeLaMuestra } from "../FormularioDeMuestra";
import type { Limite, Muestra, ProductoDeEnsayo, Retenido } from "@/lib/calidad/ensayos/types";

/** Un número de la base al campo de texto del formulario. */
function t(n: number | null): string {
  return n === null || n === undefined ? "" : String(n);
}

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Ver y corregir una muestra.
 *
 * Es el mismo formulario que la carga, con los valores puestos: transcribir se
 * equivoca, así que corregir tiene que costar lo mismo que cargar. Y como las
 * mediciones están guardadas —y no el resultado—, se puede auditar un número
 * raro sin volver al cuaderno del laboratorio.
 */
export default function MuestraClient({
  muestra,
  retenidos,
  productos,
  limites,
  puedeEditar,
  cargadoPor,
  actualizadoPor,
}: {
  muestra: Muestra;
  retenidos: Retenido[];
  productos: ProductoDeEnsayo[];
  limites: Limite[];
  puedeEditar: boolean;
  cargadoPor: string | null;
  actualizadoPor: string | null;
}) {
  const router = useRouter();
  const producto = productos.find((p) => p.id === muestra.producto_id);

  const inicial: ValoresDeLaMuestra = {
    fecha: muestra.fecha,
    producto_id: muestra.producto_id,
    observaciones: muestra.observaciones ?? "",
    humedad_p_recipiente: t(muestra.humedad_p_recipiente),
    humedad_p_inicial: t(muestra.humedad_p_inicial),
    humedad_p_final: t(muestra.humedad_p_final),
    peso_vol_gramos: t(muestra.peso_vol_gramos),
    peso_vol_volumen_cc: t(muestra.peso_vol_volumen_cc),
    cal_util_ml_acido: t(muestra.cal_util_ml_acido),
    cal_util_peso_muestra_g: t(muestra.cal_util_peso_muestra_g),
    granulometria_peso_muestra_g: t(muestra.granulometria_peso_muestra_g),
    retenidos: retenidos.map((r) => ({ malla: String(r.malla), retenido_g: String(r.retenido_g) })),
  };

  async function guardar(v: ValoresDeLaMuestra): Promise<string | null> {
    const res = await fetch(`/api/calidad/ensayos/muestras/${muestra.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    if (!res.ok) return (await res.json()).error ?? "No se pudo guardar.";
    router.refresh();
    return null;
  }

  async function borrar() {
    await fetch(`/api/calidad/ensayos/muestras/${muestra.id}`, { method: "DELETE" });
    router.push("/calidad/ensayos");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">
          {producto?.nombre ?? "Muestra"} · {comoSeLee(muestra.fecha)}
        </h1>
        <p className="text-sm text-slate-500">
          {cargadoPor && <>Cargada por {cargadoPor}. </>}
          {actualizadoPor && <>Modificada por última vez por {actualizadoPor}.</>}
        </p>
      </div>

      {puedeEditar ? (
        <FormularioDeMuestra
          productos={productos}
          limites={limites}
          inicial={inicial}
          textoDelBoton="Guardar cambios"
          onGuardar={guardar}
          onBorrar={borrar}
        />
      ) : (
        <FormularioDeMuestra
          productos={productos}
          limites={limites}
          inicial={inicial}
          textoDelBoton="Sin permiso para editar"
          onGuardar={async () => "No tenés permiso para corregir muestras."}
        />
      )}
    </div>
  );
}
