type UploadObjectInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

type StoredObject = {
  key: string;
  url: string;
};

function storageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "tech-packs";

  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey, bucket };
}

export function isCloudStorageConfigured() {
  return Boolean(storageConfig());
}

export function assetUrlForKey(key: string) {
  return `/sampling/tech-packs/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function uploadObject(input: UploadObjectInput): Promise<StoredObject | null> {
  const config = storageConfig();
  if (!config) return null;
  const body = new Blob([new Uint8Array(input.body)], { type: input.contentType });

  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.bucket}/${input.key}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": input.contentType,
      "x-upsert": "true"
    },
    body
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cloud storage upload failed: ${detail || response.status}`);
  }

  return { key: input.key, url: assetUrlForKey(input.key) };
}

export async function getObject(key: string) {
  const config = storageConfig();
  if (!config) return null;

  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.bucket}/${key}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`
    }
  });

  if (!response.ok) return null;

  const arrayBuffer = await response.arrayBuffer();
  return {
    body: Buffer.from(arrayBuffer),
    contentType: response.headers.get("content-type") || "application/octet-stream"
  };
}
