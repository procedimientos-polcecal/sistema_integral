"use client";

/*
 * Quién está cargando, para firmar una carga que puede salir horas después.
 *
 * ESTÁ SEPARADO DE `sesionDelTelefono.ts` A PROPÓSITO, y el encabezado de ese
 * archivo explica por qué: lo importa `components/CargasEsperando.tsx`, que se
 * monta en el layout de **toda** la app, y por eso ahí no hay más dependencia
 * que IndexedDB. Esto sí arrastra el cliente de Supabase, así que vive aparte y
 * lo importan sólo los dos que ya lo cargan igual: la pantalla `/cargar` y
 * `mandarOEncolar.ts`.
 *
 * Antes del 02/11/2026 esto vivía adentro de `app/cargar/catalogos.ts` y era de
 * esa pantalla. Dejó de serlo cuando los botones de siempre empezaron a poder
 * encolar: ahora los dos caminos tienen que anotar lo mismo, y una segunda
 * copia de «cómo se averigua quién sos» es cómo se desincronizan.
 */

import { createClient } from "@/lib/supabase/client";
import {
  recordarQuienEs,
  sesionRecordada,
  type SesionRecordada,
} from "./sesionDelTelefono";

/**
 * Quién tiene la sesión abierta ahora, y lo deja anotado para cuando no haya
 * red. Devuelve null si no se pudo **averiguar**; ahí vale lo que ya estaba
 * guardado, que es de la última persona que entró.
 *
 * **LOS DOS FALLOS NO SE MEZCLAN, Y ESO ES EL ARREGLO DEL 19/10/2026.** No
 * poder averiguar quién sos es normal —no hay red— y se contesta con null. No
 * poder **anotarlo** es otra cosa: el almacenamiento está lleno o bloqueado,
 * que es justo el modo de falla que la pantalla sin señal existe para contar.
 * Eso sale como rechazo, igual que todo `idb.js`.
 *
 * `getSession()` y no `getUser()`: el segundo le pregunta al servidor de
 * Supabase, y esto existe para los momentos en que no hay servidor que
 * conteste. `getSession()` lee la sesión que el navegador ya tiene.
 */
export async function recordarLaSesion(): Promise<SesionRecordada | null> {
  const supabase = createClient();

  let id: string;
  let nombre: string;
  try {
    const { data } = await supabase.auth.getSession();
    const usuario = data.session?.user;
    if (!usuario) return null;
    id = usuario.id;
    // El correo alcanza para nombrar a alguien y está en la sesión misma; el
    // nombre de verdad hay que ir a buscarlo, y puede no llegar.
    nombre = usuario.email ?? usuario.id;

    const { data: fila } = await supabase
      .from("usuarios")
      .select("nombre, apellido")
      .eq("id", usuario.id)
      .maybeSingle();
    if (fila) nombre = `${fila.nombre ?? ""} ${fila.apellido ?? ""}`.trim() || nombre;
  } catch {
    // Sin red no se puede averiguar nada nuevo, y eso no es un error que haya
    // que mostrar: lo guardado sigue valiendo.
    return null;
  }

  return await recordarQuienEs(id, nombre);
}

/**
 * Quién firma la carga que se está por mandar.
 *
 * Primero intenta averiguarlo de nuevo —y de paso lo deja anotado, que es lo
 * que le permite al service worker mandar esa carga con la app cerrada—; si no
 * se pudo, vale lo último que se anotó en este teléfono.
 *
 * **Devuelve null sólo cuando no hay ninguna de las dos cosas**, que es un
 * teléfono donde nunca entró nadie con señal. Una carga sin dueño no la puede
 * mandar el worker —`puedeMandarse` compara contra la anotación— así que ahí
 * encolarla sería guardarla para siempre, y quien llama tiene que decirlo en
 * vez de fingir que quedó esperando.
 */
export async function quienCarga(): Promise<SesionRecordada | null> {
  return (await recordarLaSesion()) ?? (await sesionRecordada());
}
