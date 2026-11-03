import type { createClient } from "@/lib/supabase/server";
import { problemaDeLaFoto, rutaDeLaFoto } from "./fotoDeCondicion";

/**
 * Guardar la foto de una condición: el archivo en el bucket **y la fila en
 * `syh_fotos`**.
 *
 * ── POR QUÉ LAS DOS COSAS JUNTAS, QUE ES EL HUECO QUE ESTO CIERRA ───────────
 *
 * Hasta el 30/10/2026 la ruta de fotos subía el archivo y devolvía su `ruta`, y
 * ahí terminaba: nadie escribía en `syh_fotos`. Una foto sin esa fila es un
 * archivo perdido —la ficha lee la tabla, no el bucket, así que no la muestra;
 * y el cron de respaldo también lee la tabla, así que nunca la respalda—. Subir
 * sin enlazar no es "la mitad del trabajo": es tirar el único campo de una
 * condición que no se puede volver a conseguir. Por eso las dos escrituras
 * viven en una sola función y no hay forma de hacer una sin la otra.
 *
 * ── POR QUÉ ACÁ Y NO EN UNA RUTA ────────────────────────────────────────────
 *
 * Lo llaman **dos**: el alta de una condición (`/api/seguridad-higiene/
 * condiciones`), que desde la cola sin señal recibe la foto adentro del mismo
 * pedido, y la ruta de fotos (`/api/seguridad-higiene/fotos`), que es por donde
 * se agregan desde la ficha. Escrito dos veces, un día uno de los dos caminos
 * sube sin enlazar otra vez.
 *
 * ── CON EL CLIENTE DEL USUARIO, NO CON EL ADMIN ─────────────────────────────
 *
 * La policy `syh_fotos_agregar` exige tres cosas que sólo valen si corre RLS:
 * que `respaldada_en_drive_el` venga en null (es del cron de respaldo; falseada
 * hace que el respaldo saltee justamente esa foto), que `subida_por` sea
 * `auth.uid()` (no se firma una foto a nombre de otro) y que la condición no
 * esté cerrada. Con el cliente admin ninguna de las tres corre. El bucket tiene
 * sus propias policies para `authenticated` (`20261029111056`), así que el
 * mismo cliente sube el archivo.
 *
 * No es puro y por eso no tiene test: habla con Storage y con la base. Lo que
 * sí se puede probar —qué foto se acepta y dónde va— vive en
 * `fotoDeCondicion.ts`.
 */

export const BUCKET_DE_FOTOS = "syh-fotos";

/** Lo que dura un link firmado: lo que dura una ficha abierta. */
const UNA_HORA = 60 * 60;

type Cliente = Awaited<ReturnType<typeof createClient>>;

/**
 * El `status` viaja con el error porque **la cola del teléfono lo lee**: un 400
 * es definitivo y deja la carga parada; todo lo demás se reintenta. Quien llama
 * no tiene que volver a decidir cuál es cuál.
 */
export type FotoGuardada =
  | { ok: true; ruta: string; link: string | null }
  | { ok: false; error: string; status: number };

/**
 * Sube la foto y la enlaza a la condición.
 *
 * @param supabase El cliente **del usuario**: ver el encabezado.
 * @param condicionId La condición a la que pertenece. Tiene que existir ya.
 * @param subidaPor Quien la sube; la policy exige que sea quien tiene la sesión.
 * @param foto El archivo tal como llegó en el `FormData`.
 */
export async function guardarLaFoto(
  supabase: Cliente,
  condicionId: string,
  subidaPor: string,
  foto: { type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<FotoGuardada> {
  // Se comprueba igual que la haya comprobado quien llama: esta función es la
  // que escribe, y lo que no se comprueba acá es lo que un tercer camino va a
  // poder meter el día que se agregue.
  const problema = problemaDeLaFoto(foto);
  if (problema) return { ok: false, error: problema, status: 400 };

  const ruta = rutaDeLaFoto(condicionId, foto.type, Date.now());
  const bucket = supabase.storage.from(BUCKET_DE_FOTOS);

  const { error: errorDeSubida } = await bucket.upload(
    ruta,
    new Uint8Array(await foto.arrayBuffer()),
    { contentType: foto.type, upsert: false }
  );
  if (errorDeSubida) {
    // Sin traducir: lo que dijo Storage es lo único que distingue «el bucket no
    // acepta este tipo» de «se cortó a mitad de camino», y lo va a leer quien
    // tenga que decidir si vuelve a sacar la foto.
    return {
      ok: false,
      error: `No se pudo guardar la foto: ${errorDeSubida.message}`,
      status: 502,
    };
  }

  const { error: errorDelEnlace } = await supabase.from("syh_fotos").insert({
    condicion_id: condicionId,
    ruta,
    subida_por: subidaPor,
    // `respaldada_en_drive_el` NO se manda: es del cron de respaldo, y la policy
    // exige que entre en null.
  });

  if (errorDelEnlace) {
    // El archivo está arriba y la fila no entró: eso es exactamente la foto
    // perdida que esta función existe para que no pase. Se saca el archivo, así
    // el bucket no se llena de huérfanos que nadie ve, y quien llama reintenta
    // de cero. Si el borrado tampoco sale, se dice: queda un archivo de más,
    // que es visible en el bucket y no se parece a una foto que sí entró.
    const { error: errorAlLimpiar } = await bucket.remove([ruta]);
    const huerfano = errorAlLimpiar
      ? ` El archivo quedó en el bucket (${ruta}) y no se pudo sacar: ${errorAlLimpiar.message}.`
      : "";
    // 42501 es la policy, y acá **sí se traduce**, que es la excepción a la
    // regla de «lo que dijo la base va sin tocar». Esa regla vale cuando el
    // texto distingue un caso de otro —lo que contesta Storage, arriba, es lo
    // único que separa «el bucket no acepta este tipo» de «se cortó»—; acá el
    // código ya se reconoció y sólo puede querer decir dos cosas, las dos
    // accionables. «new row violates row-level security policy for table
    // "syh_fotos"» es la única frase de este camino que alguien parado en la
    // planta no puede hacer nada con ella.
    if (errorDelEnlace.code === "42501") {
      return {
        ok: false,
        error:
          `La foto no se pudo enlazar a la condición: o la condición ya está ` +
          `cerrada —y entonces sólo un admin de Seguridad e Higiene puede ` +
          `reabrirla para agregarle fotos—, o la sesión con la que se mandó no ` +
          `es la de quien la sacó.${huerfano}`,
        status: 403,
      };
    }
    return {
      ok: false,
      error: `La foto se subió pero no se pudo enlazar a la condición: ${errorDelEnlace.message}.${huerfano}`,
      status: 502,
    };
  }

  // Si firmar falla, la foto **ya está guardada y enlazada**: no es un error.
  // Se devuelve sin link y la ficha pide otro cuando la abran.
  const { data: firmado } = await bucket.createSignedUrl(ruta, UNA_HORA);
  return { ok: true, ruta, link: firmado?.signedUrl ?? null };
}
