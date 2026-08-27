import { createAdminClient } from "@/lib/supabase/admin";

/**
 * La cotización del dólar para convertir presupuestos.
 *
 * Reemplaza al `=dolarBNA()` que la planilla traía a cada comparativa con un
 * IMPORTRANGE. Se usa el valor de **venta**: es lo que cuesta conseguir los
 * dólares para pagarle a un proveedor, así que es el que refleja el costo real
 * de la compra.
 *
 * Cada valor que se obtiene se guarda. No es un caché por velocidad —aunque
 * también evita pegarle a la API en cada carga de pantalla— sino porque hace
 * falta tenerlo: para congelar la cotización de un presupuesto elegido, y para
 * seguir funcionando el día que la API no responda.
 */

const FUENTE = "https://dolarapi.com/v1/dolares/oficial";

export interface CotizacionDolar {
  venta: number;
  fecha: string;
  /** Si es la de hoy o la última que se pudo conseguir. */
  alDia: boolean;
}

/**
 * Lee la respuesta de la API.
 *
 * Separado del fetch para poder probarlo: una respuesta con un valor que no es
 * un número no puede terminar guardada, porque después congelaría presupuestos
 * con una cotización inventada.
 */
export function leerRespuesta(json: unknown): { compra: number | null; venta: number } | null {
  if (!json || typeof json !== "object") return null;
  const d = json as Record<string, unknown>;

  const venta = Number(d.venta);
  if (!Number.isFinite(venta) || venta <= 0) return null;

  const compra = Number(d.compra);
  return { compra: Number.isFinite(compra) && compra > 0 ? compra : null, venta };
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

/**
 * La cotización con la que convertir hoy.
 *
 * Devuelve null sólo si nunca se pudo conseguir ninguna. En ese caso la
 * pantalla lo dice: es preferible a mostrar un total en pesos calculado con un
 * número inventado.
 */
export async function cotizacionDeHoy(): Promise<CotizacionDolar | null> {
  const admin = createAdminClient();
  const hoy = hoyISO();

  const { data: guardada } = await admin
    .from("cotizaciones_dolar")
    .select("fecha, venta")
    .eq("fecha", hoy)
    .maybeSingle();

  if (guardada) {
    return { venta: Number(guardada.venta), fecha: guardada.fecha as string, alDia: true };
  }

  try {
    // Corto por tiempo: esto corre mientras alguien espera una pantalla, y una
    // API que tarda es peor que una que falla — al menos del segundo caso se
    // sale con el último valor conocido.
    const res = await fetch(FUENTE, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (res.ok) {
      const valores = leerRespuesta(await res.json());
      if (valores) {
        await admin.from("cotizaciones_dolar").upsert(
          { fecha: hoy, compra: valores.compra, venta: valores.venta, fuente: "dolarapi" },
          { onConflict: "fecha" }
        );
        return { venta: valores.venta, fecha: hoy, alDia: true };
      }
    }
  } catch (e) {
    console.error("No se pudo traer la cotización del dólar:", e);
  }

  // La última que se haya podido conseguir. Quien la use tiene que decir de
  // qué día es: una cotización vieja sin avisar es peor que ninguna.
  const { data: ultima } = await admin
    .from("cotizaciones_dolar")
    .select("fecha, venta")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ultima) return null;
  return { venta: Number(ultima.venta), fecha: ultima.fecha as string, alDia: false };
}
