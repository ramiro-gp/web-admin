import { getWorkspace } from "@/server/queries";
import { SiteTypeForm, WebsiteForm } from "@/components/admin-forms";
import { WebsiteTable, clientName } from "@/components/admin-tables";
import { Disclosure, Empty, PageHeading, Section } from "@/components/ui";
import { Filters, searchValue, type SearchValues } from "@/components/filters";

export default async function WebsitesPage({searchParams}:{searchParams:Promise<SearchValues>}) {
  const [data,search]=await Promise.all([getWorkspace(),searchParams]);const q=searchValue(search,"q").toLowerCase();const status=searchValue(search,"status");const client=searchValue(search,"client");
  const rows=data.websites.filter(w=>(!q||`${w.name} ${w.url??""} ${clientName(data,w.clientId)}`.toLowerCase().includes(q))&&(!client||w.clientId===client)&&(status==="archived"?!!w.archivedAt:status==="all"?true:!w.archivedAt));
  return <><PageHeading title="Sitios web" description="La venta original, los planes y la evolución de cada proyecto."/><Disclosure title="Nuevo sitio web" open={!data.websites.length}>{data.clients.length&&data.siteTypes.some(t=>t.active)?<WebsiteForm data={data}/>:<Empty title="Prepará los datos del sitio" description="Agregá primero un cliente y al menos un tipo de sitio disponible."/>}</Disclosure><Filters values={search} data={data} statuses={[{value:"active",label:"Vigentes"},{value:"archived",label:"Archivados"},{value:"all",label:"Vigentes y archivados"}]}/><Section title="Sitios registrados" count={rows.length}><WebsiteTable data={data} rows={rows}/></Section><Disclosure title="Tipos de sitio"><div className="grid gap-5 md:grid-cols-2">{data.siteTypes.map(t=><div className="border-b border-[#2a2c31] pb-4" key={t.id}><SiteTypeForm type={t}/></div>)}<div><h3>Agregar un tipo</h3><SiteTypeForm/></div></div></Disclosure></>;
}
