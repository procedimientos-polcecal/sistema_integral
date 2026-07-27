export interface ParadaTexto {
  nombre: string;
  direccion: string | null;
  lat: number;
  lng: number;
}

export interface HojaTexto {
  tipo: "ida" | "vuelta";
  vehiculoNombre: string;
  choferNombre: string | null;
  choferTelefono: string | null;
  km: number | null;
  minutos: number | null;
  fabrica: { nombre: string; lat: number; lng: number };
  paradas: ParadaTexto[]; // solo empleados, en orden — sin la fábrica
}

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Orden de paradas visible (fábrica incluida según ida/vuelta), para texto y links. */
function secuenciaCompleta(h: HojaTexto): ParadaTexto[] {
  const fabricaComoParada: ParadaTexto = { nombre: h.fabrica.nombre, direccion: null, lat: h.fabrica.lat, lng: h.fabrica.lng };
  return h.tipo === "ida" ? [...h.paradas, fabricaComoParada] : [fabricaComoParada, ...h.paradas];
}

export function gmapsLink(h: HojaTexto): string {
  const secuencia = secuenciaCompleta(h);
  const first = secuencia[0];
  const last = secuencia[secuencia.length - 1];
  const mid = secuencia.slice(1, -1).slice(0, 9).map((s) => `${s.lat},${s.lng}`).join("|");
  return (
    `https://www.google.com/maps/dir/?api=1&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}` +
    (mid ? `&waypoints=${encodeURIComponent(mid)}` : "") +
    `&travelmode=driving`
  );
}

export function wazeLink(h: HojaTexto): string {
  const secuencia = secuenciaCompleta(h);
  const last = secuencia[secuencia.length - 1];
  return `https://waze.com/ul?ll=${last.lat}%2C${last.lng}&navigate=yes&zoom=17`;
}

export function textoRuta(h: HojaTexto, fecha: string): string {
  const label = h.tipo === "ida" ? "IDA (Búsqueda)" : "VUELTA (Retorno)";
  const lines = [
    `RUTA ${label} — ${fmtFecha(fecha)}`,
    `Vehículo: ${h.vehiculoNombre}`,
    h.choferNombre ? `Conductor: ${h.choferNombre}` : "",
    h.choferTelefono ? `Tel: ${h.choferTelefono}` : "",
    "",
    ...secuenciaCompleta(h).map((s, si, arr) =>
      si === 0 && h.tipo === "vuelta" ? `${s.nombre}` : si === arr.length - 1 && h.tipo === "ida" ? `${s.nombre}` : `${si + 1}. ${s.nombre}${s.direccion ? " — " + s.direccion : ""}`
    ),
    "",
    h.km != null ? `${h.km} km  |  aprox. ${h.minutos} min` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function whatsappLink(mensaje: string, telefono?: string): string {
  const encoded = encodeURIComponent(mensaje);
  const limpio = telefono?.replace(/[\s\-+()]/g, "").replace(/^0+/, "");
  return limpio ? `https://wa.me/${limpio}?text=${encoded}` : `https://api.whatsapp.com/send?text=${encoded}`;
}

export function emailLink(asunto: string, mensaje: string): string {
  return `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
}
