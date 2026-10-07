import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diasAMarcarAlEditar, marcarDiaCorregido } from "./marcarDia";

const A = { empleadoId: "emp-a", fecha: "2026-10-05" };

describe("diasAMarcarAlEditar", () => {
  it("si no se movió, marca sólo ese día", () => {
    expect(diasAMarcarAlEditar({ ...A }, { ...A })).toEqual([A]);
  });

  it("si cambió de día, marca el de destino y el de origen", () => {
    const nuevo = { empleadoId: "emp-a", fecha: "2026-10-06" };
    expect(diasAMarcarAlEditar(A, nuevo)).toEqual([nuevo, A]);
  });

  it("si cambió de empleado, marca los dos empleados", () => {
    const nuevo = { empleadoId: "emp-b", fecha: "2026-10-05" };
    expect(diasAMarcarAlEditar(A, nuevo)).toEqual([nuevo, A]);
  });

  it("si cambió de los dos, marca los dos pares", () => {
    const nuevo = { empleadoId: "emp-b", fecha: "2026-10-06" };
    expect(diasAMarcarAlEditar(A, nuevo)).toEqual([nuevo, A]);
  });

  it("sin lectura previa, marca igual el día en que quedó", () => {
    expect(diasAMarcarAlEditar(null, A)).toEqual([A]);
  });
});

describe("marcarDiaCorregido", () => {
  function clienteQue(resultado: () => unknown) {
    const upsert = vi.fn(resultado);
    const from = vi.fn(() => ({ upsert }));
    return { cliente: { from } as unknown as SupabaseClient, upsert, from };
  }

  it("hace upsert sobre (empleado_id, fecha)", async () => {
    const { cliente, upsert, from } = clienteQue(() => ({ error: null }));
    await marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "borrada");
    expect(from).toHaveBeenCalledWith("rrhh_dias_corregidos");
    expect(upsert).toHaveBeenCalledWith(
      { empleado_id: "emp-a", fecha: "2026-10-05", usuario_id: "usr-1", accion: "borrada" },
      { onConflict: "empleado_id,fecha" }
    );
  });

  it("no lanza si la base devuelve un error, y lo deja en el log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteQue(() => ({ error: { message: "boom" } }));
    await expect(marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "editada")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("no lanza si el cliente tira una excepción", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { cliente } = clienteQue(() => { throw new Error("red caída"); });
    await expect(marcarDiaCorregido(cliente, "emp-a", "2026-10-05", "usr-1", "creada")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
