"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { urlDePlanilla } from "@/lib/compras/vincular";
import type { Cotizacion, RequerimientoConRelaciones } from "@/lib/compras/types";
import SelectorComparativa from "./SelectorComparativa";
import PresupuestoForm from "./PresupuestoForm";
import {
  totalesEnPesosDe, minimoEnPesos, eleccionDeLaPlanilla, type ProveedorElegible,
} from "@/lib/compras/comparativa";
import { moneda } from "@/lib/compras/constants";
import type { CotizacionDolar } from "@/lib/compras/dolar";
import ComparativaTabla from "./ComparativaTabla";
import ComparativaDecision from "./ComparativaDecision";

/**
 * La comparativa de un requerimiento.
 *
 * Compras adjunta la planilla de Drive, carga los presupuestos y designa a
 * quién le toca. La persona asignada aprueba la compra eligiendo uno: elegir es
 * el acto de aprobar, no un paso previo.
 *
 * Los mismos datos se muestran de dos maneras, porque son dos trabajos
 * distintos y el circuito ya los distingue:
 *
 *   - mientras Compras arma la comparativa, una fila por proveedor: compacta y
 *     con la acción de borrar a mano (ComparativaTabla).
 *   - cuando le toca decidir a la persona asignada, la comparación atributo por
 *     atributo (ComparativaDecision).
 *
 * Al aprobarse la compra la comparativa se congela: es el respaldo de por qué se
 * eligió ese precio.
 */
export default function Comparativa({
  requerimiento: r, cotizaciones, proveedores, puedeEditar, esAsignado, dolar,
}: {
  requerimiento: RequerimientoConRelaciones;
  cotizaciones: Cotizacion[];
  proveedores: ProveedorElegible[];
  puedeEditar: boolean;
  esAsignado: boolean;
  /** Con qué convertir los presupuestos que vinieron en dólares. */
  dolar: CotizacionDolar | null;
}) {
  const router = useRouter();
  const [selector, setSelector] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);

  const congelada = ["APROBADO", "PEDIDO", "RECIBIDO"].includes(r.estado_compra);
  const puedeCargar = puedeEditar && !congelada && r.estado_aprobacion === "APROBADA";
  const puedeElegir = esAsignado && r.estado_compra === "PARA_COMPRAR";

  // Todo en pesos, calculado una sola vez. El orden, el más barato y la
  // diferencia porcentual salen de los mismos números: si cada uno convirtiera
  // por su cuenta, la comparativa podría decir una cosa y el resaltado otra.
  const enPesos = totalesEnPesosDe(cotizaciones, dolar?.venta ?? null);

  // Ordenadas por total. Es información, no una decisión: el plazo, la
  // disponibilidad y la marca también pesan.
  const ordenadas = [...cotizaciones].sort(
    (a, b) => (enPesos[a.id] ?? Infinity) - (enPesos[b.id] ?? Infinity)
  );
  const minimo = minimoEnPesos(enPesos);

  /*
   * Qué dice la casilla de la columna ELECCIÓN de la planilla.
   *
   * Se muestra pero no se aplica: marcar la casilla no aprueba la compra, y no
   * es una limitación técnica sino la decisión que se tomó. Aprobar exige estar
   * en `compras_aprobadores` y tener el RI asignado, y una planilla de Drive no
   * puede saltear eso. Así que la planilla propone y una persona confirma.
   *
   * Sólo tiene sentido mostrarlo mientras la compra no esté decidida: después
   * la comparativa queda congelada y el aviso sería ruido.
   */
  const enLaPlanilla = eleccionDeLaPlanilla(cotizaciones);

  /*
   * ¿La compra está decidida de verdad?
   *
   * No es lo mismo que `congelada`. `congelada` mira el estado, y hay **35
   * requerimientos** cuyo estado dice APROBADO sin proveedor ni presupuesto
   * elegido: el estado vino de la columna de la planilla, no de que alguien
   * eligiera acá. En ésos la pantalla se congelaba y escondía todo lo que
   * permitía resolverlo, incluido este aviso — justo donde más sirve, porque 33
   * de los 35 tienen comparativa adjunta y la planilla probablemente ya tiene
   * la respuesta.
   */
  const decidida = cotizaciones.some((c) => c.elegida) || r.proveedor_id !== null;
  const trabada = congelada && !decidida;

  function refrescar(mensaje: string | null) {
    setAviso(mensaje);
    setSelector(false);
    setCargando(false);
    router.refresh();
  }

  /**
   * Relee la planilla adjunta.
   *
   * Se borran los presupuestos que habían venido de Drive —sobre esos manda la
   * planilla— y quedan intactos los que se cargaron acá. Lo resuelve la misma
   * ruta que adjuntar: es idempotente a propósito.
   */
  async function volverATraer() {
    if (!r.comparativa_drive_id) return;
    setTrayendo(true);
    setError("");

    const res = await fetch(`/api/compras/requerimientos/${r.id}/comparativa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drive_id: r.comparativa_drive_id, nombre: r.comparativa_nombre }),
    });
    const body = await res.json().catch(() => ({}));
    setTrayendo(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo releer la planilla.");
      return;
    }
    refrescar(`Se releyó la planilla: ${body.traidas} presupuesto(s).`);
  }

  async function elegir(cotizacion: Cotizacion) {
    setEligiendo(cotizacion.id);
    setError("");
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}/elegir`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setEligiendo(null);
    if (!res.ok) {
      setError(body.error ?? "No se pudo aprobar la compra.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  async function borrar(cotizacion: Cotizacion) {
    if (!confirm(`¿Borrar el presupuesto de ${cotizacion.proveedores?.nombre ?? "ese proveedor"}?`)) {
      return;
    }
    const res = await fetch(`/api/compras/cotizaciones/${cotizacion.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "No se pudo borrar.");
      return;
    }
    refrescar(body.aviso_drive ?? null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Comparativa de proveedores
          </h2>
          {/* Alcanza con el id del archivo: el nombre puede no saberse
              todavía. La sincronización enlaza la planilla que anotó la hoja de
              área —el link escondido detrás del "LINK" de la celda— y para eso
              no abre el archivo, así que no sabe cómo se llama. Antes esto
              colgaba del nombre y una comparativa recién sincronizada no se
              veía en ninguna parte de la ficha. */}
          {(r.comparativa_drive_id || r.comparativa_nombre) && (
            <p className="mt-0.5 text-sm text-slate-600">
              Planilla:{" "}
              {r.comparativa_drive_id ? (
                <a
                  href={urlDePlanilla(r.comparativa_drive_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {r.comparativa_nombre ?? "la que enlaza la planilla"}
                </a>
              ) : (
                r.comparativa_nombre
              )}
            </p>
          )}
        </div>

        {puedeCargar && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelector(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {r.comparativa_drive_id ? "Cambiar planilla" : "Elegir comparativa de Drive"}
            </button>
            {r.comparativa_drive_id && (
              <button
                onClick={volverATraer}
                disabled={trayendo}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {trayendo ? "Trayendo…" : "Volver a traer"}
              </button>
            )}
            {!cargando && (
              <button
                onClick={() => setCargando(true)}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--primary-dark)]"
              >
                Cargar presupuesto
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {aviso}
          </div>
        )}

        {!decidida && enLaPlanilla.tipo === "una" && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-900">
            <p>
              <strong>En la planilla eligieron a{" "}
              {enLaPlanilla.cotizacion.proveedores?.nombre ?? "un proveedor"}</strong>
              {enLaPlanilla.cotizacion.precio_total !== null &&
                ` — ${moneda(enLaPlanilla.cotizacion.precio_total)}`}
              .
            </p>
            {puedeElegir ? (
              <button
                onClick={() => elegir(enLaPlanilla.cotizacion)}
                disabled={eligiendo !== null}
                className="mt-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
              >
                {eligiendo ? "Confirmando…" : "Confirmar esta elección"}
              </button>
            ) : trabada ? (
              <p className="mt-1 text-xs text-sky-800">
                El estado dice <strong>compra aprobada</strong> pero no hay ningún
                presupuesto elegido, así que el sistema no deja confirmar. Para
                resolverlo, pasá el estado de la compra a <strong>Para comprar</strong> y
                volvé acá.
              </p>
            ) : (
              <p className="mt-1 text-xs text-sky-800">
                La confirma quien tenga la compra asignada: marcarla en la planilla no
                aprueba el gasto.
              </p>
            )}
          </div>
        )}

        {!decidida && enLaPlanilla.tipo === "varias" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>
              <strong>La planilla tiene {enLaPlanilla.cotizaciones.length} elecciones
              marcadas para este requerimiento:</strong>{" "}
              {enLaPlanilla.cotizaciones
                .map((c) => c.proveedores?.nombre ?? "sin proveedor")
                .join(", ")}
              .
            </p>
            {/*
              No se ofrece confirmar con un click: el requerimiento guarda un
              presupuesto elegido, así que quedarse con uno haría desaparecer el
              costo del otro sin que nadie se entere. Lo resuelve una persona,
              eligiendo abajo o corrigiendo la planilla.
            */}
            <p className="mt-1 text-xs text-amber-800">
              El sistema guarda un presupuesto elegido por requerimiento. Hay que elegir
              uno acá abajo, o dejar una sola casilla marcada en la planilla.
            </p>
          </div>
        )}

        {puedeElegir && ordenadas.length > 0 && (
          <p className="text-sm text-slate-600">
            Esta compra espera tu decisión. Elegir un presupuesto aprueba la compra.
          </p>
        )}

        {cargando && (
          <PresupuestoForm
            dolar={dolar}
            requerimientoId={r.id}
            proveedores={proveedores}
            cantidadSugerida={r.cantidad}
            onListo={(a) => refrescar(a)}
            onCancelar={() => setCargando(false)}
          />
        )}

        {ordenadas.length === 0 ? (
          <p className="text-sm text-slate-400">Todavía no hay presupuestos cargados.</p>
        ) : puedeElegir ? (
          <ComparativaDecision
            enPesos={enPesos}
            cotizaciones={ordenadas}
            minimo={minimo}
            onElegir={elegir}
            eligiendo={eligiendo}
          />
        ) : (
          <ComparativaTabla
            enPesos={enPesos}
            cotizaciones={ordenadas}
            minimo={minimo}
            puedeBorrar={puedeCargar}
            onBorrar={borrar}
          />
        )}

        {congelada && decidida && cotizaciones.length > 0 && (
          <p className="text-xs text-slate-400">
            La comparativa quedó congelada al aprobarse la compra.
          </p>
        )}
      </div>

      {selector && (
        <SelectorComparativa
          requerimientoId={r.id}
          onListo={(mensaje) => refrescar(mensaje)}
          onCerrar={() => setSelector(false)}
        />
      )}
    </section>
  );
}
