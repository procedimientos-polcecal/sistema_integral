"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Traer datos cuando cambian las dependencias, descartando lo que llegue tarde.
 *
 * EL BUG QUE ARREGLA
 *
 * Veintisiete pantallas hacían `useEffect(() => { cargar(); }, [filtros])` y
 * **ninguna descartaba la respuesta vieja**. Si alguien cambia un filtro dos
 * veces seguidas salen dos pedidos, y gana el que llega último — que no es
 * necesariamente el último que se pidió. La pantalla queda mostrando el
 * resultado del filtro anterior, sin ningún indicio de que está desactualizada.
 *
 * En una app con filtros de fecha, sector y empresa por todos lados, eso pasa
 * de verdad: cambiar "desde" con el teclado dispara un pedido por tecla.
 *
 * CÓMO SE USA
 *
 *     const recargar = useCargar(async (vigente) => {
 *       const datos = await fetch(url).then((r) => r.json());
 *       if (!vigente()) return;          // llegó tarde: no se pinta
 *       setDatos(datos);
 *     }, [desde, hasta]);
 *
 * `vigente()` es false cuando las dependencias volvieron a cambiar o el
 * componente se desmontó. Hay que consultarlo **después de cada `await`**,
 * antes de tocar el estado: es lo único que separa "esta respuesta sirve" de
 * "esta respuesta es de una pregunta que ya nadie está haciendo".
 *
 * Devuelve una función para volver a cargar a mano, que es lo que hace falta
 * después de guardar algo.
 *
 * POR QUÉ NO UN `useDatos(url)` QUE DEVUELVA LOS DATOS
 *
 * Porque las pantallas no se parecen tanto: unas piden dos endpoints en
 * paralelo, otras post-procesan, otras reparten el resultado en tres estados.
 * Un hook que devuelve `{datos, cargando}` obligaría a torcer la mitad de los
 * casos. Esto se queda con lo único que todas comparten y hacían mal.
 */
export function useCargar(
  cargar: (vigente: () => boolean) => Promise<void>,
  deps: React.DependencyList
): () => void {
  // El callback se guarda en un ref para que el efecto dependa SÓLO de `deps`.
  // Si dependiera de la función, cada render la recrearía y volvería a pedir.
  const ultimo = useRef(cargar);
  useEffect(() => {
    ultimo.current = cargar;
  });

  const [pedidoManual, setPedidoManual] = useState(0);

  useEffect(() => {
    let vivo = true;
    void ultimo.current(() => vivo);
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pedidoManual]);

  return useCallback(() => setPedidoManual((n) => n + 1), []);
}
