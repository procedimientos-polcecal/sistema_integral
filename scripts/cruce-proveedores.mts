/**
 * Qué falta para que un requerimiento pueda generar su orden de compra en Odoo.
 *
 * **No escribe nada**, ni en Supabase ni en Odoo: mide y deja un informe en
 * `docs/COMPRAS-PROVEEDORES-ODOO.md`.
 *
 * Existe porque la pregunta "¿por qué este RI no genera la orden?" tiene cuatro
 * respuestas distintas y sólo una se arregla con el botón de enlazar de
 * `/compras/configuracion`. Medido el 11/09/2026: ese botón ya no tiene nada que
 * hacer —las 209 filas deducibles por CUIT ya están— y sin embargo 512 de 1682
 * pedidos siguen trabados. Lo que falta es dato, no proceso.
 *
 * El cruce lo hace `cruzarProveedores`, el mismo que usa la app, para no razonar
 * sobre un cruce distinto del que la app haría. Lo único propio de acá es el
 * **parecido por nombre**, que sirve para proponer y nunca para enlazar: enlazar
 * al que se le parece manda la orden al CUIT de otro y no se nota nunca.
 *
 * Uso:
 *   npx tsx scripts/cruce-proveedores.mts
 *
 * Conviene correrlo de nuevo después de tocar los datos, y contra producción
 * antes de enlazar en serio: lo que se lee acá sale de la instancia que digan
 * ODOO_URL y ODOO_DB.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { buscarLeer, dondeApuntaOdoo } = await import("../lib/odoo/client.ts");
const { cruzarProveedores } = await import("../lib/odoo/proveedores.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const VACIAS = new Set(["SA", "SRL", "SACI", "SAIC", "S", "A", "L", "DE", "Y", "EL", "LA", "SOCIEDAD", "ANONIMA", "COMERCIAL", "INDUSTRIAL", "E", "INMOBILIARIA", "SAICF", "SAIFC", "SACIF"]);
const fichas = (s: string): string[] =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !VACIAS.has(t));

const { data: emp } = await sb.from("empresas").select("id, nombre, odoo_company_id");
const empresas = (emp ?? []).map((e) => e.id as string);
const nombreEmpresa = new Map((emp ?? []).map((e) => [e.id as string, e.nombre as string]));

const delSdG = await traerTodo<any>((d, h) => sb.from("proveedores").select("id, nombre, cuit").range(d, h));
const deOdoo = await buscarLeer<any>("res.partner", [["supplier_rank", ">", 0]], ["name", "vat", "company_id"], {
  limite: 2000,
  orden: "name asc",
});
const cruce = cruzarProveedores(delSdG, deOdoo);

const enl = await traerTodo<any>((d, h) => sb.from("proveedores_odoo").select("proveedor_id, empresa_id").range(d, h));
const clave = new Set(enl.map((e) => `${e.proveedor_id}|${e.empresa_id}`));
const tieneAlguno = new Set(enl.map((e) => e.proveedor_id));

const ris = await traerTodo<any>((d, h) =>
  sb.from("compras_requerimientos").select("nro_ri, estado_compra, proveedor_id, costo_iva, empresa_id, paga_ambas").range(d, h)
);
const pedibles = ris.filter((r) => r.estado_compra === "PEDIDO" && r.proveedor_id && r.costo_iva !== null);
const uso = new Map<string, number>();
for (const r of pedibles) uso.set(r.proveedor_id, (uso.get(r.proveedor_id) ?? 0) + 1);

/** Candidatos de Odoo por parecido de nombre. Para confirmar a mano, nunca para enlazar solo. */
function candidatos(nombre: string) {
  const mias = fichas(nombre);
  if (!mias.length) return [];
  const puntuados = deOdoo
    .map((o: any) => {
      const suyas = fichas(o.name);
      const comunes = mias.filter((t) => suyas.includes(t)).length;
      return { o, comunes, ratio: comunes / mias.length };
    })
    .filter((c) => c.comunes > 0 && c.ratio >= 0.5);

  // Agrupados por CUIT: un mismo proveedor está una vez por empresa.
  const porCuit = new Map<string, { nombre: string; vat: string; empresas: string[]; ratio: number }>();
  for (const c of puntuados.sort((a, b) => b.ratio - a.ratio)) {
    const vat = String(c.o.vat || "").replace(/\D/g, "") || `sin-cuit-${c.o.id}`;
    const previo = porCuit.get(vat);
    const empresa = c.o.company_id ? c.o.company_id[1] : "COMPARTIDO";
    if (previo) { if (!previo.empresas.includes(empresa)) previo.empresas.push(empresa); continue; }
    porCuit.set(vat, { nombre: c.o.name, vat: String(c.o.vat || ""), empresas: [empresa], ratio: c.ratio });
  }
  return [...porCuit.values()].slice(0, 3);
}

// ── 1. Duplicados del padrón del SdG ──
const duplicados = cruce.cuitRepetidoEnSdG
  .map((g) => ({
    cuit: g.cuit,
    ri: g.proveedores.reduce((s, p) => s + (uso.get(p.id) ?? 0), 0),
    proveedores: g.proveedores.map((p) => ({ ...p, ri: uso.get(p.id) ?? 0 })),
    odoo: deOdoo.filter((o: any) => String(o.vat || "").replace(/\D/g, "") === g.cuit),
  }))
  .sort((a, b) => b.ri - a.ri);

// ── 2. Sin CUIT, con RI, y sus candidatos ──
const sinCuit = cruce.sinEnlazar
  .filter((s) => s.motivo === "sin cuit")
  .map((s) => ({ ...s, ri: uso.get(s.proveedorId) ?? 0 }))
  .filter((s) => s.ri > 0)
  .sort((a, b) => b.ri - a.ri)
  .map((s) => ({ ...s, candidatos: candidatos(s.nombre) }));

// ── 3. AMBAS incompletos ──
const ambasParcial = new Map<string, number>();
for (const r of pedibles) {
  if (!r.paga_ambas || !tieneAlguno.has(r.proveedor_id)) continue;
  if (empresas.some((e) => !clave.has(`${r.proveedor_id}|${e}`)))
    ambasParcial.set(r.proveedor_id, (ambasParcial.get(r.proveedor_id) ?? 0) + 1);
}

const conCandidato = sinCuit.filter((s) => s.candidatos.length);
const sinCandidato = sinCuit.filter((s) => !s.candidatos.length);
const riDup = duplicados.reduce((s, d) => s + d.ri, 0);
const riCand = conCandidato.reduce((s, c) => s + c.ri, 0);

const md: string[] = [];
const p = (s = "") => md.push(s);

p("# Cruce de proveedores con Odoo — qué destraba las órdenes de compra");
p();
p(`Medido el ${new Date().toISOString().slice(0, 10)} contra \`${dondeApuntaOdoo().base}\`.`);
p();
p("> El padrón de Odoo que se leyó es el de **staging**, que es una copia del 03/09.");
p("> Los CUIT de acá sirven para decidir, pero antes de enlazar en serio conviene");
p("> reconfirmarlos contra producción: un proveedor dado de alta después no está en");
p("> esta copia.");
p(`Padrones: **${delSdG.length}** proveedores del SdG, **${deOdoo.length}** partners proveedores de Odoo.`);
p();
p("## Lo primero: el botón de enlazar ya no tiene nada que hacer");
p();
p("Correr el cruce de `/compras/configuracion` hoy escribe **0 filas nuevas**: las 209");
p("que se pueden deducir por CUIT ya están. Lo que falta no sale de volver a cruzar,");
p("sale de arreglar los datos. Son tres cosas, y la primera es barata.");
p();
p("## El estado, sobre los pedidos que importan");
p();
p("| | RI |");
p("|---|---|");
p(`| En PEDIDO con proveedor y costo cargado | ${pedibles.length} |`);
p(`| **Pueden generar orden hoy** | **${pedibles.filter((r) => { const q = r.paga_ambas ? empresas : r.empresa_id ? [r.empresa_id] : []; return q.length > 0 && q.every((e) => clave.has(`${r.proveedor_id}|${e}`)); }).length}** |`);
p(`| Trabados por el proveedor | ${pedibles.length - pedibles.filter((r) => { const q = r.paga_ambas ? empresas : r.empresa_id ? [r.empresa_id] : []; return q.length > 0 && q.every((e) => clave.has(`${r.proveedor_id}|${e}`)); }).length} |`);
p();
p(`## 1. Tres CUIT duplicados en el padrón del SdG — ${riDup} RI, y se arregla en cinco ediciones`);
p();
p("Es lo más barato que hay. El cruce **no enlaza un CUIT que aparece dos veces en el");
p("SdG**, y con razón: dos filas apuntando al mismo partner no se sabe después cuál es");
p("cuál. Pero acá el duplicado es siempre el mismo caso — una **persona** cargada con el");
p("CUIT de la empresa para la que trabaja — y ninguna de esas personas tiene un solo");
p("pedido. Sacándoles el CUIT (o borrándolas, si no se usan), el cruce las enlaza solo.");
p();
for (const d of duplicados) {
  p(`### CUIT ${d.cuit} — ${d.ri} RI`);
  p();
  for (const pr of d.proveedores) p(`- SdG: **${pr.nombre}** — ${pr.ri} RI en PEDIDO`);
  for (const o of d.odoo) p(`- Odoo: \`#${o.id}\` ${o.name} — ${o.company_id ? o.company_id[1] : "COMPARTIDO"}`);
  p();
}
p(`## 2. ${cruce.sinEnlazar.filter((s) => s.motivo === "sin cuit").length} proveedores sin CUIT en el SdG — ${sinCuit.reduce((s, x) => s + x.ri, 0)} RI`);
p();
p("Es la causa grande, y no se arregla cruzando: **sin CUIT no hay por dónde**. Lo que");
p("sí se puede es proponer, y que alguien confirme. Abajo, cada proveedor con los");
p("partners de Odoo que se le parecen por nombre.");
p();
p("**Ninguno de estos está enlazado ni lo va a estar solo.** Enlazar al que se le parece");
p("es la trampa que este módulo ya pagó: un enlace equivocado manda la orden al CUIT de");
p("otro y no se nota nunca. La forma de resolverlo es **cargarle el CUIT al proveedor del");
p("SdG** — el de la columna de la derecha, si es el correcto — y volver a correr el cruce,");
p("que ahí sí lo va a enlazar por CUIT y no por parecido.");
p();
p(`### Con candidato en Odoo — ${conCandidato.length} proveedores, ${riCand} RI`);
p();
p("La columna **Seguridad** dice cuánto del nombre del SdG aparece en el de Odoo.");
p("Un `parcial` es una coincidencia de una sola palabra y hay que mirarlo dos veces:");
p("`MERCADO LIBRE` engancha con `COMPAÑIA ADMINIST DEL MERCADO MAYORISTA ELECTRICO`");
p("nada más que por la palabra *MERCADO*, y es otra empresa. Eso, cargado sin mirar,");
p("manda 33 órdenes de compra al CUIT equivocado.");
p();
p("| RI | Proveedor del SdG | Candidato en Odoo | CUIT que le pondría | Empresas | Seguridad |");
p("|---:|---|---|---|---|---|");
for (const s of conCandidato)
  for (const c of s.candidatos)
    p(
      `| ${c === s.candidatos[0] ? s.ri : ""} | ${c === s.candidatos[0] ? s.nombre : ""} | ${c.nombre} | \`${c.vat || "—"}\` | ${c.empresas.join(", ")} | ${c.ratio >= 1 ? "entero" : "**parcial**"} |`
    );
p();
p(`### Sin ningún candidato — ${sinCandidato.length} proveedores, ${sinCandidato.reduce((s, x) => s + x.ri, 0)} RI`);
p();
p("O están en Odoo con un nombre que no se parece, o no están. Hay que buscarlos a mano");
p("o darlos de alta allá.");
p();
for (const s of sinCandidato) p(`- ${s.ri} RI — **${s.nombre}**`);
p();
p(`## 3. ${[...ambasParcial.values()].reduce((a, b) => a + b, 0)} RI de pedidos AMBAS con el proveedor en una sola empresa`);
p();
p("El proveedor está enlazado, pero sólo en una de las dos. Un RI que pagan las dos");
p("necesita las dos órdenes, así que falta darlo de alta en Odoo en la otra empresa.");
p();
for (const [id, n] of [...ambasParcial.entries()].sort((a, b) => b[1] - a[1])) {
  const pr = delSdG.find((x: any) => x.id === id);
  const tiene = enl.filter((e) => e.proveedor_id === id).map((e) => nombreEmpresa.get(e.empresa_id));
  p(`- ${n} RI — **${pr?.nombre}** (cuit ${pr?.cuit ?? "—"}) — sólo en ${tiene.join(", ")}`);
}
p();
p(`## 4. ${cruce.sinEnlazar.filter((s) => s.motivo === "no esta en odoo").length} con CUIT que no están en Odoo — 0 RI en PEDIDO`);
p();
p("Tienen CUIT válido y ningún partner con ese CUIT del otro lado. **Ninguno tiene");
p("pedidos hoy**, así que no urge: se resuelven cuando aparezca el primero.");
p();
for (const s of cruce.sinEnlazar.filter((x) => x.motivo === "no esta en odoo")) p(`- ${s.nombre} — \`${s.cuit}\``);
p();

writeFileSync("docs/COMPRAS-PROVEEDORES-ODOO.md", md.join("\n"), "utf-8");
console.log(`duplicados: ${duplicados.length} (${riDup} RI)`);
console.log(`sin cuit con RI: ${sinCuit.length} | con candidato: ${conCandidato.length} (${riCand} RI) | sin candidato: ${sinCandidato.length}`);
console.log(`AMBAS parcial: ${ambasParcial.size} proveedores, ${[...ambasParcial.values()].reduce((a, b) => a + b, 0)} RI`);
console.log(">>> docs/COMPRAS-PROVEEDORES-ODOO.md");
