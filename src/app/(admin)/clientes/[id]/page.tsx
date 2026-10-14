import { notFound } from "next/navigation";
import { getWorkspace } from "@/server/queries";
import { ClientForm, WebsiteForm } from "@/components/admin-forms";
import { WebsiteTable, PlanTable } from "@/components/admin-tables";
import { Badge, Disclosure, Info, PageHeading, Section } from "@/components/ui";

export default async function ClientPage({params}:{params:Promise<{id:string}>}) {
  const [{id},data]=await Promise.all([params,getWorkspace()]);const client=data.clients.find(c=>c.id===id);if(!client)notFound();
  const sites=data.websites.filter(w=>w.clientId===id);const siteIds=new Set(sites.map(w=>w.id));
  return <><PageHeading title={client.companyName||client.contactName} description={client.companyName?client.contactName:"Ficha del cliente"} back={{href:"/clientes",label:"Clientes"}}><Badge label={client.active?"Cliente activo":"Cliente inactivo"} tone={client.active?"active":"neutral"}/></PageHeading><div className="detail-columns"><div><Section title="Sitios web" count={sites.length}><WebsiteTable data={data} rows={sites}/></Section><Disclosure title="Agregar sitio de este cliente"><WebsiteForm data={data} clientId={id}/></Disclosure><Section title="Planes" count={data.plans.filter(p=>siteIds.has(p.websiteId)).length}><PlanTable data={data} rows={data.plans.filter(p=>siteIds.has(p.websiteId))}/></Section></div><div><Section title="Contacto"><div className="section-content"><div className="info-grid"><Info label="Nombre de contacto">{client.contactName}</Info><Info label="Empresa">{client.companyName}</Info><Info label="Email">{client.email?<a className="text-link" href={`mailto:${client.email}`}>{client.email}</a>:null}</Info><Info label="Teléfono">{client.phone}</Info></div>{client.notes&&<p className="note-text mt-5">{client.notes}</p>}</div></Section><Disclosure title="Editar cliente"><ClientForm client={client}/></Disclosure></div></div></>;
}
