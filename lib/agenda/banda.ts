import { avisoDelPendiente, type EventoVista } from "./vista";

/**
 * La banda de alertas de la Agenda: lo que se fija encima de la grilla para que
 * un problema no se pierda. Sin red y sin React.
 *
 * **Por qué existe.** En la lista, la tarjeta de un evento dice con todas las
 * letras que alguien lo movió o lo borró en Google, o que no llegó a escribirse
 * allá. Una celda de una grilla de calendario no tiene dónde poner un párrafo,
 * así que esos avisos se mudan acá. Si esta función deja a un evento afuera, esa
 * alerta deja de verse en las vistas de calendario sin que nada lo diga: por eso
 * la regla de abajo es «todo lo que tiene algo que decir, entra».
 *
 * **Un evento da una sola entrada**, por la condición más grave: divergencia,
 * después pendiente, después `aviso`. Un evento divergido puede tener además un
 * `google_pendiente` —es justamente el caso que `avisoDelPendiente` distingue—,
 * y dos renglones sobre el mismo evento harían parecer dos problemas a uno solo.
 * El panel del evento sigue mostrando todo lo que tiene.
 *
 * **Una divergencia que alguien ya dio por vista se queda.** «Ya lo vi» apaga la
 * campana de quien lo apretó y nada más: el evento sigue divergido, y el SdG
 * sigue sin moverlo ni reescribirlo en Google. Sacarla de la banda convertiría un
 * botón personal en uno que esconde el problema para todos los demás. La banda
 * se va cuando el dueño lo resuelve, no cuando alguien lo mira.
 *
 * El orden es por tipo (divergencia, pendiente, aviso), después por `inicio`
 * —el que viene antes, primero— y, a igual inicio, por `id`: el mismo conjunto
 * de eventos da siempre la misma banda, sin importar en qué orden llegó.
 */

export type TipoDeAlerta = "divergencia" | "pendiente" | "aviso";

export interface EntradaDeLaBanda {
  eventoId: string;
  titulo: string;
  tipo: TipoDeAlerta;
  /** Una línea. El detalle y los botones están en el panel del evento. */
  texto: string;
}

const GRAVEDAD: Record<TipoDeAlerta, number> = { divergencia: 0, pendiente: 1, aviso: 2 };

/** La alerta de un evento, o `null` si está sano. Una sola, la más grave. */
function alertaDe(e: EventoVista): Pick<EntradaDeLaBanda, "tipo" | "texto"> | null {
  if (e.divergencia === "borrado") {
    return { tipo: "divergencia", texto: "Alguien lo borró en Google. El SdG ya no lo mueve." };
  }
  if (e.divergencia === "movido") {
    return { tipo: "divergencia", texto: "Alguien lo movió de horario en Google. El SdG ya no lo mueve." };
  }
  const pendiente = avisoDelPendiente(e);
  if (pendiente !== null) return { tipo: "pendiente", texto: pendiente };
  if (e.aviso) return { tipo: "aviso", texto: e.aviso };
  return null;
}

export function entradasDeLaBanda(eventos: readonly EventoVista[]): EntradaDeLaBanda[] {
  const conInicio: { entrada: EntradaDeLaBanda; inicio: number }[] = [];
  for (const e of eventos) {
    const alerta = alertaDe(e);
    if (alerta === null) continue;
    conInicio.push({
      entrada: { eventoId: e.id, titulo: e.titulo, ...alerta },
      inicio: Date.parse(e.inicio),
    });
  }
  return conInicio
    .sort(
      (a, b) =>
        GRAVEDAD[a.entrada.tipo] - GRAVEDAD[b.entrada.tipo] ||
        a.inicio - b.inicio ||
        a.entrada.eventoId.localeCompare(b.entrada.eventoId)
    )
    .map((x) => x.entrada);
}
