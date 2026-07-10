import { cookies } from "next/headers";

export const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: "CEO" | "HEAD_OF_OPERATIONS" | "MERCHANT" | "ERP_MANAGER" | "ADMIN";
  factoryId: string;
  twoFactorEnabled: boolean;
  status?: string;
  requestedRole?: string | null;
  permissions: string[];
};

async function authHeaders(): Promise<HeadersInit> {
  const cookieStore = await cookies();
  const session = cookieStore.get("mct_session");
  return session ? { Cookie: `mct_session=${session.value}` } : {};
}

async function getJson(path: string, fallback: unknown) {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      cache: "no-store",
      headers: await authHeaders()
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return {
      apiOffline: true,
      apiUrl,
      error: error instanceof Error ? error.message : "Unknown API error",
      rows: fallback
    };
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await fetch(`${apiUrl}/auth/me`, {
      cache: "no-store",
      headers: await authHeaders()
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function getControlTower() {
  try {
    const response = await fetch(`${apiUrl}/dashboard/control-tower`, {
      cache: "no-store",
      headers: await authHeaders()
    });

    if (!response.ok) {
      throw new Error(`API responded with ${response.status}`);
    }

    return response.json();
  } catch (error) {
    return {
      apiOffline: true,
      apiUrl,
      error: error instanceof Error ? error.message : "Unknown API error",
      metrics: {
        ordersRunning: 0,
        ordersDelayed: 0,
        ordersAtRisk: 0,
        upcomingDeliveries: 0,
        dispatchedOrders: 0,
        totalInventoryQuantity: 0,
        totalReworkQuantity: 0,
        importsPending: 0
      },
      upcomingDeliveries: [],
      orderJourneyStatus: [],
      stageInventorySummary: [],
      reworkSummary: [],
      importSummary: [],
      recentEvents: []
    };
  }
}

export async function getOrders() {
  return getJson("/orders", []);
}

export async function getWorkflows() {
  return getJson("/workflows", []);
}

export async function getFactories() {
  return getJson("/factories", []);
}

export async function getUploads() {
  return getJson("/erp-import/uploads", []);
}

export async function getFabricSnapshots() {
  return getJson("/fabric/snapshots", []);
}

export async function getWipSnapshots() {
  return getJson("/wip/snapshots", []);
}

export async function getTechPackStyles() {
  return getJson("/sampling/tech-packs/styles", []);
}

export async function getHistory(tab: "sampling" | "fabric" | "production") {
  return getJson(`/history/${tab}`, { groups: [] });
}

export async function getProductionUnits() {
  return getJson("/production-units", []);
}

export async function getOrder(id: string) {
  return getJson(`/orders/${id}`, null);
}


export async function getImportStageMappings() {
  return getJson("/erp-import/stage-mappings", []);
}

export async function getMonitoringSummary() {
  return getJson("/monitoring/summary", { metrics: {}, recentErrors: [], failedUploads: [], openIssues: [], recentEvents: [], activeWorkLogs: [] });
}

export async function getReportSummary() {
  return getJson("/reports/summary", { metrics: {}, sections: {} });
}

export async function getWorkLogs() {
  return getJson("/work-logs", []);
}

export async function getIssues() {
  return getJson("/issues", []);
}

export async function getUsers() {
  return getJson("/users", []);
}
