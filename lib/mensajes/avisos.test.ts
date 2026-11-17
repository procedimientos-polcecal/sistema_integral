import { describe, it, expect } from "vitest";
import type { Destinatario } from "@/lib/core/mensajes";
import {
  MOTIVO_NO_PUEDE_VERLO, MOTIVO_SIN_CONFIGURAR, MOTIVO_SIN_CORREO,
  estadoDelAviso, nombreCompleto, repartirAvisos,
} from "./avisos";

const d = (usuarioId: string, extra: Partial<Destinatario> = {}): Destinatario => ({
  usuarioId, email: `${usuarioId}@polcecal.com`, puedeVerElRegistro: true, ...extra,
});

describe("repartirAvisos", () => {
  it("a quien le toca el correo lo manda, y a nadie más", () => {
    const r = repartirAvisos([d("beto"), d("carla")], "ana", true);
    expect(r.aEnviar.map((x) => x.usuarioId)).toEqual(["beto", "carla"]);
    expect(r.sinAviso).toEqual([]);
  });

  it("el autor no está en ninguna de las dos listas: su mención ni se guarda", () => {
    const r = repartirAvisos([d("ana"), d("beto")], "ana", true);
    expect(r.aEnviar.map((x) => x.usuarioId)).toEqual(["beto"]);
    expect(r.sinAviso).toEqual([]);
  });

  it("sin correo configurado nadie recibe nada y todos quedan con el mismo motivo", () => {
    const r = repartirAvisos([d("beto"), d("carla", { email: null })], "ana", false);
    expect(r.aEnviar).toEqual([]);
    expect(r.sinAviso).toEqual([
      { usuarioId: "beto", motivo: MOTIVO_SIN_CONFIGURAR },
      { usuarioId: "carla", motivo: MOTIVO_SIN_CONFIGURAR },
    ]);
  });

  it("quien no tiene correo queda con su motivo y no rompe a los demás", () => {
    const r = repartirAvisos(
      [d("beto", { email: null }), d("carla"), d("dora", { email: "  " })],
      "ana",
      true
    );
    expect(r.aEnviar.map((x) => x.usuarioId)).toEqual(["carla"]);
    expect(r.sinAviso).toEqual([
      { usuarioId: "beto", motivo: MOTIVO_SIN_CORREO },
      { usuarioId: "dora", motivo: MOTIVO_SIN_CORREO },
    ]);
  });

  it("quien no puede ver el registro queda con su motivo, aunque tenga correo", () => {
    const r = repartirAvisos([d("beto", { puedeVerElRegistro: false })], "ana", true);
    expect(r.aEnviar).toEqual([]);
    expect(r.sinAviso).toEqual([{ usuarioId: "beto", motivo: MOTIVO_NO_PUEDE_VERLO }]);
  });

  it("mencionado dos veces es una sola mención: es la clave primaria de la tabla", () => {
    const r = repartirAvisos([d("beto"), d("beto")], "ana", true);
    expect(r.aEnviar).toHaveLength(1);
  });

  it("cada mención que se guarda tiene un destino: se envía o tiene motivo, nunca ninguna de las dos", () => {
    const mencionados = [
      d("a"), d("b", { email: null }), d("c", { puedeVerElRegistro: false }), d("ana"), d("a"),
    ];
    const r = repartirAvisos(mencionados, "ana", true);
    const unicos = new Set(mencionados.map((m) => m.usuarioId).filter((id) => id !== "ana"));
    const cubiertos = new Set([
      ...r.aEnviar.map((x) => x.usuarioId),
      ...r.sinAviso.map((x) => x.usuarioId),
    ]);
    expect(cubiertos).toEqual(unicos);
    expect(r.aEnviar.length + r.sinAviso.length).toBe(unicos.size);
  });
});

describe("nombreCompleto y estadoDelAviso", () => {
  it("junta nombre y apellido, y no deja un espacio de más sin apellido", () => {
    expect(nombreCompleto({ nombre: "Ana", apellido: "Pérez" })).toBe("Ana Pérez");
    expect(nombreCompleto({ nombre: "Ana", apellido: "" })).toBe("Ana");
    expect(nombreCompleto({ nombre: "Ana" })).toBe("Ana");
  });

  it("null con null es el único estado que quiere decir «no se sabe»", () => {
    expect(estadoDelAviso({ avisado_en: "2026-11-11T10:00:00Z", aviso_fallo: null })).toBe("enviado");
    expect(estadoDelAviso({ avisado_en: null, aviso_fallo: "no tiene correo" })).toBe("fallo");
    expect(estadoDelAviso({ avisado_en: null, aviso_fallo: null })).toBe("pendiente");
  });
});
