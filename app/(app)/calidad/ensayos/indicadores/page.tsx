import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerLimites,
  traerMuestras,
  traerProductos,
  traerRetenidos,
} from "@/lib/calidad/ensayos/consultas";
import { evaluarMuestra } from "@/lib/calidad/ensayos/limites";
import { resolver, type MuestraResuelta } from "@/lib/calidad/ensayos/indicadores";
import IndicadoresClient from "./IndicadoresClient";

/** Un año: es el período en el que una serie de ensayos empieza a decir algo. */
const DIAS = 365;

/**
 * Los indicadores del laboratorio.
 *
 * **La evaluación se hace acá y una sola vez**, con la misma `evaluarMuestra`
 * del listado y del formulario; al cliente le cruzan los valores ya resueltos.
 * Después las series las arma `serieDe()` —la misma función probada— cuando
 * alguien cambia el desplegable, así que no hay una segunda copia del criterio
 * escrita adentro de la pantalla.
 */
export default async function IndicadoresPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [productos, limites, muestras, retenidos] = await Promise.all([
    traerProductos(supabase),
    traerLimites(supabase),
    traerMuestras(supabase, desde),
    traerRetenidos(supabase, desde),
  ]);

  // Agrupar una vez y buscar en el mapa: un `filter` por muestra sobre la lista
  // entera de retenidos es cuadrático, y un año son miles de renglones.
  const porMuestra = new Map<string, typeof retenidos>();
  for (const r of retenidos) {
    const suyos = porMuestra.get(r.muestra_id) ?? [];
    suyos.push(r);
    porMuestra.set(r.muestra_id, suyos);
  }

  const resueltas: MuestraResuelta[] = muestras.map((m) =>
    resolver(m, evaluarMuestra(m, porMuestra.get(m.id) ?? [], limites))
  );

  return (
    <IndicadoresClient
      muestras={resueltas}
      productos={productos.map((p) => ({ id: p.id, nombre: p.nombre }))}
      limites={limites}
      dias={DIAS}
    />
  );
}
