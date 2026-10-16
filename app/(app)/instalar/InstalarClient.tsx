"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";
import { plataformaDeInstalacion, type PlataformaInstalacion } from "@/lib/core/instalacion";
import {
  dispararInstalacion,
  estaInstalada,
  useEstadoDeInstalacion,
} from "@/components/promptDeInstalacion";

/** Lo que hay que saber del navegador de quien mira, resuelto una vez al montar. */
interface Entorno {
  plataforma: PlataformaInstalacion;
  /** Sin service worker no hay instalación posible: contexto inseguro o navegador viejo. */
  soportado: boolean;
}

/**
 * Cómo instalar el SdG, según el teléfono que tenga adelante quien mira.
 *
 * POR QUÉ ESTA PANTALLA EXISTE
 *
 * Instalar no se hace igual en Android que en iPhone, y en iPhone **no hay
 * botón**: hay que pasar por el menú de compartir de Safari. Sin un lugar que
 * lo explique, la única forma de enterarse es que alguien te lo muestre.
 *
 * LO QUE DECIDE QUÉ SE MUESTRA
 *
 * `plataformaDeInstalacion()`, que es pura y vive en `lib/core/instalacion.ts`.
 * Acá sólo se leen los dos datos que necesita —el user agent y si la página ya
 * corre instalada— y se dibuja. La detección no se reimplementa.
 */
export default function InstalarClient() {
  // Arranca en null a propósito: `navigator` no existe en el servidor, y
  // decidir el texto durante el render daría un HTML distinto al del cliente.
  // Se resuelve al montar, con el mismo molde que usa `mi-remis` para
  // preguntarle al navegador si soporta notificaciones.
  const [entorno, setEntorno] = useState<Entorno | null>(null);
  const { evento, instalada } = useEstadoDeInstalacion();
  const [intento, setIntento] = useState<"ninguno" | "esperando" | "aceptada" | "rechazada">("ninguno");

  useCargar(async () => {
    setEntorno({
      plataforma: plataformaDeInstalacion(navigator.userAgent, estaInstalada()),
      soportado: "serviceWorker" in navigator,
    });
  }, []);

  async function instalar() {
    setIntento("esperando");
    const resultado = await dispararInstalacion();
    setIntento(
      resultado === "accepted" ? "aceptada" : resultado === "dismissed" ? "rechazada" : "ninguno",
    );
  }

  function contenido(e: Entorno) {
    // Ya instalada gana sobre todo, incluso sobre "tu navegador no la soporta":
    // si está corriendo instalada, es evidente que se pudo.
    if (e.plataforma === "ya-instalada" || instalada) return <YaInstalada />;
    if (!e.soportado) return <NoSoportado />;
    if (e.plataforma === "ios") return <PasosIOS />;
    if (e.plataforma === "android") {
      return <PasosAndroid hayBoton={evento !== null} intento={intento} onInstalar={instalar} />;
    }
    return <PasosEscritorio />;
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="page-header">Instalar la app</h1>
      <p className="page-subheader mb-6">
        El SdG queda como un ícono más en la pantalla de inicio, a pantalla completa y sin la barra
        del navegador.
      </p>

      {entorno === null ? (
        <p className="text-sm text-slate-500">Viendo qué teléfono tenés...</p>
      ) : (
        <div className="card p-5">{contenido(entorno)}</div>
      )}

      {/* La advertencia va en los cuatro casos, incluso cuando ya está
          instalada: es lo que evita el llamado del primer día. La app instalada
          tiene su propio almacenamiento —en iPhone, separado del Safari donde
          la instalaste—, así que la sesión no viaja y la primera vez pide la
          contraseña de nuevo. Quien no lo sabe cree que la app está rota. */}
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">
          La primera vez te va a pedir la contraseña otra vez
        </p>
        <p className="mt-1 text-sm text-amber-800">
          No está rota: la app instalada guarda su sesión aparte de la del navegador. Entrás una vez
          con tu correo y tu contraseña, y después queda abierta como siempre.
        </p>
      </div>
    </div>
  );
}

function YaInstalada() {
  return (
    <>
      <p className="text-sm font-semibold text-slate-900">Ya la tenés instalada.</p>
      <p className="mt-1 text-sm text-slate-600">
        Estás entrando desde la app, así que no hay nada que hacer acá. Si la borraste del teléfono,
        volvé a entrar desde el navegador y esta pantalla te va a mostrar cómo instalarla de nuevo.
      </p>
    </>
  );
}

function NoSoportado() {
  return (
    <>
      <p className="text-sm font-semibold text-slate-900">
        Este navegador no puede instalar la app.
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Le falta el soporte que hace falta (service workers). Suele pasar con navegadores viejos, o
        cuando se entró por una dirección que no empieza con <code>https</code>. Probá con Chrome en
        Android o con Safari en iPhone, entrando por la dirección de siempre.
      </p>
    </>
  );
}

/** El ícono de Compartir de iOS: el cuadrado con la flecha que sale para arriba. */
function IconCompartir() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="inline-block shrink-0 align-text-bottom text-blue-600"
    >
      {/* La flecha. */}
      <path d="M12 3v12" />
      <path d="M8.5 6.5L12 3l3.5 3.5" />
      {/* La caja, abierta arriba para que la flecha salga de adentro. */}
      <path d="M8 10H6.5A1.5 1.5 0 005 11.5v8A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5v-8A1.5 1.5 0 0017.5 10H16" />
    </svg>
  );
}

function Paso({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {numero}
      </span>
      <span className="pt-0.5 text-sm text-slate-700">{children}</span>
    </li>
  );
}

function PasosIOS() {
  return (
    <>
      <p className="mb-4 text-sm font-semibold text-slate-900">
        En iPhone se instala desde el menú de compartir.
      </p>
      <ol className="space-y-3">
        <Paso numero={1}>
          Tocá el botón <strong>Compartir</strong> <IconCompartir /> en la barra de abajo de
          Safari.
        </Paso>
        <Paso numero={2}>
          Bajá en la lista y elegí <strong>«Agregar a inicio»</strong>. Confirmá con «Agregar», y el
          ícono del SdG queda en la pantalla de inicio.
        </Paso>
      </ol>
      <p className="mt-4 text-xs text-slate-500">
        Tiene que ser con Safari: en el iPhone, Chrome y Firefox no pueden instalar aplicaciones.
      </p>
    </>
  );
}

function PasosAndroid({
  hayBoton,
  intento,
  onInstalar,
}: {
  hayBoton: boolean;
  intento: "ninguno" | "esperando" | "aceptada" | "rechazada";
  onInstalar: () => void;
}) {
  if (intento === "aceptada") {
    return (
      <>
        <p className="text-sm font-semibold text-slate-900">Listo, se está instalando.</p>
        <p className="mt-1 text-sm text-slate-600">
          Buscá el ícono del SdG en la pantalla de inicio o en el cajón de aplicaciones.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm font-semibold text-slate-900">
        En Android se instala de un toque.
      </p>

      {hayBoton ? (
        <button
          type="button"
          onClick={onInstalar}
          disabled={intento === "esperando"}
          className="btn-primary"
        >
          {intento === "esperando" ? "Esperando..." : "Instalar la app"}
        </button>
      ) : (
        // Sin el evento no hay nada que disparar, y un botón que no hace nada es
        // peor que no tenerlo: se explica el camino largo, que siempre está.
        <p className="text-sm text-slate-600">
          Chrome no ofreció el botón de instalar en esta pantalla. Abrí el menú de Chrome (los tres
          puntos, arriba a la derecha) y elegí <strong>«Instalar aplicación»</strong> o{" "}
          <strong>«Agregar a pantalla principal»</strong>.
        </p>
      )}

      {intento === "rechazada" && (
        <p className="mt-3 text-sm text-amber-700">
          Cancelaste la instalación. Podés volver a intentarlo desde el menú de Chrome (los tres
          puntos, arriba a la derecha) → «Instalar aplicación».
        </p>
      )}
    </>
  );
}

function PasosEscritorio() {
  return (
    <>
      <p className="mb-2 text-sm font-semibold text-slate-900">
        En la computadora se instala desde la barra de direcciones.
      </p>
      <p className="text-sm text-slate-600">
        En Chrome o en Edge aparece un ícono de instalar al final de la barra de direcciones, a la
        derecha. Tocalo y confirmá «Instalar». Si no lo ves, está también en el menú del navegador
        (los tres puntos) como «Instalar SdG».
      </p>
      <p className="mt-4 text-xs text-slate-500">
        Si estás en un iPad y ves este texto, es porque Safari está pidiendo las páginas como
        «sitio de escritorio». Da igual: seguí los pasos del iPhone —Compartir y «Agregar a
        inicio»—, que funcionan igual.
      </p>
    </>
  );
}
