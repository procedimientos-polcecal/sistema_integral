"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Las dos mitades de "la URL es el estado de la pantalla", en un solo lugar.
 *
 * Requerimientos y las OT las escribieron a mano, cada uno con su comentario
 * explicando lo mismo. Inventario iba a ser la tercera y la cuarta copia, así
 * que acá quedan las dos con el razonamiento escrito una vez. Los dos primeros
 * siguen con el suyo: andan y están verificados en producción, y cambiarlos
 * para que se parezcan a esto no arregla nada — cuando alguno se toque por otra
 * razón, que adopten estos.
 */

/**
 * Con qué arranca la pantalla, leído de la URL de verdad.
 *
 * Al volver con el botón de atrás desde una ficha, el árbol que restaura Next
 * es el que se renderizó **al entrar** —con la URL vieja—, así que
 * `useSearchParams()` devuelve lo de entonces aunque la barra de direcciones
 * tenga los filtros puestos. Por eso, cuando hay navegador, la fuente es
 * `window.location.search` y no el hook.
 *
 * En el servidor no hay `window` y se usa `useSearchParams()`, que trae ese
 * mismo query string: los dos leen lo mismo y la hidratación coincide.
 *
 * Se lee una sola vez, al montar. De ahí en más el estado lo maneja la
 * pantalla y la URL lo sigue con `useEspejoEnLaUrl`.
 */
export function useArranqueDeLaUrl<T>(leer: (params: URLSearchParams) => T): T {
  const delServidor = useSearchParams();
  const [arranque] = useState<T>(() =>
    leer(
      new URLSearchParams(
        typeof window === "undefined" ? delServidor.toString() : window.location.search
      )
    )
  );
  return arranque;
}

/**
 * La barra de direcciones va detrás del estado de la pantalla.
 *
 * Con `replace` y no `push`: salir de la pantalla con el botón de atrás no
 * tiene por qué obligar a deshacer antes cada casilla tildada, una por una.
 *
 * Y con `history` y no `router.replace`, que le pediría la página entera al
 * servidor —los catálogos, los permisos, la sincronización— para cambiar un
 * query string que la pantalla ya tiene resuelto en memoria.
 *
 * `query` va sin el `?` y vacío cuando no hay nada puesto, que es lo que
 * devuelven los `escribirFiltros…` de cada módulo.
 */
export function useEspejoEnLaUrl(query: string): void {
  useEffect(() => {
    const destino = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    if (destino === window.location.pathname + window.location.search) return;
    // El estado que va es el que ya estaba: ahí guarda Next su árbol de rutas,
    // y pisarlo con null le rompe la navegación hacia atrás.
    window.history.replaceState(window.history.state, "", destino);
  }, [query]);
}
