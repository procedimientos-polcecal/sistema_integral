"use client";

/*
 * Mandar una carga a la ruta de alta, y contarle a la persona cómo salió.
 *
 * ACÁ NO SE DECIDE NADA. Esto habla HTTP —arma el pedido, lee el JSON— y le
 * pasa lo que recibió a `comoContesto` de `public/cola/colaOffline.js`, que es
 * quien dice si eso fue un éxito y qué quedó a medias. La razón es que el
 * service worker va a mandar la misma carga con la app cerrada (tarea 7 del
 * plan) y necesita esas mismas reglas; desde un service worker no se puede
 * importar un componente de React, así que una regla escrita acá se escribiría
 * dos veces.
 *
 * Lo único que sí es de acá: un `fetch` que tira —sin señal, el túnel que corta
 * a mitad de camino— es un fallo sin status, y eso es pasajero.
 */

import { comoContesto, type ResultadoDelEnvio, type TipoDeCarga } from "@/public/cola/colaOffline.js";

/** Qué pasó con una carga. Es lo único que el formulario tiene que mostrar. */
export type Resultado =
  | { estado: "mandada"; numero: string; advertencia: string | null }
  | { estado: "encolada"; motivo: string | null }
  | {
      estado: "rechazada";
      error: string;
      /**
       * Si la fecha que viajó la puso el reloj del teléfono y no una persona.
       * Es lo que decide si el cartel ofrece la salida: el formulario de aviso
       * no tiene campo de fecha, así que con el reloj adelantado la ruta
       * contesta 400 y quien cargó no tiene dónde corregirlo.
       */
      fechaDelReloj: boolean;
    };

/** A dónde va cada tipo de carga. Son las rutas de siempre, sin ninguna nueva. */
const RUTA_DE: Record<TipoDeCarga, string> = {
  aviso: "/api/mantenimiento/avisos",
  orden: "/api/mantenimiento/ordenes",
};

/**
 * Manda el cuerpo tal cual y devuelve qué salió de eso.
 *
 * El `status` viaja hasta el final porque es lo que `clasificarFallo` mira para
 * decidir si reintentar tiene sentido, y el error se devuelve **sin traducir**:
 * los mensajes de las dos rutas dicen cosas que ninguna frase genérica puede
 * decir ("el aviso quedó escrito en la planilla pero no se pudo guardar en el
 * sistema"), y quien cargó necesita exactamente eso para saber si mirar la
 * planilla.
 */
export async function mandarALaRuta(
  tipo: TipoDeCarga,
  cuerpo: Record<string, unknown>,
): Promise<ResultadoDelEnvio> {
  let respuesta: Response;
  try {
    respuesta = await fetch(RUTA_DE[tipo], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    // Ni se llegó a hablar con nadie, así que esto no salió de la ruta y es
    // pasajero: sin señal, o el túnel que corta a mitad de camino.
    return { ok: false, status: null, deLaRuta: false, error: loQueDijo(e) };
  }

  // Un cuerpo que no es JSON no es un error a propagar: es el HTML del login o
  // el de un portal de WiFi, y `comoContesto` lo reconoce por lo que falta. Va
  // tal cual y sin cast —puede ser `null`, que es lo que da `JSON.parse("null")`—
  // porque contemplarlo es trabajo de ahí y no de acá.
  const devuelto: unknown = await respuesta.json().catch(() => ({}));

  return comoContesto(tipo, {
    status: respuesta.status,
    // `redirected` es lo que separa "me mandaron al login" de "el servidor
    // contestó cualquier cosa", y lo primero se le puede decir a la persona con
    // todas las letras.
    redirigida: respuesta.redirected,
    cuerpo: devuelto,
  });
}

/** El mensaje de un error, sea lo que sea lo que se haya tirado. */
export function loQueDijo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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

  const comoSeLlama = tipo === "aviso" ? "el aviso" : "la orden";

  if (resultado.estado === "rechazada") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <p>{resultado.error}</p>
        {resultado.fechaDelReloj && (
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
        <p className="font-semibold">
          Queda para mandarse y todavía no tiene número.
        </p>
        <p className="mt-1">
          Quedó guardada en este teléfono y aparece abajo, en lo que está
          esperando. De ahí sale cuando haya señal.
        </p>
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
