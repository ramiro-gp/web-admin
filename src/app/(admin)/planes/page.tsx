import { getWorkspace } from "@/server/queries";
import { PlanForm } from "@/components/admin-forms";
import { PlanTable, clientName, websiteName } from "@/components/admin-tables";
import { Disclosure, Empty, PageHeading, Section } from "@/components/ui";
import { Filters, searchValue, type SearchValues } from "@/components/filters";
import { today } from "@/lib/calendar";

export default async function PlansPage({searchParams}:{searchParams:Promise<SearchValues>}) {
  const [data,search]=await Promise.all([getWorkspace(),searchParams]);const q=searchValue(search,"q").toLowerCase(),status=searchValue(search,"status"),client=searchValue(search,"client");
  const rows=data.plans.filter(p=>{const site=data.websites.find(w=>w.id===p.websiteId)!;const active=!p.endedOn||p.endedOn>today();return (!q||`${p.name} ${websiteName(data,p.websiteId)} ${clientName(data,site.clientId)}`.toLowerCase().includes(q))&&(!client||site.clientId===client)&&(!status||(status==="active"?active:!active));});
  return <><PageHeading title="Planes recurrentes" description="Condiciones, calendario y precios. Un plan por sitio, con su historial intacto."/><Disclosure title="Nuevo plan" open={!data.plans.length}>{data.websites.some(w=>!w.archivedAt)?<PlanForm data={data}/>:<Empty title="Primero agregá un sitio" description="Los planes se vinculan a una web y su cliente."/>}</Disclosure><Filters values={search} data={data} statuses={[{value:"active",label:"Activos / programados"},{value:"ended",label:"Finalizados"}]}/><Section title="Planes" count={rows.length}><PlanTable data={data} rows={rows}/></Section></>;
}
