"use client";

/*
 * Mandar una carga a la ruta de alta, y contarle a la persona cómo salió.
 *
 * Las dos cosas van juntas porque son la misma decisión: **lo que salió a
 * medias se dice, no se calla**. Las dos rutas devuelven, además del número,
 * hasta cuatro avisos de cosas que quedaron pendientes —`advertencia`,
 * `clave_error`, `planilla_error` y `aviso_error`—, y el que más importa es el
 * primero: aparece cuando la carga ya estaba escrita en la planilla y no se
 * sabe si llegó al sistema. Ése es exactamente el caso en el que alguien podría
 * cargar dos veces lo mismo, así que no puede quedar en un log.
 */

import type { TipoDeCarga } from "@/public/cola/colaOffline.js";

/** Qué pasó con una carga. Es lo único que el formulario tiene que mostrar. */
export type Resultado =
  | { estado: "mandada"; numero: string | null; advertencia: string | null }
  | { estado: "encolada"; motivo: string | null }
  | { estado: "rechazada"; error: string };

/** A dónde va cada tipo de carga. Son las rutas de siempre, sin ninguna nueva. */
const RUTA_DE: Record<TipoDeCarga, string> = {
  aviso: "/api/mantenimiento/avisos",
  orden: "/api/mantenimiento/ordenes",
};

/** Cómo se llama el número en la respuesta de cada ruta. */
const CAMPO_DEL_NUMERO: Record<TipoDeCarga, string> = {
  aviso: "oa_number",
  orden: "ot_number",
};

export type RespuestaDeLaRuta =
  | { ok: true; numero: string | null; advertencia: string | null }
  | { ok: false; status: number | null; error: string };

/**
 * Manda el cuerpo tal cual y devuelve qué contestó.
 *
 * El `status` viaja porque es lo que `clasificarFallo` mira para decidir si
 * reintentar tiene sentido, y **`null` cuando ni se llegó a hablar con el
 * servidor** —sin señal, o el túnel que corta a mitad de camino—, que es
 * pasajero.
 *
 * El error se devuelve **sin traducir**: los mensajes de las dos rutas dicen
 * cosas que ninguna frase genérica puede decir ("el aviso quedó escrito en la
 * planilla pero no se pudo guardar en el sistema"), y quien cargó necesita
 * exactamente eso para saber si mirar la planilla.
 */
export async function mandarALaRuta(
  tipo: TipoDeCarga,
  cuerpo: Record<string, unknown>,
): Promise<RespuestaDeLaRuta> {
  let respuesta: Response;
  try {
    respuesta = await fetch(RUTA_DE[tipo], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  } catch (e) {
    return { ok: false, status: null, error: loQueDijo(e) };
  }

  const devuelto = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;

  if (!respuesta.ok) {
    return {
      ok: false,
      status: respuesta.status,
      error:
        texto(devuelto.error) ??
        `El servidor contestó ${respuesta.status} y no dijo por qué.`,
    };
  }

  const numero = devuelto[CAMPO_DEL_NUMERO[tipo]];
  return {
    ok: true,
    numero: numero === null || numero === undefined ? null : String(numero),
    advertencia: loQueQuedoPendiente(devuelto),
  };
}

/**
 * Lo que la ruta contestó que quedó a medias, todo junto.
 *
 * Los cuatro campos conviven: una OT puede volver con la advertencia de que ya
 * estaba, con el enlace al aviso sin poner y con el estado sin llegar a la
 * planilla. Decir uno solo dejaría los otros dos sin que nadie se entere.
 */
function loQueQuedoPendiente(devuelto: Record<string, unknown>): string | null {
  const claveError = texto(devuelto.clave_error);
  const planillaError = texto(devuelto.planilla_error);

  const partes = [
    texto(devuelto.advertencia),
    claveError &&
      `La clave de esta carga no se pudo anotar del lado del servidor ` +
        `(${claveError}): si se vuelve a mandar, mirá la planilla antes de darla ` +
        `por duplicada.`,
    planillaError &&
      `El estado y las horas todavía no llegaron a la planilla (${planillaError}) — ` +
        `queda pendiente y lo escribe la próxima sincronización.`,
    texto(devuelto.aviso_error),
  ].filter((parte): parte is string => Boolean(parte));

  return partes.length > 0 ? partes.join(" ") : null;
}

/** El campo si es un texto con algo adentro; null en cualquier otro caso. */
function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor : null;
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
        {resultado.error}
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
        {resultado.numero
          ? `Se cargó ${comoSeLlama} ${resultado.numero}.`
          : `Se cargó ${comoSeLlama}, pero el servidor no devolvió el número.`}
      </p>
      {resultado.advertencia && <p className="mt-1">{resultado.advertencia}</p>}
    </div>
  );
}
