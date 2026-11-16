import type { Notificacion } from "./notificaciones";
import { CRECE_CON_EL_DIA } from "./notificaciones";
import { ES_POR_PERSONA } from "./avisos";
import type { Foto } from "./movimiento";

/**
 * Qué cuenta como novedad para el aviso al instante.
 *
 * ── POR QUÉ NO ALCANZA CON `loQueSeMovio` ────────────────────────────────────
 *
 * Aquélla compara contra la foto de **ayer**, una vez por día. Ésta compara
 * contra el vistazo **anterior**, cincuenta y seis veces por día. Casi todo se
 * comporta igual en las dos, y por eso lo tentador es reusarla — pero hay una
 * familia donde la diferencia de cadencia cambia el resultado por completo.
 *
 * ── EL FLANCO DE LA SALUD ────────────────────────────────────────────────────
 *
 * La `cantidad` de un `salud-*` es **la racha de corridas fallidas**, no una
 * cantidad de cosas: lo dice el docstring de `cuantoLlevaMal` en
 * `lib/core/saludDeLasSincronizaciones.ts`. Y en `vercel.json` hay diez
 * sincronizaciones corriendo **seis veces por hora**, así que mientras un
 * recurso siga roto esa racha sube unas seis veces por hora.
 *
 * Un delta la vería subir en cada pasada: **hasta 56 pushes en un día por un
 * solo sync caído**, que es exactamente el anti-goal del diseño. Así que de
 * esta familia se avisa **el flanco** —cuando pasa de sana a rota, una vez— y
 * no el número. El stock sigue en la campana y en los totales de los lunes.
 *
 * Que un recurso que se arregló y se vuelve a romper **sí** avise de nuevo
 * depende de que `guardarElVistazo` **reemplace** el contenido en vez de
 * acumularlo: si la fila vieja quedara, la rotura nueva no se vería como
 * flanco. Las dos mitades se sostienen juntas.
 *
 * ── LO QUE NO ENTRA, Y ES LO MISMO QUE EN `loQueSeMovio` ─────────────────────
 *
 *   - `ES_POR_PERSONA`: su número depende de quién mira y esta cuenta es
 *     global, así que compararlo inventaría una novedad en cada pasada.
 *   - `CRECE_CON_EL_DIA`: su número es el día, así que comparar un reloj da
 *     novedad todas las mañanas a las 7:00.
 *
 * **`ritmo-` no va por flanco**, aunque comparta prefijo-con-número con la
 * salud en `SIN_NUMERO_POR_PREFIJO`: aquello decide si el número **se
 * muestra**, que es otra pregunta. Su racha sube un umbral cada varios días,
 * así que el delta hace justo lo que se quiere —avisar el día que cruza uno
 * nuevo— y el flanco lo callaría para siempre después del primero.
 */

/**
 * Las familias cuyo número es una racha que sube sola, y por eso se avisan una
 * vez al romperse y no en cada pasada.
 */
const POR_FLANCO = ["salud-"] as const;

const vaPorFlanco = (id: string) => POR_FLANCO.some((p) => id.startsWith(p));

export function novedadesAlInstante(avisos: Notificacion[], vistos: Foto): Notificacion[] {
  return avisos.flatMap((a) => {
    if (ES_POR_PERSONA.has(a.id) || CRECE_CON_EL_DIA.has(a.id)) return [];

    // El flanco: sale sólo si no estaba, y con 1 — su racha no son cosas y
    // escribirla diría «7 más» de algo que es un único recurso roto.
    if (vaPorFlanco(a.id)) return vistos.has(a.id) ? [] : [{ ...a, cantidad: 1 }];

    const subio = a.cantidad - (vistos.get(a.id) ?? 0);
    return subio > 0 ? [{ ...a, cantidad: subio }] : [];
  });
}
