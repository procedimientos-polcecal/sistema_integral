"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { comoSeLee, diaDeLaSemana, semanaDe } from "@/lib/core/fechas";
import type { DiaDelCalendario } from "@/lib/mantenimiento/calendarioDeOT";
import { pasaElFiltro, SIN_ESPECIALIDAD } from "@/lib/mantenimiento/filtrosDelCalendario";
import { letraDeEspecialidad, LEYENDA_IMPRESA } from "@/lib/mantenimiento/marcasImpresas";
import { resumenDelDia, recorteDeLaHoja, TOPE_DE_LA_HOJA } from "@/lib/mantenimiento/resumenImpreso";
import type { PedidoDeHoja } from "@/lib/mantenimiento/urlDeImpresion";
import type { FranjaDeLaSemana } from "@/lib/mantenimiento/rotacionDeLaSemana";
import { TURNOS_DE_LA_FRANJA } from "@/lib/mantenimiento/rotacionDeLaSemana";
import type { Oficio } from "@/lib/mantenimiento/programacion";
import { ETIQUETA_DE_TIPO, ETIQUETA_DE_QUIEN } from "@/lib/mantenimiento/filtrosOt";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_DE_LA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ENCABEZADOS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

type OrdenDelDia = DiaDelCalendario["ordenes"][number];

/**
 * La hoja para imprimir, en blanco y negro.
 *
 * ── POR QUÉ NO HAY COLOR ────────────────────────────────────────────────────
 *
 * La impresora del taller es blanco y negro y la hoja se fotocopia, así que los
 * cinco colores de especialidad salen en cinco grises que no se distinguen. Acá
 * la especialidad es **una letra** (`marcasImpresas.ts`), el atraso es **relleno
 * negro** y el arrastre una **flecha**. Las tres marcas son de forma y no de
 * tono: sobreviven a una fotocopia y conviven entre sí — una orden atrasada
 * sigue diciendo de qué especialidad es, cosa que en pantalla no hace.
 *
 * ── NO SE IMPRIME SOLA ──────────────────────────────────────────────────────
 *
 * Las otras tres hojas del sistema llaman a `window.print()` con un `setTimeout`.
 * Ésta **no**, a propósito: una hoja de día puede salir recortada —el tope de
 * `recorteDeLaHoja`— y el aviso que lo dice tiene que poder leerse antes de que
 * se abra el diálogo de impresión encima.
 *
 * ── LA FRANJA DEL TALLER SE PIDE DESDE ACÁ ──────────────────────────────────
 *
 * Es lo único que no viene del servidor, y es una decisión con costo: armarla
 * allá pedía mudar las doscientas líneas de `/api/mantenimiento/taller-del-mes`.
 * Lo que la hace aceptable es que la hoja **no se imprime sola**, así que nadie
 * aprieta imprimir sin haber visto la hoja, y que si no llega **lo dice** en vez
 * de faltar en silencio. El permiso ya lo resolvió el servidor: si `conFranja`
 * es falso ni se pide.
 */
export default function ImprimirClient(props: {
  pedido?: PedidoDeHoja;
  dias?: DiaDelCalendario[];
  hoy?: string;
  conFranja?: boolean;
  error?: string;
  /** Sólo para los tests: la rotación ya resuelta, sin pedirla. */
  franjasDePrueba?: FranjaDeLaSemana[];
}) {
  const { pedido, dias, hoy, conFranja = false, error, franjasDePrueba } = props;
  const contenido = useRef<HTMLDivElement>(null);
  const [guardando, setGuardando] = useState(false);
  const [franjas, setFranjas] = useState<FranjaDeLaSemana[] | null>(franjasDePrueba ?? null);
  const [falloDelTaller, setFalloDelTaller] = useState<string | null>(null);

  const desde = pedido?.desde;
  const hasta = pedido?.hasta;
  /*
   * La rotación se pide sólo donde se dibuja: el mes y la semana. En la hoja
   * de un día no va —ahí la pregunta no es la rotación sino quién tiene cada
   * orden, y eso está en la columna de operarios—, así que pedirla sería un
   * viaje a una ruta de admin para un dato que no se imprime.
   */
  const laRotacionVa = conFranja && pedido?.periodo !== "dia";

  useEffect(() => {
    if (!laRotacionVa || !desde || !hasta || franjasDePrueba) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/mantenimiento/taller-del-mes?desde=${desde}&hasta=${hasta}`);
        const cuerpo = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok || !Array.isArray(cuerpo.franjas)) {
          setFalloDelTaller(cuerpo.error ?? `El servidor contestó ${res.status}.`);
          return;
        }
        setFranjas(cuerpo.franjas as FranjaDeLaSemana[]);
      } catch (e) {
        if (!cancelado) setFalloDelTaller(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelado = true; };
  }, [laRotacionVa, desde, hasta, franjasDePrueba]);

  async function guardarPdf() {
    const el = contenido.current;
    if (!el) return;
    setGuardando(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `OT_${pedido?.periodo ?? "hoja"}_${pedido?.desde ?? ""}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true },
          jsPDF: {
            unit: "mm",
            format: "a4",
            // El mes son siete columnas: apaisada o no entra. La semana y el
            // día son una tabla y entran mejor de pie.
            orientation: pedido?.periodo === "mes" ? "landscape" : "portrait",
          },
          pagebreak: { mode: ["css"] },
        } as never)
        .from(el)
        .save();
    } finally {
      setGuardando(false);
    }
  }

  if (error || !pedido || !dias || !hoy) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <p className="font-medium">No se pudo armar la hoja.</p>
          <p>{error ?? "Faltan datos para imprimir."}</p>
        </div>
      </div>
    );
  }

  const esMes = pedido.periodo === "mes";

  return (
    <>
      <style>{`
        @page { size: A4 ${esMes ? "landscape" : "portrait"}; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          .hoja { box-shadow: none !important; border: none !important; margin: 0 !important; padding: 0 !important; }
        }
        .hoja { background: #ffffff; color: #000000; font-family: Arial, Helvetica, sans-serif; }
      `}</style>

      <div className="no-print flex flex-wrap items-center gap-2 p-4">
        <button type="button" onClick={() => window.print()} className="btn-primary">
          Imprimir
        </button>
        <button type="button" onClick={guardarPdf} disabled={guardando} className="btn-secondary">
          {guardando ? "Generando…" : "Guardar PDF"}
        </button>
        <span className="text-xs text-slate-500">
          No se imprime sola: revisá la hoja y después apretá Imprimir.
        </span>
      </div>

      <div ref={contenido} className="hoja mx-auto max-w-[277mm] p-4">
        <Encabezado pedido={pedido} />
        {/* La leyenda va arriba y no al pie: una hoja de semana puede ocupar
            tres carillas, y con la leyenda al final las dos primeras salen con
            letras, flechas y rellenos negros que nada explica. */}
        <Leyenda />

        {esMes ? (
          <HojaDelMes
            pedido={pedido}
            dias={dias}
            hoy={hoy}
            rotacion={laRotacionVa ? { franjas, fallo: falloDelTaller } : null}
          />
        ) : (
          <HojaDeTabla
            pedido={pedido}
            dias={dias}
            rotacion={laRotacionVa ? { franjas, fallo: falloDelTaller } : null}
          />
        )}
      </div>
    </>
  );
}

// ─── El encabezado ──────────────────────────────────────────────────────────

/**
 * El título nombra **todos** los filtros puestos, no sólo la especialidad.
 *
 * Un filtro que actúa y no se lee es peor que no filtrar: es lo que vuelve
 * distinguibles a dos hojas que si no serían casi iguales — medido, 536 de 575
 * órdenes del mes son mecánicas, así que la hoja entera y la hoja «Mecánico»
 * se parecen como dos gotas de agua.
 */
export function tituloDeLaHoja(p: PedidoDeHoja): string {
  const partes: string[] = [];
  if (p.filtros.especialidad) {
    partes.push(
      p.filtros.especialidad === SIN_ESPECIALIDAD
        ? "Sin especialidad"
        : conMayusculaInicial(p.filtros.especialidad.toLowerCase())
    );
  }
  // Las etiquetas del catálogo y no un `toLowerCase()` pelado: están tipadas
  // contra la lista de valores, así que agregar un tipo sin su etiqueta es un
  // error de `tsc`. El `??` es para un valor viejo de la planilla que el
  // catálogo no conozca: se imprime tal cual antes que romper la hoja.
  if (p.filtros.tipo) {
    partes.push(ETIQUETA_DE_TIPO[p.filtros.tipo as keyof typeof ETIQUETA_DE_TIPO] ?? p.filtros.tipo);
  }
  if (p.filtros.quien) {
    partes.push(ETIQUETA_DE_QUIEN[p.filtros.quien as keyof typeof ETIQUETA_DE_QUIEN] ?? p.filtros.quien);
  }

  if (p.periodo === "dia") {
    partes.push(`${DIAS_DE_LA_SEMANA[diaDeLaSemana(p.desde)]} ${comoSeLee(p.desde)}`);
  } else if (p.periodo === "semana") {
    partes.push(`semana del ${comoSeLee(p.desde)} al ${comoSeLee(p.hasta)}`);
  } else {
    // El mes de la grilla es el del medio del rango: los bordes son relleno de
    // las semanas parciales, así que ni `desde` ni `hasta` lo nombran.
    const medio = mesDelMedio(p.desde, p.hasta);
    partes.push(`${MESES[Number(medio.slice(5, 7)) - 1]} de ${medio.slice(0, 4)}`);
  }
  return conMayusculaInicial(partes.join(" · "));
}

/**
 * Mayúscula sólo en la primera letra.
 *
 * No es `text-transform: capitalize`, que la pone en **cada palabra**: eso daba
 * «Noviembre De 2026» y «Semana Del 16/11/2026 Al 22/11/2026». En castellano un
 * título no lleva mayúscula en cada palabra, y en una hoja impresa el error se
 * queda ahí.
 */
function conMayusculaInicial(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** El mes que la grilla está mostrando: el del día que cae en la mitad del rango. */
function mesDelMedio(desde: string, hasta: string): string {
  const d = new Date(`${desde}T12:00:00Z`).getTime();
  const h = new Date(`${hasta}T12:00:00Z`).getTime();
  return new Date((d + h) / 2).toISOString().slice(0, 7);
}

function Encabezado({ pedido }: { pedido: PedidoDeHoja }) {
  return (
    <div style={{ borderBottom: "2px solid #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
      <div style={{ fontSize: "9pt", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Órdenes de trabajo · Mantenimiento
      </div>
      <div style={{ fontSize: "15pt", fontWeight: 700 }}>
        {tituloDeLaHoja(pedido)}
      </div>
    </div>
  );
}

function Leyenda() {
  return (
    <div style={{ marginTop: "3mm", paddingTop: "2mm", borderTop: "1px solid #000", fontSize: "7pt" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4mm", alignItems: "center" }}>
        {LEYENDA_IMPRESA.map((l) => (
          <span key={l.letra} style={{ display: "inline-flex", alignItems: "center", gap: "1mm" }}>
            <Marca letra={l.letra} /> {l.nombre}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: "1mm" }}>
          <span style={{
            display: "inline-block", width: "4mm", height: "3mm",
            background: "#000", border: "0.3mm solid #000",
          }} />
          atrasada
        </span>
        <span>→ viene de un día anterior</span>
      </div>
      <div style={{ marginTop: "1.5mm" }}>
        Las órdenes de varios días cuentan en cada día, así que la suma de los días no da el total.
      </div>
    </div>
  );
}

/** La letra de la especialidad, en su recuadro. */
function Marca({ letra, invertida = false }: { letra: string; invertida?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: "3.5mm",
        textAlign: "center",
        border: `0.3mm solid ${invertida ? "#fff" : "#000"}`,
        color: invertida ? "#fff" : "#000",
        fontWeight: 700,
        fontSize: "7pt",
        lineHeight: "3.5mm",
        padding: "0 0.5mm",
      }}
    >
      {letra}
    </span>
  );
}

// ─── La franja del taller, en papel ─────────────────────────────────────────

/** Lo que la hoja sabe de la rotación: `franjas` en null es «todavía no llegó». */
interface Rotacion {
  franjas: FranjaDeLaSemana[] | null;
  fallo: string | null;
}

/** Cómo se nombra cada oficio cuando se los cuenta. */
const OFICIOS_IMPRESOS: { oficio: Oficio; uno: string; varios: string }[] = [
  { oficio: "mecanico", uno: "mecánico", varios: "mecánicos" },
  { oficio: "electricista", uno: "electricista", varios: "electricistas" },
  { oficio: "lubricador", uno: "lubricador", varios: "lubricadores" },
];

/** «2 mecánicos, 1 electricista», o vacío si no hay nadie. */
function porOficio(gente: { oficio: Oficio }[]): string {
  return OFICIOS_IMPRESOS
    .map(({ oficio, uno, varios }) => {
      const n = gente.filter((p) => p.oficio === oficio).length;
      return n === 0 ? null : `${n} ${n === 1 ? uno : varios}`;
    })
    .filter(Boolean)
    .join(", ");
}

/**
 * La rotación de esa semana, **contada por oficio y sin nombres**.
 *
 * Por qué sin nombres, que es lo que no se deduce del código: quién está en el
 * taller y en qué turno es dato de admin —`/api/mantenimiento/taller-del-mes`
 * existe aparte de `/calendario` justamente por eso, y está guardada con
 * `esAdminMantenimiento`—, y **una hoja colgada la lee cualquiera**. El permiso
 * controla quién imprime, no quién mira la pared. Los nombres que sí salen son
 * los de la columna «Operarios», que dicen quién tiene cada orden: eso es el
 * trabajo asignado y no el padrón del taller.
 *
 * **En la hoja del día no va**: para un día la pregunta no es la rotación sino
 * quién tiene cada orden, y eso está en esa columna.
 */
function FranjaImpresa({ franja, fallo, cargando }: {
  franja: FranjaDeLaSemana | null;
  fallo: string | null;
  /** La rotación se pidió y todavía no contestó. */
  cargando: boolean;
}) {
  const caja = { fontSize: "7pt", padding: "1mm 0", borderBottom: "0.2mm solid #000" } as const;

  if (fallo) {
    return <div style={caja}>No se pudo traer la rotación del taller de esta semana: {fallo}</div>;
  }
  // Decirlo importa: sin esta línea, una hoja impresa en los primeros
  // milisegundos sale sin rotación y sin nada que lo explique, y en papel eso
  // no se distingue de una hoja que no lleva rotación.
  if (cargando) return <div style={caja}>Trayendo la rotación del taller…</div>;
  if (!franja) return null;
  if (!franja.porTurno) {
    return (
      <div style={caja}>
        Falta cargar la semana de referencia del taller: no se sabe quién va a qué turno.
      </div>
    );
  }
  const porTurno = franja.porTurno;
  return (
    <div style={{ ...caja, display: "flex", flexWrap: "wrap", gap: "4mm" }}>
      {TURNOS_DE_LA_FRANJA.map((turno) => (
        <span key={turno}>
          <strong>{turno}:</strong> {porOficio(porTurno[turno] ?? []) || "—"}
        </span>
      ))}
      {franja.sinTurno.length > 0 && (
        <span><strong>sin turno:</strong> {porOficio(franja.sinTurno)}</span>
      )}
    </div>
  );
}

/** La rotación de la semana que empieza ese lunes, buscada por su lunes y nunca por su posición. */
function laFranjaDe(rotacion: Rotacion | null, lunes: string) {
  if (!rotacion) return null;
  return {
    franja: rotacion.franjas?.find((f) => f.lunes === lunes) ?? null,
    fallo: rotacion.fallo,
    cargando: rotacion.franjas === null && rotacion.fallo === null,
  };
}

// ─── La hoja del mes ────────────────────────────────────────────────────────

function HojaDelMes({ pedido, dias, hoy, rotacion }: {
  pedido: PedidoDeHoja;
  dias: DiaDelCalendario[];
  hoy: string;
  rotacion: Rotacion | null;
}) {
  const porDia = useMemo(() => {
    const m = new Map<string, DiaDelCalendario>();
    for (const d of dias) m.set(d.dia, d);
    return m;
  }, [dias]);

  const semanas = useMemo(() => {
    const filas: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const lunes = semanaDe(pedido.desde, i)[0];
      if (lunes > pedido.hasta) break;
      filas.push(semanaDe(lunes));
    }
    return filas;
  }, [pedido.desde, pedido.hasta]);

  const mes = mesDelMedio(pedido.desde, pedido.hasta);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontSize: "8pt", fontWeight: 700 }}>
        {ENCABEZADOS.map((e) => (
          <div key={e} style={{ padding: "0.5mm 1mm", borderBottom: "0.3mm solid #000" }}>{e}</div>
        ))}
      </div>

      {semanas.map((semana) => (
        <div key={semana[0]}>
          {rotacion && (
            <FranjaImpresa
              {...laFranjaDe(rotacion, semana[0])!}
              // El fallo es uno solo —la ruta trae el mes entero de una— y
              // repetirlo seis veces convierte un aviso en un muro.
              fallo={semana[0] === semanas[0][0] ? rotacion.fallo : null}
            />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {semana.map((d) => (
              <CuadroDelDia
                key={d}
                diaIso={d}
                info={porDia.get(d)}
                filtros={pedido.filtros}
                delMes={d.startsWith(mes)}
                esHoy={d === hoy}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Un día del mes: cuántas hay y de qué especialidad, nunca cuáles.
 *
 * El cuadro mide unos 39 × 35 mm en una A4 apaisada y la mediana de un día es 6
 * órdenes: listarlas no entra, y recortarlas a tres convierte el cuadro en una
 * promesa que no cumple. Las órdenes de verdad están en la hoja de la semana y
 * en la del día.
 */
function CuadroDelDia({ diaIso, info, filtros, delMes, esHoy }: {
  diaIso: string;
  info: DiaDelCalendario | undefined;
  filtros: PedidoDeHoja["filtros"];
  delMes: boolean;
  esHoy: boolean;
}) {
  const r = info ? resumenDelDia(info, filtros) : { total: 0, porLetra: [], atrasadas: 0 };
  const numero = Number(diaIso.slice(8, 10));
  return (
    <div style={{
      border: "0.2mm solid #000",
      /*
       * 17 mm y no 22, medido: el área útil de una A4 apaisada con margen de
       * 10 mm son 190 mm de alto, y seis filas de 22 mm más el encabezado, la
       * leyenda y las seis bandas de rotación daban **199 mm impresos** — o
       * sea una segunda carilla con una tira. Con 17 mm quedan ~169 mm y
       * sobran dos centímetros para el mes que empiece en domingo.
       *
       * No aprieta el contenido: el día más cargado de noviembre de 2026 usa
       * tres renglones (número, total, cuatro letras y la barra de atrasadas),
       * que son unos 12 mm.
       */
      minHeight: "17mm",
      padding: "1mm",
      color: delMes ? "#000" : "#888",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "8pt", fontWeight: esHoy ? 700 : 400 }}>
          {numero}{esHoy ? " (hoy)" : ""}
        </span>
        {r.total > 0 && <span style={{ fontSize: "13pt", fontWeight: 700 }}>{r.total}</span>}
      </div>
      {r.porLetra.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1mm", marginTop: "0.8mm", fontSize: "7pt" }}>
          {r.porLetra.map((l) => (
            <span key={l.letra} style={{ display: "inline-flex", alignItems: "center", gap: "0.5mm" }}>
              <Marca letra={l.letra} /> {l.cantidad}
            </span>
          ))}
        </div>
      )}
      {r.atrasadas > 0 && (
        <div style={{
          marginTop: "0.8mm", background: "#000", color: "#fff",
          fontSize: "7pt", fontWeight: 700, padding: "0 1mm", display: "inline-block",
        }}>
          {r.atrasadas} atrasada{r.atrasadas === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

// ─── La hoja de la semana y la del día ──────────────────────────────────────

/**
 * La semana va **agrupada por día**, con un subtítulo por cada uno, y no como
 * una corrida de siete días seguidos: la hoja se cuelga de una pared para ver
 * qué toca cada día, y una tabla corrida obliga a buscar dónde empieza el
 * martes.
 */
function HojaDeTabla({ pedido, dias, rotacion }: {
  pedido: PedidoDeHoja;
  dias: DiaDelCalendario[];
  rotacion: Rotacion | null;
}) {
  const delRango = dias.filter((d) => d.dia >= pedido.desde && d.dia <= pedido.hasta);
  const total = delRango.reduce(
    (n, d) => n + d.ordenes.filter((o) => pasaElFiltro(o, pedido.filtros)).length,
    0
  );

  return (
    <div>
      {/* Por su lunes y no por la posición en el arreglo: con un `desde`
          tipeado a mano, `franjas[0]` imprimiría la rotación de otra semana
          sin decirlo, y un dato de otra semana en una hoja colgada no se nota
          nunca. */}
      {rotacion && <FranjaImpresa {...laFranjaDe(rotacion, semanaDe(pedido.desde)[0])!} />}

      {total === 0 && (
        <p style={{ fontSize: "9pt", padding: "4mm 0" }}>
          No hay ninguna orden en este período{
            pedido.filtros.especialidad || pedido.filtros.tipo || pedido.filtros.quien
              ? " con el filtro puesto"
              : ""
          }.
        </p>
      )}

      {delRango.map((d) => (
        <TablaDeUnDia
          key={d.dia}
          dia={d}
          filtros={pedido.filtros}
          // En la hoja de un día el título ya dice qué día es: repetirlo arriba
          // de la tabla es la misma línea dos veces.
          conFecha={pedido.periodo !== "dia"}
        />
      ))}
    </div>
  );
}

function TablaDeUnDia({ dia, filtros, conFecha }: {
  dia: DiaDelCalendario;
  filtros: PedidoDeHoja["filtros"];
  conFecha: boolean;
}) {
  const todas = dia.ordenes
    .filter((o) => pasaElFiltro(o, filtros))
    // Los inicios primero y después por número: el mismo orden que la pantalla.
    .sort((a, b) => Number(a.arrastre) - Number(b.arrastre) || a.ot_number - b.ot_number);
  if (todas.length === 0) return null;

  const { visibles, afuera } = recorteDeLaHoja(todas, TOPE_DE_LA_HOJA);

  return (
    <div style={{ marginTop: "3mm", pageBreakInside: "auto" }}>
      <div style={{ fontSize: "9pt", fontWeight: 700, marginBottom: "1mm" }}>
        {conFecha
          ? `${conMayusculaInicial(DIAS_DE_LA_SEMANA[diaDeLaSemana(dia.dia)])} ${comoSeLee(dia.dia)} — `
          : ""}
        {todas.length} {todas.length === 1 ? "orden" : "órdenes"}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "8pt" }}>
        <thead>
          <tr style={{ borderBottom: "0.3mm solid #000", textAlign: "left" }}>
            <th style={{ width: "8mm", padding: "0.5mm" }}>Esp.</th>
            <th style={{ width: "16mm", padding: "0.5mm" }}>OT</th>
            <th style={{ width: "38mm", padding: "0.5mm" }}>Equipo</th>
            <th style={{ padding: "0.5mm" }}>Tarea</th>
            <th style={{ width: "40mm", padding: "0.5mm" }}>Operarios</th>
            <th style={{ width: "10mm", padding: "0.5mm" }}>Hecho</th>
          </tr>
        </thead>
        <tbody>
          {visibles.map((o) => <FilaDeOrden key={o.id} orden={o} />)}
          {afuera > 0 && (
            <tr>
              <td colSpan={6} style={{ padding: "1mm 0.5mm", fontSize: "8pt", fontWeight: 700 }}>
                Hay {afuera} orden{afuera === 1 ? "" : "es"} más en este día que no entran en la
                hoja. Se cortó en {TOPE_DE_LA_HOJA}: un día con tantas órdenes iguales suele ser un
                problema de carga y no trabajo de verdad.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilaDeOrden({ orden }: { orden: OrdenDelDia }) {
  const operarios = [orden.operario_1, orden.operario_2, orden.operario_3]
    .map((n) => (n ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const negro = orden.atrasada;
  return (
    <tr style={{
      borderBottom: "0.2mm solid #000",
      background: negro ? "#000" : undefined,
      color: negro ? "#fff" : undefined,
      pageBreakInside: "avoid",
    }}>
      <td style={{ padding: "0.8mm 0.5mm" }}>
        <Marca letra={letraDeEspecialidad(orden.especialidad)} invertida={negro} />
      </td>
      <td style={{ padding: "0.8mm 0.5mm", fontWeight: 700, whiteSpace: "nowrap" }}>
        {orden.arrastre ? "→ " : ""}{orden.ot_number}
      </td>
      <td style={{ padding: "0.8mm 0.5mm" }}>{orden.equipo_raw ?? ""}</td>
      <td style={{ padding: "0.8mm 0.5mm" }}>{orden.descripcion ?? ""}</td>
      <td style={{ padding: "0.8mm 0.5mm" }}>{operarios}</td>
      <td style={{ padding: "0.8mm 0.5mm" }}>
        <span style={{
          display: "inline-block", width: "4mm", height: "4mm",
          border: `0.3mm solid ${negro ? "#fff" : "#000"}`,
        }} />
      </td>
    </tr>
  );
}
