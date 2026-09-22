# Mudanza a San Pablo — Plan de implementación

> **Para quien ejecute esto:** los pasos usan checkbox (`- [ ]`). Las Fases B y C
> **no son código**: son una operación sobre producción, con una ventana
> nocturna y una persona mirando. No se automatizan enteras a propósito.

**Objetivo:** mover la app (Vercel `iad1` → `gru1`) y la base (Supabase
`us-east-1` → `sa-east-1`) a San Pablo, **juntas**, sin perder datos ni
usuarios.

**Arquitectura:** no cambia el código de la app. Se crea un proyecto Supabase
nuevo en `sa-east-1`, se le restaura el dump que el backup nocturno ya produce,
se copian los dos buckets de Storage aparte, se verifica contando, y recién
entonces se apuntan cuatro variables de entorno y la región de Vercel.

**Stack:** Node + `tsx` para los scripts, `vitest` para la lógica pura, la API
REST de Supabase (PostgREST, Storage y Auth Admin), CLI de Vercel y `gh`.

**Spec:** [2026-09-22-mudanza-a-san-pablo-design.md](../specs/2026-09-22-mudanza-a-san-pablo-design.md)

---

## Cómo se divide

| Fase | Qué | ¿Se puede hacer ahora? |
|---|---|---|
| **A** | La herramienta: contar, comparar, copiar buckets, medir | **Sí.** No toca producción. |
| **B** | El ensayo en un proyecto descartable | Necesita que alguien **cree el proyecto** en Supabase |
| **C** | La ventana real | Necesita B verde y una noche |

La Fase A se hace entera antes de pedir nada. Cuando llegue el proyecto de
prueba, B es correr lo de A apuntando a otro lado.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `scripts/mudanza/comparar.ts` | **Puro.** Comparar dos conteos y decir qué está mal. Es lo que se testea. |
| `scripts/mudanza/comparar.test.ts` | Los tests de lo anterior |
| `scripts/mudanza/supabase.ts` | **I/O.** Las llamadas a PostgREST, Storage y Auth Admin |
| `scripts/mudanza/contar.mts` | Comando: contar un proyecto y escribir un JSON |
| `scripts/mudanza/verificar.mts` | Comando: comparar dos JSON y salir con código ≠ 0 si algo no cuadra |
| `scripts/mudanza/copiar-buckets.mts` | Comando: copiar los objetos de Storage de un proyecto a otro |
| `scripts/mudanza/medir.mts` | Comando: medir latencia, para el antes y el después |

El corte puro/IO es el del repo: `comparar.ts` es a `supabase.ts` lo que
`lib/compras/seguimiento.ts` es a `seguimientoSheets.ts`.

---

# FASE A — La herramienta

### Task 1: Comparar conteos (lo puro)

**Archivos:**
- Crear: `scripts/mudanza/comparar.ts`
- Test: `scripts/mudanza/comparar.test.ts`

- [ ] **Paso 1: Escribir el test que falla**

La regla que importa es la del `null`: **no poder contar una tabla no es contar
cero.** Si el script trata un fallo de lectura como cero, una tabla que no
viajó y una tabla que no se pudo leer se ven igual, y una de las dos es una
pérdida de datos silenciosa. Es la misma regla que el resto del repo aplica a
los enlaces por nombre.

```ts
// scripts/mudanza/comparar.test.ts
import { describe, it, expect } from "vitest";
import { compararConteos } from "./comparar";

describe("compararConteos", () => {
  it("no dice nada cuando los dos lados coinciden", () => {
    const a = [{ tabla: "usuarios", filas: 11 }];
    expect(compararConteos(a, a)).toEqual([]);
  });

  it("marca la tabla que tiene menos filas en el destino", () => {
    const d = compararConteos(
      [{ tabla: "fichadas", filas: 3962 }],
      [{ tabla: "fichadas", filas: 3900 }],
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ tabla: "fichadas", origen: 3962, destino: 3900 });
    expect(d[0].motivo).toBe("faltan filas");
  });

  it("marca la tabla que existe en el origen y no en el destino", () => {
    const d = compararConteos([{ tabla: "avisos", filas: 152 }], []);
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("no existe en el destino");
  });

  it("marca la tabla que no se pudo contar, y NO la trata como cero", () => {
    const d = compararConteos(
      [{ tabla: "jornadas", filas: null }],
      [{ tabla: "jornadas", filas: 6 }],
    );
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("no se pudo contar");
  });

  it("marca la tabla vacia en el destino como faltante, no como incontable", () => {
    const d = compararConteos(
      [{ tabla: "productos", filas: 40 }],
      [{ tabla: "productos", filas: 0 }],
    );
    expect(d[0].motivo).toBe("faltan filas");
  });

  it("avisa de una tabla que sobra en el destino, sin que sea fatal", () => {
    const d = compararConteos([], [{ tabla: "colada", filas: 3 }]);
    expect(d).toHaveLength(1);
    expect(d[0].motivo).toBe("sobra en el destino");
    expect(d[0].fatal).toBe(false);
  });

  it("una tabla con mas filas en el destino tampoco es fatal", () => {
    // Pasa si alguien cargo algo despues del dump: hay que verlo, pero no
    // significa que se haya perdido nada.
    const d = compararConteos(
      [{ tabla: "avisos", filas: 152 }],
      [{ tabla: "avisos", filas: 153 }],
    );
    expect(d[0].motivo).toBe("sobran filas");
    expect(d[0].fatal).toBe(false);
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

```bash
npx vitest run scripts/mudanza/comparar.test.ts
```

Esperado: FAIL, `Failed to resolve import "./comparar"`.

- [ ] **Paso 3: Escribir la implementación mínima**

```ts
// scripts/mudanza/comparar.ts
/**
 * Comparar el conteo de dos proyectos: lo puro.
 *
 * Es lo unico de la mudanza que se puede testear sin una base al lado, asi que
 * es donde vive la decision de que cuenta como "esta mal".
 */

/** Lo que se pudo contar de una tabla. `null` = no se pudo leer. */
export interface Conteo {
  tabla: string;
  filas: number | null;
}

export interface Diferencia {
  tabla: string;
  origen: number | null;
  destino: number | null;
  motivo: string;
  /** Si es `true`, no se sigue con la mudanza. */
  fatal: boolean;
}

/**
 * Que esta mal entre dos conteos.
 *
 * `null` NO es cero. Una tabla que no se pudo leer y una tabla que quedo vacia
 * son dos cosas distintas, y tratarlas igual convierte una perdida de datos en
 * un renglon mas de la lista. Por eso `null` tiene su propio motivo y es fatal:
 * obliga a ir a mirar.
 */
export function compararConteos(origen: Conteo[], destino: Conteo[]): Diferencia[] {
  const enDestino = new Map(destino.map((c) => [c.tabla, c.filas]));
  const diferencias: Diferencia[] = [];

  for (const { tabla, filas } of origen) {
    const otro = enDestino.has(tabla) ? enDestino.get(tabla)! : undefined;

    if (otro === undefined) {
      diferencias.push({ tabla, origen: filas, destino: null, motivo: "no existe en el destino", fatal: true });
      continue;
    }
    if (filas === null || otro === null) {
      diferencias.push({ tabla, origen: filas, destino: otro, motivo: "no se pudo contar", fatal: true });
      continue;
    }
    if (otro < filas) {
      diferencias.push({ tabla, origen: filas, destino: otro, motivo: "faltan filas", fatal: true });
      continue;
    }
    if (otro > filas) {
      diferencias.push({ tabla, origen: filas, destino: otro, motivo: "sobran filas", fatal: false });
    }
  }

  const enOrigen = new Set(origen.map((c) => c.tabla));
  for (const { tabla, filas } of destino) {
    if (!enOrigen.has(tabla)) {
      diferencias.push({ tabla, origen: null, destino: filas, motivo: "sobra en el destino", fatal: false });
    }
  }

  return diferencias;
}

/** Si alguna diferencia impide seguir. */
export const hayAlgoFatal = (d: Diferencia[]) => d.some((x) => x.fatal);
```

- [ ] **Paso 4: Correr los tests y ver que pasan**

```bash
npx vitest run scripts/mudanza/comparar.test.ts
```

Esperado: 7 passed.

- [ ] **Paso 5: Commit**

```bash
git add scripts/mudanza/comparar.ts scripts/mudanza/comparar.test.ts
git commit -m "feat(mudanza): comparador de conteos, con null distinto de cero"
```

---

### Task 2: Hablar con Supabase (el I/O)

**Archivos:**
- Crear: `scripts/mudanza/supabase.ts`

- [ ] **Paso 1: Escribir el módulo**

Tres cosas que no son obvias y por las que este archivo existe:

1. **PostgREST sólo expone `public`.** `auth.users` no se puede contar por ahí,
   y es justamente lo más riesgoso de la mudanza. Va por la Auth Admin API.
2. **El conteo va con `Prefer: count=exact` y `Range: 0-0`**, que trae el número
   en `content-range` sin traer las filas.
3. **Listar Storage es recursivo.** `list` devuelve una carpeta por vez.

```ts
// scripts/mudanza/supabase.ts
/**
 * Las llamadas a un proyecto de Supabase, para la mudanza.
 *
 * Todo lo que toca la red vive aca; lo que se decide con eso vive en
 * `comparar.ts`, que es lo que tiene tests.
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
 * Sale del documento OpenAPI de la raiz, que es la unica forma de preguntarle
 * "que hay" sin acceso al catalogo de Postgres.
 */
export async function listarTablas(p: Proyecto): Promise<string[]> {
  const res = await fetch(`${p.url}/rest/v1/`, { headers: cabeceras(p) });
  if (!res.ok) throw new Error(`No se pudo listar las tablas (${res.status}): ${await res.text()}`);
  const doc = await res.json();
  const defs = doc.definitions ?? doc.components?.schemas ?? {};
  return Object.keys(defs).sort();
}

/**
 * Cuantas filas tiene una tabla, o `null` si no se pudo saber.
 *
 * Devolver `null` en vez de tirar es a proposito: una tabla ilegible tiene que
 * llegar al comparador como "no se pudo contar" y no cortar el recorrido, asi
 * el informe sale completo de una sola pasada.
 */
export async function contarTabla(p: Proyecto, tabla: string): Promise<number | null> {
  try {
    const res = await fetch(`${p.url}/rest/v1/${tabla}?select=*`, {
      headers: { ...cabeceras(p), Prefer: "count=exact", Range: "0-0" },
    });
    if (!res.ok) return null;
    const rango = res.headers.get("content-range");       // "0-0/1234"
    const total = rango?.split("/")[1];
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
 * Cuantos usuarios hay en `auth`.
 *
 * Es el numero que decide si la mudanza sirvio: se pueden restaurar las 43.000
 * filas y que no entre nadie. `docs/BACKUPS.md` avisa que el dump de `auth`
 * "no es fatal si falla", o sea que hay un camino donde el backup se da por
 * bueno sin usuarios adentro.
 */
export async function contarUsuariosAuth(p: Proyecto): Promise<number> {
  let total = 0;
  for (let pagina = 1; ; pagina++) {
    const res = await fetch(`${p.url}/auth/v1/admin/users?page=${pagina}&per_page=200`, {
      headers: cabeceras(p),
    });
    if (!res.ok) throw new Error(`No se pudo leer auth.users (${res.status}): ${await res.text()}`);
    const { users } = await res.json();
    if (!users?.length) return total;
    total += users.length;
    if (users.length < 200) return total;
  }
}

export interface Objeto {
  ruta: string;
  bytes: number;
}

export async function listarBuckets(p: Proyecto) {
  const res = await fetch(`${p.url}/storage/v1/bucket`, { headers: cabeceras(p) });
  if (!res.ok) throw new Error(`No se pudo listar los buckets (${res.status}): ${await res.text()}`);
  return (await res.json()) as {
    id: string; name: string; public: boolean;
    file_size_limit: number | null; allowed_mime_types: string[] | null;
  }[];
}

/**
 * Todos los objetos de un bucket, entrando en las carpetas.
 *
 * `list` devuelve un nivel por llamada: lo que tiene `id: null` es una carpeta
 * y hay que volver a pedirla con el prefijo. Sin la recursion se copian los
 * archivos de la raiz y se pierden los de adentro, que en `execution-photos`
 * son todos.
 */
export async function listarObjetos(p: Proyecto, bucket: string, prefijo = ""): Promise<Objeto[]> {
  const objetos: Objeto[] = [];
  let offset = 0;

  for (;;) {
    const res = await fetch(`${p.url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...cabeceras(p), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: prejo(prefijo), limit: 100, offset }),
    });
    if (!res.ok) throw new Error(`No se pudo listar ${bucket}/${prefijo} (${res.status}): ${await res.text()}`);
    const lote = (await res.json()) as { name: string; id: string | null; metadata?: { size?: number } }[];
    if (!lote.length) break;

    for (const item of lote) {
      const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.id === null) objetos.push(...(await listarObjetos(p, bucket, ruta)));
      else objetos.push({ ruta, bytes: item.metadata?.size ?? 0 });
    }

    if (lote.length < 100) break;
    offset += lote.length;
  }

  return objetos;
}

/** El prefijo como lo quiere la API: sin barra al final, vacio para la raiz. */
const prejo = (p: string) => p.replace(/\/+$/, "");

export async function bajarObjeto(p: Proyecto, bucket: string, ruta: string): Promise<Blob> {
  const res = await fetch(`${p.url}/storage/v1/object/${bucket}/${ruta}`, { headers: cabeceras(p) });
  if (!res.ok) throw new Error(`No se pudo bajar ${bucket}/${ruta} (${res.status}): ${await res.text()}`);
  return res.blob();
}

export async function subirObjeto(p: Proyecto, bucket: string, ruta: string, cuerpo: Blob) {
  const res = await fetch(`${p.url}/storage/v1/object/${bucket}/${ruta}`, {
    method: "POST",
    headers: { ...cabeceras(p), "Content-Type": cuerpo.type || "application/octet-stream", "x-upsert": "true" },
    body: cuerpo,
  });
  if (!res.ok) throw new Error(`No se pudo subir ${bucket}/${ruta} (${res.status}): ${await res.text()}`);
}

export async function crearBucket(
  p: Proyecto,
  b: { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null },
) {
  const res = await fetch(`${p.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...cabeceras(p), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: b.id, name: b.id, public: b.public,
      file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types,
    }),
  });
  // 409 = ya existe, que en una copia que se reintenta es lo normal.
  if (!res.ok && res.status !== 409) {
    throw new Error(`No se pudo crear el bucket ${b.id} (${res.status}): ${await res.text()}`);
  }
}
```

- [ ] **Paso 2: Comprobar que compila**

```bash
npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Paso 3: Commit**

```bash
git add scripts/mudanza/supabase.ts
git commit -m "feat(mudanza): lectura de PostgREST, Storage y auth de un proyecto"
```

---

### Task 3: El comando que cuenta

**Archivos:**
- Crear: `scripts/mudanza/contar.mts`

- [ ] **Paso 1: Escribir el comando**

```ts
// scripts/mudanza/contar.mts
/**
 * Contar un proyecto entero y dejarlo en un JSON.
 *
 * Se corre dos veces: contra el proyecto viejo antes del dump (la linea de
 * base) y contra el nuevo despues del restore. `verificar.mts` compara los dos
 * archivos.
 *
 *   npx tsx --env-file=.env.local scripts/mudanza/contar.mts antes.json
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx scripts/mudanza/contar.mts despues.json
 */
import { writeFileSync } from "node:fs";
import { contarTodo, contarUsuariosAuth, listarBuckets, listarObjetos } from "./supabase";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const salida = process.argv[2];

if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y SUPABASE_KEY (o las del .env.local).");
  process.exit(1);
}
if (!salida) {
  console.error("Falta el archivo de salida: contar.mts <archivo.json>");
  process.exit(1);
}

const proyecto = { url, serviceKey };

console.log(`Contando ${url}`);
const tablas = await contarTodo(proyecto);
const sinPoderContar = tablas.filter((t) => t.filas === null);
const filas = tablas.reduce((a, t) => a + (t.filas ?? 0), 0);

const usuarios = await contarUsuariosAuth(proyecto);

const buckets = [];
for (const b of await listarBuckets(proyecto)) {
  const objetos = await listarObjetos(proyecto, b.id);
  buckets.push({
    id: b.id, public: b.public,
    file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types,
    objetos: objetos.length,
    bytes: objetos.reduce((a, o) => a + o.bytes, 0),
  });
}

const informe = { url, fecha: new Date().toISOString(), tablas, usuarios, buckets };
writeFileSync(salida, JSON.stringify(informe, null, 2));

console.log(`  ${tablas.length} tablas, ${filas.toLocaleString("es-AR")} filas`);
console.log(`  ${usuarios} usuarios en auth`);
for (const b of buckets) {
  console.log(`  bucket ${b.id}: ${b.objetos} objetos, ${(b.bytes / 1024 / 1024).toFixed(1)} MB`);
}
if (sinPoderContar.length) {
  console.log(`  OJO: ${sinPoderContar.length} sin poder contar: ${sinPoderContar.map((t) => t.tabla).join(", ")}`);
}
console.log(`Escrito en ${salida}`);
```

- [ ] **Paso 2: Correrlo contra el proyecto de hoy, que es la línea de base**

```bash
npx tsx --env-file=.env.local scripts/mudanza/contar.mts docs/mudanza-antes.json
```

Esperado: ~115 tablas, 11 usuarios en auth, y los dos buckets con sus objetos.
**Si dice 0 usuarios, parar**: la Auth Admin API no está contestando y sin ese
número la mudanza no se puede verificar.

- [ ] **Paso 3: Commit**

```bash
git add scripts/mudanza/contar.mts docs/mudanza-antes.json
git commit -m "feat(mudanza): comando que cuenta un proyecto, y la linea de base de hoy"
```

---

### Task 4: El comando que verifica

**Archivos:**
- Crear: `scripts/mudanza/verificar.mts`

- [ ] **Paso 1: Escribir el comando**

Sale con código ≠ 0 si hay algo fatal, para que no se pueda "seguir igual" sin
querer.

```ts
// scripts/mudanza/verificar.mts
/**
 * Comparar dos informes de `contar.mts` y decir si se puede seguir.
 *
 *   npx tsx scripts/mudanza/verificar.mts docs/mudanza-antes.json despues.json
 *
 * Sale con codigo 1 si falta algo. Es a proposito: en la ventana, a las once de
 * la noche, "salio un texto largo" y "salio mal" se confunden.
 */
import { readFileSync } from "node:fs";
import { compararConteos, hayAlgoFatal, type Conteo } from "./comparar";

interface Informe {
  url: string;
  tablas: Conteo[];
  usuarios: number;
  buckets: { id: string; objetos: number; bytes: number }[];
}

const [rutaAntes, rutaDespues] = process.argv.slice(2);
if (!rutaAntes || !rutaDespues) {
  console.error("Uso: verificar.mts <antes.json> <despues.json>");
  process.exit(1);
}

const antes: Informe = JSON.parse(readFileSync(rutaAntes, "utf8"));
const despues: Informe = JSON.parse(readFileSync(rutaDespues, "utf8"));

const diferencias = compararConteos(antes.tablas, despues.tablas);
let mal = hayAlgoFatal(diferencias);

console.log(`Origen : ${antes.url}`);
console.log(`Destino: ${despues.url}`);
console.log();

if (!diferencias.length) {
  console.log(`OK  las ${antes.tablas.length} tablas coinciden`);
} else {
  for (const d of diferencias) {
    const marca = d.fatal ? "MAL " : "aviso";
    console.log(`${marca} ${d.tabla}: ${d.motivo} (origen ${d.origen ?? "?"}, destino ${d.destino ?? "?"})`);
  }
}

console.log();
if (despues.usuarios < antes.usuarios) {
  console.log(`MAL  usuarios de auth: habia ${antes.usuarios}, hay ${despues.usuarios}. Sin esto no entra nadie.`);
  mal = true;
} else {
  console.log(`OK  usuarios de auth: ${despues.usuarios}`);
}

for (const b of antes.buckets) {
  const otro = despues.buckets.find((x) => x.id === b.id);
  if (!otro) {
    console.log(`MAL  bucket ${b.id}: no existe en el destino`);
    mal = true;
  } else if (otro.objetos < b.objetos) {
    console.log(`MAL  bucket ${b.id}: habia ${b.objetos} objetos, hay ${otro.objetos}`);
    mal = true;
  } else {
    console.log(`OK  bucket ${b.id}: ${otro.objetos} objetos`);
  }
}

console.log();
console.log(mal ? "NO se puede seguir." : "Se puede seguir.");
process.exit(mal ? 1 : 0);
```

- [ ] **Paso 2: Probarlo contra sí mismo, que tiene que dar verde**

```bash
npx tsx scripts/mudanza/verificar.mts docs/mudanza-antes.json docs/mudanza-antes.json
```

Esperado: todo OK, "Se puede seguir.", código de salida 0.

- [ ] **Paso 3: Commit**

```bash
git add scripts/mudanza/verificar.mts
git commit -m "feat(mudanza): verificador que sale con error si falta algo"
```

---

### Task 5: Copiar los buckets

**Archivos:**
- Crear: `scripts/mudanza/copiar-buckets.mts`

- [ ] **Paso 1: Escribir el comando**

```ts
// scripts/mudanza/copiar-buckets.mts
/**
 * Copiar los objetos de Storage de un proyecto a otro.
 *
 * Hace falta porque `pg_dump` NO se lleva los archivos: la base queda perfecta
 * y las fotos de mantenimiento y los PDF de facturas apuntan a un bucket vacio.
 * No se nota hasta que alguien abre una orden vieja.
 *
 *   ORIGEN_URL=... ORIGEN_KEY=... DESTINO_URL=... DESTINO_KEY=... \
 *     npx tsx scripts/mudanza/copiar-buckets.mts [--listar]
 *
 * Con `--listar` no copia nada: solo dice que hay. Sirve para medir antes de la
 * ventana.
 */
import { listarBuckets, listarObjetos, bajarObjeto, subirObjeto, crearBucket } from "./supabase";

const origen = { url: process.env.ORIGEN_URL!, serviceKey: process.env.ORIGEN_KEY! };
const soloListar = process.argv.includes("--listar");

if (!origen.url || !origen.serviceKey) {
  console.error("Faltan ORIGEN_URL y ORIGEN_KEY.");
  process.exit(1);
}

const destino = soloListar ? null : { url: process.env.DESTINO_URL!, serviceKey: process.env.DESTINO_KEY! };
if (destino && (!destino.url || !destino.serviceKey)) {
  console.error("Faltan DESTINO_URL y DESTINO_KEY (o corre con --listar).");
  process.exit(1);
}

for (const b of await listarBuckets(origen)) {
  const objetos = await listarObjetos(origen, b.id);
  const mb = (objetos.reduce((a, o) => a + o.bytes, 0) / 1024 / 1024).toFixed(1);
  console.log(`\n${b.id}: ${objetos.length} objetos, ${mb} MB${b.public ? " (publico)" : " (privado)"}`);

  if (soloListar) continue;

  await crearBucket(destino!, b);

  let copiados = 0;
  const fallados: { ruta: string; error: string }[] = [];

  for (const o of objetos) {
    try {
      await subirObjeto(destino!, b.id, o.ruta, await bajarObjeto(origen, b.id, o.ruta));
      copiados++;
      if (copiados % 25 === 0) console.log(`  ${copiados}/${objetos.length}`);
    } catch (e) {
      // Se anota y se sigue: un archivo roto no puede dejar sin copiar a los
      // otros trescientos, y la lista del final es lo que se mira.
      fallados.push({ ruta: o.ruta, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`  copiados ${copiados}/${objetos.length}`);
  if (fallados.length) {
    console.log(`  FALLARON ${fallados.length}:`);
    for (const f of fallados) console.log(`    ${f.ruta}: ${f.error}`);
    process.exitCode = 1;
  }
}
```

- [ ] **Paso 2: Correrlo en modo `--listar` contra producción, que no escribe nada**

```bash
ORIGEN_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2-) \
ORIGEN_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-) \
npx tsx scripts/mudanza/copiar-buckets.mts --listar
```

Esperado: los dos buckets con su cantidad de objetos y su tamaño. Ese número es
lo que hay que copiar en la ventana, y lo que dice cuánto va a tardar.

- [ ] **Paso 3: Commit**

```bash
git add scripts/mudanza/copiar-buckets.mts
git commit -m "feat(mudanza): copiar los objetos de Storage, que el dump no se lleva"
```

---

### Task 6: Medir el antes y el después

**Archivos:**
- Crear: `scripts/mudanza/medir.mts`

- [ ] **Paso 1: Escribir el comando**

```ts
// scripts/mudanza/medir.mts
/**
 * Medir la latencia contra la app y contra la base.
 *
 * Se corre antes de la mudanza y despues. Si el "despues" no bajo, la mudanza
 * no sirvio y hay que decirlo con un numero, no con una sensacion.
 *
 *   npx tsx --env-file=.env.local scripts/mudanza/medir.mts
 */
const VUELTAS = 7;

async function medir(nombre: string, url: string, headers: Record<string, string> = {}) {
  const tiempos: number[] = [];
  for (let i = 0; i < VUELTAS; i++) {
    const t = performance.now();
    try {
      await fetch(url, { headers, cache: "no-store" });
      tiempos.push(performance.now() - t);
    } catch {
      /* una vuelta perdida no invalida la medicion */
    }
  }
  if (!tiempos.length) return console.log(`${nombre}: no contesto`);

  tiempos.sort((a, b) => a - b);
  const mediana = tiempos[Math.floor(tiempos.length / 2)];
  console.log(
    `${nombre.padEnd(22)} mediana ${mediana.toFixed(0).padStart(4)} ms` +
      `  (min ${tiempos[0].toFixed(0)}, max ${tiempos[tiempos.length - 1].toFixed(0)})`,
  );
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://sistema-integral-one.vercel.app";

console.log(`${new Date().toISOString()}\n`);
await medir("app", app);
await medir("base (1 fila)", `${url}/rest/v1/usuarios?select=id&limit=1`, { apikey: key, Authorization: `Bearer ${key}` });
```

- [ ] **Paso 2: Correrlo y guardar el número de hoy**

```bash
npx tsx --env-file=.env.local scripts/mudanza/medir.mts
```

Esperado: app ~190 ms, base ~290 ms desde Argentina. Es el "antes".

- [ ] **Paso 3: Commit**

```bash
git add scripts/mudanza/medir.mts
git commit -m "feat(mudanza): medidor de latencia para el antes y el despues"
```

---

### Task 7: Cerrar la Fase A

- [ ] **Paso 1: Verificación completa**

```bash
npm test
npx tsc --noEmit
node scripts/revisar-arbol-commiteado.mjs
```

Los tres tienen que pasar. El tercero es el que atrapa un archivo nuevo que
quedó *staged* y nunca se commiteó.

- [ ] **Paso 2: Push**

```bash
git push origin main
```

---

# FASE B — El ensayo

**Bloqueada: hace falta que una persona cree el proyecto de prueba.** Un agente
no puede: no hay credenciales del dashboard de Supabase y crear proyectos cuesta
plata.

- [ ] **B1.** Crear en Supabase un proyecto nuevo, **región South America (São
      Paulo)**, nombre `sdg-ensayo`. Anotar URL, `anon key`, `service_role key`
      y la cadena del **Session pooler** (puerto 5432, no la directa ni la 6543).
- [ ] **B2.** Bajar de Drive el `.tar.gz` de la última noche y descomprimirlo
      (si tiene `BACKUP_PASSPHRASE`, desencriptarlo con GPG).
- [ ] **B3.** Restaurar en orden: `-esquema.sql`, `-datos.sql`, `-roles.sql` (si
      está) y `-usuarios.sql`. **El de usuarios es el que puede faltar**: si el
      backup no lo trae, el ensayo ya falló y hay que resolver eso antes de
      pensar en la ventana.
- [ ] **B4.** Contar el ensayo:
      ```bash
      SUPABASE_URL=<url-ensayo> SUPABASE_KEY=<service-key-ensayo> \
        npx tsx scripts/mudanza/contar.mts docs/mudanza-ensayo.json
      ```
- [ ] **B5.** Verificar:
      ```bash
      npx tsx scripts/mudanza/verificar.mts docs/mudanza-antes.json docs/mudanza-ensayo.json
      ```
      Tiene que salir con código 0. Los usuarios de `auth` son el renglón que
      hay que mirar dos veces.
- [ ] **B6.** Copiar los buckets al ensayo y volver a verificar.
- [ ] **B7.** **Entrar con un usuario real.** Levantar la app en local apuntando
      al ensayo y hacer login con mail y contraseña de verdad — no con la
      service role key, que siempre anda.
- [ ] **B8.** Anotar **cuánto tardó cada paso**. Eso fija el largo de la ventana.
- [ ] **B9.** Borrar el proyecto de ensayo.

---

# FASE C — La ventana

**Bloqueada por B, y por una noche de 22:00 a 02:00 ART.** No se automatiza: hay
que mirar cada paso.

- [ ] **C1. Avisar** a la gente que entre tal y tal hora no se carga nada.
- [ ] **C2. Congelar.** Son tres cosas, no una:
      ```bash
      gh workflow disable compras-sync.yml
      gh workflow disable inventario-sync.yml
      gh workflow disable mantenimiento-sync.yml
      gh workflow disable rrhh-recalculo.yml
      gh workflow disable backup.yml
      ```
      Y sacar los 6 crons de `vercel.json` (o pausarlos en el dashboard).
      **Esto es lo que más fácil se olvida y lo que más caro sale**: los tres
      primeros corren cada 15 minutos y escribirían en la base vieja después del
      dump, en verde, sin que nada avise.
- [ ] **C3. Contar de nuevo**, ya congelado — el `docs/mudanza-antes.json` de la
      Fase A quedó viejo:
      ```bash
      npx tsx --env-file=.env.local scripts/mudanza/contar.mts docs/mudanza-antes.json
      ```
- [ ] **C4. Dump** con los mismos cuatro comandos del backup nocturno, o
      disparando el workflow a mano:
      ```bash
      gh workflow enable backup.yml && gh workflow run backup.yml
      ```
      (y volver a deshabilitarlo cuando termine).
- [ ] **C5. Crear el proyecto definitivo** en São Paulo y restaurarle el dump,
      igual que en B3.
- [ ] **C6. Copiar los buckets:**
      ```bash
      ORIGEN_URL=<vieja> ORIGEN_KEY=<vieja> DESTINO_URL=<nueva> DESTINO_KEY=<nueva> \
        npx tsx scripts/mudanza/copiar-buckets.mts
      ```
- [ ] **C7. Verificar. Antes de apuntar nada:**
      ```bash
      SUPABASE_URL=<nueva> SUPABASE_KEY=<nueva> npx tsx scripts/mudanza/contar.mts docs/mudanza-despues.json
      npx tsx scripts/mudanza/verificar.mts docs/mudanza-antes.json docs/mudanza-despues.json
      ```
      **Si sale distinto de 0, se para acá.** No se apunta nada. Volver es no
      haber hecho nada todavía.
- [ ] **C8. Apuntar.** Las dos cosas en la misma tanda, porque separadas son el
      peor de los mundos:
      ```bash
      vercel env rm NEXT_PUBLIC_SUPABASE_URL production
      vercel env add NEXT_PUBLIC_SUPABASE_URL production
      # idem NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
      ```
      Y en `vercel.json`, `"regions": ["gru1"]`.
- [ ] **C9. Actualizar `SUPABASE_DB_URL`** en los secrets del repo, con el
      **Session pooler** del proyecto nuevo:
      ```bash
      gh secret set SUPABASE_DB_URL
      ```
- [ ] **C10. Desplegar:**
      ```bash
      vercel deploy --prod
      ```
- [ ] **C11. Ejercitar la operación final.** Que la app levante no es verificar:
      - Entrar con un usuario real.
      - Cargar algo y ver que quedó.
      - Abrir una foto de mantenimiento vieja y una factura vieja.
      - Disparar **un** sync a mano y ver dónde escribió.
      - ```bash
        npx tsx --env-file=.env.local scripts/mudanza/medir.mts
        ```
        Tiene que haber bajado. **Si no bajó, algo quedó apuntando a Virginia.**
- [ ] **C12. Descongelar:**
      ```bash
      gh workflow enable compras-sync.yml
      gh workflow enable inventario-sync.yml
      gh workflow enable mantenimiento-sync.yml
      gh workflow enable rrhh-recalculo.yml
      gh workflow enable backup.yml
      ```
      Y devolver los crons a `vercel.json`.
- [ ] **C13.** Actualizar `.env.local` y `docs/VARIABLES-VERCEL.md`.
- [ ] **C14.** **No borrar el proyecto viejo.** Queda en pie unas semanas: es la
      vuelta atrás. Anotar en el calendario cuándo darlo de baja.

---

## Cómo se vuelve atrás

Hasta C7, no hay nada que deshacer. Después de C8, volver son las mismas cuatro
variables y la región.

La asimetría que importa: **lo que se cargó en el proyecto nuevo no vuelve
solo.** Si se decide volver dos días después, esos dos días hay que traerlos a
mano. Por eso la decisión de quedarse o volver conviene tomarla el mismo día.
