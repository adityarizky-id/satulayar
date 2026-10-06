"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="route-state">
      <div className="route-state__mark route-state__mark--error">!</div>
      <h1>The dashboard could not be prepared.</h1>
      <p>No live connector or stored metric has been changed.</p>
      <button className="button button--primary" onClick={reset} type="button">
        Try again
      </button>
    </main>
  );
}
