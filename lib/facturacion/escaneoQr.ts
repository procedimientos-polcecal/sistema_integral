import jsQR from "jsqr";

/**
 * Encontrar un QR dentro de una imagen ya dibujada.
 *
 * Está separado de `leerArchivo` para poder **medirlo**: acá no hay ni PDF ni
 * navegador, sólo "dame los píxeles de este rectángulo". El navegador le pasa el
 * contexto de un canvas y el banco de pruebas le pasa el de `@napi-rs/canvas`,
 * así que lo que se mide contra las facturas reales es exactamente este código y
 * no una copia parecida.
 *
 * ## Lo que enseñaron las 139 facturas de septiembre de 2026
 *
 * Se corrió sobre la carpeta entera —no una muestra— y **110 se leen solas**.
 * Dos cosas que no se deducían de la especificación, y cada una es una de las
 * dos pasadas de acá:
 *
 * 1. **Un QR pegado a una línea del formulario no se lee.** El estándar pide una
 *    "zona de silencio" de cuatro módulos en blanco alrededor, y muchos emisores
 *    imprimen el QR dentro de un recuadro que lo toca. Por eso cada recorte se
 *    copia al centro de un lienzo blanco más grande antes de escanearlo: el
 *    margen que el emisor no dejó se lo agrega el lector. Con eso, 8 facturas
 *    que antes necesitaban 3600 px pasaron a leerse a 2600.
 * 2. **La resolución hay que escalonarla.** 84 facturas se leen a 1600 px de
 *    ancho y 17 más a 2600. Empezar directo en 2600 sería pagar el dibujo caro
 *    en las 84 que no lo necesitan; quedarse en 1600 sería perder 17.
 *
 * Y las ventanas deslizantes rescatan 9 más, que es el único caso donde vale
 * gastar segundos: la comparación no es contra un segundo, es contra tipear la
 * factura entera.
 *
 * ## Lo que se probó y no sirvió
 *
 * **Leer las imágenes embebidas del PDF a su resolución nativa.** La idea era
 * buena —el QR de TODO RULEMAN es una imagen de 330×330 que la página estira a
 * un rectángulo, y estirada no se lee de ninguna manera— pero **en el navegador
 * no se puede**: pdf.js decodifica las imágenes con `OffscreenCanvas` dentro del
 * worker y nunca manda los píxeles al hilo principal. `page.objs.get(...)` tira
 * "Requesting object that isn't resolved yet", antes y después de dibujar. En
 * Node funciona, porque ahí no hay `OffscreenCanvas` y el worker sí manda los
 * datos — o sea que era una pasada que **medía bien y en producción no habría
 * hecho nada**. Se comprobó en el navegador y se sacó.
 *
 * Las facturas con el QR estirado quedan entonces para carga manual, igual que
 * las que no traen QR.
 */

/** Lo mínimo que se le pide a un canvas para poder escanearlo. */
export interface PixelesDe {
  width: number;
  height: number;
  getImageData(x: number, y: number, w: number, h: number): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  };
}

/** Un rectángulo de píxeles, sin depender de la clase `ImageData` del navegador. */
export interface Pixeles {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Le agrega borde blanco a un rectángulo de píxeles.
 *
 * Es la zona de silencio que el estándar del QR exige y que muchas facturas no
 * tienen porque el recuadro del formulario le pasa por encima. Se hace copiando
 * el buffer a mano, sin canvas: así funciona igual en el navegador y en Node.
 */
export function conMargenBlanco(p: Pixeles, proporcion = 0.12): Pixeles {
  const m = Math.max(8, Math.round(Math.max(p.width, p.height) * proporcion));
  const ancho = p.width + m * 2;
  const alto = p.height + m * 2;
  const salida = new Uint8ClampedArray(ancho * alto * 4).fill(255);

  for (let y = 0; y < p.height; y++) {
    const origen = y * p.width * 4;
    const destino = ((y + m) * ancho + m) * 4;
    salida.set(p.data.subarray(origen, origen + p.width * 4), destino);
  }

  return { data: salida, width: ancho, height: alto };
}

function decodificar(p: Pixeles): string | null {
  // `attemptBoth`: hay comprobantes impresos en negativo y escaneos invertidos.
  // Cuesta el doble sólo cuando no lo encuentra derecho.
  return jsQR(p.data, p.width, p.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

function recortar(px: PixelesDe, x: number, y: number, w: number, h: number): string | null {
  if (w < 40 || h < 40) return null;
  try {
    const d = px.getImageData(Math.max(0, x), Math.max(0, y), w, h);
    return decodificar(conMargenBlanco({ data: d.data, width: d.width, height: d.height }));
  } catch {
    // Un lienzo "sucio" —con una imagen de otro origen— hace que getImageData
    // tire. No es un caso nuestro, pero que no se lleve puesta la carga.
    return null;
  }
}

/**
 * Pasada normal: la hoja completa y después los cuatro rincones.
 *
 * Los rincones van con solape porque un QR justo en el medio quedaría partido
 * por la mitad en los cuatro y no se leería en ninguno. Y sirven porque recortar
 * deja el QR más grande dentro de lo que jsQR analiza, que es lo que rescata a
 * los escaneos torcidos.
 */
export function buscarQr(px: PixelesDe): string[] {
  const completo = recortar(px, 0, 0, px.width, px.height);
  if (completo) return [completo];

  const encontrados: string[] = [];
  const w = Math.round(px.width * 0.62);
  const h = Math.round(px.height * 0.62);

  for (const [fx, fy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    const texto = recortar(
      px,
      fx === 0 ? 0 : px.width - w,
      fy === 0 ? 0 : px.height - h,
      w,
      h
    );
    if (texto && !encontrados.includes(texto)) encontrados.push(texto);
  }

  return encontrados;
}

/**
 * Último recurso: recorrer la hoja con ventanas cada vez más chicas.
 *
 * Cuesta unos segundos —hasta 274 ventanas en una A4— así que sólo corre cuando
 * todo lo demás falló, y en ese caso la comparación no es contra "un segundo":
 * es contra tipear la factura entera a mano. Rescató a AGROINGA, donde el QR
 * está pegado al borde de la hoja y ningún recorte de los otros lo aislaba.
 */
export function buscarQrConVentanas(px: PixelesDe): string[] {
  for (const frac of [0.34, 0.24, 0.16]) {
    const lado = Math.round(px.width * frac);
    if (lado < 60) continue;
    const paso = Math.max(1, Math.round(lado / 2));

    for (let y = 0; y + lado <= px.height; y += paso) {
      for (let x = 0; x + lado <= px.width; x += paso) {
        const texto = recortar(px, x, y, lado, lado);
        if (texto) return [texto];
      }
    }
  }
  return [];
}
