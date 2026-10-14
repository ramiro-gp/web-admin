"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import type { FormAction } from "@/server/action-state";

export function ActionForm({ action, children, label = "Guardar cambios", className, confirmMessage, small = false, danger = false }: { action: FormAction; children?: React.ReactNode; label?: string; className?: string; confirmMessage?: string; small?: boolean; danger?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const feedback = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.success) router.refresh();
    if (state.error) feedback.current?.focus();
  }, [state, router]);
  return <form action={formAction} className={className} onSubmit={(event) => { if (pending || (confirmMessage && !window.confirm(confirmMessage))) event.preventDefault(); }}>
    {(state.error || state.success) && <div ref={feedback} tabIndex={-1} role={state.error ? "alert" : "status"} className={`feedback ${state.error ? "feedback-error" : "feedback-success"}`}>
      {state.error || state.success}
      {state.fieldErrors && <ul>{Object.entries(state.fieldErrors).map(([name, errors]) => <li key={name}>{errors.join(". ")}</li>)}</ul>}
    </div>}
    {children}
    <div className={small ? "form-actions !mt-3" : "form-actions"}>
      <button type="submit" disabled={pending} className={`button ${danger ? "button-danger" : "button-primary"} ${small ? "button-small" : ""}`}>
        {pending && <LoaderCircle size={12} className="spinner" aria-hidden="true" />}{pending ? "Guardando…" : label}
      </button>
    </div>
  </form>;
}
