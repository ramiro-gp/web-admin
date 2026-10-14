import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { configurationStatus, getRuntimeEnv } from "@/lib/env";
import { isAllowedGithubIdentity } from "@/lib/auth-policy";

function createAuth() {
  const env = getRuntimeEnv();
  return betterAuth({
    appName: "web-admin",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: false },
    socialProviders: { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, scope: ["user:email"] } },
    user: {
      validateUserInfo: ({ source }) => isAllowedGithubIdentity(env.ADMIN_GITHUB_ID, source)
        ? undefined
        : { error: "access_denied", errorDescription: "Esta cuenta no tiene acceso a web-admin." },
    },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: new URL(env.BETTER_AUTH_URL).protocol === "https:" },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }

export const requireAdmin = cache(async () => {
  if (!configurationStatus().configured) redirect("/login");
  const env = getRuntimeEnv();
  const result = await getAuth().api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  if (!result) redirect("/login");
  const [identity] = await getDb().select({ id: account.id }).from(account).where(and(
    eq(account.userId, result.user.id), eq(account.providerId, "github"), eq(account.accountId, env.ADMIN_GITHUB_ID),
  )).limit(1);
  if (!identity) redirect("/login?error=access_denied");
  return result.user;
});
