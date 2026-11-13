"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  conElBorrador,
  guardarBorrador,
  hayAlgoEscrito,
  leerBorrador,
  soloLoTocado,
  tirarBorrador,
} from "@/lib/core/borradorDeFormulario";

/**
 * Los campos de un formulario en un solo objeto, recordados mientras la app esté
 * abierta.
 *
 * EL BUG QUE ARREGLA
 *
 * Alguien estaba registrando una OT, tocó fuera del formulario sin querer y
 * perdió diecisiete campos. De ahí sale todo esto. El `Modal` ya hace cumplir
 * «cancelar tira; todo lo demás sale y guarda», pero necesita que alguien le
 * diga si hay algo a medio cargar: **este hook es el primero que le pasa
 * `tocado`**, y es lo que enciende la pregunta.
 *
 * CÓMO SE USA
 *
 *     const { valores, cambiar, tocado, tirar } = useBorrador(
 *       claveDelBorrador("registrar-ot", { tipo: "ot", id: orden.id }),
 *       { horas: "8", contratista: "", falla: "" },
 *     );
 *     ...
 *     <input value={valores.horas} onChange={(e) => cambiar({ horas: e.target.value })} />
 *     <Modal titulo="…" alSalir={onCerrar} tocado={tocado}>
 *
 * `tirar()` es lo único que descarta, y va en dos lugares y en ninguno más: el
 * botón negativo del formulario, y **el guardado que salió bien**. No al apretar
 * «Guardar»: `RegistrarOTModal` hace un `POST` y después un `PATCH`, y si el
 * segundo falla el modal queda abierto con el error y lo cargado tiene que
 * seguir ahí.
 *
 * QUÉ ENTRA EN `inicial` Y QUÉ NO
 *
 * Sólo los campos del formulario. `guardando`, el error, la foto elegida y las
 * listas que vinieron del servidor no son lo que la persona escribió: meterlos
 * haría que el formulario figure «tocado» porque terminó de cargar una lista.
 *
 * QUÉ SE GUARDA, QUE ES LA DECISIÓN QUE IMPORTA
 *
 * **Sólo los campos que cambiaron**, no el objeto entero (`soloLoTocado`). Al
 * retomarlo, lo tocado se apoya sobre `inicial` **tal como está ahora**
 * (`conElBorrador`), así que un campo que otro corrigió mientras tanto llega con
 * su valor nuevo y no con el que tenía cuando se empezó a escribir. El porqué
 * medido está en el docstring de esas dos funciones.
 *
 * `inicial` se congela en el primer render, como el `useState` al que reemplaza:
 * es «cómo nació el formulario», que es contra lo que se compara para saber si
 * se tocó algo. Si llega un objeto nuevo en cada render —un literal escrito en el
 * JSX— no pasa nada: se usa el del principio.
 *
 * Es de cliente a propósito (`"use client"`): el almacén de borradores es un
 * `Map` de módulo, que durante un render de servidor sería el mismo para todos
 * los pedidos.
 */
export function useBorrador<T extends object>(
  clave: string,
  inicial: T,
): { valores: T; cambiar: (parcial: Partial<T>) => void; tocado: boolean; tirar: () => void } {
  // Cómo nació el formulario, congelado en el primer render: un `inicial` nuevo
  // en cada render movería la vara contra la que se mide «tocado».
  //
  // Va en `useState` y no en `useRef` porque **se lee durante el render** —de
  // ahí salen `valores` y `tocado`—, y un ref leído en el render es justo lo que
  // marca `react-hooks/refs`: el componente no se entera si cambia. Un estado
  // que nadie actualiza es exactamente un valor congelado que sí se puede leer.
  const [comoNacio] = useState(inicial);

  // El borrador se lee una sola vez, al montar, y de ahí en más manda la
  // pantalla. Releerlo pisaría lo que se está tipeando.
  const [tocadoDelFormulario, setTocado] = useState<Partial<T>>(
    () => leerBorrador<Partial<T>>(clave) ?? {},
  );

  const valores = useMemo(
    () => conElBorrador(comoNacio, tocadoDelFormulario),
    [comoNacio, tocadoDelFormulario],
  );

  const cambiar = useCallback((parcial: Partial<T>) => {
    // Actualizador de función y no `cambiar(...)` sobre el valor leído: dos
    // cambios en el mismo manejador tienen que sumarse y no pisarse.
    setTocado((previo) =>
      // Se recalcula contra `comoNacio` y no se acumula a ciegas: así un campo
      // devuelto a su valor inicial sale del borrador en vez de quedar adentro
      // diciendo que se tocó algo. `soloLoTocado` devuelve un objeto nuevo, que
      // es lo que hace que guardarlo no comparta referencia con nada vivo.
      soloLoTocado(comoNacio, conElBorrador(comoNacio, { ...previo, ...parcial })),
    );
  }, [comoNacio]);

  // El almacén se escribe acá y **no adentro del actualizador**: ése puede
  // correrse de más o sobre un render que después se tira, y el almacén es un
  // `Map` de módulo que vive fuera de React. Esto corre con lo que quedó.
  useEffect(() => {
    if (Object.keys(tocadoDelFormulario).length === 0) tirarBorrador(clave);
    else guardarBorrador(clave, tocadoDelFormulario);
  }, [clave, tocadoDelFormulario]);

  const tirar = useCallback(() => {
    tirarBorrador(clave);
    setTocado({});
  }, [clave]);

  return {
    valores,
    cambiar,
    tocado: hayAlgoEscrito(comoNacio, valores),
    tirar,
  };
}
