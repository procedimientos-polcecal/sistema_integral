"use client";

import { useEffect, useState } from "react";
import Select from "@/components/Select";
import { estadoSegunElCierre } from "@/lib/mantenimiento/cierreDeOT";
import { loQueFaltaParaCrear } from "@/lib/mantenimiento/altaDeOT";
import { PRIORIDADES_DE_OT, TIPOS_DE_OT, QUIENES_DE_OT } from "@/lib/mantenimiento/filtrosOt";
import { avisoDelPendiente } from "@/lib/mantenimiento/reintentoDePendientes";
import { ESPECIALIDADES } from "@/lib/mantenimiento/ordenes";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { AYUDA_GUT, ESCALAS_GUT } from "@/lib/mantenimiento/gut";
import InfoTip from "@/components/InfoTip";
import {
  copiarDeLaOT, numeroDeOT, avisoDeReutilizada, type Vocabulario,
} from "@/lib/mantenimiento/reutilizarOT";
import RepuestosDeLaOT from "@/components/RepuestosDeLaOT";
import type { LineaDeRepuesto } from "@/lib/mantenimiento/repuestosDeLaOT";

/**
 * Los cuatro vocabularios, de `lib/`, no una copia.
 *
 * LA PRIORIDAD YA HABÍA PASADO POR ESTO. Tenía la suya —`["ALTA", "MEDIA",
 * "BAJA"]`— y el 16/10/2026 se vio lo que costaba: lo que se elegía acá no era
 * lo que decía el filtro del listado, así que una OT creada desde la app no
 * aparecía al filtrar por «Media». El servidor igual lo traduce, pero **lo que
 * se elige tiene que ser lo que se filtra**.
 *
 * Y LAS OTRAS TRES SEGUÍAN IGUAL HASTA EL 21/10/2026, con el mismo agujero y
 * sin que nada lo notara: ofrecían INSTRUMENTACIÓN y OTRO, que no estaban en
 * `ESPECIALIDADES`; PREDICTIVO y MEJORA, que no estaban en `TIPOS_DE_OT`; y
 * MIXTO, que no estaba en `QUIENES_DE_OT`. Y la de especialidades, además, **no
 * ofrecía LUBRICACIÓN**, así que desde acá no se podía crear ninguna de las de
 * ese oficio ni copiar las 7 que existen. Los cinco valores de más se sumaron
 * al vocabulario; el porqué medido está en los encabezados de `ordenes.ts` y
 * `filtrosOt.ts`.
 *
 * Mientras esta lista salga de `lib/`, elegir y filtrar no se pueden separar.
 */
const PRIORIDADES = PRIORIDADES_DE_OT;
/**
 * Los estados **sí** son una lista propia, y es a propósito: es un
 * subconjunto de `ESTADOS_DE_OT` —le falta SUSPENDIDA— porque una OT no nace
 * suspendida, y lleva etiquetas de pantalla que el vocabulario no tiene.
 * Ofrecer menos no abre el agujero de arriba; ofrecer de más, sí.
 */
const ESTADOS_OT = [
  { value: "POR_HACER",  label: "Por hacer" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "REALIZADO",  label: "Realizado" },
  { value: "ATRASADO",   label: "Atrasado" },
];

/**
 * Lo que los desplegables de este formulario pueden mostrar.
 *
 * Sale de las mismas constantes que se renderizan, no de una copia: una OT
 * vieja con un valor que no está acá no se copia, y se avisa. Copiarla dejaría
 * el desplegable en "—" y el formulario guardando otra cosa.
 *
 * **Las 7 OT con especialidad LUBRICACIÓN ya se copian**, desde el 21/10/2026.
 * Eran el ejemplo que ilustraba esta regla, y en realidad eran un síntoma de la
 * otra: no se copiaban porque la lista de arriba era una copia a mano que no
 * tenía LUBRICACIÓN. Ahora que sale de `lib/`, el único valor que de verdad
 * puede quedar afuera es el de una OT vieja con algo que nadie ofrece hoy — que
 * es para lo que esto existe.
 */
const VOCABULARIO: Vocabulario = {
  especialidades: ESPECIALIDADES,
  tipos: TIPOS_DE_OT,
  quien: QUIENES_DE_OT,
  estados: ESTADOS_OT.map(o => o.value),
  prioridades: PRIORIDADES,
};

export default function NuevaOTModal({ sectores, equipos, onClose, onCreated }: {
  sectores: any[];
  equipos: any[];
  onClose: () => void;
  /** Se creó. `aviso` es lo que no salió del todo, para que se muestre. */
  onCreated: (aviso?: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  /* ── Reutilizar una OT vieja ──────────────────────────────────────────
   * Se cargan trabajos ya hechos en tanda, varios del mismo día y con la
   * misma gente. `vieneDe` queda puesto hasta que se guarda: es lo que
   * sostiene la barra que pide revisar, porque estos campos no los escribió
   * quien está mirando la pantalla. */
  const [numeroViejo, setNumeroViejo] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [errorAlTraer, setErrorAlTraer] = useState("");
  const [vieneDe, setVieneDe] = useState<string | null>(null);

  async function traerLaVieja() {
    const numero = numeroDeOT(numeroViejo);
    if (!numero) { setErrorAlTraer("Poné el número de la OT que querés copiar."); return; }

    setTrayendo(true); setErrorAlTraer("");
    try {
      const res = await fetch(`/api/mantenimiento/ordenes/reutilizar?numero=${numero}`);
      const body = await res.json().catch(() => ({}));
      // Nada se toca si no se pudo traer: lo que ya hubiera escrito queda.
      if (!res.ok) { setErrorAlTraer(body.error ?? "No se pudo traer esa OT."); return; }

      const { campos, lineas, noEntraron } = copiarDeLaOT(body.data, VOCABULARIO);
      setForm(prev => ({ ...prev, ...campos }));
      // Un renglón vacío y no una lista vacía: el formulario tiene que quedar
      // listo para escribir, igual que recién abierto.
      setRepuestos(lineas.length > 0 ? lineas : [{ cantidad: "", nombre: "" }]);
      setVieneDe(avisoDeReutilizada(numero, noEntraron));
    } catch {
      setErrorAlTraer("No se pudo traer esa OT.");
    } finally {
      setTrayendo(false);
    }
  }

  // La lista de Configuración, igual que al registrar el trabajo hecho: se
  // elige de ella en vez de escribir. Escribir el nombre cada vez es cómo
  // "Piparo" y "piparo" terminan siendo dos personas, y cómo la orden deja de
  // sumar horas a nadie.
  const [operarios, setOperarios] = useState<{ id: string; slot: number; nombre: string }[]>([]);
  // Los proveedores marcados como contratistas —hoy PIPARO y CANDIA—. Se elige
  // de la lista en vez de escribir, igual que al registrar el trabajo hecho:
  // es lo que evita que "Candia" y "CANDIA" terminen siendo dos.
  const [contratistas, setContratistas] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      fetch("/api/mantenimiento/operarios").then((r) => (r.ok ? r.json() : { data: [] })),
      fetch("/api/mantenimiento/proveedores").then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([o, c]) => {
        if (!vigente) return;
        setOperarios(o.data ?? []);
        setContratistas(c.data ?? []);
      })
      .catch(() => {});
    return () => { vigente = false; };
  }, []);

  /*
   * Los repuestos van aparte de `form` y no adentro: `form` se derrama entero
   * al cuerpo del POST con `...form`, y una lista no es un campo de texto.
   * Arranca con un renglón vacío para que el formulario se vea como antes —un
   * campo listo para escribir— y no como una lista que hay que estrenar.
   */
  const [repuestos, setRepuestos] = useState<LineaDeRepuesto[]>([{ cantidad: "", nombre: "" }]);

  const [form, setForm] = useState({
    equipment_id:   "",
    sector_id:      "",
    especialidad:   "",
    tipo:           "CORRECTIVO",
    quien:          "INTERNO",
    descripcion:    "",
    fecha:          hoyEnArgentina(),
    fecha_ejecucion: "",
    fecha_cierre:   "",
    estado:         "POR_HACER",
    contratista:    "",
    horas:          "",
    operario_1:     "",
    operario_2:     "",
    operario_3:     "",
    prioridad:      "🟡 Media",
    // Las tres notas GUT arrancan VACÍAS, y no a la manera de `prioridad`
    // (que arranca en Media y no tiene opción vacía): tres desplegables en 3
    // fabricarían un 27 que nadie contestó, impreso como si fuera una medición.
    gut_gravedad:   "",
    gut_urgencia:   "",
    gut_tendencia:  "",
    requiere_parada_sector: false,
  });

  function f(key: string, value: string | boolean) {
    setForm(p => {
      const next: any = { ...p, [key]: value };
      if (key === "equipment_id" && value) {
        const eq = equipos.find((e: any) => e.id === value);
        if (eq) next.sector_id = eq.sector_id ?? "";
      }
      return next;
    });
  }

  /** Si esta orden nace cerrada. Lo decide la fecha, no el desplegable. */
  const cierraAlCrearse = estadoSegunElCierre(form.fecha_cierre, form.estado) === "REALIZADO"
    && Boolean(form.fecha_cierre.trim());

  const filteredEquip = form.sector_id
    ? equipos.filter((e: any) => e.sector_id === form.sector_id)
    : equipos;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Todo lo que falta, de una sola vez: los obligatorios de siempre y, si
    // viene con fecha de cierre, también las horas y quién la hizo. Un solo
    // mensaje — que un campo sea obligatorio siempre o sólo al cerrar es una
    // distinción del código, no de quien está completando.
    const falta = loQueFaltaParaCrear(form);
    if (falta.length > 0) {
      setError(`Falta cargar ${falta.join(", ")}.`);
      return;
    }
    setSaving(true); setError("");

    const eq = equipos.find((eq: any) => eq.id === form.equipment_id);
    const sec = sectores.find((s: any) => s.id === form.sector_id);

    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        // Los renglones; la ruta arma con ellos el texto de la celda de la
        // planilla, que tiene una sola.
        repuestos,
        horas:       form.horas ? Number(form.horas) : null,
        // Sin elegir viaja como null, no como 0 ni como "": una nota que nadie
        // puso no puede quedar guardada como si fuera una.
        gut_gravedad:  form.gut_gravedad  ? Number(form.gut_gravedad)  : null,
        gut_urgencia:  form.gut_urgencia  ? Number(form.gut_urgencia)  : null,
        gut_tendencia: form.gut_tendencia ? Number(form.gut_tendencia) : null,
        // El mismo cálculo que hace el servidor. Mandarlo igual es para que lo
        // que se vio en pantalla sea lo que viaja; quien decide es la ruta.
        estado:      estadoSegunElCierre(form.fecha_cierre, form.estado),
        equipo_raw:  eq ? `${eq.code} – ${eq.name}` : null,
        equipo_code: eq?.code ?? null,
        sector_raw:  sec?.nombre ?? null,
        equipment_id: form.equipment_id || null,
        sector_id:   form.sector_id || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Error al crear"); setSaving(false); return; }

    // Lo que salió a medias se dice, no se calla. La OT se creó —por eso el
    // modal se cierra igual— pero si el aviso del que nació no quedó marcado,
    // alguien puede generar una segunda orden para el mismo problema. Este
    // valor se devolvía desde siempre y nadie lo leía: el 16/10/2026 una OT no
    // llegó a la planilla y la pantalla no dijo una palabra.
    // Y lo mismo con lo que no llegó a la planilla. Que el estado o las horas
    // queden pendientes es lo normal recién creada —la fila del master tarda—,
    // así que se dice sin sonar a error. El texto lo arma `avisoDelPendiente`,
    // en `lib/`, porque las tres pantallas que crean una OT decían tres cosas
    // distintas y ésta prometía «la próxima sincronización», que en la práctica
    // son entre 3 y 5 horas. Hoy el sistema reintenta solo durante 4 minutos.
    const aMedias = [
      data.aviso_error,
      avisoDelPendiente(data.planilla_error, data.planilla_reintentando),
      data.repuestos_error,
    ].filter(Boolean) as string[];

    onCreated(aMedias.length ? aMedias.join(" ") : null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Nueva Orden de Trabajo</h2>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {/* Arriba de todo y no escondido entre los campos: es lo primero que
              se hace cuando se carga una tanda de órdenes del mismo día. */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
            <label className="block text-xs font-medium text-slate-600">
              Reutilizar una OT
            </label>
            <div className="flex gap-2">
              <input
                value={numeroViejo}
                onChange={e => { setNumeroViejo(e.target.value); setErrorAlTraer(""); }}
                /* Enter traería la OT y además mandaría el formulario: dentro
                   de un <form>, un input suelto lo envía. Acá se corta y se
                   hace sólo lo primero. */
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); traerLaVieja(); } }}
                className="input flex-1 min-w-0"
                placeholder="N° de OT — ej: 2814"
                inputMode="numeric"
                aria-label="Número de la OT a reutilizar"
              />
              <button
                type="button"
                onClick={traerLaVieja}
                disabled={trayendo}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >{trayendo ? "Trayendo…" : "Traer"}</button>
            </div>
            <p className="text-xs text-slate-500">
              Copia todo menos las fechas, que las ponés vos.
            </p>
            {errorAlTraer && <p className="text-sm text-red-600">{errorAlTraer}</p>}
          </div>

          {/* La barra queda hasta que se guarda. Estos campos no los escribió
              quien está mirando, y ésa es toda la razón por la que existe. */}
          {vieneDe && (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {vieneDe}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <F label="Sector" required>
              <Select value={form.sector_id} onChange={e => f("sector_id", e.target.value)} className="input">
                <option value="">— Todos —</option>
                {sectores.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.empresas?.nombre ?? "Transversal"} · {s.nombre}</option>
                ))}
              </Select>
            </F>
            <F label="Equipo" required>
              <Select value={form.equipment_id} onChange={e => f("equipment_id", e.target.value)} className="input">
                <option value="">— Sin asignar —</option>
                {filteredEquip.map((eq: any) => (
                  <option key={eq.id} value={eq.id}>{eq.code} – {eq.name}</option>
                ))}
              </Select>
            </F>
          </div>

          <F label="Descripción del trabajo" required>
            <textarea value={form.descripcion} onChange={e => f("descripcion", e.target.value)}
              rows={3} className="input resize-none" placeholder="Describí el trabajo a realizar..." />
          </F>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <F label="Especialidad" required>
              <Select value={form.especialidad} onChange={e => f("especialidad", e.target.value)} className="input">
                <option value="">—</option>
                {ESPECIALIDADES.map(v => <option key={v} value={v}>{v}</option>)}
              </Select>
            </F>
            <F label="Tipo" required>
              <Select value={form.tipo} onChange={e => f("tipo", e.target.value)} className="input">
                {TIPOS_DE_OT.map(v => <option key={v} value={v}>{v}</option>)}
              </Select>
            </F>
            <F label="Quién realiza" required>
              <Select value={form.quien} onChange={e => f("quien", e.target.value)} className="input">
                {QUIENES_DE_OT.map(v => <option key={v} value={v}>{v}</option>)}
              </Select>
            </F>
          </div>

          <F label="Repuestos utilizados">
            <RepuestosDeLaOT lineas={repuestos} onCambiar={setRepuestos} deshabilitado={saving} />
          </F>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <F label="Fecha creación">
              <input type="date" value={form.fecha} onChange={e => f("fecha", e.target.value)} className="input" />
            </F>
            <F label="Fecha ejecución" required>
              <input type="date" value={form.fecha_ejecucion} onChange={e => f("fecha_ejecucion", e.target.value)} className="input" />
            </F>
            <F label="Fecha cierre">
              <input type="date" value={form.fecha_cierre} onChange={e => f("fecha_cierre", e.target.value)} className="input" />
            </F>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Con fecha de cierre el estado deja de ser una pregunta: la orden
                ya se hizo. Se muestra fijo en vez de esconderse, para que lo
                que se ve sea lo que se guarda — el servidor aplica la misma
                regla, así que esconderlo dejaría la pantalla diciendo una cosa
                y la base otra. */}
            <F label="Estado inicial">
              {cierraAlCrearse ? (
                <p className="input flex items-center bg-slate-50 text-slate-600">
                  Realizado <span className="ml-2 text-xs text-slate-400">— tiene fecha de cierre</span>
                </p>
              ) : (
                <Select value={form.estado} onChange={e => f("estado", e.target.value)} className="input">
                  {ESTADOS_OT.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              )}
            </F>
            <F label="Prioridad">
              <Select value={form.prioridad} onChange={e => f("prioridad", e.target.value)} className="input">
                {PRIORIDADES.map(v => <option key={v} value={v}>{v}</option>)}
              </Select>
            </F>
            <F label="Horas estimadas">
              <input type="number" value={form.horas} onChange={e => f("horas", e.target.value)}
                className="input" placeholder="—" min={0} step={0.5} />
            </F>
          </div>

          {/* Puntaje GUT: opcional y sin valor por defecto. Las tres van juntas
              o no cuenta ninguna; con una sola o dos, la orden queda sin
              puntaje y se puede completar después. */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-600">
              Puntaje GUT <span className="text-slate-400 font-normal">— opcional, las tres juntas</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {([
                ["gut_gravedad",  "Gravedad",  ESCALAS_GUT.gravedad],
                ["gut_urgencia",  "Urgencia",  ESCALAS_GUT.urgencia],
                ["gut_tendencia", "Tendencia", ESCALAS_GUT.tendencia],
              ] as const).map(([campo, etiqueta, escala]) => (
                <F key={campo} label={etiqueta} ayuda={AYUDA_GUT[campo]}>
                  <Select value={form[campo]} onChange={e => f(campo, e.target.value)} className="input">
                    <option value="">—</option>
                    {escala.map((palabra, i) => (
                      <option key={i + 1} value={String(i + 1)}>{i + 1} · {palabra}</option>
                    ))}
                  </Select>
                </F>
              ))}
            </div>
          </div>

          {(form.quien === "CONTRATADO" || form.quien === "MIXTO") && (
            <F label="Contratista">
              <Select value={form.contratista} onChange={e => f("contratista", e.target.value)} className="input">
                <option value="">—</option>
                {/* Si vino copiado de una OT vieja y no está en la lista, se
                    suma para no perderlo al guardar: la planilla escribió ese
                    nombre y borrarlo sería corregir hacia atrás. */}
                {[...new Set([
                  ...contratistas.map((c) => c.nombre),
                  ...(form.contratista ? [form.contratista] : []),
                ])].sort().map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </F>
          )}
          {/* Cada columna de la orden tiene su propia lista de gente: quién
              puede ir primero no es quién puede ir tercero. Es el mismo `slot`
              que usa el modal de registrar. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([1, 2, 3] as const).map((slot) => {
              const campo = `operario_${slot}` as "operario_1" | "operario_2" | "operario_3";
              const elegido = form[campo];
              const suyos = operarios.filter((o) => o.slot === slot).map((o) => o.nombre);
              return (
                <F key={slot} label={`Operario ${slot}`}>
                  <Select
                    value={elegido}
                    onChange={(e) => f(campo, e.target.value)}
                    className="input"
                  >
                    <option value="">—</option>
                    {[...new Set([...suyos, ...(elegido ? [elegido] : [])])].sort().map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </Select>
                </F>
              );
            })}
          </div>

          {/* Va con el resto del formulario y no escondido entre los campos:
              decide si el trabajo frena la produccion del sector. */}
          <label
            className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: form.requiere_parada_sector ? "#FECACA" : "#E2E8F0",
              background: form.requiere_parada_sector ? "#FEF2F2" : "#fff",
            }}
          >
            <input
              type="checkbox"
              checked={form.requiere_parada_sector}
              onChange={(e) => f("requiere_parada_sector", e.target.checked)}
            />
            <span
              className="text-sm font-medium"
              style={{ color: form.requiere_parada_sector ? "#DC2626" : "#374151" }}
            >
              Este trabajo requiere parar el sector
            </span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1 border-t border-slate-100">
            <button type="submit" disabled={saving}
              className="btn-primary disabled:opacity-50">
              {saving ? "Guardando..." : "Crear OT"}
            </button>
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function F({ label, required, ayuda, children }: {
  label: string; required?: boolean; ayuda?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {ayuda && <> <InfoTip text={ayuda} /></>}
      </label>
      {children}
    </div>
  );
}
