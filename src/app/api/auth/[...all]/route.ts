import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { configurationStatus } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!configurationStatus().configured) return Response.json({ error: "El acceso todavía no está configurado." }, { status: 503 });
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  if (!configurationStatus().configured) return Response.json({ error: "El acceso todavía no está configurado." }, { status: 503 });
  return toNextJsHandler(getAuth()).POST(request);
}
