import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return <section className="section"><div className="section-content py-10"><FileQuestion size={24} strokeWidth={1.3} className="muted mb-4"/><h1 className="!text-xl">No encontramos este registro</h1><p className="page-description mb-6">El enlace puede estar incompleto o el registro ya no está disponible.</p><Link href="/" className="button"><ArrowLeft size={12}/>Volver al resumen</Link></div></section>;
}
