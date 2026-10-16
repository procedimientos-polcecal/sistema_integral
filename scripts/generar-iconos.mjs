/**
 * Genera, a partir de `public/logo.png`, los cinco PNG que la app instalable
 * necesita en `public/`:
 *
 *   icon-192.png            ícono del manifest (Android, y lo que pide Chrome
 *                           para ofrecer "Instalar")
 *   icon-512.png            ídem, tamaño grande (pantalla de arranque)
 *   icon-512-maskable.png   el ícono que Android recorta en círculo, cuadrado
 *                           u otra forma según el teléfono
 *   apple-touch-icon.png    el de iOS, que ignora los íconos del manifest
 *   logo-320.png            el logo para las pantallas
 *
 * **Por qué `logo-320.png`:** `logo.png` mide 4266×4266 y pesa 2 MB, y se servía
 * tal cual en cinco lugares de pantalla —el Header, que está en *todas* las
 * páginas, y el login, el olvidé-mi-contraseña y el reseteo— para mostrarse a
 * 44 o 140 píxeles de ancho. Cada teléfono bajaba 2 MB para pintar un logo
 * chico. El de 320 de ancho cubre 140 px a pantalla de alta densidad (×2) y pesa
 * una fracción. `logo.png` se queda: el único uso que queda, la planilla de
 * planificación de Mantenimiento (`imprimir`), sale en papel y ahí la resolución
 * sí sirve.
 *
 * **Por qué el maskable lleva margen:** Android aplica una máscara —un círculo,
 * en muchos teléfonos— sobre el ícono y descarta lo que queda afuera. La zona
 * segura es el círculo central de 80% del lado; si el logo llegara al borde,
 * la máscara le comería las puntas. Por eso va achicado al 80% y centrado sobre
 * un fondo sólido, que es el color de tema de la app.
 *
 * **Por qué el de Apple va aplanado:** iOS pinta de negro el canal alfa. Con el
 * logo sobre transparente, el ícono de la pantalla de inicio sale con un marco
 * negro. Se aplana sobre el mismo fondo sólido y sin transparencia.
 *
 * Los íconos se generan a mano y **se commitean**, así que producción no necesita
 * `sharp` (está como devDependency).
 *
 * Uso:
 *
 *   node scripts/generar-iconos.mjs
 *
 * **Si cambia `public/logo.png` hay que volver a correrlo.** Nada avisa: los
 * cinco PNG quedan con el logo viejo, el build pasa, y el ícono instalado en
 * el teléfono de la gente sigue siendo el anterior. Después, commitear los cinco.
 *
 * Si falla, falla fuerte: un ícono ausente no rompe el build sino la
 * instalabilidad de la app, que es donde no lo vamos a ver.
 */

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const publico = join(raiz, "public");
const origen = join(publico, "logo.png");

/** El color de tema de la app: el fondo de los íconos que no pueden ser transparentes. */
const FONDO = "#0A0F1C";

/** Cuánto del lado ocupa el logo dentro del maskable: la zona segura de Android. */
const PROPORCION_MASKABLE = 0.8;

/** Los PNG se escriben con la compresión al máximo: pesan menos y se descargan una vez. */
const PNG = { compressionLevel: 9, effort: 10 };

/** `sharp` lee el origen de disco cada vez; no hay estado compartido entre salidas. */
const logo = () => sharp(origen);

const SALIDAS = [
  {
    archivo: "icon-192.png",
    generar: () => logo().resize(192, 192).png(PNG).toFile(join(publico, "icon-192.png")),
  },
  {
    archivo: "icon-512.png",
    generar: () => logo().resize(512, 512).png(PNG).toFile(join(publico, "icon-512.png")),
  },
  {
    archivo: "icon-512-maskable.png",
    generar: async () => {
      const lado = 512;
      const interior = Math.round(lado * PROPORCION_MASKABLE);
      const achicado = await logo().resize(interior, interior).png().toBuffer();
      await sharp({
        create: { width: lado, height: lado, channels: 3, background: FONDO },
      })
        .composite([{ input: achicado, gravity: "center" }])
        .png(PNG)
        .toFile(join(publico, "icon-512-maskable.png"));
    },
  },
  {
    archivo: "apple-touch-icon.png",
    generar: () =>
      logo()
        .resize(180, 180)
        // `flatten` pinta el fondo donde había transparencia, y el resultado
        // sale sin canal alfa.
        .flatten({ background: FONDO })
        .png(PNG)
        .toFile(join(publico, "apple-touch-icon.png")),
  },
  {
    archivo: "logo-320.png",
    // Sólo el ancho: la altura sale de la proporción del logo.
    generar: () => logo().resize({ width: 320 }).png(PNG).toFile(join(publico, "logo-320.png")),
  },
];

let pesoTotal = 0;

for (const salida of SALIDAS) {
  try {
    await salida.generar();
    const destino = join(publico, salida.archivo);
    const { width, height } = await sharp(destino).metadata();
    const peso = (await stat(destino)).size;
    pesoTotal += peso;
    console.log(`${salida.archivo}: ${width}x${height}, ${Math.round(peso / 1024)} KB`);
  } catch (e) {
    console.error(
      `No se pudo generar ${salida.archivo}.\n` +
        `  origen: ${origen}\n` +
        `  sin él, la app instalable queda sin ese ícono.\n` +
        `Revisá que public/logo.png exista y que sharp esté instalado.\n`
    );
    console.error(e);
    process.exit(1);
  }
}

console.log(`Total: ${Math.round(pesoTotal / 1024)} KB`);
