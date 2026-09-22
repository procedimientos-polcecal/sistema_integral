/**
 * Las llamadas a un proyecto de Supabase, para la mudanza.
 *
 * Todo lo que toca la red vive acá; lo que se decide con eso vive en
 * `comparar.ts`, que es lo que tiene tests.
 *
 * Tres cosas que no son obvias y que son la razón de que este archivo exista:
 *
 * 1. **PostgREST sólo expone `public`.** `auth.users` no se puede contar por
 *    ahí, y es justamente lo más riesgoso de toda la mudanza. Va por la Auth
 *    Admin API, aparte.
 * 2. **Contar sin traer las filas** se hace con `Prefer: count=exact` y
 *    `Range: 0-0`: el número llega en la cabecera `content-range`.
 * 3. **Listar Storage es recursivo.** `list` devuelve un nivel por llamada.
 */
import type { Conteo } from "./comparar";

export interface Proyecto {
  url: string;
  serviceKey: string;
}

const cabeceras = (p: Proyecto) => ({
  apikey: p.serviceKey,
  Authorization: `Bearer ${p.serviceKey}`,
});

/**
 * Las tablas y vistas que PostgREST expone.
 *
 * Sale del documento OpenAPI de la raíz, que es la única forma de preguntarle
 * "qué hay" sin acceso al catálogo de Postgres.
 */
export async function listarTablas(p: Proyecto): Promise<string[]> {
  const res = await fetch(`${p.url}/rest/v1/`, { headers: cabeceras(p) });
  if (!res.ok) {
    throw new Error(`No se pudo listar las tablas (${res.status}): ${await res.text()}`);
  }
  const doc = await res.json();
  const definiciones = doc.definitions ?? doc.components?.schemas ?? {};
  return Object.keys(definiciones).sort();
}

/**
 * Cuántas filas tiene una tabla, o `null` si no se pudo saber.
 *
 * Devolver `null` en vez de tirar es a propósito: una tabla ilegible tiene que
 * llegar al comparador como "no se pudo contar" —que es un motivo propio— y no
 * cortar el recorrido, así el informe sale completo de una sola pasada. Contar
 * 115 tablas y enterarse de a una por corrida no es un informe.
 */
export async function contarTabla(p: Proyecto, tabla: string): Promise<number | null> {
  try {
    const res = await fetch(`${p.url}/rest/v1/${tabla}?select=*`, {
      headers: { ...cabeceras(p), Prefer: "count=exact", Range: "0-0" },
    });
    if (!res.ok) return null;

    // "0-0/1234", o "*/*" cuando PostgREST no pudo contar.
    const total = res.headers.get("content-range")?.split("/")[1];
    if (!total || total === "*") return null;

    const n = Number(total);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Contar todas las tablas, una por una. */
export async function contarTodo(p: Proyecto): Promise<Conteo[]> {
  const tablas = await listarTablas(p);
  const conteos: Conteo[] = [];
  for (const tabla of tablas) {
    conteos.push({ tabla, filas: await contarTabla(p, tabla) });
  }
  return conteos;
}

/**
 * Cuántos usuarios hay en el esquema `auth`.
 *
 * Es el número que decide si la mudanza sirvió. Se pueden restaurar las 43.000
 * filas y que no entre nadie: `docs/BACKUPS.md` avisa que el dump de `auth`
 * **"no es fatal si falla"**, o sea que existe un camino donde el backup se da
 * por bueno, los datos están todos, y el sistema quedó sin usuarios.
 *
 * Por eso esto sí tira cuando falla, al revés que `contarTabla`: no poder leer
 * los usuarios no es un renglón más del informe.
 */
export async function contarUsuariosAuth(p: Proyecto): Promise<number> {
  const PORPAGINA = 200;
  let total = 0;

  for (let pagina = 1; ; pagina++) {
    const res = await fetch(
      `${p.url}/auth/v1/admin/users?page=${pagina}&per_page=${PORPAGINA}`,
      { headers: cabeceras(p) },
    );
    if (!res.ok) {
      throw new Error(`No se pudo leer auth.users (${res.status}): ${await res.text()}`);
    }

    const { users } = (await res.json()) as { users?: unknown[] };
    if (!users?.length) return total;

    total += users.length;
    if (users.length < PORPAGINA) return total;
  }
}

export interface Objeto {
  ruta: string;
  bytes: number;
}

export interface Bucket {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

export async function listarBuckets(p: Proyecto): Promise<Bucket[]> {
  const res = await fetch(`${p.url}/storage/v1/bucket`, { headers: cabeceras(p) });
  if (!res.ok) {
    throw new Error(`No se pudo listar los buckets (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** El prefijo como lo quiere la API: sin barra al final, vacío para la raíz. */
const sinBarraFinal = (prefijo: string) => prefijo.replace(/\/+$/, "");

/**
 * Todos los objetos de un bucket, entrando en las carpetas.
 *
 * `list` devuelve **un nivel por llamada**: lo que viene con `id: null` es una
 * carpeta y hay que volver a pedirla con el prefijo. Sin la recursión se copian
 * los archivos de la raíz y se pierden los de adentro — que en
 * `execution-photos`, donde cada orden de trabajo tiene su carpeta, son todos.
 */
export async function listarObjetos(
  p: Proyecto,
  bucket: string,
  prefijo = "",
): Promise<Objeto[]> {
  const POR_LOTE = 100;
  const objetos: Objeto[] = [];
  let desde = 0;

  for (;;) {
    const res = await fetch(`${p.url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...cabeceras(p), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: sinBarraFinal(prefijo), limit: POR_LOTE, offset: desde }),
    });
    if (!res.ok) {
      throw new Error(
        `No se pudo listar ${bucket}/${prefijo} (${res.status}): ${await res.text()}`,
      );
    }

    const lote = (await res.json()) as {
      name: string;
      id: string | null;
      metadata?: { size?: number };
    }[];
    if (!lote.length) break;

    for (const item of lote) {
      const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.id === null) objetos.push(...(await listarObjetos(p, bucket, ruta)));
      else objetos.push({ ruta, bytes: item.metadata?.size ?? 0 });
    }

    if (lote.length < POR_LOTE) break;
    desde += lote.length;
  }

  return objetos;
}

export async function bajarObjeto(p: Proyecto, bucket: string, ruta: string): Promise<Blob> {
  const res = await fetch(`${p.url}/storage/v1/object/${bucket}/${ruta}`, {
    headers: cabeceras(p),
  });
  if (!res.ok) {
    throw new Error(`No se pudo bajar ${bucket}/${ruta} (${res.status}): ${await res.text()}`);
  }
  return res.blob();
}

export async function subirObjeto(
  p: Proyecto,
  bucket: string,
  ruta: string,
  cuerpo: Blob,
): Promise<void> {
  const res = await fetch(`${p.url}/storage/v1/object/${bucket}/${ruta}`, {
    method: "POST",
    headers: {
      ...cabeceras(p),
      "Content-Type": cuerpo.type || "application/octet-stream",
      // Sin esto, reintentar una copia a medias falla en todo lo ya subido.
      "x-upsert": "true",
    },
    body: cuerpo,
  });
  if (!res.ok) {
    throw new Error(`No se pudo subir ${bucket}/${ruta} (${res.status}): ${await res.text()}`);
  }
}

/**
 * Crear el bucket en el destino con la misma configuración que el origen.
 *
 * El límite de tamaño y los tipos permitidos viajan a propósito: un bucket
 * nuevo por defecto acepta cualquier cosa, y que el destino sea más permisivo
 * que el origen es una diferencia que nadie va a notar hasta que alguien suba
 * un archivo que no debía entrar.
 */
export async function crearBucket(p: Proyecto, b: Bucket): Promise<void> {
  const res = await fetch(`${p.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...cabeceras(p), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: b.id,
      name: b.id,
      public: b.public,
      file_size_limit: b.file_size_limit,
      allowed_mime_types: b.allowed_mime_types,
    }),
  });
  // 409 = ya existe, que al reintentar una copia a medias es lo normal.
  if (!res.ok && res.status !== 409) {
    throw new Error(`No se pudo crear el bucket ${b.id} (${res.status}): ${await res.text()}`);
  }
}
