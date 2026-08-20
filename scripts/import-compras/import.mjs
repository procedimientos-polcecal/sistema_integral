#!/usr/bin/env node
/**
 * Importa el histórico de la planilla "PEDIDOS DE COMPRA.xlsx" al módulo Compras.
 *
 *   node scripts/import-compras/import.mjs "C:/ruta/PEDIDOS DE COMPRA.xlsx" --dry-run
 *   node scripts/import-compras/import.mjs "C:/ruta/PEDIDOS DE COMPRA.xlsx"
 *
 * Variables (de .env.local o del entorno):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Cómo está armada la planilla, y por qué se importa así:
 *   - "Requerimientos internos" es el master: alta del RI + estado de aprobación.
 *   - "RI <AREA>" son vistas por área donde Compras completa comparativa,
 *     proveedor, estado del pedido y costos. Las 1764 filas de esas hojas
 *     cruzan todas contra el master, así que son vistas y no datos aparte.
 *   Ambas se fusionan por N° de RI en un único registro.
 *
 * Es idempotente: hace upsert sobre nro_ri, se puede correr de nuevo.
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// ── Entorno ──────────────────────────────────────────────────

function cargarEnv() {
  for (const nombre of [".env.local", ".env"]) {
    const archivo = path.join(process.cwd(), nombre);
    if (!fs.existsSync(archivo)) continue;
    for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
      // Se recorta el valor: es habitual que al pegar una clave quede un
      // espacio adelante, y un header con espacio inicial puede terminar
      // descartado por el servidor.
      const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
cargarEnv();

const ARCHIVO = process.argv[2];
const DRY_RUN = process.argv.includes("--dry-run");

if (!ARCHIVO) {
  console.error('Uso: node scripts/import-compras/import.mjs "PEDIDOS DE COMPRA.xlsx" [--dry-run]');
  process.exit(1);
}

const HOJA_MASTER = "Requerimientos internos";

// ── Normalización ────────────────────────────────────────────

const texto = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[°º.]/g, "").replace(/\s+/g, " ");

/** Las celdas de fecha del xlsx son Date reales, ya en hora local. */
const marcaTiempo = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString() : null);

const soloFecha = (v) => {
  if (!(v instanceof Date) || isNaN(v)) return null;
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
};

const PRIORIDADES = new Set(["URGENTE", "1 SEMANA", "2 SEMANAS", "NORMAL", "LEVE"]);
// Sin valor por defecto: la celda vacia significa que nadie la definio todavia.
const prioridad = (v) => (PRIORIDADES.has(norm(v)) ? norm(v) : null);

// "Ambas" solo cuando la planilla lo dice; vacio es "sin definir".
const pagaDe = (v) => {
  const s = norm(v);
  if (s === "AMBAS") return { empresa: null, ambas: true };
  if (s === "POLCECAL" || s === "POLYSAN") return { empresa: s, ambas: false };
  return { empresa: null, ambas: false };
};

function partirEstado(valor) {
  const s = norm(valor);
  if (!s) return { base: null, quien: null };
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { base: m[1].trim(), quien: m[2].trim() } : { base: s, quien: null };
}

/** "APROBADA (NICO)": el paréntesis es quién aprobó, no otro estado. */
function estadoAprobacion(valor) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: "PENDIENTE", aprobador: null };
  if (base.startsWith("APROBAD")) return { estado: "APROBADA", aprobador: quien };
  if (base.startsWith("DENEGAD") || base.startsWith("RECHAZ")) return { estado: "DENEGADA", aprobador: quien };
  if (base.includes("REVISI")) return { estado: "EN_REVISION", aprobador: null };
  return { estado: "PENDIENTE", aprobador: null };
}

function estadoCompra(valor) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: "SIN_INICIAR", aprobador: null };
  if (base === "PEDIDO") return { estado: "PEDIDO", aprobador: null };
  if (base === "RECIBIDO") return { estado: "RECIBIDO", aprobador: null };
  if (base.startsWith("DENEGAD")) return { estado: "DENEGADO", aprobador: null };
  if (base.includes("COMPARATIVA") || base.startsWith("EN PROCESO")) {
    return { estado: "EN_COMPARATIVA", aprobador: null };
  }
  if (base.startsWith("PARA COMPRAR")) {
    // "(POR APROBAR)" no nombra a una persona: dice que falta la aprobación.
    const esPersona = quien && !/POR APROBAR/i.test(quien);
    return { estado: "PARA_COMPRAR", aprobador: esPersona ? quien : null };
  }
  if (base.startsWith("APROBAD")) return { estado: "PARA_COMPRAR", aprobador: quien };
  return { estado: "SIN_INICIAR", aprobador: null };
}

/** "MORC SRL" y "MORC" son el mismo proveedor. */
function claveProveedor(nombre) {
  return norm(nombre)
    .replace(/["']/g, "")
    .replace(/\b(S\s?R\s?L|SA|S\s?A|SAS|SACIF|SRL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Lectura de la planilla ───────────────────────────────────

console.log(`Leyendo ${ARCHIVO} …`);
const wb = XLSX.readFile(ARCHIVO, { cellDates: true });

const leerHoja = (nombre) =>
  XLSX.utils
    .sheet_to_json(wb.Sheets[nombre], { defval: null })
    .filter((f) => numero(f["N° RI"]) !== null);

// La cantidad se llama CAN o CANTIDAD según la hoja; el proveedor, PROVEEDOR
// o PROVEEDOR ELEGIDO.
const cantidadDe = (f) => numero(f["CANTIDAD"] ?? f["CAN"]);
const proveedorDe = (f) => texto(f["PROVEEDOR ELEGIDO"] ?? f["PROVEEDOR"]);

const porRi = new Map();

// 1) Master: alta + aprobación
for (const f of leerHoja(HOJA_MASTER)) {
  const nro = Math.round(numero(f["N° RI"]));
  const apro = estadoAprobacion(f["Estado"]);
  porRi.set(nro, {
    nro_ri: nro,
    fecha: marcaTiempo(f["FECHA"]),
    area: texto(f["ÁREA"]),
    descripcion: texto(f["DESCRIPCIÓN"]) ?? "(sin descripción)",
    codigo: texto(f["CODIGO"]),
    cantidad: cantidadDe(f),
    ubicacion: texto(f["DONDE SE NECESITA"]),
    fecha_necesidad: soloFecha(f["FECHA DE REQUERIMIENTO"]),
    detalle_extra: texto(f["DETALLE EXTRA"]),
    imagen_url: texto(f["IMAGEN COMPLEMENTARIA"] ?? f["IMAGEN"]),
    prioridad: prioridad(f["PRIORIDAD"]),
    paga: pagaDe(f["Empresa"] ?? f["PAGA"]),
    solicitante_nombre: texto(f["SOLICITA"]),
    estado_aprobacion: apro.estado,
    aprobador: apro.aprobador,
    estado_compra: "SIN_INICIAR",
    comparativa_url: null,
    proveedor: null,
    costo_iva: null,
    costo_envio: null,
    hoja_origen: HOJA_MASTER,
    sheets_fila: null,
  });
}
console.log(`  master: ${porRi.size} requerimientos`);

// 2) Hojas por área: etapa de compra
for (const hoja of wb.SheetNames.filter((n) => n.startsWith("RI "))) {
  const filas = leerHoja(hoja);
  let huerfanos = 0;

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const nro = Math.round(numero(f["N° RI"]));
    const compra = estadoCompra(f["Estado"]);
    const previo = porRi.get(nro);

    // La fila en la planilla: +2 por el encabezado y el índice base 0.
    const filaEnPlanilla = i + 2;

    if (!previo) {
      huerfanos++;
      const apro = estadoAprobacion(f["Estado"]);
      porRi.set(nro, {
        nro_ri: nro,
        fecha: marcaTiempo(f["FECHA"]),
        area: texto(f["ÁREA"]),
        descripcion: texto(f["DESCRIPCIÓN"]) ?? "(sin descripción)",
        codigo: texto(f["CODIGO"]),
        cantidad: cantidadDe(f),
        ubicacion: texto(f["DONDE SE NECESITA"]),
        fecha_necesidad: soloFecha(f["FECHA DE REQUERIMIENTO"]),
        detalle_extra: texto(f["DETALLE EXTRA"]),
        imagen_url: texto(f["IMAGEN"]),
        prioridad: prioridad(f["PRIORIDAD"]),
        paga: pagaDe(f["PAGA"]),
        solicitante_nombre: texto(f["SOLICITA"]),
        estado_aprobacion: compra.estado === "DENEGADO" ? "DENEGADA" : apro.estado,
        aprobador: compra.aprobador ?? apro.aprobador,
        estado_compra: compra.estado,
        comparativa_url: texto(f["COMPARATIVA PROVEEDORES"]),
        proveedor: proveedorDe(f),
        costo_iva: numero(f["COSTO + IVA"]),
        costo_envio: numero(f["COSTO ENVÍO"]),
        hoja_origen: hoja,
        sheets_fila: filaEnPlanilla,
      });
      continue;
    }

    // La hoja de área manda en todo lo relativo a la compra.
    previo.estado_compra = compra.estado;
    previo.comparativa_url = texto(f["COMPARATIVA PROVEEDORES"]);
    previo.proveedor = proveedorDe(f);
    previo.costo_iva = numero(f["COSTO + IVA"]);
    previo.costo_envio = numero(f["COSTO ENVÍO"]);
    previo.hoja_origen = hoja;
    previo.sheets_fila = filaEnPlanilla;
    previo.aprobador ??= compra.aprobador;
    previo.codigo ??= texto(f["CODIGO"]);
    previo.cantidad ??= cantidadDe(f);
    previo.solicitante_nombre ??= texto(f["SOLICITA"]);
    if (compra.estado === "DENEGADO") previo.estado_aprobacion = "DENEGADA";
  }
  console.log(`  ${hoja}: ${filas.length} filas (${huerfanos} fuera del master)`);
}

const registros = [...porRi.values()].sort((a, b) => a.nro_ri - b.nro_ri);
console.log(`\nTotal fusionado: ${registros.length} requerimientos`);

// Resumen, para verificar el mapeo antes de escribir nada.
const contar = (campo) =>
  registros.reduce((acc, r) => ((acc[r[campo]] = (acc[r[campo]] ?? 0) + 1), acc), {});
console.log("Estado de aprobación:", contar("estado_aprobacion"));
console.log("Estado de compra:   ", contar("estado_compra"));

const areas = [...new Set(registros.map((r) => r.area).filter(Boolean))].sort();
const ubicaciones = [...new Set(registros.map((r) => r.ubicacion).filter(Boolean))];

// Proveedores: se agrupan por clave normalizada y gana el nombre más usado.
const variantesPorClave = new Map();
for (const r of registros) {
  if (!r.proveedor) continue;
  const k = claveProveedor(r.proveedor);
  if (!k) continue;
  if (!variantesPorClave.has(k)) variantesPorClave.set(k, new Map());
  const v = variantesPorClave.get(k);
  v.set(r.proveedor, (v.get(r.proveedor) ?? 0) + 1);
}
const nombreCanonico = new Map();
for (const [k, variantes] of variantesPorClave) {
  const mejor = [...variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  nombreCanonico.set(k, mejor);
}

console.log(
  `\nCatálogos: ${areas.length} áreas, ${ubicaciones.length} ubicaciones distintas, ` +
  `${nombreCanonico.size} proveedores (de ${new Set(registros.map((r) => r.proveedor).filter(Boolean)).size} nombres crudos)`
);

// --- Conexion -----------------------------------------------
// Se conecta también en dry-run: sin leer sectores y equipos no se puede
// anticipar cuántas ubicaciones van a quedar enlazadas al núcleo, que es
// justamente lo que hay que revisar antes de escribir nada.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hayCredenciales = Boolean(url && key);

// En dry-run las credenciales son opcionales: sin ellas se informa igual la
// fusión de la planilla, sólo que no se puede anticipar el cruce con el núcleo.
if (!hayCredenciales && !DRY_RUN) {
  console.error();
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = hayCredenciales
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

// --- Catalogo de ubicaciones ---------------------------------
// "Donde se necesita" tiene su propio catalogo (compras_ubicaciones). El enlace
// de cada ubicacion a un sector o equipo del nucleo se administra desde ahi,
// no por requerimiento: cuando exista la flota real hay que mapear 38 filas
// una vez, no 1825.

let idEmpresa = new Map();
let ubicacionesDb = [];

if (db) {
  const [{ data: empresasDb }, { data: ubisDb }] = await Promise.all([
    db.from("empresas").select("id, nombre"),
    db.from("compras_ubicaciones").select("id, nombre"),
  ]);
  idEmpresa = new Map((empresasDb ?? []).map((e) => [norm(e.nombre), e.id]));
  ubicacionesDb = ubisDb ?? [];
}

const idUbicacion = new Map(ubicacionesDb.map((u) => [norm(u.nombre), u.id]));

if (db) {
  const nuevas = ubicaciones.filter((u) => !idUbicacion.has(norm(u)));
  const enCatalogo = registros.filter(
    (r) => r.ubicacion && idUbicacion.has(norm(r.ubicacion))
  ).length;
  const sinUbicacion = registros.filter((r) => !r.ubicacion).length;
  const cuantos = (u) => registros.filter((r) => r.ubicacion === u).length;

  console.log(
    `\nUbicaciones: ${enCatalogo} RI ya enlazados al catálogo, ` +
    `${registros.length - enCatalogo - sinUbicacion} a la espera de las que se den de alta, ` +
    `${sinUbicacion} sin ubicación cargada en la planilla.`
  );

  if (nuevas.length > 0) {
    console.log(`\nSe van a dar de alta ${nuevas.length} ubicaciones nuevas:`);
    for (const u of nuevas.slice(0, 20)) {
      console.log(`   ${String(cuantos(u)).padStart(4)} RI  ${u}`);
    }
    if (nuevas.length > 20) console.log(`   … y ${nuevas.length - 20} más`);
  }

  // Nombres casi iguales: casi siempre uno es un error de tipeo, y si no se
  // unifica quedan dos ubicaciones para el mismo lugar. Se avisa pero no se
  // corrige solo: "Planta de trituración 1" y "2" también se parecen en un
  // caracter y son lugares distintos.
  const parecidos = [];
  for (const a of ubicaciones) {
    for (const b of ubicaciones) {
      if (a >= b) continue;
      const na = norm(a), nb = norm(b);
      if (na === nb || Math.abs(na.length - nb.length) > 1) continue;
      let d = 0;
      const largo = Math.max(na.length, nb.length);
      for (let i = 0; i < largo; i++) if (na[i] !== nb[i]) d++;
      if (d === 1) parecidos.push([a, b]);
    }
  }
  if (parecidos.length > 0) {
    console.log(`\nHay ${parecidos.length} pares de nombres casi iguales. Revisá si alguno es un error de tipeo:`);
    for (const [a, b] of parecidos) {
      console.log(`   "${a}" (${cuantos(a)} RI)  vs  "${b}" (${cuantos(b)} RI)`);
    }
    console.log(
      "\n   Si alguno lo es, conviene corregirlo en la planilla antes de importar:" +
      "\n   si no, la sincronización lo vuelve a crear en cada corrida."
    );
  }
} else {
  console.log();
  console.log("Sin credenciales: no se puede anticipar el cruce con el catálogo.");
}


if (DRY_RUN) {
  console.log();
  console.log("--dry-run: no se escribió nada en la base.");
} else {
  // --- Carga a Supabase ----------------------------------------

  // Áreas
  if (areas.length > 0) {
    const { error } = await db
      .from("compras_areas")
      .upsert(areas.map((nombre, i) => ({ nombre, orden: i * 10 })), {
        onConflict: "nombre", ignoreDuplicates: true,
      });
    if (error) { console.error("compras_areas:", error.message); process.exit(1); }
  }
  const { data: areasDb } = await db.from("compras_areas").select("id, nombre");
  const idArea = new Map((areasDb ?? []).map((a) => [a.nombre, a.id]));

  // Proveedores (padrón compartido del núcleo)
  const { data: provDb0 } = await db.from("proveedores").select("id, nombre");
  const idProveedor = new Map((provDb0 ?? []).map((p) => [claveProveedor(p.nombre), p.id]));
  const nuevosProveedores = [...nombreCanonico.values()].filter(
    (n) => !idProveedor.has(claveProveedor(n))
  );
  if (nuevosProveedores.length > 0) {
    const { error } = await db
      .from("proveedores")
      .upsert(nuevosProveedores.map((nombre) => ({ nombre })), {
        onConflict: "nombre", ignoreDuplicates: true,
      });
    if (error) { console.error("proveedores:", error.message); process.exit(1); }
    const { data: provDb } = await db.from("proveedores").select("id, nombre");
    for (const p of provDb ?? []) idProveedor.set(claveProveedor(p.nombre), p.id);
  }

  // Ubicaciones: el catalogo base lo siembra la migracion 019; aca se suman las
  // que aparezcan en la planilla y todavia no esten.
  const nuevasUbicaciones = ubicaciones.filter((u) => !idUbicacion.has(norm(u)));
  if (nuevasUbicaciones.length > 0) {
    const { error } = await db
      .from("compras_ubicaciones")
      .upsert(nuevasUbicaciones.map((nombre) => ({ nombre })), {
        onConflict: "nombre", ignoreDuplicates: true,
      });
    if (error) { console.error("compras_ubicaciones:", error.message); process.exit(1); }
    const { data: ubiDb } = await db.from("compras_ubicaciones").select("id, nombre");
    for (const u of ubiDb ?? []) idUbicacion.set(norm(u.nombre), u.id);
    console.log(`  ${nuevasUbicaciones.length} ubicaciones nuevas dadas de alta`);
  }


  const aInsertar = registros.map((r) => {
    const clave = r.ubicacion ? norm(r.ubicacion) : null;

    return {
      nro_ri: r.nro_ri,
      fecha: r.fecha ?? new Date().toISOString(),
      area_id: r.area ? idArea.get(r.area) ?? null : null,
      descripcion: r.descripcion,
      codigo: r.codigo,
      cantidad: r.cantidad,
      ubicacion_raw: r.ubicacion,
      ubicacion_id: clave ? idUbicacion.get(clave) ?? null : null,
      fecha_necesidad: r.fecha_necesidad,
      detalle_extra: r.detalle_extra,
      imagen_url: r.imagen_url,
      prioridad: r.prioridad,
      // "AMBAS" no es una empresa: queda en null.
      empresa_id: r.paga.empresa ? idEmpresa.get(r.paga.empresa) ?? null : null,
      paga_ambas: r.paga.ambas,
      solicitante_nombre: r.solicitante_nombre,
      estado_aprobacion: r.estado_aprobacion,
      aprobador: r.aprobador,
      estado_compra: r.estado_compra,
      comparativa_url: r.comparativa_url,
      proveedor_id: r.proveedor
        ? idProveedor.get(claveProveedor(nombreCanonico.get(claveProveedor(r.proveedor)) ?? r.proveedor)) ?? null
        : null,
      costo_iva: r.costo_iva,
      costo_envio: r.costo_envio,
      origen: "import",
      hoja_origen: r.hoja_origen,
      sheets_fila: r.sheets_fila,
    };
  });

  console.log(`Cargando ${aInsertar.length} requerimientos…`);
  for (let i = 0; i < aInsertar.length; i += 500) {
    const lote = aInsertar.slice(i, i + 500);
    const { error } = await db.from("compras_requerimientos").upsert(lote, { onConflict: "nro_ri" });
    if (error) {
      console.error(`  lote ${i}–${i + lote.length}: ${error.message}`);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + 500, aInsertar.length)}/${aInsertar.length}`);
  }

  console.log("\nImportación terminada.");

}