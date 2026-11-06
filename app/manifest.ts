import type { MetadataRoute } from "next";

// Sin este archivo el SdG no se puede instalar en el teléfono: el navegador lo
// abre como una pestaña y no le ofrece un ícono. Next lo sirve en
// /manifest.webmanifest a partir de esta función.
//
// El color tiene que ser el mismo de `viewport.themeColor` en app/layout.tsx.
// Si no coinciden, la pantalla de carga de la app instalada parpadea de un
// color al otro al arrancar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SdG — Polcecal / Polysan",
    // Es lo que se lee abajo del ícono en la pantalla de inicio, así que tiene
    // que entrar entero: por eso es sólo la sigla.
    short_name: "SdG",
    start_url: "/",
    display: "standalone",
    lang: "es",
    background_color: "#0A0F1C",
    theme_color: "#0A0F1C",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // El maskable va separado: el sistema recorta el ícono en círculo o
        // cuadrado y necesita el margen de seguridad que trae esa versión.
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
