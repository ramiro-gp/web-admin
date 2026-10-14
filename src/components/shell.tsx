"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CircleDollarSign, FolderKanban, Globe2, LayoutDashboard, Layers3, LogOut, Monitor, ShieldCheck, Users2 } from "lucide-react";

const links = [
  { href:"/", label:"Resumen", icon:LayoutDashboard },
  { href:"/clientes", label:"Clientes", icon:Users2 },
  { href:"/sitios", label:"Sitios web", icon:Monitor },
  { href:"/planes", label:"Planes", icon:Layers3 },
  { href:"/cobranzas", label:"Cobranzas", icon:CircleDollarSign },
  { href:"/dominios", label:"Dominios", icon:Globe2 },
  { href:"/trabajos", label:"Trabajos", icon:FolderKanban },
];

function SignOutButton({className="icon-button"}:{className?:string}) {
  const router=useRouter();
  const [pending,setPending]=useState(false);
  const [error,setError]=useState(false);
  return <><button className={className} disabled={pending} aria-label="Cerrar sesión" title={error?"No se pudo cerrar sesión. Intentá nuevamente.":"Cerrar sesión"} onClick={async()=>{setPending(true);setError(false);try{const response=await fetch("/api/auth/sign-out",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!response.ok)throw new Error();router.replace("/login");router.refresh();}catch{setError(true);setPending(false);}}}><LogOut size={14}/></button>{error&&<span role="alert" className="sr-only">No se pudo cerrar sesión. Intentá nuevamente.</span>}</>;
}

export function Shell({ children, dateLabel }: { children: React.ReactNode; dateLabel: string }) {
  const path = usePathname();
  return <div className="app-shell"><a href="#main-content" className="skip-link">Ir al contenido</a>
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="web-admin, inicio"><span className="brand-mark">w.</span>web-admin<span className="text-[#c4ef91]">/</span></Link>
      <div className="nav-label">Administración</div>
      <nav aria-label="Navegación principal" className="nav-links">{links.map(({ href,label,icon:Icon }) => <Link key={href} href={href} aria-current={path === href || (href !== "/" && path.startsWith(`${href}/`)) ? "page" : undefined} className="nav-link"><Icon size={16} strokeWidth={1.6} aria-hidden="true"/>{label}</Link>)}</nav>
      <div className="sidebar-footer"><span className="admin-avatar"><ShieldCheck size={14}/></span><div className="flex-1"><div className="text-[10px] font-semibold">Espacio personal</div><div className="text-[9px] muted">Acceso privado</div></div><SignOutButton/></div>
    </aside>
    <div className="main-column"><header className="topbar"><span className="topbar-title"><span className="live-dot"/>Tu cartera, en orden</span><span className="flex items-center gap-3"><span className="mono">{dateLabel}</span><span className="mobile-signout"><SignOutButton/></span></span></header><main className="workspace" id="main-content" tabIndex={-1}>{children}</main></div>
  </div>;
}
