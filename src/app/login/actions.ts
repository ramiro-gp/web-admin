"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { configurationStatus } from "@/lib/env";

export async function signInWithGitHub() {
  if (!configurationStatus().configured) redirect("/login");
  const result = await getAuth().api.signInSocial({ body: { provider: "github", callbackURL: "/", errorCallbackURL: "/login" }, headers: await headers() });
  if (result.url) redirect(result.url);
  redirect("/login?error=authentication_failed");
}
