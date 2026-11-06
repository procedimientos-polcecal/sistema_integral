"use client";

/*
 * Quién tiene la sesión abierta en **este teléfono**, anotado donde el service
 * worker lo pueda leer.
 *
 * POR QUÉ ESTO EXISTE, Y NO ES UNA COMODIDAD. El alta de OT escribe en la
 * planilla el nombre y el correo de la sesión que mandó el POST. El service
 * worker vacía la cola con la app cerrada y **no puede leer la cookie**, así
 * que para saber de quién es la sesión lee esta anotación: `puedeMandarse`
 * compara el dueño de la carga contra ella y no deja salir nada que no cuadre.
 *
 * De ahí sale la única regla de este archivo, y es la que vale la pena leer:
 *
 *   > **Quien va a pedir un vaciado anota primero quién es. Si no pudo
 *   > anotarlo, no lo pide.**
 *
 * Porque si la anotación quedó vieja, la comparación da true contra la persona
 * equivocada y el POST sale con la cookie de quien tiene el teléfono ahora:
 * una carga firmada por quien no la hizo, que es un anti-objetivo textual del
 * spec. Hasta el 19/10/2026 esto lo escribía sólo `/cargar`, mientras la barra
 * del layout pedía el vaciado desde las 313 pantallas del sistema.
 *
 * Vive en `lib/core/` y no en `app/cargar/catalogos.ts` por una razón concreta
 * de tamaño: lo importa `components/CargasEsperando.tsx`, que se monta en el
 * layout de toda la app, y `catalogos.ts` arrastra el cliente de Supabase.
 * Acá no hay más dependencia que IndexedDB.
 */

import { SESION } from "@/public/cola/colaOffline.js";
import { guardarCatalogo, leerCatalogo } from "@/public/cola/idb.js";

/** Quién tiene la sesión abierta, tal como quedó anotado en el teléfono. */
export interface SesionRecordada {
  id: string;
  nombre: string;
}

/** Id de usuario → cómo se llama. Sólo de quienes entraron en este teléfono. */
export type GenteConocida = Record<string, string>;

/**
 * Dónde se guarda la gente que pasó por este teléfono.
 *
 * No la lee el service worker —a él le alcanza con el id de `SESION`— así que
 * esta clave no es pegamento entre dos mundos y se queda acá. La cola la usa
 * para poder decir «es de Ana» en lugar de un uuid: de una carga ajena lo único
 * que se guarda es el id del dueño, y un id no le dice nada a nadie.
 */
const GENTE = "gente";

/**
 * La sesión que quedó anotada la última vez que alguien entró en este teléfono.
 * Es lo que se usa sin señal, cuando no hay a quién preguntarle.
 */
export async function sesionRecordada(): Promise<SesionRecordada | null> {
  return await leerCatalogo<SesionRecordada>(SESION);
}

/** Los nombres de quienes entraron alguna vez en este teléfono. */
export async function genteConocida(): Promise<GenteConocida> {
  return (await leerCatalogo<GenteConocida>(GENTE)) ?? {};
}

/**
 * Anota quién tiene la sesión abierta ahora, y lo suma a la gente conocida.
 *
 * **No traga su error**, igual que todo `idb.js`: si el almacenamiento está
 * lleno o bloqueado, quien llama tiene que enterarse. Para la barra del layout
 * eso significa no pedir el vaciado —mejor que la cola espere a que alguien
 * abra `/cargar` que mandarla firmada por quien no la hizo—; para `/cargar`,
 * decirlo en pantalla, que es lo que esa pantalla existe para hacer.
 *
 * El nombre es para que la cola pueda decir de quién es una carga ajena. Si no
 * se sabe, va el id: nombrar mal es peor que no nombrar.
 */
export async function recordarQuienEs(
  id: string,
  nombre: string,
): Promise<SesionRecordada> {
  const sesion: SesionRecordada = { id, nombre: nombre.trim() || id };
  await guardarCatalogo(SESION, sesion);
  await guardarCatalogo(GENTE, { ...(await genteConocida()), [id]: sesion.nombre });
  return sesion;
}
