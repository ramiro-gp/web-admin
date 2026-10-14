import { ArrowRight, KeyRound, LockKeyhole } from "lucide-react";
import { configurationStatus } from "@/lib/env";
import { signInWithGitHub } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const config = configurationStatus();
  return (
    <main className="login-page">
      <div className="login-brand"><span className="brand-mark">w.</span><span>web-admin<span className="text-[#c4ef91]">/</span></span></div>
      <section className="login-panel" aria-labelledby="login-title">
        <span className="eyebrow"><LockKeyhole size={14} aria-hidden="true" /> Administración privada</span>
        <h1 id="login-title">Todo en orden.<br /><span>Tus clientes, en un lugar.</span></h1>
        <p>El seguimiento de tus sitios, planes y cobranzas. Acceso exclusivo para el administrador.</p>
        {config.configured ? (
          <form action={signInWithGitHub}>
            <button type="submit" className="button button-primary"><KeyRound size={18} aria-hidden="true" /> Ingresar con GitHub <ArrowRight size={16} aria-hidden="true" /></button>
          </form>
        ) : (
          <div className="setup-message" role="status">
            <strong>Configuración pendiente</strong>
            <p>El acceso todavía no está habilitado. Completá la configuración del servidor antes de ingresar.</p>
            {process.env.NODE_ENV !== "production" && <p className="mono">Variables pendientes: {config.missing.join(", ")}</p>}
          </div>
        )}
        {error && <p className="feedback feedback-error mt-5" role="alert">No se pudo iniciar sesión. Verificá que estés usando la cuenta autorizada y volvé a intentar.</p>}
      </section>
      <footer className="login-footer">Clientes · Sitios · Planes · Cobranzas</footer>
    </main>
  );
}
