/**
 * Lo que hay que decirle a quien corrigió una fichada cuando el día no quedó
 * anotado en `rrhh_dias_corregidos`.
 *
 * Las tres rutas de fichadas (POST, PUT, DELETE) devuelven `diaSinProteger:
 * true` cuando eso pasa. La corrección **sí se guardó**, pero la sincronización
 * automática con Lenox va a volver a pisar ese día: si la pantalla no lo dice,
 * la persona da por protegida una corrección que no lo está, y la pierde a la
 * mañana siguiente sin que nada avise.
 *
 * El texto dice qué hacer y no sólo que algo falló, porque la causa probable es
 * sistemática (una migración sin correr, una policy mal armada): si aparece una
 * vez, va a aparecer siempre.
 */
export const AVISO_DIA_SIN_PROTEGER =
  "La corrección se guardó, pero el día no quedó protegido de la sincronización automática con Lenox: " +
  "la próxima corrida puede volver a pisarlo. Avisá a sistemas para que lo revisen, y mientras tanto " +
  "volvé a mirar este día después de la próxima sincronización.";

/**
 * ¿Esta respuesta de las rutas de fichadas trae `diaSinProteger`?
 *
 * Nunca lanza: un 204 (el DELETE sin problema) no tiene cuerpo, y una respuesta
 * que no es JSON no es un motivo para romper una operación que ya funcionó.
 * Lee de un clon, así que quien la llama puede seguir leyendo el cuerpo.
 */
export async function traeDiaSinProteger(res: Response): Promise<boolean> {
  if (res.status === 204) return false;
  try {
    const cuerpo = await res.clone().json();
    return cuerpo?.diaSinProteger === true;
  } catch {
    return false;
  }
}
