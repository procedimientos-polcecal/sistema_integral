import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { respaldarLasFotos } from "@/lib/seguridadHigiene/respaldoEnDrive";

// Cuarenta fotos, cada una con dos viajes a Drive y uno a Storage. El corte
// propio está a los 240 s (`PRESUPUESTO_MS`), para anotar antes de que Vercel
// mate la función.
export const maxDuration = 300;

/**
 * Seguridad e Higiene: la copia de las fotos de las condiciones, en Drive.
 *
 * **Es respaldo y no es la fuente.** La app lee siempre del bucket `syh-fotos`;
 * a nadie se le muestra un link de Drive. Si esto falla, se anota y se
 * reintenta mañana. Las 52 fotos de la planilla que dio origen al módulo eran
 * hipervínculos al disco de una computadora y no se pueden recuperar: esta es
 * la razón de que exista.
 *
 * ── LA CARPETA TIENE QUE ESTAR EN UNA UNIDAD COMPARTIDA ─────────────────────
 *
 * `GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID` es el id de una carpeta **dentro de una
 * unidad compartida**. Una cuenta de servicio no tiene cuota de Drive: subir a
 * «Mi unidad» de alguien falla con *"Service Accounts do not have storage
 * quota"* aunque la carpeta esté compartida como editor. Ver
 * `lib/seguridadHigiene/respaldoEnDrive.ts` y `docs/VARIABLES-VERCEL.md`.
 *
 * ── SIN LA VARIABLE NO SE ROMPE NADA ────────────────────────────────────────
 *
 * Contesta 200 diciendo qué falta, y lo anota como fallido en `sincronizaciones`
 * con el nombre de la variable —un respaldo que se omite en silencio es peor
 * que no tenerlo—. `respaldada_en_drive_el` en null es un estado válido y es el
 * de partida: el resto del módulo no depende de esto.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503.
 *
 * Una vez por día: las fotos entran de a pocas y una copia con un día de
 * atraso es la que cualquiera aceptaría; más seguido sólo gastaría llamadas.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const carpeta = process.env.GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID?.trim();
  if (!carpeta) {
    const error =
      "Falta GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID: hay que crear una carpeta en una unidad compartida de Drive, " +
      "darle acceso a la cuenta de servicio y cargar su id en Vercel. Mientras tanto las fotos siguen " +
      "guardadas en el bucket, sin copia afuera.";
    await registrarSincronizacion({ modulo: "seguridad_higiene", recurso: "respaldo_fotos", ok: false, error });
    return NextResponse.json({ respaldo: "sin_configurar", error });
  }

  try {
    const resultado = await respaldarLasFotos(createAdminClient(), carpeta);

    const fallo = resultado.fallaron.length > 0 || resultado.cortadaPor !== null;
    await registrarSincronizacion({
      modulo: "seguridad_higiene",
      recurso: "respaldo_fotos",
      ok: !fallo,
      filas: resultado.respaldadas,
      error: fallo
        ? [
            ...resultado.fallaron.map((f) => `foto ${f.foto_id}: ${f.error}`),
            ...(resultado.cortadaPor ? [`Corrida cortada: ${resultado.cortadaPor}`] : []),
          ].join(" · ")
        : null,
    });

    // 500 sólo si no salió ninguna de las que había: un respaldo parcial es
    // un 200 con el detalle, igual que el de Sheets.
    const nadaSalio = resultado.pendientes > 0 && resultado.respaldadas === 0 && fallo;
    return NextResponse.json(resultado, { status: nadaSalio ? 500 : 200 });
  } catch (e) {
    // Fallos de arranque: la base, las credenciales de Google.
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({ modulo: "seguridad_higiene", recurso: "respaldo_fotos", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
