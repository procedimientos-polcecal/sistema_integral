import * as XLSX from "xlsx";
import { claveDeProveedor } from "@/lib/core/proveedores";
import { obtenerToken, hayCredencialesGoogle, SCOPE_DRIVE_LECTURA } from "@/lib/core/google";

/**
 * Traer la base de proveedores que lleva administración.
 *
 * Mientras la gente no use la app, la lista de verdad vive en un Excel que
 * alguien mantiene a mano. Esto la trae cuando cambia.
 *
 * El Excel manda sobre los datos —CUIT, contacto, plazos, cuenta— pero no sobre
 * quién existe: hay 75 proveedores con compras hechas que no figuran ahí, y
 * ésos se dejan intactos. Nada se desactiva ni se borra, y un campo vacío en el
 * Excel no pisa lo que ya estaba cargado.
 */

/** Un proveedor tal como viene del Excel, con los nombres de la base. */
export interface ProveedorDelExcel {
  nombre: string;
  rubro: string | null;
  contacto: string | null;
  telefono: string | null;
  telefono_alt: string | null;
  direccion: string | null;
  sitio_web: string | null;
  notas: string | null;
  cuit: string | null;
  plazo_pago_dias: number | null;
  forma_pago: string | null;
  condicion_pago: string | null;
  cbu: string | null;
  alias_bancario: string | null;
  comentario: string | null;
}

/**
 * El núcleo del nombre: sin sufijos societarios.
 *
 * Es lo que hace que "Ancoil S.A." y "ANCOIL" se reconozcan como el mismo. No
 * toca el resto de las palabras.
 */
export function nucleoDeProveedor(nombre: string): string {
  return claveDeProveedor(nombre)
    .replace(/\b(s ?a|s r l|srl|sas|s a s|ltda|sh|s h)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};

/** El plazo es un número de días; lo que no lo sea queda nulo. */
export function plazoDePago(v: unknown): number | null {
  const s = texto(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 400 ? n : null;
}

/** Lee las pestañas del Excel y devuelve un proveedor por nombre. */
export function leerProveedores(archivo: ArrayBuffer): ProveedorDelExcel[] {
  const wb = XLSX.read(archivo, { type: "array" });
  const porNombre = new Map<string, ProveedorDelExcel>();

  for (const hoja of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[hoja], {
      defval: null,
    });

    for (const f of filas) {
      const nombre = texto(f["Proveedor"]);
      if (!nombre) continue;

      const datos: ProveedorDelExcel = {
        nombre,
        // La pestaña dice el rubro cuando la fila no lo trae: las hojas de
        // BOLSAS y CARBONILLA son proveedores de eso.
        rubro: texto(f["Tipo de proveedor"])
          ?? (/BOLSAS/i.test(hoja) ? "BOLSAS Y BOLSONES"
            : /CARBONILLA/i.test(hoja) ? "CARBONILLA" : null),
        contacto: texto(f["Nombre"]),
        telefono: texto(f["Contactos"]),
        telefono_alt: texto(f["Contacto Alternativo"]),
        direccion: texto(f["Dirección"]),
        sitio_web: texto(f["Sitio web"]),
        notas: texto(f["Notas"]),
        cuit: texto(f["CUIT"]),
        plazo_pago_dias: plazoDePago(f["PLAZOS DE PAGO"]),
        forma_pago: texto(f["FORMAS DE PAGO"]),
        condicion_pago: texto(f["CONDICIÓN"]),
        cbu: texto(f["CBU"]),
        alias_bancario: texto(f["ALIAS"]),
        comentario: texto(f["COMENTARIO"]),
      };

      const k = claveDeProveedor(nombre);
      const previo = porNombre.get(k);
      if (!previo) porNombre.set(k, datos);
      else {
        // Un proveedor repetido entre pestañas se completa, no se pisa: la
        // segunda hoja suele traer los campos que la primera dejó vacíos.
        const completar = previo as unknown as Record<string, unknown>;
        for (const [campo, valor] of Object.entries(datos)) {
          if (completar[campo] == null && valor != null) completar[campo] = valor;
        }
      }
    }
  }

  return [...porNombre.values()];
}

export interface Decision {
  actualizar: { id: string; fila: ProveedorDelExcel; erraNombre: string | null }[];
  insertar: ProveedorDelExcel[];
  aRevisar: { nombre: string; candidatos: string[]; porque: string }[];
}

/**
 * Qué hacer con cada fila del Excel.
 *
 * Tres destinos: actualizar el que ya existe, darlo de alta, o dejarlo para que
 * lo mire una persona. El tercero es el que evita romper cosas — insertar un
 * duplicado no se nota el primer día, se nota cuando alguien mira cuánto le
 * compramos a un proveedor y le faltan la mitad de las compras.
 */
export function decidirImportacion(
  delExcel: ProveedorDelExcel[],
  deLaBase: { id: string; nombre: string }[]
): Decision {
  const porClave = new Map(deLaBase.map((p) => [claveDeProveedor(p.nombre), p]));

  const porNucleo = new Map<string, { id: string; nombre: string }[]>();
  for (const p of deLaBase) {
    const n = nucleoDeProveedor(p.nombre);
    if (!n) continue;
    if (!porNucleo.has(n)) porNucleo.set(n, []);
    porNucleo.get(n)!.push(p);
  }

  const decision: Decision = { actualizar: [], insertar: [], aRevisar: [] };

  for (const fila of delExcel) {
    // 1. Mismo nombre: no hay nada que decidir.
    const igual = porClave.get(claveDeProveedor(fila.nombre));
    if (igual) {
      decision.actualizar.push({ id: igual.id, fila, erraNombre: null });
      continue;
    }

    // 2. Mismo núcleo y una sola candidata: "Ancoil S.A." es "ANCOIL".
    const n = nucleoDeProveedor(fila.nombre);
    const mismos = porNucleo.get(n) ?? [];
    if (mismos.length === 1) {
      decision.actualizar.push({ id: mismos[0].id, fila, erraNombre: mismos[0].nombre });
      continue;
    }
    if (mismos.length > 1) {
      decision.aRevisar.push({
        nombre: fila.nombre,
        candidatos: mismos.map((p) => p.nombre),
        porque: "varios con el mismo nombre de fondo",
      });
      continue;
    }

    // 3. Uno contiene al otro. Acá NO se decide solo, aunque haya un único
    //    candidato: "Papelera Ciuffo" probablemente sea "CIUFFO", pero "Frenos
    //    Norte" no es "NORTE", y la regla no distingue los dos casos.
    const parecidos = deLaBase.filter((p) => {
      const b = nucleoDeProveedor(p.nombre);
      return b.length >= 4 && n.length >= 4 && (n.includes(b) || b.includes(n));
    });
    if (parecidos.length > 0) {
      decision.aRevisar.push({
        nombre: fila.nombre,
        candidatos: parecidos.map((p) => p.nombre),
        porque: "se parece, pero no es el mismo nombre",
      });
      continue;
    }

    decision.insertar.push(fila);
  }

  return decision;
}

/** Sólo lo que el Excel dice de verdad: un campo vacío no borra lo cargado. */
export function camposParaGuardar(fila: ProveedorDelExcel): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fila).filter(([, v]) => v != null));
}

// ── El archivo, desde Drive ─────────────────────────────────

/** Las planillas de Google hay que exportarlas; un .xlsx se baja tal cual. */
export const MIME_PLANILLA_GOOGLE = "application/vnd.google-apps.spreadsheet";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Con qué URL se baja el archivo.
 *
 * Depende de qué sea, y por eso no hace falta decidir de antemano en qué
 * formato tiene que estar: una planilla de Google se exporta a xlsx, y un
 * .xlsx que alguien subió a Drive se baja directo. Elegir mal devuelve un
 * archivo que después no se puede parsear.
 */
export function urlParaBajar(fileId: string, mimeType: string): string {
  const base = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  return mimeType === MIME_PLANILLA_GOOGLE
    ? `${base}/export?mimeType=${encodeURIComponent(MIME_XLSX)}`
    : `${base}?alt=media`;
}

export function planillaConfigurada(): boolean {
  return hayCredencialesGoogle() && Boolean(process.env.GOOGLE_DRIVE_PROVEEDORES_ID);
}

/**
 * Baja el Excel de proveedores de Drive.
 *
 * Lo lee la misma cuenta de servicio que la planilla de compras y las de
 * mantenimiento, así que hay que compartirle el archivo como a las otras.
 */
export async function bajarPlanillaDeProveedores(): Promise<ArrayBuffer> {
  const fileId = process.env.GOOGLE_DRIVE_PROVEEDORES_ID ?? "";
  if (!fileId) throw new Error("GOOGLE_DRIVE_PROVEEDORES_ID no configurado");

  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const cabeceras = { Authorization: `Bearer ${token}` };

  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name`,
    { headers: cabeceras }
  );
  if (!meta.ok) {
    throw new Error(
      meta.status === 404
        ? "No se encontró el archivo. Revisá el id, y que esté compartido con la cuenta de servicio."
        : `Drive respondió ${meta.status} al buscar el archivo.`
    );
  }
  const { mimeType } = (await meta.json()) as { mimeType: string };

  const res = await fetch(urlParaBajar(fileId, mimeType), { headers: cabeceras });
  if (!res.ok) throw new Error(`No se pudo bajar el archivo: Drive respondió ${res.status}.`);

  return res.arrayBuffer();
}
