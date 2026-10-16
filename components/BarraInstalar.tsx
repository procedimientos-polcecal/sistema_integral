"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCargar } from "@/lib/core/useCargar";
import { plataformaDeInstalacion, type PlataformaInstalacion } from "@/lib/core/instalacion";
import { dispararInstalacion, estaInstalada, useEstadoDeInstalacion } from "./promptDeInstalacion";

/**
 * La barra al pie que ofrece instalar la app.
 *
 * POR QUÉ UNA BARRA Y NO SÓLO LA PANTALLA
 *
 * Nadie entra a `/instalar` por su cuenta: para ir hasta ahí ya hay que saber
 * que la app se puede instalar, que es justo lo que no se sabe. La barra es lo
 * único que lo cuenta sin que lo pregunten.
 *
 * CUÁNDO NO SE MUESTRA
 *
 * - Si ya está instalada: no hay nada que ofrecer.
 * - En la computadora: ahí el navegador ya pone su propio ícono en la barra de
 *   direcciones, y una barra nuestra sería ruido encima de eso.
 * - Si la descartaron con la X: se recuerda en `localStorage`, así que no
 *   vuelve nunca. Una barra que reaparece después de que la cerraste es la
 *   definición de molesta.
 * - Si dijeron que no en el diálogo del navegador: no vuelve en esta sesión.
 * - En `/instalar`: ofrecer ir a la pantalla en la que ya estás no ayuda.
 *
 * POR QUÉ YA NO ES `fixed`
 *
 * Lo fue, y tapaba el pie de todas las pantallas: `fixed bottom-0` saca a la
 * barra del flujo, así que nadie le reservaba el lugar. El `<main>` del layout
 * es el que scrollea y su borde de abajo es el del viewport, de modo que al
 * llegar al final de cualquier pantalla quedaban tapados los 68 px de la barra
 * más el `safe-area-inset-bottom` —34 px en un iPhone con gesto—: una tabla
 * cortada, o un botón «Guardar» inalcanzable.
 *
 * Ahora es el último hijo de la columna de altura de pantalla del layout, en el
 * flujo normal. Se ve igual —el `<main>` scrollea arriba y la barra queda
 * quieta al pie— pero el lugar lo reserva el propio layout, sin espaciadores que
 * haya que mantener del mismo alto que la barra ni `padding` condicionales que
 * coordinar. Y sigue siendo correcto si el texto se parte en dos líneas en una
 * pantalla angosta, que es donde un espaciador de alto fijo se equivocaría.
 */
const DESCARTADA_KEY = "sdg-instalar-descartada";

export function BarraInstalar() {
  const pathname = usePathname();
  const { evento, rechazada, instalada } = useEstadoDeInstalacion();
  // null hasta que se monta: `navigator` y `localStorage` no existen en el
  // servidor, y decidirlo durante el render daría un HTML distinto al del
  // cliente. Mientras tanto no se dibuja nada, que es el estado correcto: la
  // barra sólo le corresponde a una minoría de las visitas.
  const [estado, setEstado] = useState<{
    plataforma: PlataformaInstalacion;
    descartada: boolean;
  } | null>(null);

  useCargar(async () => {
    let descartada = false;
    try {
      descartada = localStorage.getItem(DESCARTADA_KEY) === "1";
    } catch {
      // Modo privado o almacenamiento bloqueado: se muestra, que es el default.
      // Lo único que se pierde es el recuerdo de que la habían cerrado.
    }
    setEstado({
      plataforma: plataformaDeInstalacion(navigator.userAgent, estaInstalada()),
      descartada,
    });
  }, []);

  function descartar() {
    setEstado((previo) => (previo ? { ...previo, descartada: true } : previo));
    try {
      localStorage.setItem(DESCARTADA_KEY, "1");
    } catch {
      // Se pierde la preferencia, no la navegación: vuelve en la próxima carga.
    }
  }

  if (estado === null || estado.descartada || rechazada || instalada) return null;
  if (estado.plataforma === "ya-instalada" || estado.plataforma === "escritorio") return null;
  if (pathname === "/instalar") return null;

  // En Android se instala de un toque, pero sólo si Chrome ofreció el evento.
  // Si no lo ofreció, la barra lleva a la pantalla, que explica el camino
  // largo: un botón que no hace nada sería peor que mandar a leer.
  const conBoton = estado.plataforma === "android" && evento !== null;

  return (
    <div
      // `shrink-0` para que no la aplaste la columna de altura de pantalla: sin
      // eso, en una pantalla baja el flex le come el alto a la barra antes que
      // al `<main>`, que es el que tiene que ceder.
      //
      // `relative z-30` no posiciona nada: está para que la barra pinte por
      // encima del contenido de `<main>` —su sombra hacia arriba, si no, queda
      // debajo del texto del final de la página— y para quedar por debajo del
      // menú en teléfono, cuyo fondo oscuro es z-40 y el cajón z-50.
      className="relative z-30 shrink-0 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-2px_10px_rgba(15,23,42,.08)]"
      // El borde de abajo de los iPhone con gesto: sin esto el botón queda
      // debajo de la barra del sistema.
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-700">
          Tené el SdG como una app en tu teléfono.
        </p>

        {conBoton ? (
          <button type="button" onClick={() => void dispararInstalacion()} className="btn-primary shrink-0">
            Instalar
          </button>
        ) : (
          <Link href="/instalar" className="btn-primary shrink-0">
            Cómo se hace
          </Link>
        )}

        <button
          type="button"
          onClick={descartar}
          aria-label="No mostrar más esta barra"
          // 44x44 es el mínimo que se puede tocar con el pulgar sin errarle, y
          // acá importa más que en ningún lado: al lado hay un botón que
          // dispara un diálogo del sistema.
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
