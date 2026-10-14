import { getWorkspace } from "@/server/queries";
import { PeriodTable, clientName, websiteName } from "@/components/admin-tables";
import { FinancialTable } from "@/components/financial-table";
import { PageHeading, Section } from "@/components/ui";
import { Filters, searchValue, type SearchValues } from "@/components/filters";
import { SyncGate } from "@/components/sync-gate";
import { buildDashboard, getPeriodStatus } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { today } from "@/lib/calendar";

export default async function BillingPage({searchParams}:{searchParams:Promise<SearchValues>}) {
  const [data,search]=await Promise.all([getWorkspace(),searchParams]);const q=searchValue(search,"q").toLowerCase(),status=searchValue(search,"status"),client=searchValue(search,"client");const dashboard=buildDashboard(data);
  const rows=data.periods.filter(p=>{const plan=data.plans.find(plan=>plan.id===p.planId)!;const site=data.websites.find(w=>w.id===plan.websiteId)!;return (!q||`${plan.name} ${websiteName(data,plan.websiteId)} ${clientName(data,site.clientId)}`.toLowerCase().includes(q))&&(!client||site.clientId===client)&&(!status||getPeriodStatus(p)===status);});
  const match=(row:{clientId:string;clientName:string;websiteName:string;label:string})=>(!client||row.clientId===client)&&(!q||`${row.clientName} ${row.websiteName} ${row.label}`.toLowerCase().includes(q));
  const otherDebts=dashboard.debts.filter(row=>row.source!=="period"&&match(row)&&(!status || (status==="overdue"?!!row.dueOn&&row.dueOn<today():status==="pending"?!row.dueOn||row.dueOn>=today():false)));
  return <><PageHeading title="Cobranzas" description="Un período, un pago completo. El historial define qué está pagado y qué está pendiente."/><SyncGate><div className="stat-grid !grid-cols-2"><div className="stat"><div className="stat-label">Pendiente total · todas las fuentes</div><div className="stat-value money">{formatMoney(dashboard.totals.ARS)}</div>{dashboard.totals.USD>0n&&<div className="stat-foot mono">{formatMoney(dashboard.totals.USD,"USD")}</div>}</div><div className="stat"><div className="stat-label">Cobrado este mes</div><div className="stat-value money text-[#c4ef91]">{formatMoney(dashboard.collected.ARS)}</div>{dashboard.collected.USD>0n&&<div className="stat-foot mono">{formatMoney(dashboard.collected.USD,"USD")}</div>}</div></div><Filters values={search} data={data} statuses={[{value:"pending",label:"Pendientes"},{value:"overdue",label:"Vencidos"},{value:"paid",label:"Pagados"}]}/><Section title="Períodos de planes" count={rows.length} note="Los períodos futuros se muestran como proyección; se generan cuando comienza su cobertura."><PeriodTable data={data} rows={rows}/></Section>{status!=="paid"&&<Section title="Ventas y trabajos pendientes" count={otherDebts.length}><FinancialTable rows={otherDebts}/></Section>}{(!status||status==="paid")&&<Section title="Historial de pagos" count={dashboard.payments.filter(match).length} note="Planes, ventas y trabajos por su fecha real de cobro."><FinancialTable rows={dashboard.payments.filter(match)} payments/></Section>}</SyncGate></>;
}
