/*
 * ¿Hay alguna escritura a una planilla que, si falla, no deje nada atrás?
 *
 *   node scripts/revisar-exportaciones.mjs
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * La regla del CLAUDE.md es: «toda ruta que toque un campo que se exporta tiene
 * que exportar, y si no puede, dejar el pendiente anotado». **Incumplirla no
 * rompe nada, y ése es el problema** — la misma familia que la grilla sin
 * breakpoint y el `<select>` nativo. No hay error, no hay test que lo note,
 * `tsc` y el build pasan: el cambio se guarda, la pantalla muestra un cartel
 * que alguien cierra, y horas después la sincronización lee la celda vieja y lo
 * borra.
 *
 * Ya pasó dos veces, con dos semanas de diferencia: el PATCH de las órdenes de
 * trabajo (26/10/2026, las OT 2896 a 2898 y la 2908) y el PATCH de las órdenes
 * de servicio, que tenía el mismo agujero y se encontró buscando el primero a
 * mano. Buscarlo a mano es lo que este script reemplaza.
 *
 * ── QUÉ COMPRUEBA, Y QUÉ NO ─────────────────────────────────────────────────
 *
 * **No intenta decidir si una ruta está bien.** Eso depende de si el importador
 * de ese módulo vuelve a leer la columna que se escribió, y eso no se deduce de
 * un regex. Lo que comprueba es más chico y mucho más confiable: que **ninguna
 * escritura nueva aparezca sin que alguien haya dicho qué la protege**.
 *
 * O sea: es un chequeo de completitud, no de corrección. El registro de abajo
 * tiene una entrada por archivo que escribe una planilla, con su estrategia y
 * el porqué. Si aparece un archivo que escribe y no está en el registro, sale
 * ROMPE y quien lo escribió tiene que elegir una de las cinco estrategias y
 * dejar dicho por qué. **Ese momento —y no un regex— es la defensa**: el
 * script no sabe si una ruta está bien, pero sí logra que nadie escriba una
 * planilla sin haber contestado la pregunta.
 *
 * Las cinco estrategias, que son las que el repo ya usa:
 *
 *   cola           Se guarda, se escribe, y si falla queda `sheets_pendiente`.
 *                  El archivo lo anota él mismo.
 *   delega         Escribe y devuelve qué pasó; lo anota quien la llama. Quien
 *                  la llama queda obligado a declararse (ver abajo).
 *   aborta         La planilla primero: un fallo tira abajo la operación
 *                  entera. No hay nada que encolar porque no se guardó nada.
 *   pantalla       Sólo se le dice a quien hizo la acción. Es la excepción a la
 *                  regla, así que exige un porqué, se lista siempre al final de
 *                  la corrida, y es lo primero que hay que mirar cuando un dato
 *                  se pierde.
 *   otra-direccion No es exportar un dato de la app a su espejo: es el libro de
 *                  respaldo, una marca que deja un importador, una bajada
 *                  masiva. La regla no aplica.
 *
 * **Escribir se cuenta con la indirección puesta.** Casi ninguna ruta llama a
 * una primitiva: llama a su espejo. Por eso quien importa y usa algo de un
 * módulo declarado `delega` cuenta también como escritor y tiene que estar en
 * el registro — si no, una ruta nueva que use `escribirEnLaFilaDeLaOT` sin
 * anotar nada sería invisible, que es exactamente el bug que esto vino a
 * buscar. Se mira el **import** y no sólo el nombre, o `ordenes.ts` queda
 * marcado por tener su propia `fechaParaLaPlanilla`.
 *
 * Lo único que sí verifica del código es lo que puede verificar sin
 * interpretarlo: que quien dice `cola` **nombre** una columna de pendiente.
 * Eso atrapa el "declarado y después vaciado", que es como una defensa se
 * muere en silencio.
 *
 * ── SALIDA ──────────────────────────────────────────────────────────────────
 *
 * ROMPE  un archivo que escribe y no está declarado; un `cola` que no anota;
 *        una entrada sin porqué o con una estrategia que no existe.
 * MIRAR  una entrada del registro que ya no escribe — sobra, o se movió.
 *
 * Sale 1 si hay algún ROMPE. Hoy da ROMPE 0 · MIRAR 0.
 *
 * **Todavía NO está en el CI**, por el mismo motivo que `revisar-responsive`:
 * primero conviene que el registro aguante unas semanas de cambios sin dar
 * falsos positivos. Mientras tanto se corre a mano, como los otros.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Las cuatro primitivas que escriben en una planilla de Google.
 *
 * Son las de `lib/core/sheets.ts` más `agregarFila` de `lib/compras/drive.ts`,
 * que es el escritor propio de Compras. Si algún día aparece una quinta, hay
 * que sumarla acá: es el único lugar donde el script sabe qué es escribir.
 *
 * No están `crearPestana`, `formatearColumnas`, `protegerPestana` ni
 * `borrarPestana`: no escriben un dato que un importador pueda volver a leer.
 */
const PRIMITIVAS = ["escribirCeldas", "agregarFila", "escribirBloque", "reemplazarPestana"];

/**
 * Qué protege a cada archivo que escribe una planilla.
 *
 * **Una entrada por archivo, y el porqué no es decoración**: es lo que alguien
 * va a leer dentro de seis meses cuando un dato aparezca mal y haya que
 * decidir si el problema está acá.
 *
 * Revisado entero el 26/10/2026.
 */
export const REGISTRO = {
  // ── El núcleo y los escritores ───────────────────────────────────────────
  "lib/core/sheets.ts": {
    estrategia: "otra-direccion",
    porque: "Es donde viven las primitivas: no exporta ningún dato por su cuenta.",
  },
  "lib/compras/drive.ts": {
    estrategia: "otra-direccion",
    porque:
      "El escritor propio de Compras para los libros de comparativa, que son un " +
      "documento por RI y no un espejo. No decide nada: lo deciden sus llamadores.",
  },

  // ── Mantenimiento ────────────────────────────────────────────────────────
  "lib/mantenimiento/planillaDeOT.ts": {
    estrategia: "delega",
    porque:
      "Devuelve el motivo y no lanza. Lo anota quien la llama, salvo las notas, " +
      "que están declaradas aparte con su porqué.",
  },
  "lib/mantenimiento/planillaDeOS.ts": {
    estrategia: "delega",
    porque: "Gemela de planillaDeOT: devuelve el motivo y lo anota quien la llama.",
  },
  "app/api/mantenimiento/ordenes-servicio/route.ts": {
    estrategia: "cola",
    porque:
      "El PATCH anota el pendiente del seguimiento (26/10/2026). La escritura " +
      "directa que queda es la aprobación, que es planilla-primero y devuelve 502.",
  },
  "lib/mantenimiento/formulario.ts": {
    estrategia: "aborta",
    porque:
      "El alta de una OT escribe la hoja de respuestas primero y relee lo escrito. " +
      "Si no puede, no se crea la orden: una OT sin fila no existe.",
  },
  "app/api/mantenimiento/avisos/route.ts": {
    estrategia: "aborta",
    porque:
      "El alta de un aviso escribe la planilla antes de insertar y devuelve 502 si " +
      "falla, para no dejar un aviso con un número que la planilla no conoce.",
  },
  "app/api/mantenimiento/comparativas/route.ts": {
    estrategia: "aborta",
    porque:
      "Los tres caminos —alta, elegir, borrar— escriben la planilla primero y " +
      "devuelven 502 si falla. La sincronización borraría una cotización que " +
      "la planilla no tiene.",
  },
  "app/api/mantenimiento/ordenes/[id]/notas/route.ts": {
    estrategia: "pantalla",
    porque:
      "La columna X no la lee `filaDeOrden`, así que ninguna sincronización puede " +
      "pisar una justificación: la nota vive en `ordenes_trabajo_notas`. Y la cola " +
      "no la puede rehacer entera —el DELETE tiene que vaciar la celda y su regla " +
      "es que lo vacío no viaja—. El porqué largo y lo medido están en el " +
      "encabezado de la ruta.",
  },
  "lib/mantenimiento/planillaDelAviso.ts": {
    estrategia: "delega",
    porque:
      "La escritura compartida de los tres caminos de avisos. Devuelve el motivo y " +
      "no lanza; lo anota quien la llama.",
  },
  "lib/mantenimiento/marcarElAviso.ts": {
    estrategia: "cola",
    porque:
      "Anota el pendiente de `ot_asignada` desde el 29/10/2026. Era un hueco: " +
      "`filaDeAviso` relee `OT ASIGNADA`, así que el sync pisaba el enlace con la " +
      "celda vacía.",
  },
  "app/api/mantenimiento/avisos/desestimar/route.ts": {
    estrategia: "cola",
    porque:
      "Los dos caminos anotan el pendiente de `observaciones`. El DELETE **vacía** " +
      "la celda, que es la mitad de por qué esta cola guarda el campo en vez de " +
      "rearmar todo desde la fila.",
  },
  "app/api/mantenimiento/avisos/enlazar/route.ts": {
    estrategia: "cola",
    porque:
      "El DELETE vacía `OT ASIGNADA` y lo anota. Vaciar es seguro acá porque " +
      "`loQueImpideDesenlazar` ya se negó cuando el número lo escribió una persona.",
  },

  // ── Compras ──────────────────────────────────────────────────────────────
  "lib/compras/formulario.ts": {
    estrategia: "delega",
    porque:
      "Devuelve `falla`/`listo` por paso. Lo junta `exportarRequerimiento`, que " +
      "escribe `sheets_pendiente` con las bloqueadas y las en espera por separado.",
  },
  "lib/compras/seguimientoSheets.ts": {
    estrategia: "cola",
    porque:
      "Tiene su propia cola, `seguimiento_pendiente`, aparte a propósito: es otro " +
      "libro, y un fallo acá no tiene por qué ensuciar el pendiente del master.",
  },
  "app/api/compras/requerimientos/[id]/cotizaciones/route.ts": {
    estrategia: "pantalla",
    porque:
      "Lo que escribe a mano es el libro de comparativa del RI, que es un documento " +
      "por pedido y no un espejo que un cron relea —de ahí sólo se importa cuando " +
      "una persona aprieta vincular—. El master sí va por la cola, con " +
      "`exportarRequerimiento`.",
  },

  // ── Los espejos que devuelven el resultado ───────────────────────────────
  "lib/inventario/espejo.ts": {
    estrategia: "delega",
    porque: "Devuelve `ResultadoEspejo`; la ruta anota o limpia, nunca a medias.",
  },
  "lib/calidad/envases/espejo.ts": {
    estrategia: "delega",
    porque: "Devuelve `ResultadoEspejo`; la ruta anota o limpia.",
  },
  "lib/calidad/espejo.ts": {
    estrategia: "cola",
    porque:
      "`exportarMovimiento` anota y limpia ella misma, y por eso la ruta no se " +
      "puede olvidar: es el único camino para escribir un movimiento de carbonilla.",
  },
  "lib/cantera/espejo.ts": {
    estrategia: "delega",
    porque:
      "Devuelve `ResultadoEspejo`. Los `desespejar*` no anotan nada y no pueden: " +
      "la fila ya no existe en el sistema, así que no hay dónde.",
  },
  "lib/despacho/espejo.ts": {
    estrategia: "delega",
    porque: "Devuelve `ResultadoEspejo` con la fila; la ruta anota o limpia.",
  },
  "lib/despacho/espejoRecepcion.ts": {
    estrategia: "delega",
    porque: "Devuelve `ResultadoEspejo` con la fila; la ruta anota o limpia.",
  },
  "lib/produccion/espejo.ts": {
    estrategia: "delega",
    porque:
      "Devuelve `ResultadoEspejo`. La ruta anota en **todos** los partes del día, " +
      "no sólo en el que se guardó.",
  },
  "lib/tallerVial/espejo.ts": {
    estrategia: "delega",
    porque:
      "Devuelve `ResultadoEspejo`; las rutas anotan. No hay drenaje: el pendiente " +
      "es el cartel de la pantalla, porque acá manda el sistema y cada fila se " +
      "escribe una sola vez.",
  },
  "lib/trituracion/espejo.ts": {
    estrategia: "delega",
    porque: "Devuelve `ResultadoEspejo`; la ruta anota o limpia.",
  },

  // ── Las rutas que consumen un espejo y tienen que anotar ─────────────────
  //
  // Están una por una y no agrupadas a propósito: es el lugar donde alguien que
  // agrega la próxima tiene que parar y contestar qué la protege.
  "app/api/mantenimiento/ordenes/route.ts": {
    estrategia: "cola",
    porque:
      "El alta y el PATCH anotan el pendiente e insisten con `after()`. El PATCH " +
      "lo hace desde el 26/10/2026: antes devolvía el motivo a la pantalla y la " +
      "sincronización le pisaba el registro del trabajo.",
  },
  "app/api/mantenimiento/partes-contratista/generar/route.ts": {
    estrategia: "cola",
    porque: "Las dos ramas —OT nueva y OT reutilizada— anotan el pendiente del registro.",
  },
  "lib/mantenimiento/sincronizar.ts": {
    estrategia: "cola",
    porque:
      "Son los drenajes: `exportarLoPendiente` y `exportarLoPendienteDeOS` " +
      "reescriben lo que quedó y actualizan la marca con lo que pasó.",
  },
  "lib/compras/sheets.ts": {
    estrategia: "cola",
    porque:
      "`exportarRequerimiento` anota las bloqueadas y las en espera por separado, " +
      "y no pisa el pendiente de un alta que todavía no llegó a la planilla.",
  },
  "app/api/compras/requerimientos/route.ts": {
    estrategia: "cola",
    porque: "El alta nace con `ALTA_SIN_ESCRIBIR` y queda anotado lo que no salga.",
  },
  "app/api/inventario/movimientos/route.ts": {
    estrategia: "cola",
    porque: "Anota o limpia en el mismo update; nunca queda a medias.",
  },
  "app/api/calidad/envases/movimientos/route.ts": {
    estrategia: "cola",
    porque: "Anota o limpia en el mismo update; nunca queda a medias.",
  },
  "app/api/cantera/voladuras/[codigo]/route.ts": {
    estrategia: "cola",
    porque:
      "El PATCH anota o limpia. El DELETE no anota nada y no puede: la voladura ya " +
      "no existe en el sistema, así que no hay fila donde dejar la marca.",
  },
  "app/api/cantera/voladuras/[codigo]/conciliacion/route.ts": {
    estrategia: "cola", porque: "Anota o limpia en el mismo update.",
  },
  "app/api/cantera/bochones/[codigo]/route.ts": {
    estrategia: "cola",
    porque:
      "El PATCH anota o limpia, y el DELETE anota en los bochones **renombrados**, " +
      "que sí siguen existiendo. El vaciado de la fila del borrado no se anota " +
      "porque no hay dónde.",
  },
  "app/api/cantera/bochones/[codigo]/conciliacion/route.ts": {
    estrategia: "cola", porque: "Anota o limpia en el mismo update.",
  },
  "app/api/despacho/ordenes/[id]/route.ts": {
    estrategia: "cola", porque: "Anota o limpia junto con la fila; nunca queda a medias.",
  },
  "app/api/despacho/recepciones/[id]/route.ts": {
    estrategia: "cola", porque: "Anota o limpia junto con la fila al cerrar la recepción.",
  },
  "app/api/produccion/partes/route.ts": {
    estrategia: "cola",
    porque:
      "Anota o limpia en **todos** los partes del día, no sólo en el que se guardó: " +
      "si el de la mañana había quedado pendiente y ahora sale, tiene que dejar de " +
      "aparecer en el tablero.",
  },
  "app/api/produccion/planilla/reintentar/route.ts": {
    estrategia: "cola", porque: "Es el botón de reintento: vuelve a escribir y actualiza la marca.",
  },
  "app/api/trituracion/partes/route.ts": {
    estrategia: "cola", porque: "Anota si falla y limpia si el parte venía pendiente.",
  },
  "app/api/taller-vial/cargas/route.ts": {
    estrategia: "cola",
    porque:
      "Anota si falla. No hay drenaje: acá manda el sistema y cada fila se escribe " +
      "una sola vez, así que el pendiente es el cartel que ve quien cargó.",
  },
  "app/api/taller-vial/estados/route.ts": {
    estrategia: "cola",
    porque: "Anota si falla, y el upsert del estado del día lo limpia al reintentar.",
  },

  // ── Las que no son exportar ──────────────────────────────────────────────
  "lib/respaldo/correr.ts": {
    estrategia: "otra-direccion",
    porque:
      "El libro de respaldo: una pestaña por instantánea, reescrita entera. No es " +
      "el espejo de nadie y nada lo vuelve a leer.",
  },
  "lib/calidad/desdeLaPlanilla.ts": {
    estrategia: "otra-direccion",
    porque:
      "Escribe el id del movimiento en la columna K **durante la importación**, " +
      "que es el ancla que evita el lazo. Va en el sentido contrario.",
  },
  "lib/calidad/envases/bajada.ts": {
    estrategia: "otra-direccion",
    porque:
      "La bajada del kardex completo: reescribe la planilla entera con lo que el " +
      "SdG tiene. Es el primer paso del cambio de dirección del 19/10/2026 y no " +
      "convive encendida con el importador.",
  },
};

/**
 * Las columnas donde se anota que algo no llegó a la planilla.
 *
 * Son tres nombres y no uno porque las colas no son iguales:
 * `seguimiento_pendiente` es la de Compras, que va aparte a propósito —es otro
 * libro—, y `sheets_pendiente_campos` es la de los avisos, que guarda **qué
 * campo** falló. El `\b` no alcanzaba para esa última: `_` es carácter de
 * palabra, así que `sheets_pendiente` no hace borde dentro de
 * `sheets_pendiente_campos` y los dos archivos que sólo la nombraban a ella
 * salían como «dice cola y no anota». Se nombran las tres.
 */
const COLUMNAS_DE_PENDIENTE =
  /\bsheets_pendiente\b|\bsheets_pendiente_campos\b|\bseguimiento_pendiente\b/;

const ESTRATEGIAS = ["cola", "delega", "aborta", "pantalla", "otra-direccion"];

/** Si el archivo llama a alguno de esos nombres. */
const llamaA = (texto, nombres) =>
  nombres.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(texto));

/** Si el archivo llama a alguna primitiva de escritura. */
export function escribeEnUnaPlanilla(texto) {
  return llamaA(texto, PRIMITIVAS);
}

/** Los nombres que un módulo exporta como función. */
function exportadas(texto) {
  const nombres = [];
  const re = /^[ \t]*export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of texto.matchAll(re)) nombres.push(m[1]);
  return nombres;
}

/**
 * Qué nombres importa un archivo, y de qué módulo. `@/lib/x` → `lib/x`.
 *
 * **Se mira el import y no sólo el nombre**, y eso no es prolijidad: sin esto
 * `lib/mantenimiento/ordenes.ts` quedaba marcado como escritor porque define su
 * propia `fechaParaLaPlanilla`, que se llama igual que la que exporta el espejo
 * de Inventario. Un chequeo que señala archivos que no tienen nada que ver es
 * un chequeo que se empieza a ignorar.
 */
function loQueImporta(texto) {
  const porModulo = new Map();
  const re = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of texto.matchAll(re)) {
    const modulo = m[2].replace(/^@\//, "").replace(/\.tsx?$/, "");
    const nombres = m[1]
      .split(",")
      .map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    porModulo.set(modulo, [...(porModulo.get(modulo) ?? []), ...nombres]);
  }
  return porModulo;
}

/**
 * Quién escribe en una planilla, contando la indirección.
 *
 * Un archivo escribe si llama a una primitiva **o** si llama a algo que
 * **importó** de un módulo declarado `delega`. Esa segunda mitad es la que
 * importa: `delega` quiere decir que la responsabilidad de anotar se mudó a
 * quien llama, así que quien llama tiene que estar declarado. Sin esto, una
 * ruta nueva que use `escribirEnLaFilaDeLaOT` y no anote nada era invisible
 * para el script — que es exactamente el bug que vino a buscar.
 *
 * La propagación es **sólo desde los `delega`**, a propósito. Desde un `cola`
 * no hace falta: ese módulo anota él mismo y por eso su llamador no se puede
 * olvidar. Y desde `otra-direccion` sería un desastre — `lib/core/sheets.ts`
 * exporta también `leerValores`, así que propagar desde ahí convertiría en
 * escritor a cualquiera que lea una planilla.
 */
export function quienesEscriben(archivos, registro) {
  const porRuta = new Map(archivos.map((a) => [a.ruta, a.texto]));
  const escriben = new Set(archivos.filter((a) => escribeEnUnaPlanilla(a.texto)).map((a) => a.ruta));

  /** Módulo (sin extensión) → los nombres suyos que llevan a una escritura. */
  const puertas = new Map();

  // Punto fijo: hoy alcanzan dos vueltas (ruta → espejo → sheets), pero se
  // itera igual para que una capa más no lo deje corto en silencio.
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const antes = escriben.size + [...puertas.values()].reduce((n, v) => n + v.length, 0);

    for (const [ruta, entrada] of Object.entries(registro)) {
      if (entrada.estrategia !== "delega") continue;
      const texto = porRuta.get(ruta);
      if (texto === undefined) continue;
      puertas.set(ruta.replace(/\.tsx?$/, ""), exportadas(texto));
    }

    for (const a of archivos) {
      if (escriben.has(a.ruta)) continue;
      for (const [modulo, nombres] of loQueImporta(a.texto)) {
        const deAhi = puertas.get(modulo);
        if (!deAhi) continue;
        const usadas = nombres.filter((n) => deAhi.includes(n));
        if (usadas.length > 0 && llamaA(a.texto, usadas)) escriben.add(a.ruta);
      }
    }

    if (escriben.size + [...puertas.values()].reduce((n, v) => n + v.length, 0) === antes) break;
  }

  return escriben;
}

/**
 * Los hallazgos, a partir de `{ruta, texto}[]` y el registro.
 *
 * Pura y exportada para que el test la pueda llamar con archivos inventados:
 * lo que decide tiene que poder probarse sin recorrer el repo.
 */
export function revisarExportaciones(archivos, registro = REGISTRO) {
  const hallazgos = [];
  const porRuta = new Map(archivos.map((a) => [a.ruta, a.texto]));
  const escriben = [...quienesEscriben(archivos, registro)];

  for (const ruta of escriben) {
    const entrada = registro[ruta];
    if (!entrada) {
      hallazgos.push({
        severidad: "ROMPE",
        ruta,
        que:
          "escribe en una planilla y no está declarada. Elegí qué la protege " +
          `(${ESTRATEGIAS.join(" | ")}) y anotalo en el registro de este script, ` +
          "con el porqué.",
      });
      continue;
    }

    if (!ESTRATEGIAS.includes(entrada.estrategia)) {
      hallazgos.push({
        severidad: "ROMPE", ruta,
        que: `estrategia desconocida: "${entrada.estrategia}".`,
      });
      continue;
    }

    if (!String(entrada.porque ?? "").trim()) {
      hallazgos.push({ severidad: "ROMPE", ruta, que: "declarada sin porqué." });
    }

    // Lo único del código que se puede comprobar sin interpretarlo: que quien
    // dice anotar, nombre la columna. Atrapa el "declarado y después vaciado".
    if (entrada.estrategia === "cola" && !COLUMNAS_DE_PENDIENTE.test(porRuta.get(ruta) ?? "")) {
      hallazgos.push({
        severidad: "ROMPE", ruta,
        que: "dice `cola` pero no nombra ninguna columna de pendiente.",
      });
    }

  }

  for (const ruta of Object.keys(registro)) {
    if (!escriben.includes(ruta)) {
      hallazgos.push({
        severidad: "MIRAR", ruta,
        que: "está declarada y ya no escribe en ninguna planilla: sobra, o se movió.",
      });
    }
  }

  return hallazgos;
}

function archivosTs(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      salida.push(...archivosTs(completa));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      salida.push(completa);
    }
  }
  return salida;
}

const normalizar = (p) => p.split(path.sep).join("/");

function main() {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const archivos = ["app", "lib"]
    .map((c) => path.join(raiz, c))
    .filter((d) => existsSync(d))
    .flatMap((d) => archivosTs(d))
    .map((completa) => ({
      ruta: normalizar(path.relative(raiz, completa)),
      texto: readFileSync(completa, "utf8"),
    }));

  const hallazgos = revisarExportaciones(archivos);
  const escriben = quienesEscriben(archivos, REGISTRO).size;
  console.log(`${archivos.length} archivos revisados · ${escriben} escriben en una planilla`);

  for (const severidad of ["ROMPE", "MIRAR"]) {
    const deEsta = hallazgos.filter((h) => h.severidad === severidad);
    if (deEsta.length === 0) continue;
    console.log(`\n${severidad} (${deEsta.length})\n`);
    for (const h of deEsta) console.log(`  ${h.ruta}\n      → ${h.que}`);
  }

  const cuenta = (s) => hallazgos.filter((h) => h.severidad === s).length;
  console.log(`\nROMPE ${cuenta("ROMPE")} · MIRAR ${cuenta("MIRAR")}`);

  // Las declaradas `pantalla` se listan siempre: son la excepción a la regla,
  // y lo primero que hay que mirar cuando un dato se perdió.
  const pantalla = Object.entries(REGISTRO).filter(([, e]) => e.estrategia === "pantalla");
  console.log(`\nSólo a la pantalla (${pantalla.length}) — la excepción, y por qué:`);
  for (const [ruta, e] of pantalla) console.log(`  ${ruta}\n      → ${e.porque}`);

  if (cuenta("ROMPE") > 0) process.exit(1);
}

// Sólo corre al invocarlo directo: el test lo importa y no debe recorrer el árbol.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
