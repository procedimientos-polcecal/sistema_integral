"use client";

/*
 * Mandar una carga a la ruta de alta, y contarle a la persona cómo salió.
 *
 * ACÁ NO SE DECIDE NADA. Esto habla HTTP —arma el pedido, lee el JSON— y le
 * pasa lo que recibió a `comoContesto` de `public/cola/colaOffline.js`, que es
 * quien dice si eso fue un éxito y qué quedó a medias. La razón es que el
 * service worker manda la misma carga con la app cerrada y necesita esas mismas
 * reglas; desde un service worker no se puede importar un componente de React,
 * así que una regla escrita acá se escribiría dos veces.
 *
 * Lo único que sí es de acá: un `fetch` que tira —sin señal, el túnel que corta
 * a mitad de camino— es un fallo sin status, y eso es pasajero.
 */

import {
  CABECERA_DEL_DISPARO,
  DISPARO,
  RUTA_DE,
  comoContesto,
  conSuArticulo,
  cuerpoComoFormData,
  llevaArchivo,
  type ResultadoDelEnvio,
  type TipoDeCarga,
} from "@/public/cola/colaOffline.js";

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
      /**
       * El número con el que la fila **ya quedó escrita** aunque el pedido
       * haya fallado. Un rechazo deja lo escrito en el formulario para
       * corregirlo, que es lo correcto cuando falta un campo y lo peor
       * posible cuando la fila ya existe: apretar «Cargar» de nuevo manda una
       * clave nueva y crea una segunda. Con esto el cartel lo dice y el
       * formulario se vacía.
       */
      yaEntro?: string | null;
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
 *
 * ── LAS DOS RAMAS, Y POR QUÉ EL `if` ESTÁ DONDE ESTÁ ────────────────────────
 *
 * Una carga que puede traer un archivo sale como `multipart/form-data`; todas
 * las demás salen como salían. **El `if` va alrededor de la construcción del
 * pedido y no adentro**, a propósito: el aviso y la orden de trabajo se usan
 * todos los días, y la promesa de esta tarea es que su pedido salga byte por
 * byte igual que antes. Un `headers` armado con un ternario adentro es un
 * lugar donde un día cambia algo para los tres tipos sin que nadie lo note.
 *
 * **Y EL `Content-Type` DE LA RAMA DEL ARCHIVO NO SE ESCRIBE**: lo pone el
 * navegador, con el `boundary` que separa las partes. Escribirlo a mano lo
 * deja sin `boundary` y el servidor no puede partir el cuerpo —`formData()`
 * rechaza y la ruta contesta que falta todo—, que es un 400 definitivo sobre
 * una carga que estaba bien.
 */
export async function mandarALaRuta(
  tipo: TipoDeCarga,
  cuerpo: Record<string, unknown>,
): Promise<ResultadoDelEnvio> {
  let respuesta: Response;
  try {
    respuesta = llevaArchivo(tipo)
      ? await fetch(RUTA_DE[tipo], {
          method: "POST",
          headers: { [CABECERA_DEL_DISPARO]: DISPARO.pantalla },
          body: cuerpoComoFormData(cuerpo),
        })
      : await fetch(RUTA_DE[tipo], {
          method: "POST",
          // Todo lo que sale de esta pantalla sale con alguien mirando, así que
          // nunca pide correo: el cartel de abajo ya le va a decir lo mismo, y un
          // correo que repite lo que la persona está leyendo es cómo se aprende a
          // ignorar los correos del sistema.
          headers: {
            "Content-Type": "application/json",
            [CABECERA_DEL_DISPARO]: DISPARO.pantalla,
          },
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
