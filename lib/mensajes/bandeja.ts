import type { TipoDeEntidad } from "@/lib/core/mensajes";

/**
 * La bandeja de «Mis menciones»: lo que `GET /api/mensajes/mios` devuelve, puesto
 * en la forma en que se lee.
 *
 * La ruta devuelve **una fila por mensaje**, porque una mención es de un
 * mensaje. Pero marcar como leído es **por hilo** (`PATCH { tipo, id }`) y
 * quien lee piensa en registros —«me escribieron en la OT 2983»—, no en
 * mensajes sueltos. Por eso la pantalla agrupa por registro: una tarjeta, un
 * enlace, un botón de «ya lo vi», y adentro los mensajes.
 *
 * Es una función aparte y no un `reduce` en el componente porque ahí está la
 * única decisión de orden de la pantalla, y se prueba sin montar nada.
 */

/** Una fila tal como la entrega la ruta. */
export interface MencionDeLaBandeja {
  mensaje_id: string;
  tipo: TipoDeEntidad;
  id: string;
  texto: string;
  creado_en: string;
  autor: string | null;
  titulo: string;
  existe_el_registro: boolean;
  /** Relativa a la raíz del sitio. La arma `ENTIDADES[tipo].ruta()` en la ruta: acá no se vuelve a armar. */
  ruta: string;
}

export interface RegistroConMenciones {
  tipo: TipoDeEntidad;
  id: string;
  titulo: string;
  existe: boolean;
  ruta: string;
  /** Del más nuevo al más viejo. */
  mensajes: MencionDeLaBandeja[];
  /** Cuándo llegó la más nueva: es lo que ordena las tarjetas. */
  ultima: string;
}

/**
 * Agrupa las menciones por registro. Las tarjetas salen con la más reciente
 * arriba, y los mensajes de cada una también.
 *
 * La clave es `tipo` **y** `id`: los ids son uuid y no se pisan entre tablas,
 * pero un hilo es «este tipo de registro, este id», que es como lo nombra el
 * `PATCH`, y agrupar por otra cosa dejaría un botón que marca algo distinto de
 * lo que muestra la tarjeta.
 */
export function agruparPorRegistro(menciones: MencionDeLaBandeja[]): RegistroConMenciones[] {
  const porRegistro = new Map<string, RegistroConMenciones>();

  for (const m of menciones) {
    const clave = `${m.tipo}:${m.id}`;
    const grupo = porRegistro.get(clave);
    if (grupo) {
      grupo.mensajes.push(m);
    } else {
      porRegistro.set(clave, {
        tipo: m.tipo,
        id: m.id,
        titulo: m.titulo,
        existe: m.existe_el_registro,
        ruta: m.ruta,
        mensajes: [m],
        ultima: m.creado_en,
      });
    }
  }

  const grupos = [...porRegistro.values()];
  for (const g of grupos) {
    g.mensajes.sort((a, b) => b.creado_en.localeCompare(a.creado_en));
    g.ultima = g.mensajes[0].creado_en;
  }
  return grupos.sort((a, b) => b.ultima.localeCompare(a.ultima));
}

/**
 * Qué hace el enlace de una tarjeta y qué hay que hacer después, **dicho como
 * es** para ese tipo. Los tres enlaces no llegan igual de lejos y un texto único
 * prometería lo que sólo uno cumple:
 *
 * - **El requerimiento** abre la conversación: `/mis-pedidos?pedido=<id>` la
 *   muestra al cargar.
 * - **La condición insegura** abre su ficha: `?condicion=<id>` desde el
 *   11/11/2026. Antes llevaba a la lista a secas y el texto decía «buscá y
 *   abrí la N° X», prometiendo un buscador que esa pantalla **no tiene**; la
 *   conversación está dentro de la ficha, que ahora se abre sola.
 * - **La orden de trabajo** lleva a la lista de órdenes ya filtrada por el
 *   número (`?q=`): la conversación está dentro de la orden y hay que abrirla.
 *   Es el único de los tres que todavía no llega solo.
 *
 * **Los dos primeros llegan hasta la conversación porque le pasan
 * `abiertoAlMontar` a `HiloDeMensajes`**, que desde el 12/11/2026 arranca
 * plegado en una barra. Es un contrato entre esta función y esas dos pantallas
 * que nada comprueba: si una dejara de pasarlo, el enlace seguiría abriendo el
 * registro, el texto de acá seguiría prometiendo la conversación, y lo que
 * llegaría es una barra cerrada —y la mención no se marcaría, porque marcar es
 * abrir el hilo y no cargarlo—.
 *
 * La orden de trabajo es la única que no llega sola, y por eso su nota lo dice.
 * El «Marcar como leído» de la tarjeta, en cambio, ya no está ahí sólo por
 * ella: desde que el hilo arranca plegado es el camino principal, porque quien
 * abre el registro y no despliega la barra tampoco marcó nada.
 */
export function comoSeLlega(
  tipo: TipoDeEntidad,
  titulo: string
): { boton: string; nota: string | null } {
  switch (tipo) {
    case "requerimiento":
      return { boton: "Abrir la conversación", nota: null };
    case "orden_trabajo":
      return {
        boton: "Buscar la orden en la lista",
        nota: `Te lleva a la lista de órdenes, filtrada por ese número. Abrí ${titulo} para leer la conversación.`,
      };
    case "condicion_insegura":
      return {
        boton: "Abrir la condición",
        nota: `Te abre la ficha de ${titulo}; la conversación está adentro.`,
      };
  }
}
