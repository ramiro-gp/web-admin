import Link from "next/link";
export default function NotFound() { return <main className="empty-state"><h1>No encontramos este registro</h1><p>Puede que el enlace no sea correcto.</p><Link className="button" href="/">Ir al inicio</Link></main>; }
