"use client";

import { useState } from "react";

export function PlanCalendarFields({initialDate,initialAnchor}:{initialDate:string;initialAnchor?:number}) {
  const [start,setStart]=useState(initialDate);
  const [anchor,setAnchor]=useState(String(initialAnchor ?? Number(initialDate.slice(-2))));
  return <><label className="field"><span>Primer período administrado *</span><input type="date" name="billingStart" required value={start} onChange={event=>{setStart(event.target.value);if(event.target.value&&!initialAnchor)setAnchor(String(Number(event.target.value.slice(-2))));}}/><span className="field-help">Inicio de un período completo. No se generará deuda anterior.</span></label><label className="field"><span>Día ancla del calendario *</span><input type="number" name="anchorDay" min="1" max="31" step="1" required value={anchor} onChange={event=>setAnchor(event.target.value)}/><span className="field-help">{initialAnchor?"Se conserva el ancla del plan anterior. ":""}Si el ancla es 31, se conserva después de febrero.</span></label></>;
}
