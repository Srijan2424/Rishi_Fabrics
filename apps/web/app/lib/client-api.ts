const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

function normalizeLocalApiUrl(url: string) {
  if (typeof window === "undefined") return url;
  const pageHost = window.location.hostname;
  if (pageHost === "127.0.0.1" && url.includes("//localhost:")) {
    return url.replace("//localhost:", "//127.0.0.1:");
  }
  if (pageHost === "localhost" && url.includes("//127.0.0.1:")) {
    return url.replace("//127.0.0.1:", "//localhost:");
  }
  return url;
}

export const clientApiUrl = normalizeLocalApiUrl(configuredApiUrl);

export const pilotSessionCookieName = "rf_pilot_session";

export function savePilotSessionToken(token: string | undefined) {
  if (!token) return;
  document.cookie = `${pilotSessionCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax; Secure`;
}

export function clearPilotSessionToken() {
  document.cookie = `${pilotSessionCookieName}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
}

function readPilotSessionToken() {
  return document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${pilotSessionCookieName}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

export function clientAuthHeaders(headers?: HeadersInit): HeadersInit {
  const merged = new Headers(headers);
  const token = readPilotSessionToken();
  if (token) {
    merged.set("Authorization", `Bearer ${decodeURIComponent(token)}`);
  }
  return merged;
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? "include",
    headers: clientAuthHeaders(init.headers)
  });
}
