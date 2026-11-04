"use client";

/*
 * Lo que la pantalla de carga necesita tener guardado en el teléfono para poder
 * dibujarse sin servidor: los desplegables, y de paso quién es la sesión.
 *
 * QUIÉN ES LA SESIÓN YA NO VIVE ACÁ: se mudó a `lib/core/sesionDelTelefono.ts`
 * el 19/10/2026, con el porqué escrito allá. En dos palabras: esa anotación la
 * tiene que escribir **todo** el que vaya a pedir un vaciado, y uno de ésos es
 * la barra del layout, que no puede arrastrar el cliente de Supabase que este
 * archivo importa. Acá quedan los catálogos y la bajada con señal.
 *
 * Los tres catálogos son 41 KB medidos contra producción el 18/10/2026 —244
 * equipos, 40 sectores, 10 operarios— y no son secretos para quien ya tiene
 * acceso al módulo. Esto NO es la fase 3: no se guardan listados, ni el
 * tablero, ni el historial.
 *
 * El cuarto es el glosario de peligros de Seguridad e Higiene, y **trae algo que
 * los otros no: si esta persona puede cargar condiciones inseguras.** `/cargar`
 * no filtra por módulo, así que ese permiso se anota acá, junto con la lista, y
 * es lo que decide si se muestra la tarjeta. Ver `lib/seguridadHigiene/glosarioOffline.ts`.
 *
 * **Y ES DEL APARATO, NO DE LA PERSONA**, como los otros catálogos: dos usuarios
 * con distinto nivel que comparten un teléfono ven lo que dejó la última sesión
 * que bajó con señal. Es un riesgo acotado —la carga que no corresponda queda
 * parada y visible con el 403 de la ruta, nunca se pierde en silencio—, y se
 * acepta a cambio de no tener un endpoint de permisos aparte.
 */

import { guardarCatalogo, leerCatalogo } from "@/public/cola/idb.js";
import {
  SIN_GLOSARIO,
  queHacerConElGlosario,
  type GlosarioGuardado,
  type PeligroDelCatalogo,
} from "@/lib/seguridadHigiene/glosarioOffline";

// Se re-exportan para que `CargarClient` siga teniendo un solo lugar de dónde
// traer lo que necesita el arranque de la pantalla.
export {
  genteConocida,
  sesionRecordada,
  type GenteConocida,
  type SesionRecordada,
} from "@/lib/core/sesionDelTelefono";

export interface EquipoDelCatalogo {
  id: string;
  code: string | null;
  name: string;
  sector_id: string | null;
}

export interface SectorDelCatalogo {
  id: string;
  nombre: string;
  codigo: string | null;
}

export interface OperarioDelCatalogo {
  id: string;
  slot: number;
  nombre: string;
}

export type { PeligroDelCatalogo };

export interface Catalogos {
  equipos: EquipoDelCatalogo[];
  sectores: SectorDelCatalogo[];
  operarios: OperarioDelCatalogo[];
  peligros: PeligroDelCatalogo[];
  /**
   * Si este teléfono tiene anotado que la persona puede cargar condiciones
   * inseguras. **Sin la anotación es false**: la tarjeta no se muestra, que es
   * lo seguro cuando no se sabe.
   */
  puedeCargarCondiciones: boolean;
}

/** Lo que hay antes de leer el teléfono, y lo que queda si nunca se bajó nada. */
export const SIN_CATALOGOS: Catalogos = {
  equipos: [],
  sectores: [],
  operarios: [],
  peligros: SIN_GLOSARIO.peligros,
  puedeCargarCondiciones: SIN_GLOSARIO.puedeCargar,
};

// Un almacén por endpoint, con el nombre del endpoint: así se ve de un vistazo
// qué catálogo quedó viejo y de dónde se vuelve a bajar.
const EQUIPOS_Y_SECTORES = "mantenimiento/equipos-y-sectores";
const OPERARIOS = "mantenimiento/operarios";
const PELIGROS = "seguridad-higiene/peligros";

/** Lo que haya guardado. Un catálogo que nunca se bajó queda como lista vacía. */
export async function catalogosGuardados(): Promise<Catalogos> {
  const [equiposYSectores, operarios, glosario] = await Promise.all([
    leerCatalogo<{ equipos: EquipoDelCatalogo[]; sectores: SectorDelCatalogo[] }>(
      EQUIPOS_Y_SECTORES,
    ),
    leerCatalogo<OperarioDelCatalogo[]>(OPERARIOS),
    leerCatalogo<GlosarioGuardado>(PELIGROS),
  ]);
  return {
    equipos: equiposYSectores?.equipos ?? [],
    sectores: equiposYSectores?.sectores ?? [],
    operarios: operarios ?? [],
    // Lo que nunca se bajó no da permiso: sin anotación, la tarjeta no se ve.
    peligros: glosario?.peligros ?? [],
    puedeCargarCondiciones: glosario?.puedeCargar === true,
  };
}

/**
 * Baja los catálogos y los guarda. Sólo tiene sentido llamarla con señal.
 *
 * **Lo que no se pudo bajar no se pisa con una lista vacía**: recibe lo que ya
 * había y lo devuelve tal cual para esa lista. Un desplegable vacío no sirve
 * para cargar y el de ayer sí, y acá el caso normal es justamente que la red
 * esté mala — si estuviera bien, esta pantalla casi no haría falta.
 */
export async function refrescarCatalogos(guardados: Catalogos): Promise<Catalogos> {
  const refrescados: Catalogos = { ...guardados };

  const equiposYSectores = await traer<{
    equipos?: EquipoDelCatalogo[];
    sectores?: SectorDelCatalogo[];
  }>("/api/mantenimiento/equipos-y-sectores");

  if (equiposYSectores?.equipos && equiposYSectores.sectores) {
    const datos = {
      equipos: equiposYSectores.equipos,
      sectores: equiposYSectores.sectores,
    };
    await guardarCatalogo(EQUIPOS_Y_SECTORES, datos);
    refrescados.equipos = datos.equipos;
    refrescados.sectores = datos.sectores;
  }

  const operarios = await traer<{ data?: OperarioDelCatalogo[] }>(
    "/api/mantenimiento/operarios",
  );
  if (operarios?.data) {
    await guardarCatalogo(OPERARIOS, operarios.data);
    refrescados.operarios = operarios.data;
  }

  // El glosario es el único que **puede borrar** lo guardado, y sólo con un 403
  // de la ruta: ahí la persona ya no puede cargar y la tarjeta tiene que
  // esconderse. Todo lo demás deja lo que había. Qué cuenta como qué lo decide
  // `queHacerConElGlosario`, que está probada.
  const glosario = await traerConStatus("/api/seguridad-higiene/peligros");
  const queHacer = queHacerConElGlosario(glosario.status, glosario.cuerpo);
  if (queHacer.accion === "guardar") {
    await guardarCatalogo(PELIGROS, queHacer.glosario);
    refrescados.peligros = queHacer.glosario.peligros;
    refrescados.puedeCargarCondiciones = queHacer.glosario.puedeCargar;
  }

  return refrescados;
}

/**
 * Se re-exporta desde `lib/core/sesionParaCargar.ts`, adonde se mudó el
 * 02/11/2026: los botones de siempre también encolan, así que averiguar
 * quién firma la carga dejó de ser de esta pantalla.
 */
export { recordarLaSesion } from "@/lib/core/sesionParaCargar";

/**
 * Un GET que devuelve null en vez de fallar.
 *
 * Acá tragarse el error es correcto y no la excepción de siempre: refrescar un
 * catálogo es una mejora, no una operación de la persona. Lo que no se puede
 * tragar es un fallo al **guardar una carga**, y eso pasa por otro lado.
 */
async function traer<T>(url: string): Promise<T | null> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    return (await respuesta.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Un GET que cuenta qué contestó el servidor, sea lo que sea.
 *
 * `traer` devuelve null ante un 403 y eso aquí no alcanza: el 403 del glosario
 * **es** la respuesta. Tampoco lanza: sin señal da `status: null`.
 */
async function traerConStatus(
  url: string,
): Promise<{ status: number | null; cuerpo: unknown }> {
  try {
    const respuesta = await fetch(url);
    const cuerpo: unknown = await respuesta.json().catch(() => null);
    return { status: respuesta.status, cuerpo };
  } catch {
    return { status: null, cuerpo: null };
  }
}
