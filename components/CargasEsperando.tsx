"use client";

import Link from "next/link";
import { useState } from "react";
import { haceCuanto } from "@/lib/core/haceCuanto";
import { loQueNoEntro, type LoQueNoEntro } from "@/lib/core/loQueNoEntro";
import { useCargar } from "@/lib/core/useCargar";
import { pedirVaciadoAhora, pedirVaciadoEnSegundoPlano } from "@/lib/core/vaciarLaCola";
import { leerCola } from "@/public/cola/idb.js";

/**
 * La barra que avisa, al abrir la app, que algo cargado en este teléfono
 * todavía no entró al sistema.
 *
 * ES LA RED DE ABAJO DE TODO EL DISEÑO SIN SEÑAL. Lo demás son disparos que
 * pueden no ocurrir: el `sync` del service worker no existe en iPhone, y el
 * push de las 8:30 lo tienen prendido dos personas de trece. Abrir la app es lo
 * único que hace todo el mundo todos los días, y es lo único que esta barra
 * necesita. Sin ella, una carga hecha el viernes en la planta puede no existir
 * para nadie hasta que alguien entre a `/cargar` por casualidad; el tope
 * acordado para eso es un día.
 *
 * NO MEZCLA DOS COSAS EN UNA FRASE, que es lo único difícil de esta pantalla.
 * Una carga **demorada** lleva más de un día esperando y no está perdida: sale
 * sola en cuanto haya señal. Una **detenida** no sale sola nunca más por su
 * cuenta y necesita que una persona la mire. Decir una sola frase para las dos
 * obligaría a elegir entre asustar por algo que se arregla solo o restarle
 * urgencia a lo que no. Los números salen de `loQueNoEntro`, que está probado.
 *
 * DE PASO, PIDE EL VACIADO, porque abrir la app es también el único disparo que
 * siempre llega al service worker. No manda nada por su cuenta: le pide al
 * worker que corra **su** vaciado, que es el mismo código que corre cuando
 * llega el push. Una segunda implementación de «mandar una carga» viviendo en
 * el layout es exactamente cómo estas dos se separan sin que nadie lo note.
 *
 * NO TIENE DERECHO A ROMPER NADA: se monta en el layout de toda la app, o sea
 * que corre en cada pantalla para los 14 usuarios. Sin IndexedDB, con la base
 * sin abrir o sin service worker, no se dibuja y la app sigue igual.
 */
export function CargasEsperando() {
  // null es los dos estados en los que no hay barra: todavía no se leyó, y no
  // hay nada que decir. Son el mismo dibujo —ninguno— y distinguirlos sólo
  // agregaría un estado que nadie mira.
  const [queHay, setQueHay] = useState<LoQueNoEntro | null>(null);
  const [cerrada, setCerrada] = useState(false);

  useCargar(async (vigente) => {
    let cargas;
    try {
      cargas = await leerCola();
    } catch (e) {
      // La base no abre: Safari en modo privado, el almacenamiento lleno, el
      // permiso denegado. No se le dice acá, y no es tragárselo: si la cola no
      // se puede leer, esta barra no sabe **nada** —ni que hay algo esperando
      // ni que no—, así que lo único que podría poner en pantalla es que no
      // sabe. Eso quedaría fijo en las 313 pantallas del sistema, todos los
      // días, sin una palabra de diagnóstico y sin nada que la persona pueda
      // hacer desde donde está. Quien sí lo cuenta bien es `/cargar`: lo dice
      // con las palabras exactas del navegador y además bloquea los
      // formularios, que es la consecuencia que importa. A esa pantalla se
      // llega por el menú de Mantenimiento, que no depende de esto.
      console.error("cargas sin señal: no se pudo leer la cola", e);
      return;
    }
    if (!vigente()) return;

    // El vaciado se pide sólo si hay algo que mandar. Pedirlo siempre
    // despertaría al service worker en cada carga de cada pantalla para que
    // mire una cola vacía, y en Android dejaría registrado un `sync` que no
    // tiene nada que hacer.
    if (cargas.some((carga) => carga.estado === "esperando")) {
      void pedirVaciadoAhora();
      void pedirVaciadoEnSegundoPlano();
    }

    // La foto es de antes del vaciado, a propósito: esperar a que el worker
    // termine para recién ahí dibujar dejaría la barra en blanco justo cuando
    // no hay señal, que es cuando hay algo que decir. Si el vaciado anda, lo
    // que sobre desaparece en la próxima carga de la app.
    setQueHay(loQueNoEntro(cargas, new Date()));
  }, []);

  if (queHay === null || cerrada) return null;

  const { demoradas, detenidas, laMasVieja } = queHay;

  return (
    <div
      // `shrink-0` por lo mismo que la barra de instalar: en una pantalla baja,
      // el alto lo tiene que ceder el `<main>` que scrollea y no la barra.
      className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-900"
      role="status"
    >
      {/* Se parte en una pantalla angosta en vez de apretar el enlace: en los
          343 px útiles de un teléfono, el texto y el botón en la misma línea
          dejan al texto en dos palabras por renglón. */}
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">
            Hay cargas de Mantenimiento que todavía no entraron al sistema.
          </p>

          {/* Esperar no es haberse perdido, y decirlo es lo que evita que esta
              barra asuste por algo que se arregla solo. Lo que no se promete es
              cuándo: eso depende de que haya señal y de que entre quien la
              cargó. */}
          {demoradas > 0 && (
            <p className="mt-0.5">
              {demoradas === 1
                ? "Una espera desde hace más de un día"
                : `${demoradas} esperan desde hace más de un día`}
              {laMasVieja === null
                ? ". "
                : `; la más vieja se cargó ${haceCuanto(laMasVieja)}. `}
              No se perdieron: salen solas cuando haya señal.
            </p>
          )}

          {/* POR QUÉ NO DICE «FALLARON»: una carga queda parada también cuando
              **entró** y su advertencia no se pudo mostrar —así la deja
              `siNoSePudoAvisar`—, y de ésa «falló» sería falso, además de
              empujar a cargarla de nuevo, que es el duplicado que todo este
              diseño existe para evitar. Lo único que las dos clases tienen en
              común, y lo único que se afirma acá, es que ninguna sale sola.
              Cuál es cada una lo dice su propio texto en `/cargar`. */}
          {detenidas > 0 && (
            <p className="mt-0.5 font-medium">
              {detenidas === 1
                ? "Una está parada y no sale sola: hay que mirarla."
                : `${detenidas} están paradas y no salen solas: hay que mirarlas.`}
            </p>
          )}
        </div>

        <Link href="/cargar" className="btn-primary shrink-0">
          Ver
        </Link>

        <button
          type="button"
          onClick={() => setCerrada(true)}
          aria-label="Ocultar este aviso hasta la próxima vez que abra la app"
          // No se recuerda en `localStorage`, al revés que la barra de
          // instalar, y la diferencia es qué se está descartando. Aquélla es
          // una oferta: cerrarla para siempre es la respuesta. Ésta es trabajo
          // de alguien que no entró; vuelve en la próxima carga de la app, y
          // deja de volver cuando la carga entra o alguien la borra, que es
          // cuando el problema de verdad terminó.
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-amber-700 transition hover:bg-amber-100"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
