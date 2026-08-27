/**
 * Los 14 que el importador no se animó a decidir.
 *
 * Este archivo ya corrió y no hace falta correrlo de nuevo: queda como
 * registro de quién decidió qué. El importador vive ahora en la app
 * —Configuración de Compras, "Traer proveedores"— y su lógica está en
 * lib/compras/importarProveedores.ts.
 *
 * Son los casos donde el Excel trae el nombre largo y la base el corto
 * —"Papelera Ciuffo" y "CIUFFO"—, que un programa no puede distinguir de un
 * parecido casual: "Frenos Norte" no es "NORTE". Los resolvió una persona que
 * conoce a los proveedores, el 27 de agosto de 2026, y el mapeo queda escrito
 * acá para que se sepa quién es quién y por qué.
 *
 * Se actualiza el registro que ya existe en vez de dar de alta uno nuevo:
 * el viejo es el que tiene las compras colgando, y duplicarlo las partiría
 * en dos mitades que después nadie suma.
 *
 *   node --env-file=.env.local scripts/import-proveedores/resolver-pendientes.mjs --dry-run
 */
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const ARCHIVO = process.env.PROVEEDORES_XLSX
  ?? "C:/Users/Usuario/Downloads/Base de datos PROVEEDORES.xlsx";
const DRY = process.argv.includes("--dry-run");

/**
 * Cada fila del Excel, y a qué proveedor de la base corresponde.
 *
 * `null` significa que no es ninguno de los que están: se da de alta.
 */
const MAPEO = [
  ["Ingeniería Boggio", "BOGGIO"],
  ["Matafuegos Messineo", "MESSINEO"],
  ["Oriti Gustavo", "ORITI"],
  ["Papelera Ciuffo", "CIUFFO"],
  ["Ravioli Rodamientos", "RAVIOLI"],
  ["El manu materiales rurales de olavarría S.R.L.", "EL MANU MATERIALES"],
  ["G & L Internacional S.A", "G & L"],
  ["Torraco Pablo Javier", "TORRACO"],
  ["Papel Misionero [Grupo Arcor]", "PAPEL MISIONERO"],

  // Berner distribuye Shell, y es el que tiene las nueve compras. La fila
  // "SHELL" de la base quedó suelta, sin movimientos, y no se toca.
  ["Berner (Shell)", "BERNER"],

  // Las dos filas siguientes son el MISMO proveedor: comparten el CUIT
  // 20-36745118-2 en el Excel. Van al mismo registro, y la segunda pisa a la
  // primera porque trae contacto y rubro. El nombre que queda es el de ella.
  ["El arco iris", "ARCO IRIS"],
  ["Pinturería y ferretería Arco Iris", "ARCO IRIS"],

  // Sus "parecidos" no eran proveedores sino filas con tres nombres metidos en
  // un campo, arrastradas de una celda de la planilla de comparativas. No hay
  // con qué unirlos: se dan de alta.
  ["Bolsaflex", null],
  ["Recuperadora del Sur", null],
];

const texto = (v) => {
  const s = String(v ?? "").trim();
  return s === "" || s === "-" ? null : s;
};

function plazoDias(v) {
  const s = texto(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 400 ? n : null;
}

function filasDelExcel() {
  const wb = XLSX.readFile(ARCHIVO);
  const porNombre = new Map();
  for (const hoja of wb.SheetNames) {
    for (const f of XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: null })) {
      const nombre = texto(f["Proveedor"]);
      if (!nombre) continue;
      porNombre.set(nombre, {
        nombre,
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
      });
    }
  }
  return porNombre;
}

async function main() {
  const excel = filasDelExcel();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: base, error } = await db.from("proveedores").select("id, nombre").limit(2000);
  if (error) throw new Error(error.message);
  const porNombre = new Map(base.map((p) => [p.nombre, p]));

  let unidos = 0, altas = 0;

  for (const [nombreExcel, destino] of MAPEO) {
    const fila = excel.get(nombreExcel);
    if (!fila) { console.error(`  x no está en el Excel: ${nombreExcel}`); continue; }

    // Un campo vacío en el Excel no borra lo que ya estaba cargado.
    const datos = Object.fromEntries(Object.entries(fila).filter(([, v]) => v != null));

    if (destino === null) {
      console.log(`  alta: ${nombreExcel}`);
      if (!DRY) {
        const { error } = await db.from("proveedores").insert(datos);
        if (error) console.error(`      x ${error.message}`);
        else altas++;
      }
      continue;
    }

    // Se busca por el nombre ORIGINAL de la base, no por el que va quedando:
    // las dos filas de Arco Iris apuntan al mismo registro, y para cuando llega
    // la segunda el nombre ya cambió. Por eso el mapa se arma una vez y no se
    // toca.
    const actual = porNombre.get(destino);
    if (!actual) { console.error(`  x no está en la base: ${destino}`); continue; }

    console.log(`  ${destino}  →  ${nombreExcel}`);
    if (!DRY) {
      const { error } = await db.from("proveedores").update(datos).eq("id", actual.id);
      if (error) { console.error(`      x ${error.message}`); continue; }
      unidos++;
    }
  }

  console.log(DRY ? "\n(--dry-run: no se escribió nada)" : `\nUnidos: ${unidos} · Altas: ${altas}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
