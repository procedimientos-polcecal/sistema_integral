"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(
  async () => false
);

// Hook para pedir confirmación: const confirm = useConfirm();
//   if (await confirm({ message: "...", danger: true })) { ...acción... }
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  function close(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div
          onClick={() => close(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 60,
            background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            style={{ animation: "fadeUp .2s ease both" }}
          >
            <div className="flex items-start gap-3">
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: opts.danger ? "#FEF2F2" : "#FFFBEB" }}
              >
                <svg width="18" height="18" fill="none" stroke={opts.danger ? "#DC2626" : "#D97706"} strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-gray-900">
                  {opts.title ?? "¿Confirmás la acción?"}
                </h3>
                <p className="text-sm text-gray-600 mt-1">{opts.message}</p>
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => close(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {opts.cancelText ?? "Cancelar"}
              </button>
              <button
                onClick={() => close(true)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors"
                style={{ background: opts.danger ? "#DC2626" : "#D97706" }}
              >
                {opts.confirmText ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
