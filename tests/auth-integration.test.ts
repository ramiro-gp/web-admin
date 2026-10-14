import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const request = vi.hoisted(() => ({ db: undefined as unknown, headers: undefined as unknown as Headers,
  profile: { id: 123, login: "admin", name: "Admin", email: "admin@example.com", avatar_url: "https://example.com/avatar.png" },
}));
vi.mock("@/db", () => ({ getDb: () => request.db }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));

import { getAuth, requireAdmin } from "@/lib/auth";

let pg: PGlite;
const origin = "http://localhost:3000";
function cookies(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

/** Only GitHub's HTTP responses are fixtures. Better Auth's state, callback,
 * validation hook, adapter, sessions and cookie signatures all run unchanged. */
async function oauthLogin() {
  const auth = getAuth();
  const start = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST", headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: "/", errorCallbackURL: "/login" }),
  }));
  expect(start.status).toBe(200);
  const state = new URL((await start.json() as { url: string }).url).searchParams.get("state");
  expect(state).toBeTruthy();
  const callback = await auth.handler(new Request(`${origin}/api/auth/callback/github?code=fixture-code&state=${encodeURIComponent(state!)}`, {
    headers: { cookie: cookies(start) },
  }));
  return { response: callback, cookie: cookies(callback) };
}

beforeAll(async () => {
  pg = new PGlite();
  request.db = drizzle(pg, { schema });
  await migrate(drizzle(pg), { migrationsFolder: "./drizzle" });
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/auth_test");
  vi.stubEnv("BETTER_AUTH_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-secret-with-at-least-32-characters-2026");
  vi.stubEnv("GITHUB_CLIENT_ID", "fixture-client-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "fixture-client-secret");
  vi.stubEnv("ADMIN_GITHUB_ID", "123");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "fixture-token", token_type: "bearer", scope: "read:user,user:email" });
    if (url === "https://api.github.com/user") return Response.json(request.profile);
    if (url === "https://api.github.com/user/emails") return Response.json([{ email: request.profile.email, primary: true, verified: true }]);
    throw new Error(`Unexpected network request in auth integration test: ${new URL(url).origin}`);
  }));
}, 30_000);

beforeEach(async () => {
  await pg.exec('TRUNCATE "user", verification CASCADE;');
  request.profile = { id: 123, login: "admin", name: "Admin", email: "admin@example.com", avatar_url: "https://example.com/avatar.png" };
  request.headers = new Headers();
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await pg?.close(); });

describe("Better Auth real con el único administrador", () => {
  it("aprovisiona por OAuth válido y autentica mediante su cookie firmada y cuenta GitHub", async () => {
    const login = await oauthLogin();
    expect(login.response.status).toBe(302);
    expect(new URL(login.response.headers.get("location")!, origin).pathname).toBe("/");
    request.headers = new Headers({ cookie: login.cookie });
    expect((await requireAdmin()).email).toBe("admin@example.com");
    const counts = await pg.query<{ users: number; accounts: number; sessions: number }>(
      'SELECT (SELECT count(*)::integer FROM "user") AS users,(SELECT count(*)::integer FROM account) AS accounts,(SELECT count(*)::integer FROM session) AS sessions');
    expect(counts.rows[0]).toEqual({ users: 1, accounts: 1, sessions: 1 });
  });

  it("rechaza otro ID antes de crear usuario, cuenta o sesión, aun con el mismo email", async () => {
    request.profile.id = 124;
    const login = await oauthLogin();
    expect(login.response.status).toBe(302);
    const location = new URL(login.response.headers.get("location")!, origin);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("access_denied");
    const counts = await pg.query<{ users: number; accounts: number; sessions: number }>(
      'SELECT (SELECT count(*)::integer FROM "user") AS users,(SELECT count(*)::integer FROM account) AS accounts,(SELECT count(*)::integer FROM session) AS sessions');
    expect(counts.rows[0]).toEqual({ users: 0, accounts: 0, sessions: 0 });
  });

  it("una sesión borrada deja de permitir lecturas inmediatamente", async () => {
    const login = await oauthLogin();
    request.headers = new Headers({ cookie: login.cookie });
    expect((await requireAdmin()).name).toBe("Admin");
    await pg.exec("DELETE FROM session;");
    expect(await getAuth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } })).toBeNull();
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("una sesión vencida no autentica aunque su firma siga siendo válida", async () => {
    const login = await oauthLogin();
    request.headers = new Headers({ cookie: login.cookie });
    await pg.exec("UPDATE session SET expires_at = now() - interval '1 minute';");
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("una sesión válida sin la cuenta autorizada tampoco accede", async () => {
    const login = await oauthLogin();
    request.headers = new Headers({ cookie: login.cookie });
    await pg.exec("UPDATE account SET account_id = '124';");
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login?error=access_denied");
  });

  it("cerrar sesión borra el registro en PostgreSQL y revoca la cookie anterior", async () => {
    const login = await oauthLogin();
    const logout = await getAuth().handler(new Request(`${origin}/api/auth/sign-out`, {
      method: "POST", headers: { origin, cookie: login.cookie, "Content-Type": "application/json" }, body: "{}",
    }));
    expect(logout.status).toBe(200);
    request.headers = new Headers({ cookie: login.cookie });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("rechaza una cookie alterada y mantiene deshabilitado el registro por contraseña", async () => {
    const login = await oauthLogin();
    request.headers = new Headers({ cookie: `${login.cookie}tampered` });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT:/login");
    await pg.exec('TRUNCATE "user" CASCADE;');
    const signup = await getAuth().handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Other", email: "other@example.com", password: "password-is-disabled" }),
    }));
    expect(signup.status).toBeGreaterThanOrEqual(400);
    expect((await pg.query<{ count: number }>('SELECT count(*)::integer AS count FROM "user"')).rows[0]?.count).toBe(0);
  });
});
