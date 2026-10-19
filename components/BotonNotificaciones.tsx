"use client";

import { useState } from "react";
import { useCargar } from "@/lib/core/useCargar";

/**
 * Prender y apagar las notificaciones **en este aparato**.
 *
 * Lo de «este aparato» no es un detalle de implementación: desde el 18/10/2026
 * la suscripción se guarda por `(usuario_id, endpoint)`, así que el celular y la
 * computadora de la misma persona son dos cosas distintas y se prenden por
 * separado. Antes la clave era el usuario solo, y suscribirse en la segunda
 * borraba la primera sin que nada avisara. Por eso el texto dice «en este
 * teléfono / en esta computadora» y no «tus notificaciones»: si dijera lo
 * segundo, alguien lo prendería en la compu y se quedaría esperando que le
 * llegue al teléfono.
 *
 * El molde de los estados viene de lo que ya hacía `/mi-remis`: distinguir «no
 * soportado» de «denegado» de «apagado», porque las tres se arreglan distinto y
 * un cartel genérico no le sirve a nadie. **«Denegado» es el que más importa**:
 * una vez que la persona dice que no, el navegador no vuelve a preguntar nunca
 * más, y desde la app no hay forma de revertirlo — hay que ir a la
 * configuración del navegador. Sin ese texto, el botón parece roto.
 */
type Estado =
  | "mirando"
  | "apagado"
  | "prendiendo"
  | "prendido"
  | "apagando"
  | "no-soportado"
  | "denegado"
  | "sin-modulos"
  | "fallo";

/** La clave pública VAPID viaja en base64url y `subscribe` la quiere en bytes. */
function base64UrlABytes(base64: string): Uint8Array {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(normal);
  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)));
}

/** Cómo llamar al aparato en pantalla, para que se entienda que es éste y no todos. */
function esteAparato(): string {
  if (typeof navigator === "undefined") return "este aparato";
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? "este teléfono" : "esta computadora";
}

export function BotonNotificaciones() {
  const [estado, setEstado] = useState<Estado>("mirando");
  const [aparato, setAparato] = useState("este aparato");

  // Si el navegador puede y si ya está suscrito no son datos del render: se
  // preguntan una vez al montar. Por `useCargar`, para que la respuesta no se
  // pinte si el componente ya se fue.
  useCargar(async (vigente) => {
    setAparato(esteAparato());
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      if (vigente()) setEstado("no-soportado");
      return;
    }
    if (Notification.permission === "denied") {
      if (vigente()) setEstado("denegado");
      return;
    }
    const registro = await navigator.serviceWorker.getRegistration();
    const suscripcion = await registro?.pushManager.getSubscription();
    if (vigente()) setEstado(suscripcion ? "prendido" : "apagado");
  }, []);

  async function prender() {
    setEstado("prendiendo");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") { setEstado("denegado"); return; }

      // `register` es idempotente: si el service worker ya está registrado
      // —lo hace `RegistrarServiceWorker` en cada carga desde la fase 1—
      // devuelve el mismo registro en vez de crear otro.
      //
      // **El `type` tiene que ser el mismo que en `RegistrarServiceWorker`**:
      // `public/sw.js` importa las reglas de la cola de cargas sin señal, así
      // que es un módulo. (Medido en Chromium el 19/10/2026: registrar el mismo
      // alcance con otro tipo **no choca**, dispara una actualización normal.
      // Antes acá decía lo contrario y nadie lo había comprobado.)
      //
      // **ACÁ SE ATRAPA APARTE, Y ES POR FIREFOX DE ESCRITORIO**, que no
      // soporta service workers de tipo módulo en **ninguna** versión —lo de la
      // 114 son los *dedicated workers*, que es otra cosa—. Ahí esto rechaza, y
      // sin esta rama la persona veía «No se pudo activar. Probá de nuevo», que
      // la manda a reintentar algo que no va a funcionar nunca. Como la
      // computadora es una fila aparte de `push_suscripciones`, es un caso real
      // y no teórico.
      let registro;
      try {
        registro = await navigator.serviceWorker.register("/sw.js", { type: "module" });
      } catch {
        setEstado("sin-modulos");
        return;
      }
      const { clavePublica } = await fetch("/api/push/suscripcion").then((r) => r.json());
      if (!clavePublica) { setEstado("fallo"); return; }

      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlABytes(clavePublica) as BufferSource,
      });
      const r = await fetch("/api/push/suscripcion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suscripcion.toJSON()),
      });
      setEstado(r.ok ? "prendido" : "fallo");
    } catch {
      setEstado("fallo");
    }
  }

  async function apagar() {
    setEstado("apagando");
    try {
      const registro = await navigator.serviceWorker.getRegistration();
      const suscripcion = await registro?.pushManager.getSubscription();
      if (suscripcion) {
        // Primero se avisa al servidor y después se desuscribe el navegador. Al
        // revés, si lo segundo anda y lo primero no, queda una fila que ya no
        // corresponde a nada y el cron le manda a un aparato que no escucha
        // hasta que el push service conteste 410.
        await fetch("/api/push/suscripcion", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: suscripcion.endpoint }),
        });
        await suscripcion.unsubscribe();
      }
      setEstado("apagado");
    } catch {
      setEstado("fallo");
    }
  }

  if (estado === "mirando") return <p className="text-sm text-slate-400">Viendo si este navegador puede…</p>;

  if (estado === "no-soportado") {
    return (
      <p className="text-sm text-slate-500">
        Este navegador no puede mostrar notificaciones. En iPhone funcionan sólo
        con la app agregada a la pantalla de inicio — está explicado en{" "}
        <a href="/instalar" className="underline">Instalar la app</a>.
      </p>
    );
  }

  if (estado === "denegado") {
    return (
      <p className="text-sm text-amber-700">
        Las notificaciones están bloqueadas en {aparato}. El navegador no vuelve
        a preguntar, así que hay que habilitarlas a mano en su configuración,
        en los permisos de este sitio.
      </p>
    );
  }

  if (estado === "sin-modulos") {
    return (
      <p className="text-sm text-amber-700">
        En este navegador no se pueden activar. El SdG usa un service worker de
        tipo módulo, y Firefox de escritorio no los soporta en ninguna versión;
        reintentar no va a cambiar nada. Desde Chrome o Edge en la computadora,
        o desde el teléfono, funcionan. Si estás en otro navegador y ves esto,
        avisá: puede ser una falla del último despliegue.
      </p>
    );
  }

  const ocupado = estado === "prendiendo" || estado === "apagando";
  // `apagando` cuenta como prendido a los efectos de qué se muestra. Si no, al
  // tocar «Apagar» el estado deja de ser `prendido`, la vista salta a la otra
  // rama y ofrece **activar** algo que se está apagando — y el texto
  // «Apagando…» de abajo no se puede ver nunca. Lo mismo le pasaba al botón de
  // instalar de la fase 1 y lo encontró `tsc`, no una prueba a ojo.
  const seVePrendido = estado === "prendido" || estado === "apagando";

  return (
    <div className="space-y-2">
      {seVePrendido ? (
        <>
          <p className="text-sm text-emerald-700">Activadas en {aparato}.</p>
          <button type="button" onClick={apagar} disabled={ocupado} className="btn-ghost text-sm disabled:opacity-50">
            {estado === "apagando" ? "Apagando…" : "Apagar en " + aparato}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Una vez por día, un resumen de lo que tenés para mirar en tus módulos.
            Se activan por aparato: si las querés en el teléfono y en la
            computadora, hay que prenderlas en los dos.
          </p>
          <button type="button" onClick={prender} disabled={ocupado} className="btn-primary text-sm disabled:opacity-50">
            {estado === "prendiendo" ? "Activando…" : "Activar en " + aparato}
          </button>
          {estado === "fallo" && (
            <p className="text-sm text-amber-700">No se pudo activar. Probá de nuevo; si sigue, avisá.</p>
          )}
        </>
      )}
    </div>
  );
}
