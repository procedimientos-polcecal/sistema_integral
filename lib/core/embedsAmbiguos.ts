/**
 * Los embeds de PostgREST que **tienen que** nombrar el foreign key.
 *
 * Cuando entre dos tablas hay más de un camino, PostgREST no elige: contesta
 * **300 PGRST201** y la consulta entera falla. Es un error que no ve nada de
 * lo que este repo corre antes de desplegar —ni `vitest`, ni `tsc`, ni el
 * build, ni `revisar-arbol-commiteado`—, porque lo resuelve el servidor del
 * otro lado del cable con el esquema real delante. La consulta se escribe, el
 * tipo cierra, el deploy pasa, y la pantalla se rompe en producción.
 *
 * Ya pasó dos veces:
 *
 * 1. `mensajes` → `usuarios`, por `mensajes_menciones`: alguien escribía, el
 *    correo salía, y después el hilo no se podía leer ni por el autor ni por
 *    el mencionado.
 * 2. `compras_requerimientos` → `proveedores`, por
 *    `compras_requerimiento_proveedores` (los invitados a cotizar), el
 *    24/11/2026: **ninguna orden de compra se podía generar**, tampoco las que
 *    ya funcionaban, porque `empujarOrdenesDeRequerimiento` salía con el
 *    mensaje crudo de PostgREST antes de hacer nada.
 *
 * La segunda apareció en una revisión, no en la suite. Esto es esa revisión
 * convertida en código. **No descubre pares nuevos**: un par entra acá cuando
 * alguien lo encuentra, igual que las entradas de `revisar-exportaciones`. Lo
 * que sí hace es que una vez encontrado no vuelva.
 *
 * Para agregar uno, el `hint` del propio 300 trae el nombre del FK:
 *
 *   curl "$URL/rest/v1/<origen>?select=<destino>(id)&limit=1" -H "apikey: ..."
 */

export interface ParAmbiguo {
  /** La tabla del `.from()`. */
  origen: string;
  /** La tabla embebida en el `.select()`. */
  destino: string;
  /** El FK que hay que nombrar: `destino!fk(...)`. */
  fk: string;
  /** Cuál es el segundo camino, que es lo que no se deduce leyendo la query. */
  porque: string;
}

export const AMBIGUOS: ParAmbiguo[] = [
  {
    origen: "compras_requerimientos",
    destino: "proveedores",
    fk: "compras_requerimientos_proveedor_id_fkey",
    porque:
      "`compras_requerimiento_proveedores` es el segundo camino: los proveedores invitados " +
      "a cotizar ese pedido, que son muchos, contra el proveedor elegido, que es uno.",
  },
  {
    origen: "compras_requerimientos",
    destino: "empresas",
    fk: "empresa_id",
    porque:
      "`compras_odoo_ordenes` es el segundo camino: un RI de AMBAS tiene una orden por " +
      "empresa. Éste ya estaba bien escrito y comprobado en la pantalla del RI; entra al " +
      "registro para que siga estándolo.",
  },
  {
    origen: "mensajes",
    destino: "usuarios",
    fk: "mensajes_creado_por_fkey",
    porque: "`mensajes_menciones` es el segundo camino: a quiénes nombra el mensaje.",
  },
];

/** Hasta dónde se mira después de un `.from()` para encontrar su `.select()`. */
const VENTANA = 600;

/**
 * Si ese `select()` embebe a `destino` **en el primer nivel** y sin FK.
 *
 * El nivel importa y fue lo primero que falló: `app/api/mensajes/route.ts`
 * escribe bien `autor:usuarios!mensajes_creado_por_fkey(...)` y adentro de
 * `menciones:mensajes_menciones(...)` lleva un `usuario:usuarios(...)`. Ese
 * segundo es un embed de `mensajes_menciones` a `usuarios`, que tiene un solo
 * camino y no necesita nada. Un control que mire el texto plano lo acusa, y un
 * control que acusa a lo que está bien se termina apagando.
 *
 * Del token que precede al paréntesis se saca la tabla: en `alias:tabla(` es
 * lo que va después de los dos puntos, y en la forma correcta —`tabla!fk(`—
 * el token incluye el `!fk`, así que no coincide con el nombre pelado. La
 * ausencia del FK **es** el hallazgo; no hay que entender el resto del select.
 */
function embebeSinFk(select: string, destino: string): boolean {
  let nivel = 0;

  for (let i = 0; i < select.length; i++) {
    const c = select[i];
    if (c === ")") {
      nivel--;
      continue;
    }
    if (c !== "(") continue;

    if (nivel === 0) {
      const token = select.slice(0, i).match(/([A-Za-z0-9_!:]+)$/)?.[1] ?? "";
      const tabla = token.includes(":") ? token.slice(token.lastIndexOf(":") + 1) : token;
      if (tabla === destino) return true;
    }
    nivel++;
  }

  return false;
}

/**
 * Los pares de `AMBIGUOS` que este archivo embebe sin nombrar el FK.
 *
 * Mira la ventana de texto que sigue a cada `.from("<origen>")`, saca de ahí
 * la cadena del `.select()` y la revisa. La ventana se corta en el `.from()`
 * siguiente, para no acusar a la consulta de al lado.
 */
export function embedsSinFk(fuente: string, pares: ParAmbiguo[] = AMBIGUOS): string[] {
  const hallazgos = new Set<string>();

  for (const par of pares) {
    const desde = new RegExp(`\\.from\\(\\s*["'\`]${par.origen}["'\`]`, "g");
    for (const encontrado of fuente.matchAll(desde)) {
      const arranca = (encontrado.index ?? 0) + encontrado[0].length;
      let ventana = fuente.slice(arranca, arranca + VENTANA);

      // Lo que viene después del próximo `.from(` ya es otra consulta.
      const siguiente = ventana.indexOf(".from(");
      if (siguiente !== -1) ventana = ventana.slice(0, siguiente);

      const select = ventana.match(/\.select\(\s*(["'`])([\s\S]*?)\1/)?.[2];
      if (select && embebeSinFk(select, par.destino)) {
        hallazgos.add(`${par.origen} → ${par.destino}`);
      }
    }
  }

  return [...hallazgos];
}
