import type { EstadoParte } from "@/lib/trituracion/vocabulario";

export interface Planta {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  orden: number;
}

export interface Parte {
  id: string;
  plantaId: string;
  fecha: string; // "YYYY-MM-DD"
  estado: EstadoParte;
  motivoNoOperativo: string | null;
  material: string | null;
  origen: string | null;
  horaInicio: string | null; // "HH:MM"
  horaFin: string | null;
  operarioId: string | null;
  operarioRaw: string | null;
  horasMantenimiento: number;
  horasFaltaPiedra: number;
  horasProduccion: number;
  horasOtro: number;
  motivoOtro: string | null;
  camionesLlegados: number | null;
  toneladasProcesadas: number | null;
  observaciones: string | null;
  sheetsPendiente: string | null;
  sheetsPendienteEn: string | null;
  cargadoPor: string | null;
  cargadoEn: string;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}
