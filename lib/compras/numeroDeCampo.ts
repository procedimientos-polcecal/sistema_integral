/**
 * Lee el número que alguien tipeó en un campo de la pantalla de carga.
 *
 * Es lógica que decide plata, por eso vive acá y no en el componente: un precio
 * mal leído entra a la comparativa que define a quién se le compra, y la ruta
 * no lo frena porque 12,5 es un número válido.
 *
 * La regla:
 *
 * - **Cuando aparecen los dos separadores, el decimal es el que está más a la
 *   derecha** y el otro es de miles: `"12.500,50"` → 12500.5 y `"1,234.56"`
 *   (formato estadounidense, típico de copiar un precio en dólares) → 1234.56.
 * - **Una coma sola es el decimal**: `"12500,50"` → 12500.5.
 * - **Un punto solo es de miles si el texto calza `^[1-9]\d{0,2}(\.\d{3})+$`**
 *   (un grupo inicial que no empieza en cero, y después uno o más puntos con
 *   exactamente tres dígitos): `"12.500"` → 12500, `"1.234.567"` → 1234567. Si
 *   no calza, es decimal: `"12.5"` → 12.5 y `"0.500"` → 0.5, porque un grupo
 *   inicial en cero nunca es un separador de miles.
 * - **Cualquier signo menos devuelve `null`**: un precio, una cantidad, un
 *   descuento o un IVA negativos no existen, y `null` es mejor que un número de
 *   magnitud equivocada (`"-12.500"` daba -12,5).
 * - Vacío o algo que no es un número → `null`.
 *
 * La ambigüedad que queda es `"1.500"` pensado como uno coma cinco: se lee como
 * mil quinientos, que es lo que significa en una planilla argentina.
 *
 * `PresupuestoForm.tsx` tiene su propio `num()` copiado, con el defecto
 * contrario (`"12.500"` da 12,5). No se tocó: es una pantalla en uso diario y
 * cambiarla es una decisión aparte.
 */
export function numeroDeCampo(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;

  if (t.includes("-")) return null;

  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");

  let normalizado: string;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // Los dos a la vez: el decimal es el de más a la derecha.
    normalizado = ultimaComa > ultimoPunto
      ? t.replace(/\./g, "").replace(",", ".")
      : t.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    normalizado = t.replace(",", ".");
  } else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) {
    normalizado = t.replace(/\./g, "");
  } else {
    normalizado = t;
  }

  // `Number("")` es 0 y `Number("1e3")` es 1000: sólo pasa lo que parece un número.
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lo mismo, pero distinguiendo **«vacío» de «no se pudo leer»**.
 *
 * `numeroDeCampo` devuelve `null` para las dos cosas, y eso alcanza mientras el
 * que llama trate al `null` como «falta». Lo que no se puede hacer es taparlo
 * con un cero: alguien que tipea `"21%"` en un campo rotulado «IVA %» carga IVA
 * 0, la fórmula de la planilla da un total 21% más bajo que el de los otros
 * proveedores, y en una comparativa donde gana el más barato eso **elige
 * proveedor**. Un `"1.500 $"` en envío se pierde entero por el mismo camino.
 */
export type LecturaDeCampo =
  | { estado: "vacio" }
  | { estado: "numero"; valor: number }
  | { estado: "ilegible" };

export function leerCampo(texto: string): LecturaDeCampo {
  if (texto.trim() === "") return { estado: "vacio" };
  const n = numeroDeCampo(texto);
  return n === null ? { estado: "ilegible" } : { estado: "numero", valor: n };
}

/** Lo que la pantalla tipeó en los campos numéricos de un renglón. */
export interface CamposTipeados {
  precio: string;
  cantidad: string;
  descuento: string;
  iva: string;
  envio: string;
}

/** Lo que de ahí sale para el cuerpo del POST. */
export interface NumerosDelRenglon {
  precio_unitario: number | null;
  cantidad: number | null;
  /** Fracción, no porcentaje: 21 → 0,21. Es como lo guarda la base. */
  descuento: number;
  iva: number;
  costo_envio: number | null;
}

/** Cómo se llama cada campo en la pantalla, para poder nombrarlo en el error. */
const ETIQUETAS: Record<keyof CamposTipeados, string> = {
  precio: "Precio unitario",
  cantidad: "Cantidad",
  descuento: "Descuento %",
  iva: "IVA %",
  envio: "Envío",
};

/**
 * Lee los cinco campos numéricos de un renglón y junta **todos** los problemas.
 *
 * Las reglas, que no son iguales para los cinco:
 *
 * - **Vacío sigue valiendo 0 en descuento e IVA**, porque es lo que la gente
 *   quiere decir cuando no escribe nada ahí.
 * - **Vacío es `null` en precio, cantidad y envío**: una celda sin cantidad no
 *   es una cantidad de cero —la fórmula del total multiplica por ella— y el
 *   precio que falta lo nombra la ruta, que es la que sabe de qué pedido es.
 * - **Un texto que no se pudo leer como número se rechaza y se nombra**, en los
 *   cinco. Es la misma vara que ya tenía el precio unitario, un piso más arriba:
 *   antes de llegar a la ruta.
 *
 * `comoSeLlama` es cómo nombrar el renglón en el mensaje ("RI 2301").
 */
export function numerosDelRenglon(
  tipeados: CamposTipeados,
  comoSeLlama: string
): { campos: NumerosDelRenglon; problemas: string[] } {
  const problemas: string[] = [];

  const leer = (campo: keyof CamposTipeados, siVacio: number | null): number | null => {
    const texto = tipeados[campo];
    const lectura = leerCampo(texto);
    if (lectura.estado === "vacio") return siVacio;
    if (lectura.estado === "ilegible") {
      problemas.push(
        `${comoSeLlama} · ${ETIQUETAS[campo]}: «${texto.trim()}» no es un número. ` +
        "Escribí sólo el número, sin % ni $ ni letras."
      );
      return siVacio;
    }
    return lectura.valor;
  };

  // El porcentaje viaja como fracción. Se divide después de leer: dividir un
  // `null` tapado con cero es exactamente el error que esto evita.
  const porcentaje = (campo: "descuento" | "iva"): number => (leer(campo, 0) ?? 0) / 100;

  return {
    campos: {
      precio_unitario: leer("precio", null),
      cantidad: leer("cantidad", null),
      descuento: porcentaje("descuento"),
      iva: porcentaje("iva"),
      costo_envio: leer("envio", null),
    },
    problemas,
  };
}
