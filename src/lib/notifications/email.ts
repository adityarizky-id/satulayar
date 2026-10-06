import { Resend } from "resend";

export interface EmailPayload {
  to?: string | string[];
  from?: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Check if the Resend email service is configured with a valid API key.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.startsWith("re_"));
}

/**
 * Get an initialized Resend client instance.
 * Returns null if the API key is not configured.
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.startsWith("re_")) {
    return null;
  }
  return new Resend(apiKey);
}

/**
 * Core email dispatcher using Resend API.
 * Designed to fail closed and degrade gracefully without throwing uncaught exceptions.
 */
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const resend = getResendClient();

  if (!resend) {
    console.warn(
      "[Notifications:Email] Skipped sending email: RESEND_API_KEY is not configured in environment.",
    );
    return {
      success: false,
      skipped: true,
      error: "RESEND_API_KEY is not configured.",
    };
  }

  const defaultFrom =
    process.env.NOTIFICATION_EMAIL_FROM || "Satulayar <onboarding@resend.dev>";
  const defaultTo = process.env.NOTIFICATION_EMAIL_TO || "owner@satulayar.example";

  const to = payload.to || defaultTo;
  const from = payload.from || defaultFrom;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });

    if (error) {
      console.error("[Notifications:Email] Resend API error:", error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Notifications:Email] Unexpected dispatch failure:", errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send a verification / welcome test email to confirm Resend API connectivity.
 */
export async function sendTestNotificationEmail(
  recipientEmail?: string,
): Promise<EmailResult> {
  const to = recipientEmail || process.env.NOTIFICATION_EMAIL_TO || "owner@satulayar.example";
  const sentAt = new Date().toISOString();

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #edf2f7; padding-bottom: 14px;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #35e27d;"></span>
        <strong style="font-size: 15px; color: #0f172a; letter-spacing: -0.01em;">Satulayar</strong>
      </div>
      <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px;">Resend API Integration Active</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px;">
        Halo, sistem notifikasi otomatis email via <strong>Resend</strong> telah berhasil terhubung dengan <strong>Satulayar</strong>.
      </p>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 18px;">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Status Koneksi</div>
        <div style="font-size: 14px; font-weight: 600; color: #16a34a;">● Live & Ready for Alerting</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 8px; margin-bottom: 4px;">Waktu Verifikasi</div>
        <div style="font-size: 13px; font-family: monospace; color: #334155;">${sentAt}</div>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0;">
        Email ini menandai bahwa jalur pengiriman alert anomali, rekap performa brand, dan peringatan kedaluwarsa token siap beroperasi.
      </p>
    </div>
  `;

  return sendEmail({
    to,
    subject: "✅ [Satulayar] Resend Email Integration Verified",
    html,
    text: `Satulayar: Resend API Integration Active. Verified at ${sentAt}.`,
  });
}
