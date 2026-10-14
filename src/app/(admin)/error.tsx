"use client";
import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
export default function AdminError({error,reset}:{error:Error & {digest?:string};reset:()=>void}) {
  useEffect(()=>{console.error("Workspace request failed",error.digest ?? "unknown");},[error]);
  return <div className="section"><div className="section-content"><AlertCircle size={22} className="text-[#ddc68c] mb-4"/><h2>No pudimos cargar los datos</h2><p className="muted text-xs my-3">Revisá la conexión e intentá nuevamente. No se mostrarán totales incompletos.</p><button onClick={reset} className="button"><RefreshCw size={12}/>Volver a intentar</button></div></div>;
}
