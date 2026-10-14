import Link from "next/link";
import type { WorkspaceData } from "@/server/queries";
import { Badge, Empty, Table } from "@/components/ui";
import { formatMoney, monthlyEquivalent } from "@/lib/money";
import { daysBetween, formatDate, today } from "@/lib/calendar";
import { currentPrice, getPeriodStatus, nextPlanDueDate, PERIOD_LABELS } from "@/lib/billing";
import { PaymentForm, PeriodAdjustmentForm } from "@/components/admin-forms";

export const frequencyLabels: Record<number,string> = {1:"Mensual",6:"Semestral",12:"Anual"};
export const workLabels: Record<string,string> = {requested:"Solicitado",in_progress:"En curso",completed:"Completado",cancelled:"Cancelado"};
export const clientName = (data:WorkspaceData,id:string) => {const c=data.clients.find(c=>c.id===id); return c?.companyName || c?.contactName || "Cliente";};
export const websiteName = (data:WorkspaceData,id:string) => data.websites.find(w=>w.id===id)?.name ?? "Sitio";
export function Money({amount,currency}:{amount:bigint|null;currency:"ARS"|"USD"}) { return amount===null?<span className="muted">Sin definir</span>:<span className="amount">{formatMoney(amount,currency)}</span>; }
export function PaymentBadge({amount,paidOn,dueOn,cancelled=false}:{amount:bigint|null;paidOn:string|null;dueOn:string|null;cancelled?:boolean}) {
  if(amount===null)return <Badge label="Sin precio"/>;
  if(amount===0n)return <Badge label="Sin cargo"/>;
  if(paidOn)return <Badge label="Pagado" tone="paid"/>;
  if(cancelled)return <Badge label="Cancelado"/>;
  return dueOn && dueOn<today()?<Badge label="Vencido" tone="overdue"/>:<Badge label="Pendiente" tone="pending"/>;
}
export function WebsiteTable({data,rows}:{data:WorkspaceData;rows:WorkspaceData["websites"]}) {
  if(!rows.length)return <Empty title="Sin sitios web" description="Registrá la primera web vendida para vincular planes, dominios y trabajos."/>;
  return <Table headers={["Sitio / cliente","Tipo vendido","Venta original","Fecha de venta","Estado",""]}>{rows.map(w=><tr key={w.id}><td><Link href={`/sitios/${w.id}`} className="table-primary text-link">{w.name}</Link><div className="table-secondary">{clientName(data,w.clientId)}</div></td><td>{data.siteTypes.find(t=>t.id===w.siteTypeId)?.name}</td><td><Money amount={w.salePriceMinor} currency={w.currency}/></td><td className="mono">{formatDate(w.soldOn)}</td><td>{w.archivedAt?<Badge label="Archivado"/>:<Badge label="Activo" tone="active"/>}</td><td className="align-right"><Link className="text-link muted" href={`/sitios/${w.id}`}>Ver sitio ↗</Link></td></tr>)}</Table>;
}
export function PlanTable({data,rows}:{data:WorkspaceData;rows:WorkspaceData["plans"]}) {
  if(!rows.length)return <Empty title="Sin planes recurrentes" description="Cada plan mantiene su propio calendario e historial de precios."/>;
  return <Table headers={["Plan / sitio","Frecuencia","Total período","Equiv. mensual","Próximo vencimiento","Estado",""]}>{rows.map(p=>{const price=currentPrice(p.id,data.prices) ?? data.prices.filter(price=>price.planId===p.id).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom))[0]; const due=nextPlanDueDate(p,data.periods); const ended=p.endedOn && p.endedOn<=today(); return <tr key={p.id}><td><Link href={`/planes/${p.id}`} className="table-primary text-link">{p.name}</Link><div className="table-secondary">{websiteName(data,p.websiteId)}</div></td><td>{frequencyLabels[p.frequencyMonths]}</td><td><Money amount={price?.amountMinor ?? null} currency={p.currency}/></td><td><Money amount={price?monthlyEquivalent(price.amountMinor,p.frequencyMonths):null} currency={p.currency}/></td><td className={`mono ${due && due<today()?"text-[#f3a39e]":""}`}>{formatDate(due)}</td><td>{ended?<Badge label="Finalizado"/>:<Badge label={p.billingStart>today()?"Programado":"Activo"} tone="active"/>}</td><td><Link className="muted text-link" href={`/planes/${p.id}`}>Ver ↗</Link></td></tr>;})}</Table>;
}
export function PeriodTable({data,rows,controls=true}:{data:WorkspaceData;rows:WorkspaceData["periods"];controls?:boolean}) {
  if(!rows.length)return <Empty title="No hay períodos registrados" description="Se generan hasta la fecha de hoy, desde el primer período administrado."/>;
  return <Table headers={["Plan / sitio","Período de cobertura","Vencimiento","Esperado","Pagado","Estado",...(controls?["Pago"]:[])]}>{rows.map(p=>{const plan=data.plans.find(plan=>plan.id===p.planId)!;const status=getPeriodStatus(p); return <tr key={p.id}><td><Link href={`/planes/${plan.id}`} className="table-primary text-link">{plan.name}</Link><div className="table-secondary">{websiteName(data,plan.websiteId)}</div></td><td><div className="mono text-[10px]">{formatDate(p.startsOn)} → {formatDate(p.endsOn)}</div><div className="table-secondary">{p.priceId===null?"Histórico manual · fin exclusivo":"Fin exclusivo"}</div></td><td className="mono">{formatDate(p.dueOn)}</td><td><Money amount={p.expectedAmountMinor} currency={plan.currency}/></td><td>{p.paidOn?<><Money amount={p.paidAmountMinor} currency={plan.currency}/><div className="table-secondary mono">{formatDate(p.paidOn)}</div></>:<span className="muted">—</span>}</td><td><Badge label={PERIOD_LABELS[status]} tone={status}/></td>{controls&&<td className="payment-controls"><details><summary>{p.paidOn?"Corregir pago":"Registrar pago"}</summary><PaymentForm source="period" id={p.id} amount={p.expectedAmountMinor} paidOn={p.paidOn}/></details>{!p.paidOn&&<details className="mt-3"><summary>Ajustar importe del período</summary><PeriodAdjustmentForm period={p}/></details>}</td>}</tr>;})}</Table>;
}
export function DomainTable({data,rows}:{data:WorkspaceData;rows:WorkspaceData["domains"]}) {
  if(!rows.length)return <Empty title="Sin dominios" description="Registrá sus vencimientos reales para anticipar las renovaciones."/>;
  return <Table headers={["Dominio / sitio","Registrador","Vencimiento","Autorrenovación","Incluido en plan",""]}>{rows.map(d=>{const days=daysBetween(today(),d.expiresOn);const included=data.planDomains.filter(i=>i.domainId===d.id).map(i=>data.plans.find(p=>p.id===i.planId)).filter(p=>p && (!p.endedOn || p.endedOn>today()));return <tr key={d.id}><td><Link href={`/dominios#dominio-${d.id}`} className="table-primary text-link">{d.name}</Link><div className="table-secondary">{websiteName(data,d.websiteId)}</div></td><td>{d.registrar}</td><td><div className="mono">{formatDate(d.expiresOn)}</div><div className={`table-secondary ${days<0?"!text-[#f3a39e]":days<=30?"!text-[#ddc68c]":""}`}>{days<0?`Vencido hace ${-days} días`:days===0?"Vence hoy":`En ${days} días`}</div></td><td>{d.autoRenew?"Activada":"Manual"}</td><td>{included.length?included.map(p=><Link key={p!.id} className="text-link" href={`/planes/${p!.id}`}>{p!.name}</Link>):<span className="muted">No incluido</span>}</td><td><Link className="text-link muted" href={`/dominios#dominio-${d.id}`}>Gestionar ↗</Link></td></tr>;})}</Table>;
}
export function WorkTable({data,rows}:{data:WorkspaceData;rows:WorkspaceData["works"]}) {
  if(!rows.length)return <Empty title="Sin trabajos adicionales" description="Registrá los pedidos posteriores a la venta original de cada sitio."/>;
  return <Table headers={["Trabajo / sitio","Solicitud","Estado","Precio","Cobro",""]}>{rows.map(w=><tr key={w.id}><td><Link className="table-primary text-link" href={`/trabajos#trabajo-${w.id}`}>{w.description}</Link><div className="table-secondary">{websiteName(data,w.websiteId)}</div></td><td className="mono">{formatDate(w.requestedOn)}</td><td><Badge label={workLabels[w.status] ?? w.status} tone={w.status==="completed"?"paid":"neutral"}/></td><td><Money amount={w.priceMinor} currency={w.currency}/></td><td><PaymentBadge amount={w.priceMinor} paidOn={w.paidOn} dueOn={w.dueOn} cancelled={w.status==="cancelled"}/>{w.paidOn&&<div className="table-secondary mono">{formatDate(w.paidOn)}</div>}</td><td><Link className="text-link muted" href={`/trabajos#trabajo-${w.id}`}>Gestionar ↗</Link></td></tr>)}</Table>;
}
