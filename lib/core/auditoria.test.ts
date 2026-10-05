import { describe, it, expect } from "vitest";
import { filaDeAuditoria, nombreParaAuditoria, ACCIONES } from "./auditoria";

const base = {
  modulo: "facturacion",
  entidad: "facturas_proveedor",
  entidadId: "f-1",
  usuario: { id: "u-1", nombre: "Ana Gómez" },
} as const;

describe("el motivo, donde es obligatorio", () => {
  /**
   * Denegar y ajustar son las dos acciones que **contradicen** lo que el
   * sistema venía diciendo. Sin el porqué, el registro dice que alguien lo hizo
   * pero no sirve para entender nada seis meses después, que es para lo que
   * existe la tabla.
   */
  it("denegar sin motivo no se registra", () => {
    const r = filaDeAuditoria({ ...base, accion: "denegar" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("motivo");
  });

  it("ajustar sin motivo no se registra", () => {
    expect(filaDeAuditoria({ ...base, accion: "ajustar" }).ok).toBe(false);
  });

  it("un motivo en blanco no cuenta como motivo", () => {
    expect(filaDeAuditoria({ ...base, accion: "denegar", motivo: "   " }).ok).toBe(false);
  });

  it("con motivo, denegar se registra y el motivo va recortado", () => {
    const r = filaDeAuditoria({ ...base, accion: "denegar", motivo: "  sin presupuesto  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fila.motivo).toBe("sin presupuesto");
  });

  /** Las otras cinco confirman algo que ya estaba en curso: el motivo es opcional. */
  it("las acciones que no contradicen nada no exigen motivo", () => {
    for (const accion of ACCIONES.filter((a) => a !== "denegar" && a !== "ajustar")) {
      expect(filaDeAuditoria({ ...base, accion }).ok, accion).toBe(true);
    }
  });
});

describe("quien la hizo", () => {
  it("con usuario, el actor es persona y el nombre queda cacheado", () => {
    const r = filaDeAuditoria({ ...base, accion: "postear" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fila.usuario_id).toBe("u-1");
      expect(r.fila.usuario_nombre).toBe("Ana Gómez");
      expect(r.fila.actor).toBe("persona");
    }
  });

  /**
   * EL AGUJERO QUE ESTA TABLA EXISTE PARA NO REPETIR.
   *
   * En `compras_historial` hay 2.852 filas sin `usuario_id`, y mirándolas no se
   * puede decir si falta el autor porque la ruta se olvidó o porque no había
   * ninguno —la sincronización de la planilla—. Acá eso no se puede escribir:
   * o viene el usuario, o hay que decir qué proceso fue.
   */
  it("sin usuario y sin actor, no se registra", () => {
    const r = filaDeAuditoria({ ...base, usuario: null, accion: "postear" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("quién");
  });

  it("sin usuario pero diciendo que fue la sincronizacion, si se registra", () => {
    const r = filaDeAuditoria({ ...base, usuario: null, actor: "sincronizacion", accion: "aprobar" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fila.actor).toBe("sincronizacion");
      expect(r.fila.usuario_id).toBeNull();
      expect(r.fila.usuario_nombre).toBeNull();
    }
  });

  it("un cron tambien es un actor valido", () => {
    const r = filaDeAuditoria({ ...base, usuario: null, actor: "cron", accion: "cerrar" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fila.actor).toBe("cron");
  });

  /** Lo que manda es el dato, no la etiqueta que mandó quien llama. */
  it("si hay usuario, el actor es persona aunque digan otra cosa", () => {
    const r = filaDeAuditoria({ ...base, actor: "cron", accion: "postear" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fila.actor).toBe("persona");
  });

  it("un usuario sin nombre deja el nombre nulo, no una cadena vacia", () => {
    const r = filaDeAuditoria({ ...base, usuario: { id: "u-2", nombre: "  " }, accion: "postear" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fila.usuario_nombre).toBeNull();
  });
});

describe("el resto de la fila", () => {
  it("lo que no se manda queda en null y no en undefined", () => {
    const r = filaDeAuditoria({ ...base, accion: "postear" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fila.valor_anterior).toBeNull();
      expect(r.fila.valor_nuevo).toBeNull();
      expect(r.fila.contexto).toBeNull();
      expect(r.fila.motivo).toBeNull();
    }
  });

  it("el contexto viaja tal cual, que es para lo que es jsonb", () => {
    const r = filaDeAuditoria({
      ...base,
      accion: "postear",
      contexto: { odoo_move_id: 4821, importe: 1234.5 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fila.contexto).toEqual({ odoo_move_id: 4821, importe: 1234.5 });
  });

  it("el antes y el despues se guardan como texto", () => {
    const r = filaDeAuditoria({
      ...base,
      accion: "aprobar",
      valorAnterior: "PENDIENTE",
      valorNuevo: "APROBADO",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fila.valor_anterior).toBe("PENDIENTE");
      expect(r.fila.valor_nuevo).toBe("APROBADO");
    }
  });
});

describe("nombreParaAuditoria", () => {
  it("junta nombre y apellido", () => {
    expect(nombreParaAuditoria({ nombre: "Ana", apellido: "Gómez" })).toBe("Ana Gómez");
  });

  it("con uno solo de los dos, alcanza", () => {
    expect(nombreParaAuditoria({ nombre: "Ana", apellido: null })).toBe("Ana");
    expect(nombreParaAuditoria({ nombre: "", apellido: "Gómez" })).toBe("Gómez");
  });

  /** Un usuario sin nombre cargado igual tiene que quedar identificado. */
  it("sin nombre, cae al email", () => {
    expect(nombreParaAuditoria({ nombre: null, apellido: null, email: "ana@polcecal.com" }))
      .toBe("ana@polcecal.com");
  });

  it("sin nada, devuelve vacio y no 'undefined undefined'", () => {
    expect(nombreParaAuditoria(null)).toBe("");
    expect(nombreParaAuditoria({})).toBe("");
  });
});
