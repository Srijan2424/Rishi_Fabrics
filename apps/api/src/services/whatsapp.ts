type SendWhatsAppInput = {
  to: string | string[];
  text: string;
};

type SendWhatsAppResult = {
  ok: boolean;
  delivered?: Array<{ to: string; sid?: string }>;
  failed?: Array<{ to: string; error: string }>;
  error?: string;
};

function normalizeWhatsAppNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM ?? "");

  if (!accountSid || !authToken || !from) {
    return {
      ok: false,
      error: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM must be configured"
    };
  }

  const recipients = (Array.isArray(input.to) ? input.to : [input.to])
    .map(normalizeWhatsAppNumber)
    .filter(Boolean);

  if (recipients.length === 0) {
    return { ok: false, error: "No WhatsApp recipients configured" };
  }

  const delivered: Array<{ to: string; sid?: string }> = [];
  const failed: Array<{ to: string; error: string }> = [];
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  for (const to of recipients) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        From: from,
        To: to,
        Body: input.text
      })
    });

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      failed.push({ to, error: bodyText || `WhatsApp provider returned ${response.status}` });
      continue;
    }

    const body: { sid?: string } = bodyText
      ? await Promise.resolve().then(() => JSON.parse(bodyText) as { sid?: string }).catch(() => ({}))
      : {};
    delivered.push({ to, sid: body.sid });
  }

  if (failed.length > 0) {
    return {
      ok: false,
      delivered,
      failed,
      error: failed.map((item) => `${item.to}: ${item.error}`).join("; ")
    };
  }

  return { ok: true, delivered };
}
