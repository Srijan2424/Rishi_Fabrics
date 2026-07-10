type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

type SendEmailResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Rishi Fabrics <onboarding@resend.dev>";

  if (!apiKey) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY is not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, error: detail || `Email provider returned ${response.status}` };
  }

  return { ok: true };
}
