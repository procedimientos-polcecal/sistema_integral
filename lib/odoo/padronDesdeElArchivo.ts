/**
 * Qué le cambia al padrón el archivo de proveedores que completó una persona.
 *
 * El 26/11/2026 se exportaron los 311 proveedores sin CUIT a un CSV con dos
 * columnas vacías —CUIT y razón social— y volvió con **166 completadas**. Esto
 * decide qué se escribe de eso y qué no, y el «qué no» es la mitad que importa.
 *
 * ## Por qué no se escriben los 166
 *
 * Medido contra la base el 26/11/2026: de los 166 CUITs completados, **112 ya
 * los tiene otra fila del padrón** —la misma empresa cargada dos veces, una por
 * la planilla de Compras en mayúscula y otra a mano con el CUIT—, y **98 de
 * esas otras filas están enlazadas a Odoo hoy**.
 *
 * Escribirlos igual no conecta nada: `cruzarProveedores()` manda a
 * `cuitRepetidoEnSdG` a todo CUIT que aparezca en dos filas y **no enlaza a
 * ninguna de las dos**. O sea que el archivo, aplicado literal, no sumaría 112
 * proveedores conectados: **desconectaría 98 que hoy funcionan**. Por eso un
 * CUIT que ya tiene otro se informa y no se escribe: lo que esas filas
 * necesitan es que alguien fusione el par, que es una decisión de datos y no
 * una escritura.
 *
 * ## Lo que no se toca nunca
 *
 * **El `nombre`.** El archivo volvió con 18 nombres cambiados y 77 pasados a
 * mayúscula, y `nombre` es con lo que la sincronización de Compras reconoce al
 * proveedor: cambiarlo deja a la planilla sin a quién apuntar y la próxima
 * corrida crea la fila de nuevo. Es el incidente del 14/09/2026, que re-apuntó
 * 1.937 requerimientos. Los cambios se informan para que alguien los mire.
 *
 * La razón social sí se guarda, pero **sólo junto con el CUIT**: es el nombre
 * legal de la empresa que ese CUIT identifica, y escribirla en una fila cuyo
 * CUIT no se pudo afirmar sería ponerle a un registro una identidad que nadie
 * confirmó.
 */

import { cuitEsValido, normalizarCuit } from "@/lib/core/cuit";

/**
 * Parte un CSV en filas y columnas, respetando las comillas.
 *
 * No alcanza con `split(",")`: el archivo volvió de Excel y tres nombres
 * llevan una coma adentro —`FASE 3 DE DIEGO ENRIQUE CORIA,MAXIMILIANO…`— y dos
 * llevan comillas —`BAZAR "LA ESQUINA"`—. Partir por la coma pelada corre las
 * columnas de esas filas una posición, y entonces el CUIT se lee de la columna
 * de al lado: escribiría un CUIT equivocado sin ningún error, que es
 * exactamente lo que este archivo no puede permitirse.
 *
 * El separador se detecta de la primera línea, porque el archivo salió con `;`
 * y volvió con `,`: Excel guarda con el de la configuración regional de quien
 * lo abre, y pedirle a alguien que elija el separador al exportar es pedirle
 * que se acuerde de algo que no tiene por qué saber.
 *
 * Vive acá y no en el núcleo porque es el primero que lo necesita; el lector de
 * los molinos parte por `;` sin comillas y no tiene este problema. Cuando
 * aparezca el segundo, se muda —es el camino que ya hicieron `fechaDeSheets` y
 * `normalizarCuit`—.
 */
export function filasDelCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primera = t.split("\n")[0] ?? "";
  // El que más veces aparezca fuera de comillas en el encabezado. Con empate
  // gana la coma, que es el CSV de manual.
  const sep = (primera.split(";").length > primera.split(",").length ? ";" : ",") as string;

  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      // Dos comillas seguidas adentro de un campo son una comilla literal.
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }

  // Una línea en blanco al final no es una fila.
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

/** Una fila del archivo, ya partida en columnas. */
export interface FilaDelArchivo {
  /** Para poder nombrarla en el informe: la línea del CSV, empezando en 1. */
  linea: number;
  id: string;
  nombre: string;
  cuit: string | null;
  razonSocial: string | null;
}

export interface ProveedorDelPadron {
  id: string;
  nombre: string;
  cuit: string | null;
  razonSocial: string | null;
}

export interface AGuardar {
  proveedorId: string;
  nombre: string;
  cuit: string;
  /** `null` si el archivo no la trajo: el CUIT se guarda igual. */
  razonSocial: string | null;
}

/** Una fila que no se escribe, con el motivo dicho en sus propios términos. */
export interface Rechazada {
  linea: number;
  nombre: string;
  cuit: string;
  /** Las otras filas que ya tienen ese CUIT: del padrón, del archivo, o las dos. */
  otras: { id: string; nombre: string }[];
}

export interface Informe {
  aGuardar: AGuardar[];
  /** El proveedor ya tenía ese mismo CUIT: no hay nada que hacer. */
  yaLoTenia: { linea: number; nombre: string; cuit: string }[];
  /** El CUIT lo tiene otra fila. El par hay que fusionarlo, no escribirlo. */
  cuitDeOtro: Rechazada[];
  /** El dígito verificador no cierra: casi siempre es un dígito mal tipeado. */
  cuitInvalido: { linea: number; nombre: string; cuit: string }[];
  /** La fila no trae id. No se adivina por nombre: se informa. */
  sinId: { linea: number; nombre: string; cuit: string | null }[];
  /** El id no está en el padrón (fila borrada desde que se exportó). */
  noEstaEnElPadron: { linea: number; id: string; nombre: string }[];
  /** El nombre del archivo no es el de la base. No se escribe; se informa. */
  nombreCambiado: { linea: number; id: string; enLaBase: string; enElArchivo: string }[];
}

/** El nombre listo para comparar: sin mayúsculas, acentos, puntos ni comillas. */
function claveDelNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["'.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qué se escribe y qué se informa.
 *
 * El orden de los rechazos importa y es el de la pregunta que contesta cada
 * uno: primero si la fila se puede ubicar (`sinId`, `noEstaEnElPadron`),
 * después si el CUIT es un CUIT (`cuitInvalido`), y recién al final si está
 * libre (`yaLoTenia`, `cuitDeOtro`). Decir «ese CUIT lo tiene otro» sobre una
 * fila que ni siquiera existe manda a buscar al lugar equivocado.
 *
 * Un CUIT repetido **dentro del archivo** sale por `cuitDeOtro` igual que si el
 * duplicado estuviera en la base: para quien lo lee son el mismo problema —la
 * misma empresa en dos filas— y separarlos obligaría a leer dos listas para
 * entender un solo par.
 */
export function loQueCambiaElArchivo(
  filas: readonly FilaDelArchivo[],
  padron: readonly ProveedorDelPadron[]
): Informe {
  const porId = new Map(padron.map((p) => [p.id.toLowerCase(), p]));

  const informe: Informe = {
    aGuardar: [],
    yaLoTenia: [],
    cuitDeOtro: [],
    cuitInvalido: [],
    sinId: [],
    noEstaEnElPadron: [],
    nombreCambiado: [],
  };

  // Quién tiene cada CUIT: el padrón de hoy, más las propias filas del archivo.
  // Las dos fuentes van al mismo índice porque el choque es el mismo hecho.
  const duenos = new Map<string, { id: string; nombre: string }[]>();
  const anotar = (cuit: string, quien: { id: string; nombre: string }) => {
    if (!duenos.has(cuit)) duenos.set(cuit, []);
    duenos.get(cuit)!.push(quien);
  };
  for (const p of padron) {
    const c = normalizarCuit(p.cuit);
    if (c) anotar(c, { id: p.id, nombre: p.nombre });
  }
  for (const f of filas) {
    const c = normalizarCuit(f.cuit);
    const enLaBase = porId.get(f.id.trim().toLowerCase());
    // Una fila del archivo cuyo proveedor ya tiene el CUIT en la base ya quedó
    // anotada arriba: anotarla de nuevo la volvería su propia duplicada.
    if (c && f.id.trim() && enLaBase && !normalizarCuit(enLaBase.cuit)) {
      anotar(c, { id: enLaBase.id, nombre: enLaBase.nombre });
    }
  }

  for (const fila of filas) {
    const id = fila.id.trim();
    const cuit = normalizarCuit(fila.cuit);

    if (!id) {
      informe.sinId.push({ linea: fila.linea, nombre: fila.nombre, cuit });
      continue;
    }

    const enLaBase = porId.get(id.toLowerCase());
    if (!enLaBase) {
      informe.noEstaEnElPadron.push({ linea: fila.linea, id, nombre: fila.nombre });
      continue;
    }

    if (claveDelNombre(enLaBase.nombre) !== claveDelNombre(fila.nombre)) {
      informe.nombreCambiado.push({
        linea: fila.linea,
        id: enLaBase.id,
        enLaBase: enLaBase.nombre,
        enElArchivo: fila.nombre,
      });
    }

    // Una fila sin CUIT no es un error: son las que la persona dejó en blanco
    // porque no lo sabía, y dejarlas en blanco era lo pedido.
    if (!cuit) continue;

    if (!cuitEsValido(cuit)) {
      informe.cuitInvalido.push({ linea: fila.linea, nombre: fila.nombre, cuit });
      continue;
    }

    if (normalizarCuit(enLaBase.cuit) === cuit) {
      informe.yaLoTenia.push({ linea: fila.linea, nombre: fila.nombre, cuit });
      continue;
    }

    const otras = (duenos.get(cuit) ?? []).filter((d) => d.id.toLowerCase() !== id.toLowerCase());
    if (otras.length) {
      informe.cuitDeOtro.push({ linea: fila.linea, nombre: fila.nombre, cuit, otras });
      continue;
    }

    informe.aGuardar.push({
      proveedorId: enLaBase.id,
      nombre: enLaBase.nombre,
      cuit,
      razonSocial: fila.razonSocial?.trim() || null,
    });
  }

  return informe;
}
