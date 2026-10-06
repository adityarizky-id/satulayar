import assert from "node:assert/strict";
import test from "node:test";

import {
  isEmailConfigured,
  getResendClient,
  sendEmail,
} from "@/lib/notifications/email";

test("isEmailConfigured returns true when RESEND_API_KEY starts with re_", () => {
  const originalKey = process.env.RESEND_API_KEY;

  try {
    process.env.RESEND_API_KEY = "re_test_123456789";
    assert.equal(isEmailConfigured(), true);

    const client = getResendClient();
    assert.notEqual(client, null);
  } finally {
    process.env.RESEND_API_KEY = originalKey;
  }
});

test("isEmailConfigured returns false when RESEND_API_KEY is empty or invalid", () => {
  const originalKey = process.env.RESEND_API_KEY;

  try {
    delete process.env.RESEND_API_KEY;
    assert.equal(isEmailConfigured(), false);
    assert.equal(getResendClient(), null);

    process.env.RESEND_API_KEY = "invalid_key_prefix";
    assert.equal(isEmailConfigured(), false);
  } finally {
    process.env.RESEND_API_KEY = originalKey;
  }
});

test("sendEmail degrades gracefully and skips when RESEND_API_KEY is not configured", async () => {
  const originalKey = process.env.RESEND_API_KEY;

  try {
    delete process.env.RESEND_API_KEY;

    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });

    assert.equal(result.success, false);
    assert.equal(result.skipped, true);
    assert.match(result.error ?? "", /RESEND_API_KEY is not configured/);
  } finally {
    process.env.RESEND_API_KEY = originalKey;
  }
});
