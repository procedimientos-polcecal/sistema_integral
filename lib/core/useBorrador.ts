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
 * `TIRAR` Y `ASENTAR` SON DOS FINALES DISTINTOS, Y ELEGIR MAL REVIERTE DATOS
 *
 * Los dos vacían el borrador; la diferencia es **contra qué queda comparándose
 * el formulario después**.
 *
 * - `tirar()` vuelve a «cómo nació»: lo escrito se descarta y la pantalla
 *   muestra otra vez lo que decía el registro al abrir. Es lo que quiere el
 *   botón negativo, y también el guardado que **cierra** el formulario, porque
 *   al reabrirlo se monta de nuevo y «cómo nació» se vuelve a leer del registro
 *   ya actualizado.
 * - `asentar()` hace que **lo que está en pantalla pase a ser cómo nació**: no
 *   cambia nada de lo que se ve, deja el formulario sin tocar y el borrador
 *   vacío. Es para el guardado que **deja el formulario abierto**.
 *
 * Usar `tirar()` donde iba `asentar()` no se ve como un error: la pantalla
 * vuelve sola a los valores de antes de editar, y si alguien no lo nota y
 * aprieta «Guardar» otra vez, **le manda al servidor los valores viejos encima
 * de lo que acababa de guardar**. Pasó en `DetalleOS`, donde el modal queda
 * abierto después del PATCH y la OS que le llega por props nunca se resincroniza.
 *
 * UNA SOLA VARA: NO GUARDES UNA COPIA DEL INICIAL AL LADO DEL HOOK
 *
 * La tentación es dejar el objeto inicial en un `useState` congelado para que el
 * botón de descartar vuelva a él. **No**: `asentar()` mueve la vara del hook y
 * no la copia, así que desde el primer guardado esa copia es la foto de antes de
 * guardar, y «Descartar» la devuelve — con el formulario quedando tocado y el
 * siguiente «Guardar» mandando lo viejo encima. Es el mismo defecto de arriba
 * entrando por otra puerta, y `DetalleOS` lo tuvo las dos veces. Quien descarta
 * es `tirar()`, que ya vuelve a la vara buena.
 *
 * La excepción es un formulario con **paneles que se descartan por separado**
 * —`HojaDePersona`—, donde `tirar()` se llevaría también lo que se esté
 * escribiendo en el otro panel. Ahí la copia es necesaria y lo que la mantiene
 * sana es que en ese archivo **nadie llame a `asentar()`**; está anotado al lado
 * de la copia, porque no hay nada que lo comprueba.
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
 * JSX— no pasa nada: se usa el del principio. **Lo único que lo mueve es
 * `asentar()`.**
 *
 * DÓNDE SE LLAMA, QUE NO ES UN DETALLE DE ESTILO
 *
 * El hook tiene que vivir en el componente que **se monta y se desmonta con el
 * formulario**, no en la pantalla que lo contiene. Si vive arriba, «cómo nació»
 * queda congelado para toda la visita a la página: se guarda un cambio, el
 * registro de abajo se actualiza, y el formulario sigue comparándose contra el
 * valor viejo. En `EquipoDetalle` eso dejaba el modal reabriendo con el estado
 * **anterior** preseleccionado, con «Confirmar» habilitado y el cartel de «ya
 * está en ese estado» apagado: un clic revertía el equipo. Por eso ese modal es
 * hoy su propio componente. Si un formulario nuevo no puede montarse por
 * apertura, no uses el hook arriba: sacá el cuerpo del modal a un componente.
 *
 * Es de cliente a propósito (`"use client"`): el almacén de borradores es un
 * `Map` de módulo, que durante un render de servidor sería el mismo para todos
 * los pedidos.
 */
export function useBorrador<T extends object>(
  clave: string,
  inicial: T,
): {
  valores: T;
  cambiar: (parcial: Partial<T>) => void;
  tocado: boolean;
  tirar: () => void;
  asentar: () => void;
} {
  // Cómo nació el formulario, congelado en el primer render: un `inicial` nuevo
  // en cada render movería la vara contra la que se mide «tocado». Lo único que
  // lo mueve es `asentar()`.
  //
  // Va en `useState` y no en `useRef` porque **se lee durante el render** —de
  // ahí salen `valores` y `tocado`—, y un ref leído en el render es justo lo que
  // marca `react-hooks/refs`: el componente no se entera si cambia.
  const [comoNacio, setComoNacio] = useState(inicial);

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

  // Lo que está en pantalla pasa a ser «cómo nació»: no se ve ningún cambio, el
  // formulario queda sin tocar y el borrador vacío. Los dos `set` entran en el
  // mismo lote, así que `valores` no parpadea en el medio.
  const asentar = useCallback(() => {
    tirarBorrador(clave);
    setComoNacio(valores);
    setTocado({});
  }, [clave, valores]);

  return {
    valores,
    cambiar,
    tocado: hayAlgoEscrito(comoNacio, valores),
    tirar,
    asentar,
  };
}
