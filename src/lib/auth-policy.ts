/** Only the immutable GitHub ID authenticates the administrator. Never email/login. */
export function isAllowedGithubIdentity(allowedId: string | undefined, source: unknown): boolean {
  if (!allowedId || !/^[1-9]\d*$/.test(allowedId) || !source || typeof source !== "object") return false;
  const candidate = source as { method?: unknown; oauth?: { providerId?: unknown; profile?: { id?: unknown } } };
  if (candidate.method !== "oauth" || candidate.oauth?.providerId !== "github") return false;
  const id = candidate.oauth.profile?.id;
  if (typeof id === "number" && (!Number.isSafeInteger(id) || id <= 0)) return false;
  if (typeof id !== "number" && typeof id !== "string") return false;
  return String(id) === allowedId;
}

export function isAllowedStoredAccount(allowedId: string, providerId: string, accountId: string): boolean {
  return providerId === "github" && accountId === allowedId;
}
