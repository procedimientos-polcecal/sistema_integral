/**
 * Los dos topes de un mensaje, en un archivo que no importa nada.
 *
 * Viven acá y no en `pedidos.ts` porque la pantalla del hilo necesita los mismos
 * números —para el `maxLength` del campo y para dejar de ofrecer menciones— y
 * `pedidos.ts` arrastra `entidades.ts`, que importa los permisos de Mantenimiento
 * y de Seguridad e Higiene: meterlo en un componente del navegador es llevarse
 * el código del servidor puesto. `pedidos.ts` los vuelve a exportar, así que
 * quien ya los importaba de ahí no cambia.
 */

/**
 * Cuántas personas se pueden mencionar en un mensaje.
 *
 * El padrón activo son 14, así que 20 no recorta a nadie hoy. Existe para que
 * un pedido armado a mano no dispare cientos de consultas de permisos ni
 * cientos de correos: cada mención cuesta una consulta y, si le corresponde,
 * un llamado al Apps Script.
 */
export const MAXIMO_DE_MENCIONES = 20;

/**
 * Cuánto puede medir un mensaje.
 *
 * El texto viaja entero en el cuerpo del correo y en el asunto sólo entra un
 * recorte (`paraUnAsunto`), así que no hay un límite técnico cerca: es el
 * tamaño de una conversación y no el de un informe. Se escribe una vez y vale
 * para la pantalla también.
 */
export const MAXIMO_DEL_TEXTO = 4000;
