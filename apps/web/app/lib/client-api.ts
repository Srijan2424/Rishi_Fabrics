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
