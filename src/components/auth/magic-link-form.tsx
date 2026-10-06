"use client";

import { FormEvent, useState } from "react";

export function MagicLinkForm() {
  const [message, setMessage] = useState(
    "Use an invited work email. New accounts are not created from this form.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("Requesting a secure sign-in link…");

    // React clears currentTarget once the sync handler returns, so keep the
    // element before the first await or reset() lands on null.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "");

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to request a sign-in link.");
      }

      setMessage(
        payload.message ??
          "If that invited account exists, a sign-in link has been sent.",
      );
      formElement.reset();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to request a sign-in link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label className="field">
        <span>Work email</span>
        <input
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          name="email"
          placeholder="name@company.com"
          required
          type="email"
        />
      </label>
      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Sending link…" : "Email sign-in link"}
      </button>
      <p aria-live="polite" className="auth-form__message">
        {message}
      </p>
    </form>
  );
}
