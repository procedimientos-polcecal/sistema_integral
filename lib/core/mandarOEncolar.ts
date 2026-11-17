"use client";

/*
 * Mandar una carga, y si el camino falla, dejarla en la cola del teléfono.
 *
 * VIVE ACÁ Y NO EN `app/cargar/` PORQUE AHORA SON TRES LOS QUE LO HACEN, y
 * antes era uno. Hasta el 02/11/2026 esto estaba adentro de `CargarClient` y
 * `/cargar` era el único lugar desde donde se podía cargar sin señal: había
 * que acordarse de ir ahí **antes** de quedarse sin red, que es justo lo que
 * nadie hace. Desde entonces los botones de siempre —«Avisar de una falla»,
 * «Nueva orden de trabajo» y «Nueva condición»— abren su formulario como
 * siempre y **caen solos a la cola** cuando el envío no sale.
 *
 * ACÁ NO SE DECIDE NADA SOBRE EL RESULTADO. Qué significa lo que contestó el
 * servidor —si eso fue un éxito, si conviene reintentar, si la fila ya quedó
 * escrita pese al fallo— lo dice `queHacerConLaNueva` de
 * `public/cola/colaOffline.js`, que es pura, está probada y la comparten la
 * pantalla y el service worker. Esto ejecuta lo que esa función dijo.
 *
 * **Y POR ESO ESTE ARCHIVO EXISTE EN VEZ DE TRES COPIAS.** El modal del aviso
 * y el de la OT tenían su propio `fetch` suelto, sin `try`: sin señal el
 * `await fetch(...)` tiraba, el error se escapaba de la función del botón y el
 * modal quedaba colgado con el spinner puesto y lo escrito adentro. No era que
 * mostrara mal el error: no mostraba ninguno. Copiar acá la pregunta de «¿esto
 * fue un corte de conexión o un rechazo de la ruta?» habría dejado tres
 * versiones de la misma regla, y la que se desactualiza es la que nadie mira.
 *
 * **Es de navegador**: usa `navigator.onLine` e IndexedDB. No lo importe un
 * Server Component.
 */

import {
  comoContesto,
  cuerpoComoFormData,
  llevaArchivo,
  queHacerConLaNueva,
  CABECERA_DEL_DISPARO,
  DISPARO,
  RUTA_DE,
  type CargaEnCola,
  type ResultadoDelEnvio,
  type TipoDeCarga,
} from "@/public/cola/colaOffline.js";
import { guardarCarga } from "@/public/cola/idb.js";
import { hoyEnArgentina } from "./fechas";
import { quienCarga } from "./sesionParaCargar";
import { pedirVaciadoEnSegundoPlano } from "./vaciarLaCola";

/** Qué pasó con una carga. Es lo único que el formulario tiene que mostrar. */
export type Resultado =
  | { estado: "mandada"; numero: string; advertencia: string | null }
  | {
      estado: "encolada";
      motivo: string | null;
      /**
       * El número con el que la fila **ya quedó escrita** aunque la carga siga
       * en la cola. Es el mismo campo que la variante de abajo y por el mismo
       * motivo: cuando la condición entra y la foto no, el veredicto es
       * **`encolar`** y no `rechazada` —un 502 es pasajero—, así que ésta es
       * la rama más probable de ese camino y la que decía «todavía no tiene
       * número» arriba de un texto chico que daba el número.
       */
      yaEntro?: string | null;
    }
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
       * corregirlo, que es lo correcto cuando falta un campo y lo peor posible
       * cuando la fila ya existe: apretar «Cargar» de nuevo manda una clave
       * nueva y crea una segunda.
       */
      yaEntro?: string | null;
    };

/** El mensaje de un error, sea lo que sea lo que se haya tirado. */
export function loQueDijo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Manda el cuerpo tal cual y devuelve qué salió de eso.
 *
 * Es gemela de `mandarALaRuta` de `public/sw.js` y está escrita dos veces a
 * propósito: aquello es un service worker y no puede importar TypeScript.
 * **Lo que no está dos veces es ninguna decisión**: quién contestó y si eso
 * fue un éxito lo dice `comoContesto`, la misma función en los dos lados.
 *
 * **Y EL `Content-Type` DE LA RAMA DEL ARCHIVO NO SE ESCRIBE**: lo pone el
 * navegador, con el `boundary` que separa las partes. Escribirlo a mano lo
 * deja sin `boundary` y el servidor no puede partir el cuerpo.
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
          // Todo lo que sale por acá sale con alguien mirando, así que nunca
          // pide correo: el cartel ya le va a decir lo mismo, y un correo que
          // repite lo que la persona está leyendo es cómo se aprende a ignorar
          // los correos del sistema.
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
  // el de un portal de WiFi, y `comoContesto` lo reconoce por lo que falta.
  const devuelto: unknown = await respuesta.json().catch(() => ({}));

  return comoContesto(tipo, {
    status: respuesta.status,
    redirigida: respuesta.redirected,
    cuerpo: devuelto,
  });
}

/**
 * Manda la carga; si el camino falló y conviene reintentar, la deja en la cola.
 *
 * Devuelve siempre un `Resultado`: **nunca tira**. Un formulario que llama a
 * esto no necesita un `try`, que es exactamente lo que a los dos modales les
 * faltaba.
 */
export async function mandarOEncolar(
  tipo: TipoDeCarga,
  cuerpo: Record<string, unknown>,
): Promise<Resultado> {
  // QUIÉN FIRMA LA CARGA SE AVERIGUA ACÁ Y NO SE RECIBE. Que lo pasara el
  // llamador obligaba a enhebrar el id por las props de cuatro pantallas, y el
  // que se olvidara encolaba una carga sin dueño: el service worker compara el
  // dueño contra lo anotado en el teléfono y no manda lo que no cuadra, así
  // que esa carga se quedaba esperando para siempre sin que nada lo dijera.
  // `quienCarga()` además **deja anotada** la sesión, que es lo que le permite
  // al worker mandarla con la app cerrada.
  const sesion = await quienCarga();
  // UNA CLAVE POR CARGA, generada acá y **nunca derivada del contenido**: dos
  // avisos iguales el mismo día son dos avisos y no un duplicado. Es la misma
  // clave en cada reintento, y es lo que hace que el servidor pueda reconocer
  // que ya la escribió en vez de escribirla de nuevo.
  const clave = crypto.randomUUID();

  // Si el formulario trae una fecha que tipeó una persona, se respeta. Si no,
  // la pone el teléfono — y entonces un reloj adelantado puede hacer que la
  // ruta la rechace, y quien cargó no tiene dónde corregirla: por eso el
  // resultado lo dice y el cartel ofrece la salida.
  const laPusoUnaPersona = typeof cuerpo.fecha === "string" && cuerpo.fecha !== "";
  const cuerpoCompleto = {
    ...cuerpo,
    clave,
    fecha: laPusoUnaPersona ? cuerpo.fecha : hoyEnArgentina(),
  };

  const carga: CargaEnCola = {
    clave,
    tipo,
    cuerpo: cuerpoCompleto,
    usuarioId: sesion?.id ?? "",
    creadaEn: new Date().toISOString(),
    tomadaEn: null,
    intentos: 0,
    ultimoError: null,
    estado: "esperando",
  };

  // `null` es "ni se intentó": sin señal va derecho a la cola. Qué hacer con
  // lo que haya contestado el servidor lo decide `queHacerConLaNueva`, que es
  // pura y está probada; acá sólo se ejecuta lo que dijo.
  const respuesta = navigator.onLine ? await mandarALaRuta(tipo, cuerpoCompleto) : null;
  const queHacer = queHacerConLaNueva(respuesta);

  if (queHacer.accion === "listo") {
    return { estado: "mandada", numero: queHacer.numero, advertencia: queHacer.advertencia };
  }

  if (queHacer.accion === "rechazar") {
    // El texto de la ruta, sin traducir. Y, si la ruta dijo que la fila ya
    // quedó escrita pese al fallo, eso viaja aparte: es lo que evita que el
    // formulario quede listo para mandar un duplicado.
    return {
      estado: "rechazada",
      error: queHacer.error,
      fechaDelReloj: !laPusoUnaPersona,
      yaEntro: queHacer.yaEntro ?? null,
    };
  }

  const aGuardar: CargaEnCola = {
    ...carga,
    intentos: queHacer.intentos,
    ultimoError: queHacer.ultimoError,
    // Si la ruta dijo que la fila ya quedó escrita pese al fallo —hoy sólo la
    // condición cuya foto no se pudo guardar—, la carga nace sabiéndolo: es lo
    // que después le saca el botón de corregir, que sobre una de éstas crearía
    // una segunda fila.
    ...(queHacer.yaEntro ? { yaEntro: queHacer.yaEntro } : {}),
  };

  // UNA CARGA SIN DUEÑO NO LA MANDA NADIE. `puedeMandarse` compara el dueño de
  // la carga contra quién quedó anotado en el teléfono, así que encolarla acá
  // sería guardarla para siempre y decirle a la persona que quedó esperando.
  // Pasa en un teléfono donde nunca entró nadie con señal; es raro y es mejor
  // decirlo que fingirlo.
  if (!sesion) {
    return {
      estado: "rechazada",
      error:
        "No se pudo averiguar quién tiene la sesión en este teléfono, así que " +
        "la carga no se puede guardar para mandarla después: no habría forma " +
        "de saber de quién es. Entrá con señal una vez y volvé a intentarlo.",
      fechaDelReloj: !laPusoUnaPersona,
    };
  }

  try {
    await guardarCarga(aGuardar);
  } catch (e) {
    return {
      estado: "rechazada",
      error:
        `No se pudo guardar la carga en el teléfono: ${loQueDijo(e)}. ` +
        `No quedó anotada en ningún lado, así que no se cargó nada.`,
      fechaDelReloj: !laPusoUnaPersona,
    };
  }

  // Recién con la carga guardada: pedirlo antes dejaría registrado un vaciado
  // para una cola a la que no entró nada. En Android es lo que hace que la
  // carga salga sola cuando vuelva la señal, con la app cerrada; en iPhone no
  // hace nada y falla callado, porque no es algo que la persona pueda arreglar.
  void pedirVaciadoEnSegundoPlano();

  // `yaEntro` sale de la carga que se acaba de guardar y no de un parámetro: es
  // el mismo dato, y el cartel lo necesita para no decir «todavía no tiene
  // número» sobre una condición que ya tiene el suyo.
  return { estado: "encolada", motivo: queHacer.ultimoError, yaEntro: aGuardar.yaEntro ?? null };
}
