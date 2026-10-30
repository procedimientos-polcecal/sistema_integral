/**
 * El cuerpo de la ruta que carga el motivo de una parada. Vive aparte de la
 * ruta para poder probar la validación sin levantar nada: las rutas no tienen
 * tests en este repo y lo que se decide acá —qué entra y qué no— sí merece uno.
 *
 * Tres cosas que no se deducen del código:
 *
 * - **`turno` null es "planta parada" y se manda explícito.** Un `turno` que no
 *   viene no es lo mismo que uno en null: el primero es un cuerpo incompleto y
 *   el segundo es el día entero. Por eso el campo es obligatorio y nullable,
 *   no opcional.
 * - **El motivo es obligatorio también para la planta parada.** La columna es
 *   `not null`, y de todos modos una planta parada sin motivo sería un día
 *   entero tapado sin explicar nada, que es justo lo que la cola viene a
 *   evitar.
 * - **`orden_trabajo_id` ausente no es lo mismo que null.** Ausente = no se
 *   toca el enlace; null = se quita. Quien carga sin acceso a Mantenimiento no
 *   ve la lista de OT y no manda el campo: si ausente significara null, cada
 *   motivo que corrigiera le borraría el enlace que otra persona puso.
 */

import { z } from "zod";
import { esFechaIso } from "@/lib/core/fechas";

const TURNOS = ["00_04", "04_12", "12_20", "20_00"] as const;

const fecha = z
  .string()
  .refine((f) => esFechaIso(f), { message: "La fecha tiene que existir, con forma AAAA-MM-DD." });

const motivo = z
  .string()
  .transform((m) => m.trim())
  .refine((m) => m.length > 0, { message: "Falta el motivo de la parada." })
  .refine((m) => m.length <= 500, { message: "El motivo no puede pasar de 500 caracteres." });

export const AltaDeParada = z.object({
  molino_id: z.string().uuid(),
  fecha,
  turno: z.enum(TURNOS).nullable(),
  motivo,
  orden_trabajo_id: z.string().uuid().nullable().optional(),
});

export const EdicionDeParada = z.object({
  id: z.string().uuid(),
  motivo,
  orden_trabajo_id: z.string().uuid().nullable().optional(),
});

export const BajaDeParada = z.object({ id: z.string().uuid() });

/**
 * Lo que se le dice a quien intenta cargar algo que ya está cargado. **Son dos
 * cosas distintas**: un turno con motivo y un día con la planta parada. Con
 * `unique nulls not distinct` la base los rechaza igual, y el mismo cartel para
 * los dos le diría a quien marcó el día entero que "ese turno" ya tiene motivo,
 * cuando lo que hay es una planta parada de ese día.
 */
export function mensajeDeDuplicada(turno: string | null): string {
  return turno === null
    ? "Ese día ya tiene marcada la planta parada: recargá la pantalla para verla."
    : "Ese turno ya tiene un motivo cargado: recargá la pantalla para verlo.";
}
