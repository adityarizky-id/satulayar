import { NextResponse } from "next/server";
import { sendTestNotificationEmail, isEmailConfigured } from "@/lib/notifications/email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: "RESEND_API_KEY is not configured in environment.",
      },
      { status: 503 },
    );
  }

  try {
    let body: { email?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty or invalid body is acceptable; defaults to NOTIFICATION_EMAIL_TO
    }

    const result = await sendTestNotificationEmail(body.email);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Failed to send email via Resend API",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      message: "Test email dispatched successfully via Resend API.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 },
    );
  }
}
