"use client";

import { useEffect } from "react";

/**
 * Registra `/sw.js` para todo el mundo, apenas carga la app.
 *
 * POR QUÉ EXISTE
 *
 * Sin esto **no hay service worker**, y sin service worker Chrome no dispara
 * `beforeinstallprompt`: el camino de «un toque» de Android no existe y la barra
 * de instalar sólo puede mandar a leer las instrucciones a mano. El único
 * `register()` que había en el repo vive en `app/(app)/mi-remis`, adentro de
 * `activarNotificaciones()`, detrás de un botón que **nunca tocó nadie** —cero
 * suscripciones medidas—, así que en los hechos el navegador no veía ninguno y
 * el handler de `fetch` de `public/sw.js` era código muerto en producción.
 *
 * Aquel registro **se deja como está**: es de la fase 2, y registrar dos veces
 * el mismo scope devuelve el mismo registro, así que no se pisan.
 *
 * POR QUÉ EN EL `load` Y NO EN EL MONTAJE
 *
 * Registrar mientras la página todavía está bajando su propio JS y sus datos le
 * compite el ancho de banda a lo que la persona está esperando ver. El registro
 * no urge: lo que habilita —que Chrome ofrezca instalar, y el push de la fase 2—
 * no lo necesita en el primer segundo.
 *
 * Y el `readyState` no es un detalle: en una navegación del lado del cliente
 * este componente se monta **después** de que `load` ya pasó, y el evento no
 * vuelve. Sin esa rama, en una visita que entra por cualquier pantalla que no
 * sea la primera, el registro no ocurriría nunca.
 *
 * FALLA CALLADO, A PROPÓSITO
 *
 * Esto corre en cada carga de cada pantalla para los 14 usuarios: no tiene
 * derecho a romper nada. Sin soporte (Safari viejo, modo privado de Firefox) o
 * si el registro rechaza, la app sigue funcionando igual que hoy — lo único que
 * se pierde es la oferta de instalar. No hay nada que decirle a la persona: no
 * es algo que ella pidió ni algo que pueda arreglar.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const registrar = () => {
      try {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          // Registro rechazado: queda sin service worker y nada más.
        });
      } catch {
        // `register` puede tirar en contextos donde la API existe pero está
        // bloqueada. Tampoco hay nada que hacer.
      }
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }

    window.addEventListener("load", registrar, { once: true });
    return () => window.removeEventListener("load", registrar);
  }, []);

  return null;
}
