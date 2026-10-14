"use client";

import { useState } from "react";

type WebsiteChoice={id:string;name:string;clientName:string};
type DomainChoice={id:string;websiteId:string;name:string};

export function PlanSiteFields({websites,domains,initialWebsiteId}:{websites:WebsiteChoice[];domains:DomainChoice[];initialWebsiteId?:string}) {
  const [websiteId,setWebsiteId]=useState(initialWebsiteId ?? "");
  const includedChoices=domains.filter(d=>d.websiteId===websiteId);
  return <><label className="field"><span>Sitio web *</span><select name="websiteId" value={websiteId} required onChange={event=>setWebsiteId(event.target.value)}><option value="" disabled>Seleccionar sitio…</option>{websites.map(w=><option key={w.id} value={w.id}>{w.name} · {w.clientName}</option>)}</select></label>{includedChoices.length>0&&<div key={websiteId} className="field-full"><div className="field mb-2">Dominios incluidos</div><div className="checks">{includedChoices.map(d=><label className="check" key={d.id}><input type="checkbox" name="domainIds" value={d.id}/><span>{d.name}</span></label>)}</div></div>}</>;
}
