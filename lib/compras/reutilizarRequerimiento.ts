/**
 * Copiar un pedido viejo para cargar uno nuevo.
 *
 * POR QUÉ EXISTE
 *
 * Es el gemelo de `lib/mantenimiento/reutilizarOT.ts` y nace del mismo pedido:
 * se cargan pedidos parecidos una y otra vez —el mismo electrodo, la misma
 * manguera, para el mismo lugar— y hoy eso es volver a escribir la
 * descripción, el código, la cantidad y a elegir el lugar y el equipo cada vez.
 *
 * Vive acá y no en el modal porque es **una decisión con reglas y no un
 * `setState`**: qué se copia, qué no, y sobre todo qué hacer con un valor que
 * el formulario de hoy ya no puede mostrar.
 *
 * LA FECHA NO SE COPIA
 *
 * Es el pedido y es lo único que no se discute: «para cuándo se necesita» es
 * de este pedido y no del viejo. Tampoco el N° de RI, que lo da el sistema al
 * guardar, ni el estado ni nada del circuito de compra — un pedido nuevo nace
 * PENDIENTE aunque el que se copió esté recibido.
 *
 * UN VALOR QUE EL DESPLEGABLE NO TIENE, NO SE COPIA
 *
 * La regla que no se deduce, y la misma que ya gobierna el copiado de una OT.
 * Si se copiara un valor que el desplegable no ofrece, el campo mostraría «—»
 * mientras el formulario guarda otra cosa: lo que se ve y lo que se guarda,
 * distintos, que es la familia de errores que este repo paga más caro.
 *
 * Acá tiene mordida de verdad, porque los catálogos de Compras cambian solos:
 * una ubicación se desactiva (`compras_ubicaciones.activo`), un equipo se da de
 * baja (`equipos.is_active`), un área se deja de usar. Un pedido de hace seis
 * meses puede apuntar a cualquiera de las tres. Así que lo que no está en la
 * lista **no entra**, y se devuelve en `noEntraron` para decírselo a quien está
 * cargando. Dejarlo vacío y callarlo sería la misma trampa con otra ropa.
 *
 * SÍ SE COPIAN LA PRIORIDAD Y QUIÉN PAGA, Y ESO PIDE UNA EXPLICACIÓN
 *
 * El encabezado de `NuevoRequerimientoModal` dice que **quién paga no se
 * precarga nunca** y que la prioridad «la define quien aprueba». Las dos cosas
 * siguen siendo ciertas y esto no las contradice, porque esa regla tiene un
 * alcance escrito: es contra precargar **desde otra pantalla**, en
 * `ValoresIniciales` —ahí el riesgo es que un pedido de Mantenimiento entre
 * como si fuera de Producción porque lo abrió una pantalla de Producción—.
 *
 * Reutilizar es lo contrario de eso: no llega de afuera, lo pide quien está
 * mirando el formulario, nombrando un pedido concreto, y los campos quedan a la
 * vista y se pueden cambiar antes de enviar. Es la misma diferencia que ya
 * justifica que la ubicación sugiera la empresa.
 *
 * Decidido con el usuario el 19/11/2026, sabiendo esto. Si alguna vez se quiere
 * volver atrás, lo que hay que sacar son dos entradas de `campos` y sus tests —
 * no hace falta tocar el modal.
 *
 * LA IMAGEN NO SE COPIA
 *
 * Y es el único campo que queda afuera sin que nadie lo haya pedido, así que va
 * dicho: una foto es la prueba de **ese** faltante —la pieza rota, el estante
 * vacío— y no una propiedad del material. Copiarla haría que un pedido nuevo
 * llegue a Compras con la evidencia de otro, que es peor que llegar sin
 * ninguna. Si se quiere, es una línea.
 */
import { AMBAS } from "@/lib/compras/sectorDelPedido";

/** El pedido viejo, con lo único que se le pide prestado. */
export interface RequerimientoViejo {
  nro_ri: number;
  descripcion: string | null;
  codigo: string | null;
  cantidad: number | null;
  detalle_extra: string | null;
  area_id: string | null;
  ubicacion_id: string | null;
  equipo_id: string | null;
  prioridad: string | null;
  empresa_id: string | null;
  paga_ambas: boolean | null;
}

/**
 * Lo que cada desplegable del formulario puede mostrar **hoy**.
 *
 * Son los ids de las listas que el modal ya tiene en la mano, no una consulta
 * aparte: preguntar de nuevo abriría la puerta a que esto valide contra una
 * lista y la pantalla muestre otra.
 */
export interface Catalogos {
  areas: readonly string[];
  ubicaciones: readonly string[];
  equipos: readonly string[];
  empresas: readonly string[];
  prioridades: readonly string[];
}

/** Los campos del formulario, con los nombres que usa el modal. */
export interface CamposCopiados {
  descripcion?: string;
  codigo?: string;
  cantidad?: string;
  detalle?: string;
  areaId?: string;
  ubicacionId?: string;
  equipoId?: string;
  prioridad?: string;
  /** El id de la empresa, o `AMBAS`. Es lo que guarda el estado `paga`. */
  paga?: string;
}

export interface LoQueSeCopia {
  /**
   * Para aplicar sobre el formulario. **Lo que no está acá queda como estaba**:
   * la fecha, la imagen, y cualquier desplegable cuyo valor no se pudo
   * representar.
   */
  campos: CamposCopiados;
  /**
   * Lo que el pedido viejo tenía y el formulario no puede mostrar, en
   * castellano y listo para leer. Vacío es lo normal.
   */
  noEntraron: string[];
}

/** Un campo de texto libre: el null de la base es la cadena vacía del formulario. */
const texto = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Qué se lleva el pedido nuevo del viejo.
 *
 * Los textos se copian siempre —no hay desplegable que los limite— y los ids
 * sólo si siguen en su catálogo.
 */
export function copiarDelRequerimiento(
  viejo: RequerimientoViejo,
  catalogos: Catalogos
): LoQueSeCopia {
  const campos: CamposCopiados = {};
  const noEntraron: string[] = [];

  // ── Texto libre: entra tal cual, incluso vacío ──
  //
  // Vacío también se copia, y es a propósito: si el pedido viejo no tenía
  // detalle, el nuevo tampoco tiene por qué arrastrar lo que quedó escrito de
  // un intento anterior. «Copiar» es dejar el formulario como ese pedido, no
  // mezclarlo con lo que había.
  campos.descripcion = texto(viejo.descripcion);
  campos.codigo = texto(viejo.codigo);
  campos.detalle = texto(viejo.detalle_extra);

  // La cantidad viaja como texto porque el campo del formulario es de texto.
  // Un 0 o un negativo no se copian: no son cantidades que alguien quiso
  // pedir, y dejarlos haría que el formulario se niegue a enviar sin decir por
  // qué venía así.
  campos.cantidad =
    viejo.cantidad !== null && viejo.cantidad > 0 ? String(viejo.cantidad) : "";

  // ── Ids: sólo si el desplegable todavía los tiene ──
  const enLista = (
    id: string | null,
    lista: readonly string[],
    comoSeLlama: string
  ): string | undefined => {
    if (!id) return undefined;
    if (lista.includes(id)) return id;
    noEntraron.push(comoSeLlama);
    return undefined;
  };

  const area = enLista(viejo.area_id, catalogos.areas, "el área");
  if (area) campos.areaId = area;

  const ubicacion = enLista(
    viejo.ubicacion_id,
    catalogos.ubicaciones,
    "dónde se necesita"
  );
  if (ubicacion) campos.ubicacionId = ubicacion;

  const equipo = enLista(viejo.equipo_id, catalogos.equipos, "el equipo");
  if (equipo) campos.equipoId = equipo;

  const prioridad = enLista(
    viejo.prioridad,
    catalogos.prioridades,
    "la prioridad"
  );
  if (prioridad) campos.prioridad = prioridad;

  // ── Quién paga ──
  //
  // `paga_ambas` gana sobre `empresa_id` y no se valida contra ninguna lista:
  // «Ambas» no es una empresa del catálogo sino un valor que el formulario ya
  // entiende, igual que en `empresaSugerida`.
  if (viejo.paga_ambas) {
    campos.paga = AMBAS;
  } else {
    const empresa = enLista(viejo.empresa_id, catalogos.empresas, "quién paga");
    if (empresa) campos.paga = empresa;
  }

  return { campos, noEntraron };
}

/**
 * El número que alguien escribió, o null si no se puede leer.
 *
 * Acepta «2184», « 2184 » y «RI 2184», que es como se nombra un pedido en voz
 * alta y en los mensajes del sistema. No acepta un negativo ni un cero: no hay
 * RI 0, y dejarlo pasar manda una consulta que sólo puede fallar.
 */
export function numeroDeRi(escrito: string): number | null {
  const limpio = String(escrito ?? "").trim().replace(/^RI\s*/i, "");
  if (!/^\d+$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Lo que se le dice a quien copió, y que queda a la vista hasta que guarde.
 *
 * Nombra el RI de origen porque estos campos **no los escribió quien está
 * mirando la pantalla**: sin eso, un pedido copiado se ve igual que uno
 * tipeado y nadie lo revisa.
 */
export function avisoDeReutilizado(
  numero: number,
  noEntraron: readonly string[]
): string {
  const base = `Copiado del RI ${numero}. Revisalo antes de enviar.`;
  if (noEntraron.length === 0) return base;
  return `${base} No se pudo traer ${noEntraron.join(", ")}: ya no está en la lista.`;
}
