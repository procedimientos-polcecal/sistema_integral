"use client";

import { useState } from "react";
import { moneda, fecha } from "@/lib/compras/constants";
import {
  totalCotizacion, PLAZOS_PAGO, DISPONIBILIDADES, plazosAlCambiarDeProveedor, mismosPlazos,
  datosDePagoDe, alCambiarDeProveedor, type ProveedorElegible,
} from "@/lib/compras/comparativa";
import SelectorProveedor from "../../SelectorProveedor";
import NuevoProveedorModal from "./NuevoProveedorModal";
import MultiSelect from "@/components/MultiSelect";
import Select from "@/components/Select";

/**
 * Cargar un presupuesto, con los campos de la planilla.
 *
 * Los porcentajes se escriben como los diría una persona —10, no 0.1— y se
 * convierten a fracción al guardar, que es como los guarda la planilla.
 *
 * El total se muestra mientras se escribe con la misma fórmula que calcula la
 * base, para que no haya sorpresa entre lo que se ve y lo que queda guardado.
 *
 * Al elegir el proveedor se completan solos el plazo y las condiciones de pago,
 * que administración ya lleva en la base de proveedores. La disponibilidad no:
 * depende de qué se esté comprando, no de a quién.
 */
export default function PresupuestoForm({
  requerimientoId, proveedores, cantidadSugerida, dolar, onListo, onCancelar,
}: {
  requerimientoId: string;
  proveedores: ProveedorElegible[];
  cantidadSugerida: number | null;
  /** Con qué convertir si el proveedor cotiza en dólares. */
  dolar: { venta: number; fecha: string; alDia: boolean } | null;
  onListo: (aviso: string | null) => void;
  onCancelar: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [marca, setMarca] = useState("");
  const [unidad, setUnidad] = useState("");
  const [unitario, setUnitario] = useState("");
  // Se llama `divisa` y no `moneda` porque ese nombre ya lo usa el formateador
  // de importes que este archivo importa.
  const [divisa, setDivisa] = useState<"ARS" | "USD">("ARS");
  const [cantidad, setCantidad] = useState(cantidadSugerida ? String(cantidadSugerida) : "");
  const [envio, setEnvio] = useState("");
  const [descuento, setDescuento] = useState("0");
  const [iva, setIva] = useState("21");
  const [precioHasta, setPrecioHasta] = useState("");
  // Cuotas, no una opción: [30, 60] es "una parte a 30 días y otra a 60".
  const [plazos, setPlazos] = useState<number[]>([]);
  const [condiciones, setCondiciones] = useState("");
  const [disponibilidad, setDisponibilidad] = useState("");
  const [comentario, setComentario] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /*
   * El alta de un proveedor que no está en la lista. La lista vive acá en vez
   * de recargar la página a propósito: recargar perdería lo que ya se tipeó
   * del presupuesto, que es justo lo que el botón viene a evitar.
   */
  const [abrirAlta, setAbrirAlta] = useState(false);
  const [nuevos, setNuevos] = useState<ProveedorElegible[]>([]);
  const [avisoDelAlta, setAvisoDelAlta] = useState<string | null>(null);
  const lista = [...proveedores, ...nuevos];

  // Lo último que puso el autocompletado. Sirve para dos cosas: saber qué se
  // puede reemplazar al cambiar de proveedor sin pisar lo que escribió una
  // persona, y avisar en pantalla de dónde salió cada valor.
  const [traido, setTraido] = useState<{ plazos: number[]; condiciones: string }>({
    plazos: [], condiciones: "",
  });

  function elegirProveedor(id: string) {
    setProveedorId(id);
    const datos = datosDePagoDe(lista.find((p) => p.id === id));
    setPlazos((actual) => plazosAlCambiarDeProveedor(actual, traido.plazos, datos.plazos));
    setCondiciones((actual) => alCambiarDeProveedor(actual, traido.condiciones, datos.condiciones));
    setTraido(datos);
  }

  /** Si el campo sigue mostrando lo que trajo la ficha del proveedor. */
  const delProveedor = (valor: string, puesto: string) => puesto !== "" && valor === puesto;

  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

  const total = totalCotizacion({
    precio_unitario: num(unitario),
    cantidad: num(cantidad),
    descuento: (num(descuento) ?? 0) / 100,
    iva: (num(iva) ?? 0) / 100,
    costo_envio: num(envio),
  });

  // El equivalente en pesos, para verlo mientras se escribe.
  const enPesos = divisa === "USD" && dolar ? Math.round(total * dolar.venta * 100) / 100 : null;

  async function guardar() {
    setGuardando(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/cotizaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proveedor_id: proveedorId,
        marca: marca.trim() || null,
        unidad_medida: unidad.trim() || null,
        precio_unitario: num(unitario),
        moneda: divisa,
        cantidad: num(cantidad),
        costo_envio: num(envio),
        descuento: (num(descuento) ?? 0) / 100,
        iva: (num(iva) ?? 0) / 100,
        precio_hasta: precioHasta || null,
        plazos_pago_dias: plazos,
        condiciones_pago: condiciones.trim() || null,
        disponibilidad: disponibilidad || null,
        comentario: comentario.trim() || null,
      }),
    });

    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setError(body.error ?? "No se pudo guardar el presupuesto.");
      return;
    }
    onListo(body.aviso_drive ?? null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {avisoDelAlta && (
        <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">{avisoDelAlta}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo label="Proveedor" ancho="sm:col-span-2">
          <div className="flex gap-1.5">
            <div className="flex-1">
              <SelectorProveedor
                proveedores={lista}
                valor={proveedorId}
                onCambio={elegirProveedor}
              />
            </div>
            <button
              type="button"
              onClick={() => setAbrirAlta(true)}
              className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Nuevo
            </button>
          </div>
        </Campo>
        <Campo label="Marca"><Texto valor={marca} set={setMarca} /></Campo>

        <Campo label="Precio unitario">
          <div className="flex gap-1.5">
            <Texto valor={unitario} set={setUnitario} />
            {/* La moneda es del presupuesto entero: si el proveedor cotiza en
                dólares, el envío también. */}
            <Select
              value={divisa}
              onChange={(e) => setDivisa(e.target.value as "ARS" | "USD")}
              aria-label="Moneda"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="ARS">$</option>
              <option value="USD">USD</option>
            </Select>
          </div>
        </Campo>
        <Campo label="Cantidad"><Texto valor={cantidad} set={setCantidad} /></Campo>
        <Campo label="Unidad de medida"><Texto valor={unidad} set={setUnidad} /></Campo>

        <Campo label="Envío"><Texto valor={envio} set={setEnvio} /></Campo>
        <Campo label="Descuento %"><Texto valor={descuento} set={setDescuento} /></Campo>
        <Campo label="IVA %"><Texto valor={iva} set={setIva} /></Campo>

        <Campo label="Precio válido hasta">
          <input
            type="date"
            value={precioHasta}
            onChange={(e) => setPrecioHasta(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </Campo>
        <Campo
          label="Plazos de pago"
          nota={
            plazos.length > 0 && mismosPlazos(plazos, traido.plazos) ? "del proveedor" : undefined
          }
        >
          {/*
            Varias cuotas a la vez: la columna PLAZOS de las comparativas ya se
            usa así —46 celdas medidas en 25 libros— y hasta ahora el sistema
            sólo podía guardar una, con el agravante de que "30, 60" entraba
            redondeado a 31 días.
          */}
          <MultiSelect
            valores={plazos.map(String)}
            onCambio={(v) => setPlazos(v.map(Number).sort((a, b) => a - b))}
            vacio="Sin definir"
            plural="cuotas"
            opciones={PLAZOS_PAGO.map((p) => [String(p), p === 0 ? "contado" : `${p} días`])}
          />
        </Campo>
        <Campo label="Disponibilidad">
          <Select
            value={disponibilidad}
            onChange={(e) => setDisponibilidad(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {DISPONIBILIDADES.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Campo>

        <Campo
          label="Condiciones de pago"
          ancho="sm:col-span-3"
          nota={delProveedor(condiciones, traido.condiciones) ? "del proveedor" : undefined}
        >
          <Texto valor={condiciones} set={setCondiciones} />
        </Campo>
        <Campo label="Comentario" ancho="sm:col-span-3">
          <Texto valor={comentario} set={setComentario} />
        </Campo>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <div className="text-sm text-slate-600">
          Total con IVA y envío:{" "}
          <strong className="font-mono">
            {divisa === "USD" ? `USD ${total.toLocaleString("es-AR")}` : moneda(total)}
          </strong>
          {/* Nadie tiene que confiar a ciegas en una conversión que no ve. */}
          {divisa === "USD" && (
            <span className="ml-2 text-xs text-slate-500">
              {enPesos === null ? (
                <span className="text-amber-700">
                  Sin cotización del dólar: se guarda en USD y se convierte cuando haya.
                </span>
              ) : (
                <>
                  ≈ <strong className="font-mono text-slate-700">{moneda(enPesos)}</strong>
                  {" a "}{moneda(dolar!.venta)}
                  {!dolar!.alDia && ` del ${fecha(dolar!.fecha)}`}
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancelar}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando || !proveedorId || unitario.trim() === ""}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar presupuesto"}
          </button>
        </div>
      </div>

      {abrirAlta && (
        <NuevoProveedorModal
          requerimientoId={requerimientoId}
          onCerrar={() => setAbrirAlta(false)}
          onUsarExistente={(id) => {
            elegirProveedor(id);
            setAbrirAlta(false);
            setAvisoDelAlta(null);
          }}
          onCreado={(proveedor, resultado) => {
            setNuevos((previos) => [...previos, proveedor]);
            elegirProveedor(proveedor.id);
            setAbrirAlta(false);
            setAvisoDelAlta(avisoDelResultado(resultado));
          }}
        />
      )}
    </div>
  );
}

/**
 * Qué decirle a quien acaba de dar de alta un proveedor.
 *
 * Los tres desenlaces significan cosas distintas y por eso se dicen distinto:
 * quedó enlazado, no está en Odoo todavía —y entonces se crea al generar la
 * orden, que no es un problema sino el plan—, o hay varios candidatos y hace
 * falta que alguien de administración elija.
 */
function avisoDelResultado(r: {
  enlaces: { empresa: string }[];
  sinEnlazar: { empresa: string; motivo: string }[];
  avisoDeOdoo: string | null;
}): string {
  if (r.avisoDeOdoo) {
    return `El proveedor quedó creado, pero no se pudo consultar Odoo: ${r.avisoDeOdoo}`;
  }

  const partes: string[] = [];
  if (r.enlaces.length) {
    partes.push(`Quedó enlazado con Odoo en ${r.enlaces.map((e) => e.empresa).join(" y ")}.`);
  }
  for (const s of r.sinEnlazar) partes.push(`${s.empresa}: ${s.motivo}`);
  if (!r.enlaces.length && !r.sinEnlazar.length) {
    partes.push("El proveedor quedó creado.");
  }
  if (!r.enlaces.length) {
    partes.push("Se va a crear en Odoo cuando se genere la orden de compra.");
  }
  return partes.join(" ");
}

function Campo({ label, ancho = "", nota, children }: {
  label: string;
  ancho?: string;
  /** De dónde salió el valor, cuando no lo escribió quien está mirando. */
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {nota && <span className="ml-1.5 font-normal normal-case text-slate-400">{nota}</span>}
      </span>
      {children}
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
