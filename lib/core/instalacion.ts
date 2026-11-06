/**
 * Qué instrucciones de instalación le tocan a cada persona.
 *
 * EL PROBLEMA
 *
 * Instalar el SdG en el teléfono no se hace igual en todos lados, y la
 * diferencia no es de estética: en Android el navegador ofrece un botón que
 * instala de un toque, y en iPhone **no existe tal botón**. Hay que ir al menú
 * de compartir y elegir "Agregar a inicio". Mostrarle a alguien las
 * instrucciones de la otra plataforma es peor que no mostrarle nada: busca un
 * botón que no está.
 *
 * POR QUÉ `CriOS` Y COMPAÑÍA CAEN EN `ios`
 *
 * En iOS todos los navegadores —Chrome (`CriOS`), Firefox (`FxiOS`), Edge— son
 * por obligación una envoltura de WebKit, y **ninguno puede disparar la
 * instalación solo**: la única vía es el menú de compartir de Safari. Por eso
 * no se mira qué navegador dice ser, sino que el sistema sea iOS. Preguntar por
 * "Safari" daría "escritorio" para quien abrió el link desde Chrome en su
 * iPhone, que es justo la persona que más necesita la explicación.
 *
 * POR QUÉ EL SAFARI DE ESCRITORIO NO
 *
 * Su user agent dice `Safari` y `Macintosh`, y no es un teléfono. Se decide por
 * las palabras `iPhone`, `iPad` e `iPod`, que sólo aparecen en dispositivos
 * iOS, y no por `Safari` ni por `Mac`.
 *
 * UN LÍMITE CONOCIDO: desde iPadOS 13 un iPad con la opción "sitio de
 * escritorio" (que viene activada) se presenta como `Macintosh`, y esta función
 * lo ve como escritorio. Se acepta: el resultado es el texto genérico y no un
 * error, y distinguirlo exigiría mirar `navigator.maxTouchPoints`, que acá no
 * se lee a propósito (ver abajo).
 *
 * POR QUÉ RECIBE LOS DATOS Y NO LOS LEE
 *
 * No toca `navigator` ni `window`: quien la llama le pasa el `userAgent` y si
 * la página corre ya instalada (`standalone`). Así se prueba con textos reales
 * y sin simular un navegador, y es la misma función en el servidor y en el
 * cliente.
 *
 * EL PEOR CASO ES SEGURO
 *
 * Un user agent vacío o desconocido da `escritorio`, que muestra el texto
 * genérico. Equivocarse hacia ahí no rompe nada ni manda a nadie a buscar un
 * botón que no existe.
 */

export type PlataformaInstalacion =
  | "ya-instalada"
  | "ios"
  | "android"
  | "escritorio";

export function plataformaDeInstalacion(
  userAgent: string,
  standalone: boolean,
): PlataformaInstalacion {
  // Ya instalada gana sobre todo: quien abre la app desde el ícono no necesita
  // que se le explique cómo instalarla, sea cual sea su teléfono.
  if (standalone) return "ya-instalada";
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "escritorio";
}
