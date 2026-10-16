"use client";

import { useSyncExternalStore } from "react";

/**
 * El evento de instalación de Chrome, compartido entre la pantalla y la barra.
 *
 * POR QUÉ NO UN `useEffect` EN CADA COMPONENTE
 *
 * `beforeinstallprompt` lo dispara Chrome **una sola vez**, apenas carga la
 * página. Si cada componente lo escuchara por su cuenta, el que se monta más
 * tarde —la pantalla `/instalar`, a la que se llega navegando— nunca lo vería:
 * le mostraría a alguien las instrucciones de "hacelo a mano desde el menú"
 * teniendo el botón disponible. Por eso el oyente se engancha **cuando se carga
 * este módulo**, que es lo más temprano que puede pasar del lado del cliente, y
 * el evento queda guardado acá para quien lo pida después.
 *
 * Es el mismo criterio que `components/desplegables.ts`: lo que comparten dos
 * componentes vive en un archivo al lado, no adentro de uno de los dos.
 *
 * EL EVENTO SE USA UNA SOLA VEZ
 *
 * Llamar a `prompt()` dos veces sobre el mismo evento tira. Por eso
 * `dispararInstalacion()` lo descarta apenas lo usa. Si Chrome vuelve a
 * ofrecerlo más adelante —lo hace, después de un rato o en otra carga—, el
 * oyente lo guarda de nuevo y el botón reaparece solo.
 *
 * QUÉ **NO** VIVE ACÁ
 *
 * Qué instrucciones mostrar lo decide `plataformaDeInstalacion()` de
 * `lib/core/instalacion.ts`, que es pura y se prueba con user agents de
 * verdad. Acá sólo vive lo que es inevitablemente del navegador: un evento que
 * no se puede simular y las dos preguntas que hay que hacerle a `window` para
 * alimentar a esa función.
 */
export interface EventoDeInstalacion extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface EstadoDeInstalacion {
  /** El evento guardado, o null si Chrome todavía no lo ofreció (o ya se usó). */
  evento: EventoDeInstalacion | null;
  /** La persona dijo que no en el diálogo del navegador, en esta sesión. */
  rechazada: boolean;
  /** Llegó `appinstalled`: se instaló sin recargar la página. */
  instalada: boolean;
}

const VACIO: EstadoDeInstalacion = { evento: null, rechazada: false, instalada: false };

// La instantánea tiene que ser el **mismo objeto** mientras nada cambie:
// `useSyncExternalStore` compara por identidad y un objeto nuevo en cada
// lectura lo dejaría re-renderizando para siempre.
let instantanea: EstadoDeInstalacion = VACIO;
const oyentes = new Set<() => void>();

function cambiar(parche: Partial<EstadoDeInstalacion>) {
  instantanea = { ...instantanea, ...parche };
  for (const avisar of oyentes) avisar();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    // Sin esto Chrome muestra su propio cartel, que compite con la barra y con
    // la pantalla de instrucciones.
    e.preventDefault();
    cambiar({ evento: e as EventoDeInstalacion, rechazada: false });
  });

  window.addEventListener("appinstalled", () => {
    cambiar({ evento: null, instalada: true });
  });
}

function suscribir(avisar: () => void): () => void {
  oyentes.add(avisar);
  return () => {
    oyentes.delete(avisar);
  };
}

/** En el servidor no hay evento ni lo habrá: siempre el estado vacío. */
const enElServidor = () => VACIO;
const ahora = () => instantanea;

export function useEstadoDeInstalacion(): EstadoDeInstalacion {
  return useSyncExternalStore(suscribir, ahora, enElServidor);
}

/**
 * Si la página ya se está viendo desde la app instalada.
 *
 * Son dos preguntas porque iOS no soporta la media query `display-mode`: ahí el
 * dato está en `navigator.standalone`, que es propio de Safari y por eso no
 * está en los tipos del DOM.
 *
 * Sólo se puede llamar del lado del cliente.
 */
export function estaInstalada(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Abre el diálogo de instalación del navegador.
 *
 * Devuelve `"sin-evento"` cuando no hay nada que disparar —Chrome no lo ofreció
 * o ya se usó—, para que quien llama muestre las instrucciones a mano en vez de
 * no hacer nada.
 */
export async function dispararInstalacion(): Promise<"accepted" | "dismissed" | "sin-evento"> {
  const evento = instantanea.evento;
  if (!evento) return "sin-evento";

  // Se descarta **antes** de esperar la respuesta: el diálogo es modal, pero un
  // doble toque rápido alcanzaría para llamar a `prompt()` dos veces sobre el
  // mismo evento, que es justo lo que tira.
  cambiar({ evento: null });

  await evento.prompt();
  const { outcome } = await evento.userChoice;

  // Si dijo que no, la barra no vuelve a molestar en esta sesión. La pantalla
  // `/instalar` sí sigue disponible: ahí fue a propósito.
  if (outcome === "dismissed") cambiar({ rechazada: true });

  return outcome;
}
