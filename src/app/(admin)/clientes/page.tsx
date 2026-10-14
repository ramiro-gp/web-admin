import Link from "next/link";
import { getWorkspace } from "@/server/queries";
import { ClientForm } from "@/components/admin-forms";
import { Badge, Disclosure, Empty, PageHeading, Section, Table } from "@/components/ui";
import { Filters, searchValue, type SearchValues } from "@/components/filters";

export default async function ClientsPage({searchParams}:{searchParams:Promise<SearchValues>}) {
  const [data,search]=await Promise.all([getWorkspace(),searchParams]);
  const q=searchValue(search,"q").toLocaleLowerCase("es");const status=searchValue(search,"status");
  const rows=data.clients.filter(c=>(!q||`${c.contactName} ${c.companyName??""} ${c.email??""}`.toLocaleLowerCase("es").includes(q))&&(!status||(status==="active"?c.active:!c.active)));
  return <><PageHeading title="Clientes" description="Contactos y empresas. Toda su información, conectada a sus sitios."/><Disclosure title="Nuevo cliente" open={!data.clients.length}><ClientForm/></Disclosure><Filters values={search} clients={false} statuses={[{value:"active",label:"Activos"},{value:"inactive",label:"Inactivos"}]}/><Section title="Tu cartera" count={rows.length}>{rows.length?<Table headers={["Cliente","Contacto","Sitios","Estado",""]}>{rows.map(c=><tr key={c.id}><td><Link href={`/clientes/${c.id}`} className="table-primary text-link">{c.companyName||c.contactName}</Link>{c.companyName&&<div className="table-secondary">{c.contactName}</div>}</td><td><div>{c.email??"—"}</div><div className="table-secondary mono">{c.phone}</div></td><td className="mono">{data.websites.filter(w=>w.clientId===c.id&&!w.archivedAt).length}</td><td><Badge label={c.active?"Activo":"Inactivo"} tone={c.active?"active":"neutral"}/></td><td className="align-right"><Link href={`/clientes/${c.id}`} className="muted text-link">Ver cliente ↗</Link></td></tr>)}</Table>:<Empty title={data.clients.length?"Sin resultados":"Tu cartera empieza acá"} description={data.clients.length?"Probá otra búsqueda o cambiá los filtros.":"Agregá un cliente y después registrá los sitios que le vendiste."}/>}</Section></>;
}
