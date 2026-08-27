/**
 * Trae la base de datos de proveedores que lleva administración.
 *
 * El Excel manda sobre los datos —CUIT, contacto, plazos, cuenta—, pero no
 * sobre quién existe: hay 75 proveedores con compras hechas que no figuran ahí,
 * y ésos se dejan intactos. Nada se desactiva ni se borra.
 *
 * El trabajo fino es reconocer al mismo proveedor escrito distinto. "Ancoil
 * S.A." y "ANCOIL" son el mismo y hay que actualizarlo, no duplicarlo: el
 * registro viejo es el que tiene las compras colgando. Pero "Berner (Shell)"
 * se parece a "SHELL" y a "BERNER", que son dos proveedores distintos, y ahí
 * adivinar sería peor que no hacer nada: esos casos se listan aparte y los
 * resuelve alguien que los conoce.
 *
 *   node --env-file=.env.local scripts/import-proveedores/import.mjs --dry-run
 *   node --env-file=.env.local scripts/import-proveedores/import.mjs
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const ARCHIVO = process.env.PROVEEDORES_XLSX
  ?? "C:/Users/Usuario/Downloads/Base de datos PROVEEDORES.xlsx";
const DRY = process.argv.includes("--dry-run");

// ── Reconocer el mismo nombre escrito distinto ──────────────

/** Sin acentos, sin mayúsculas, sin puntuación, espacios colapsados. */
export const clave = (n) =>
  String(n ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * El núcleo del nombre: sin sufijos societarios.
 *
 * Es lo que hace que "Ancoil S.A." y "ANCOIL" se reconozcan como el mismo. No
 * toca el resto de las palabras.
 */
export const nucleo = (n) =>
  clave(n)
    .replace(/\b(s ?a|s r l|srl|sas|s a s|ltda|sh|s h)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ── Lectura del Excel ───────────────────────────────────────

const texto = (v) => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};

/** El plazo es un número de días; lo que no lo sea queda nulo. */
export function plazoDias(v) {
  const s = texto(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 400 ? n : null;
}

function leerExcel() {
  const wb = XLSX.readFile(ARCHIVO);
  const porNombre = new Map();

  for (const hoja of wb.SheetNames) {
    for (const f of XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null })) {
      const nombre = texto(f["Proveedor"]);
      if (!nombre) continue;
      const k = clave(nombre);

      const datos = {
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
        plazo_pago_dias: plazoDias(f["PLAZOS DE PAGO"]),
        forma_pago: texto(f["FORMAS DE PAGO"]),
        condicion_pago: texto(f["CONDICIÓN"]),
        cbu: texto(f["CBU"]),
        alias_bancario: texto(f["ALIAS"]),
        comentario: texto(f["COMENTARIO"]),
      };

      // Un proveedor repetido entre pestañas se completa, no se pisa: la
      // segunda hoja suele traer los campos que la primera dejó vacíos.
      if (!porNombre.has(k)) porNombre.set(k, datos);
      else {
        const previo = porNombre.get(k);
        for (const [campo, valor] of Object.entries(datos)) {
          if (previo[campo] == null && valor != null) previo[campo] = valor;
        }
      }
    }
  }
  return [...porNombre.values()];
}

// ── Cruce contra lo que ya está ─────────────────────────────

/**
 * Decide qué hacer con cada fila del Excel.
 *
 * Tres destinos: actualizar el que ya existe, darlo de alta, o dejarlo para
 * que lo mire una persona. El tercero es el que evita romper cosas.
 */
export function decidir(delExcel, deLaBase) {
  const porClave = new Map(deLaBase.map((p) => [clave(p.nombre), p]));
  const porNucleo = new Map();
  for (const p of deLaBase) {
    const n = nucleo(p.nombre);
    if (!n) continue;
    if (!porNucleo.has(n)) porNucleo.set(n, []);
    porNucleo.get(n).push(p);
  }

  const actualizar = [], insertar = [], aRevisar = [];

  for (const fila of delExcel) {
    const k = clave(fila.nombre);

    // 1. Mismo nombre: no hay nada que decidir.
    if (porClave.has(k)) {
      actualizar.push({ id: porClave.get(k).id, fila, porque: "mismo nombre" });
      continue;
    }

    // 2. Mismo núcleo y una sola candidata: "Ancoil S.A." es "ANCOIL".
    const n = nucleo(fila.nombre);
    const mismos = porNucleo.get(n) ?? [];
    if (mismos.length === 1) {
      actualizar.push({
        id: mismos[0].id, fila, renombra: true,
        porque: mismos[0].nombre,
      });
      continue;
    }
    if (mismos.length > 1) {
      aRevisar.push({
        fila: fila.nombre, candidatos: mismos.map((p) => p.nombre),
        porque: "varios con el mismo nombre de fondo",
      });
      continue;
    }

    // 3. Uno contiene al otro. Acá NO se decide solo, aunque haya un único
    //    candidato: "Papelera Ciuffo" y "CIUFFO" probablemente sean el mismo,
    //    pero "Frenos Norte" y "NORTE" probablemente no.
    const parecidos = deLaBase.filter((p) => {
      const b = nucleo(p.nombre);
      return b.length >= 4 && n.length >= 4 && (n.includes(b) || b.includes(n));
    });
    if (parecidos.length > 0) {
      aRevisar.push({
        fila: fila.nombre, candidatos: parecidos.map((p) => p.nombre),
        porque: "se parece, pero no es el mismo nombre",
      });
      continue;
    }

    insertar.push(fila);
  }

  return { actualizar, insertar, aRevisar };
}

// ── Escritura ───────────────────────────────────────────────

async function main() {
  const delExcel = leerExcel();
  console.log(`Excel: ${delExcel.length} proveedores únicos`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: deLaBase, error } = await db.from("proveedores").select("id, nombre").limit(2000);
  if (error) throw new Error(error.message);
  console.log(`Base:  ${deLaBase.length} proveedores`);

  const { actualizar, insertar, aRevisar } = decidir(delExcel, deLaBase);
  console.log("");
  console.log(`  actualizar:       ${actualizar.length}`);
  console.log(`  dar de alta:      ${insertar.length}`);
  console.log(`  a revisar a mano: ${aRevisar.length}`);

  const renombres = actualizar.filter((a) => a.renombra);
  if (renombres.length) {
    console.log(`\n--- Se unen, y el nombre pasa a ser el del Excel (${renombres.length}) ---`);
    for (const r of renombres) console.log(`  ${r.porque}  →  ${r.fila.nombre}`);
  }

  if (aRevisar.length) {
    const salida = path.join(process.cwd(), "scripts/import-proveedores/a-revisar.json");
    fs.writeFileSync(salida, JSON.stringify(aRevisar, null, 2), "utf8");
    console.log(`\n--- A revisar a mano (${aRevisar.length}) ---`);
    for (const r of aRevisar) {
      console.log(`  ${r.fila}\n      ~ ${r.candidatos.join(" / ")}   (${r.porque})`);
    }
    console.log(`\n  Guardado en ${salida}`);
  }

  if (DRY) {
    console.log("\n(--dry-run: no se escribió nada)");
    return;
  }

  let ok = 0;
  for (const { id, fila } of actualizar) {
    // Sólo lo que el Excel dice de verdad: un campo vacío ahí no borra lo que
    // ya estaba cargado en el sistema.
    const cambios = Object.fromEntries(Object.entries(fila).filter(([, v]) => v != null));
    const { error } = await db.from("proveedores").update(cambios).eq("id", id);
    if (error) console.error(`  x ${fila.nombre}: ${error.message}`);
    else ok++;
  }
  console.log(`\nActualizados: ${ok}/${actualizar.length}`);

  let altas = 0;
  for (let i = 0; i < insertar.length; i += 100) {
    const lote = insertar.slice(i, i + 100);
    const { error } = await db.from("proveedores").insert(lote);
    if (error) console.error(`  x lote ${i}: ${error.message}`);
    else altas += lote.length;
  }
  console.log(`Dados de alta: ${altas}/${insertar.length}`);
  console.log(`\nA revisar a mano quedaron ${aRevisar.length}. No se tocaron.`);
}

// Sólo corre si se lo invoca directo, no al importarlo desde un test.
if (process.argv[1]?.endsWith("import.mjs")) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
