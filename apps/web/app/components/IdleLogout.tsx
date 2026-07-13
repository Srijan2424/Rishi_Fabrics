"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authFetch, clearPilotSessionToken, clientApiUrl } from "../lib/client-api";

const idleTimeoutMs = 10 * 60 * 1000;
const activityEvents = ["click", "keydown", "scroll", "touchstart", "mousemove"];

export function IdleLogout() {
  const router = useRouter();

  useEffect(() => {
    let timeoutId: number;

    async function logoutForInactivity() {
      clearPilotSessionToken();
      await authFetch(`${clientApiUrl}/auth/logout`, { method: "POST" }).catch(() => undefined);
      router.push("/login?reason=idle");
      router.refresh();
    }

    function resetTimer() {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(logoutForInactivity, idleTimeoutMs);
    }

    resetTimer();
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, resetTimer, { passive: true });
    }

    return () => {
      window.clearTimeout(timeoutId);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, resetTimer);
      }
    };
  }, [router]);

  return null;
}
