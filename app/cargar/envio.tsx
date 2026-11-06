"use client";

/*
 * El cartel que le cuenta a la persona cómo salió la carga.
 *
 * LO QUE ERA ESTE ARCHIVO SE MUDÓ a `lib/core/mandarOEncolar.ts` el
 * 02/11/2026. Mandar la carga y, si el camino falla, dejarla en la cola es
 * ahora lo que hacen también los botones de siempre —«Avisar de una falla»,
 * «Nueva orden de trabajo» y «Nueva condición»—, así que esa regla no podía
 * seguir viviendo adentro de `/cargar`: habrían quedado tres versiones de
 * «¿esto fue un corte de conexión o un rechazo de la ruta?».
 *
 * Acá queda el cartel, que sí es de esta pantalla. Las tres piezas que se
 * fueron se re-exportan para no romper a quien las importaba de acá.
 */

import { conSuArticulo, type TipoDeCarga } from "@/public/cola/colaOffline.js";
import type { Resultado } from "@/lib/core/mandarOEncolar";

export { loQueDijo, mandarALaRuta, type Resultado } from "@/lib/core/mandarOEncolar";

/**
 * El cartel que cuenta cómo salió la carga.
 *
 * LO QUE NO PUEDE PASAR es que una carga que quedó esperando parezca cargada.
 * Por eso el cartel de la cola dice, con todas las letras, que **todavía no
 * tiene número**: el número lo reparte la planilla en el servidor y en el
 * teléfono no se inventa nunca.
 */
export function CartelDelResultado({
  tipo,
  resultado,
}: {
  tipo: TipoDeCarga;
  resultado: Resultado | null;
}) {
  if (!resultado) return null;

  // El nombre sale de `colaOffline.js` y no de acá: decía «la orden» mientras la
  // lista decía «Orden de trabajo» y la notificación del service worker «la
  // orden de trabajo», o sea que la misma carga cambiaba de nombre según si
  // entró con la app abierta o cerrada.
  const comoSeLlama = conSuArticulo(tipo);

  if (resultado.estado === "rechazada") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <p>{resultado.error}</p>
        {/* UN RECHAZO QUE IGUAL DEJÓ LA FILA ESCRITA. Todo lo demás de este
            cartel está dicho para que alguien corrija y vuelva a apretar el
            botón, que es lo que hay que hacer cuando falta un campo — y es lo
            peor posible acá, porque el próximo envío lleva una clave nueva y
            crea una segunda. Por eso se dice primero y en negrita, y por eso
            el formulario se vacía en vez de quedar cargado. */}
        {resultado.yaEntro && (
          <p className="mt-1 font-semibold">
            Igual entró, con el número {resultado.yaEntro}: no vuelvas a
            apretar el botón o van a quedar dos. Lo que faltó fue la foto, y se
            le puede agregar después desde su ficha.
          </p>
        )}
        {resultado.fechaDelReloj && !resultado.yaEntro && (
          <p className="mt-1 text-xs">
            La fecha de esta carga la pone el reloj de este teléfono, que es el
            único que hay sin señal. Si el servidor habla de la fecha: corregí la
            hora del aparato y volvé a tocar el botón — lo que escribiste quedó
            donde estaba.
          </p>
        )}
      </div>
    );
  }

  if (resultado.estado === "encolada") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {/* EL TITULAR DEPENDE DE SI LA FILA YA ESTÁ ESCRITA, y ésa es la rama
            más probable de este camino: cuando la condición entra y la foto no,
            el fallo es un 502, o sea pasajero, o sea `encolar`. Decir «todavía
            no tiene número» ahí es lo peor que se puede decir —invita a
            cargarla de nuevo a mano, y la segunda lleva una clave nueva— y
            encima lo contradecía el texto chico de abajo, que daba el número. */}
        {resultado.yaEntro ? (
          <>
            <p className="font-semibold">
              Entró con el número {resultado.yaEntro}: no la vuelvas a cargar.
            </p>
            <p className="mt-1">
              Lo que falta es la foto. La carga queda abajo, en lo que está
              esperando, y la foto sale sola cuando haya señal; también se le
              puede agregar después desde su ficha.
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">
              Queda para mandarse y todavía no tiene número.
            </p>
            <p className="mt-1">
              Quedó guardada en este teléfono y aparece abajo, en lo que está
              esperando. De ahí sale cuando haya señal.
            </p>
          </>
        )}
        {resultado.motivo && (
          <p className="mt-1 text-xs">El servidor dijo: {resultado.motivo}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
      <p className="font-semibold">
        Se cargó {comoSeLlama} {resultado.numero}.
      </p>
      {resultado.advertencia && <p className="mt-1">{resultado.advertencia}</p>}
    </div>
  );
}
