import { readFile } from "node:fs/promises";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
const password = "Factory@2026";

async function json(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}

async function login(email: string) {
  const response = await fetch(`${apiUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  return { cookie, user: body.user };
}

async function previewWorkbook(cookie: string, factoryId: string, importKind: string, path: string) {
  const buffer = await readFile(path);
  const form = new FormData();
  form.append("factoryId", factoryId);
  form.append("importKind", importKind);
  form.append("file", new Blob([buffer]), path.split("/").pop() ?? "workbook.xlsx");

  const response = await fetch(`${apiUrl}/erp-import/preview-workbook`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`Preview failed for ${importKind}: ${JSON.stringify(body)}`);
  return body;
}

async function applyExtracted(cookie: string, factoryId: string, fileName: string, workbookKind: string, acceptedRows: unknown[]) {
  const response = await fetch(`${apiUrl}/erp-import/apply-extracted-workbook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({ factoryId, fileName, workbookKind, acceptedRows })
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`Apply extracted failed for ${workbookKind}: ${JSON.stringify(body)}`);
  return body;
}

async function getRows(cookie: string, path: string) {
  const response = await fetch(`${apiUrl}${path}`, { headers: { Cookie: cookie } });
  const body = await json(response);
  if (!response.ok) throw new Error(`GET ${path} failed: ${JSON.stringify(body)}`);
  return body as unknown[];
}

async function uploadTechPack(cookie: string, pdfPath: string) {
  const buffer = await readFile(pdfPath);
  const form = new FormData();
  form.append("files", new Blob([buffer], { type: "application/pdf" }), pdfPath.split("/").pop() ?? "tech-pack.pdf");
  const response = await fetch(`${apiUrl}/sampling/tech-packs/upload`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form
  });
  const body = await json(response);
  if (!response.ok) throw new Error(`Tech pack upload failed: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const admin = await login("admin@demo.local");
  const factoryId = admin.user.factoryId;

  const wipPreview = await previewWorkbook(admin.cookie, factoryId, "WIP", "/Users/srijanchopra/Desktop/WIP BOTH UNIT.xlsx");
  await applyExtracted(admin.cookie, factoryId, "WIP BOTH UNIT.xlsx", "WIP", wipPreview.acceptedRows);
  const wipRows = await getRows(admin.cookie, "/wip/snapshots");
  if (wipRows.length === 0) throw new Error("WIP snapshots were not saved.");

  const fabricPreview = await previewWorkbook(admin.cookie, factoryId, "FABRIC_DYEING", "/Users/srijanchopra/Desktop/FABRIC SHEET OF DYEING.xlsx");
  await applyExtracted(admin.cookie, factoryId, "FABRIC SHEET OF DYEING.xlsx", "FABRIC_DYEING", fabricPreview.acceptedRows);
  const fabricRows = await getRows(admin.cookie, "/fabric/snapshots");
  if (fabricRows.length === 0) throw new Error("Fabric snapshots were not saved.");

  await uploadTechPack(admin.cookie, "/Users/srijanchopra/Downloads/AW26-WW-AJ-SST-00019-AW26-WW-AJ-SST-00019 - Revised PROD TP-en.pdf");
  const techPacks = await getRows(admin.cookie, "/sampling/tech-packs/styles");
  if (!techPacks.some((row: any) => row.styleNumber === "AW26-WW-AJ-SST-00019")) {
    throw new Error("Tech pack style number was not extracted.");
  }

  console.table({
    wipRows: wipRows.length,
    fabricRows: fabricRows.length,
    techPackStyles: techPacks.length
  });
  console.log("Module split smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
