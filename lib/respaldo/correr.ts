import type { SupabaseClient } from "@supabase/supabase-js";
import { reemplazarPestana, formatearColumnas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { INSTANTANEAS, hoyParaElRespaldo, type Instantanea } from "./instantaneas";

/**
 * Escribir el libro de respaldo: una pestaña por instantánea, reescrita entera.
 *
 * El porqué del libro —y por qué es un libro aparte y no las planillas que ya
 * están conectadas— está en `instantaneas.ts`. Acá está sólo el cómo.
 */

export const ID_DEL_LIBRO = () => process.env.GOOGLE_SHEETS_RESPALDO_ID?.trim() ?? "";

export interface ResultadoDePestana {
  pestana: string;
  ok: boolean;
  filas: number;
  error?: string;
}

export interface ResultadoDelRespaldo {
  hoy: string;
  pestanas: ResultadoDePestana[];
  /** Cuántas fallaron. Lo mira el cron para decidir el código de respuesta. */
  fallaron: number;
}

/**
 * La fila 1 de cada pestaña: qué es esto, cuándo se generó y que no se edita.
 *
 * Es la única defensa contra el modo en que esto se puede romper de verdad:
 * que alguien encuentre el libro, le parezca una planilla más del sistema y
 * empiece a corregir ahí. No vuelve nada de lo que se escriba acá, y la
 * próxima noche se pierde. Decirlo en la primera celda es barato.
 */
function encabezadoDelRespaldo(ins: Instantanea, generadoEn: string): string {
  return (
    `RESPALDO AUTOMATICO DEL SdG — generado el ${generadoEn}. ` +
    `NO EDITAR: esta pestaña se reescribe entera en cada corrida y el sistema nunca la lee, ` +
    `así que lo que se escriba acá se pierde sin avisar. ${ins.descripcion}`
  );
}

/**
 * Cuándo se generó, en hora de Argentina y legible.
 *
 * Importa que sea la hora local y no UTC: quien abra el libro para ver si está
 * al día compara contra su reloj, y un sello tres horas adelantado parece un
 * respaldo del futuro.
 */
function selloDeAhora(): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
}

/**
 * Corre todas las instantáneas.
 *
 * **Cada pestaña va por su cuenta y un fallo no corta el resto.** Son módulos
 * independientes: que Facturación tenga un carácter que rompa una celda no es
 * motivo para quedarse sin el padrón de RRHH. Lo que falló queda nombrado en
 * el resultado, con lo que dijo Google **sin traducir** — la misma regla que
 * las planillas: un diagnóstico que no se distingue de otro no es un
 * diagnóstico.
 *
 * Y van en serie y no con `Promise.all`: son siete pestañas del mismo libro y
 * Google limita por planilla, no por pestaña. Paralelizarlas cambia siete
 * escrituras tranquilas por siete que compiten entre ellas y se llevan un 429.
 */
export async function correrElRespaldo(
  admin: SupabaseClient,
  soloEstas?: string[]
): Promise<ResultadoDelRespaldo> {
  const planillaId = ID_DEL_LIBRO();
  if (!planillaId) {
    throw new Error(
      "Falta GOOGLE_SHEETS_RESPALDO_ID: es el id del libro de respaldo, que tiene que ser " +
        "uno NUEVO y vacío, compartido como editor con la cuenta de servicio. No puede ser " +
        "ninguna de las planillas que el sistema ya sincroniza. " +
        // Esta segunda mitad existe porque el mensaje de arriba, solo, hizo
        // perder una vuelta entera: la variable estaba cargada en Vercel y el
        // error seguía diciendo que faltaba. Vercel aplica una variable a los
        // deploys creados DESPUÉS de agregarla, así que el que ya estaba
        // publicado no la tiene nunca. Decirlo acá es más barato que volver a
        // deducirlo.
        "Si ya la cargaste en Vercel y seguís viendo esto: una variable nueva no entra en un " +
        "deploy ya hecho. Hay que redesplegar producción (Deployments → el último → Redeploy) " +
        "y confirmar que esté tildada para Production y no sólo para Preview."
    );
  }
  if (!hayCredencialesGoogle()) {
    throw new Error("Falta GOOGLE_SERVICE_ACCOUNT_JSON: sin credenciales no se puede escribir en Drive.");
  }

  const hoy = hoyParaElRespaldo();
  const generadoEn = selloDeAhora();
  const aCorrer = soloEstas?.length
    ? INSTANTANEAS.filter((i) => soloEstas.includes(i.pestana))
    : INSTANTANEAS;

  const pestanas: ResultadoDePestana[] = [];

  for (const ins of aCorrer) {
    try {
      const datos = await ins.filas(admin, hoy);
      await reemplazarPestana(planillaId, ins.pestana, [
        [encabezadoDelRespaldo(ins, generadoEn)],
        ins.encabezados,
        ...datos,
      ]);
      // Después de escribir y no antes: `reemplazarPestana` crea la pestaña si
      // no estaba, y formatear una que no existe es un error.
      if (ins.formatos?.length) {
        await formatearColumnas(planillaId, ins.pestana, ins.formatos);
      }
      pestanas.push({ pestana: ins.pestana, ok: true, filas: datos.length });
    } catch (e) {
      pestanas.push({
        pestana: ins.pestana,
        ok: false,
        filas: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { hoy, pestanas, fallaron: pestanas.filter((p) => !p.ok).length };
}
