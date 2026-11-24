"use client";

import { useState } from "react";
import MultiSelect from "@/components/MultiSelect";
import type { ProveedorElegible } from "@/lib/compras/comparativa";

/**
 * Dar de alta un proveedor sin salir de la carga del presupuesto.
 *
 * El CUIT es obligatorio acá y no en `/compras/proveedores`, y la razón es la
 * cadena que este modal existe para destrabar: cargar el presupuesto y, si
 * avanza, generarle la orden de compra. Esa orden necesita el `partner_id` de
 * Odoo, y sin CUIT no se puede ni buscar si el proveedor ya está allá ni
 * crearlo sin arriesgar un duplicado en la contabilidad.
 *
 * Tres desenlaces, y los tres se dicen en pantalla porque significan cosas
 * distintas: quedó enlazado, no está en Odoo todavía (y se va a crear al
 * generar la orden), o hay varios candidatos y no se puede elegir solo.
 */

interface ProblemaDelAlta {
  campo: "nombre" | "cuit";
  mensaje: string;
  proveedorExistente?: { id: string; nombre: string };
}

interface Parecido {
  id: string;
  nombre: string;
  cuit: string | null;
}

interface Resultado {
  enlaces: { empresa: string; partnerId: number }[];
  sinEnlazar: { empresa: string; motivo: string }[];
  avisoDeOdoo: string | null;
}

/**
 * El vocabulario sale del padrón, no de la cabeza de quien escribe el modal.
 *
 * Medido el 24/11/2026 sobre las 113 filas de `proveedores` con `forma_pago`
 * cargada: `ECHEQ` 37, `CTA CTE` 28, `TRANSFERENCIA` 10, `CONTADO` 7,
 * `CHEQUE` 2, `EFECTIVO` 1. La primera versión de este modal ofrecía
 * «Transferencia, Cheque, Efectivo, **Tarjeta**» en minúscula: `Tarjeta` no
 * aparece ni una vez, y los **dos más usados —65 de 113— no estaban**. O sea
 * que quien daba de alta al proveedor más común no podía elegir su forma de
 * pago y la dejaba vacía, justo el campo que después se autocompleta solo en
 * el presupuesto siguiente y que `datosDePagoDe()` concatena en Condiciones.
 *
 * Van en MAYÚSCULA porque así están las 113, y de a varias porque **24 de
 * ellas tienen más de una** separadas por coma: `ECHEQ, CHEQUE` es la tercera
 * combinación más frecuente. Un desplegable de uno solo obligaría a elegir
 * cuál de las dos mentir.
 */
const FORMAS_DE_PAGO: [string, string][] = [
  ["ECHEQ", "ECHEQ"],
  ["CTA CTE", "CTA CTE"],
  ["TRANSFERENCIA", "TRANSFERENCIA"],
  ["CONTADO", "CONTADO"],
  ["CHEQUE", "CHEQUE"],
  ["EFECTIVO", "EFECTIVO"],
];

export default function NuevoProveedorModal({
  requerimientoId, onCerrar, onCreado, onUsarExistente,
}: {
  requerimientoId: string;
  onCerrar: () => void;
  onCreado: (proveedor: ProveedorElegible, resultado: Resultado) => void;
  /** Elegir uno del padrón en vez de crear: el camino que evita el duplicado. */
  onUsarExistente: (id: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [cuit, setCuit] = useState("");
  const [rubro, setRubro] = useState("");
  const [contacto, setContacto] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [notas, setNotas] = useState("");
  const [esContratista, setEsContratista] = useState(false);
  const [plazo, setPlazo] = useState("");
  const [condicion, setCondicion] = useState("");
  const [formasPago, setFormasPago] = useState<string[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [problemas, setProblemas] = useState<ProblemaDelAlta[]>([]);
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [error, setError] = useState("");

  const problemaDe = (campo: "nombre" | "cuit") => problemas.find((p) => p.campo === campo);
  const yaExiste = problemas.find((p) => p.proveedorExistente)?.proveedorExistente;

  async function guardar(confirmarParecidos: boolean) {
    setGuardando(true);
    setError("");
    setProblemas([]);
    /*
     * Los parecidos del intento anterior **también** se limpian. Si no, quien
     * cambia el nombre después del 409 sigue viendo la lista vieja, y como el
     * botón principal vuelve a mandar `confirmar_parecidos: false`, un segundo
     * intento con el mismo nombre repinta lo mismo y parece que no pasó nada.
     */
    setParecidos([]);

    const res = await fetch("/api/compras/proveedores/con-odoo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nombre: nombre.trim(),
        cuit: cuit.trim(),
        rubro: rubro.trim() || null,
        contacto: contacto.trim() || null,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        notas: notas.trim() || null,
        es_contratista: esContratista,
        plazo_pago_dias: plazo.trim() === "" ? null : Number(plazo),
        condicion_pago: condicion.trim() || null,
        forma_pago: formasPago.join(", ") || null,
        requerimiento_id: requerimientoId,
        confirmar_parecidos: confirmarParecidos,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (res.status === 400) return setProblemas(body.problemas ?? []);
    if (res.status === 409) return setParecidos(body.parecidos ?? []);
    if (!res.ok) return setError(body.error ?? "No se pudo dar de alta el proveedor.");

    onCreado(body.proveedor as ProveedorElegible, {
      enlaces: body.enlaces ?? [],
      sinEnlazar: body.sinEnlazar ?? [],
      avisoDeOdoo: body.avisoDeOdoo ?? null,
    });
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-10 w-full max-w-2xl rounded-xl bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-bold text-slate-900">Nuevo proveedor</h2>
          <p className="text-sm text-slate-500">
            El CUIT es obligatorio: es con lo que se lo reconoce en Odoo para poder
            generarle después la orden de compra.
          </p>
        </div>

        <div className="space-y-3 px-6 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {yaExiste && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Ese CUIT ya es de <strong>{yaExiste.nombre}</strong>.{" "}
              <button
                type="button"
                onClick={() => onUsarExistente(yaExiste.id)}
                className="font-semibold underline"
              >
                Usar ése
              </button>
            </div>
          )}

          {parecidos.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="mb-1.5">
                Ya hay {parecidos.length === 1 ? "un proveedor" : "proveedores"} con un nombre
                parecido. ¿Es alguno de éstos?
              </p>
              <ul className="mb-2 space-y-1">
                {parecidos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onUsarExistente(p.id)}
                      className="font-semibold underline"
                    >
                      {p.nombre}
                    </button>
                    {p.cuit && <span className="ml-1.5 text-amber-700">· {p.cuit}</span>}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => guardar(true)}
                disabled={guardando}
                className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-semibold"
              >
                Ninguno, es uno nuevo
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Nombre" ancho="sm:col-span-2" error={problemaDe("nombre")?.mensaje}>
              <Texto valor={nombre} set={setNombre} />
            </Campo>
            <Campo label="CUIT" error={yaExiste ? undefined : problemaDe("cuit")?.mensaje}>
              <Texto valor={cuit} set={setCuit} />
            </Campo>

            <Campo label="Rubro"><Texto valor={rubro} set={setRubro} /></Campo>
            <Campo label="Contacto"><Texto valor={contacto} set={setContacto} /></Campo>
            <Campo label="Teléfono"><Texto valor={telefono} set={setTelefono} /></Campo>

            <Campo label="Email" ancho="sm:col-span-2"><Texto valor={email} set={setEmail} /></Campo>
            <Campo label="Plazo de pago (días)">
              <Texto valor={plazo} set={setPlazo} />
            </Campo>

            <Campo label="Forma de pago">
              <MultiSelect
                valores={formasPago}
                onCambio={setFormasPago}
                vacio="Sin especificar"
                plural="formas"
                opciones={FORMAS_DE_PAGO}
              />
            </Campo>
            <Campo label="Condición de pago" ancho="sm:col-span-2">
              <Texto valor={condicion} set={setCondicion} />
            </Campo>

            <Campo label="Notas" ancho="sm:col-span-3"><Texto valor={notas} set={setNotas} /></Campo>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={esContratista}
              onChange={(e) => setEsContratista(e.target.checked)}
            />
            Es contratista
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => guardar(false)}
            disabled={guardando || !nombre.trim() || !cuit.trim()}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Crear proveedor"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, ancho = "", error, children }: {
  label: string;
  ancho?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function Texto({ valor, set }: { valor: string; set: (v: string) => void }) {
  return (
    <input
      value={valor}
      onChange={(e) => set(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
    />
  );
}
