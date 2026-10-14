"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { syncPeriods } from "@/server/actions";

export function SyncGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready,setReady] = useState(false);
  const [error,setError] = useState("");
  const [pending,startTransition] = useTransition();
  const update = useCallback(() => startTransition(async () => {
    setError("");
    try {
      const result = await syncPeriods();
      if (!result.ok) { setError(result.error || "No se pudieron actualizar los períodos."); setReady(false); return; }
      router.refresh();
      setReady(true);
    } catch { setError("No se pudieron actualizar las cobranzas. Intentá nuevamente."); setReady(false); }
  }), [router]);
  // One authenticated POST on entry. GET requests never generate periods.
  useEffect(() => { update(); }, [update]);
  if (error) return <div className="sync-error" role="alert"><h2>No pudimos preparar las cobranzas</h2><p className="mt-3">{error}</p><button className="button" disabled={pending} onClick={update}><RefreshCw size={12}/>Reintentar</button></div>;
  if (!ready || pending) return <div className="loading-state" role="status"><LoaderCircle size={16} className="spinner"/>Actualizando períodos y vencimientos…</div>;
  return <><div className="sync-toolbar"><button className="button button-small button-ghost" disabled={pending} onClick={update}><RefreshCw size={11}/>Actualizar cobranzas</button></div>{children}</>;
}
