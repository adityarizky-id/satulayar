const syncFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A stored sync time only means something next to the zone it was recorded in,
 * so the account timezone is always shown with it.
 */
export function formatSyncTimestamp(
  isoTimestamp: string,
  timeZone: string,
): string {
  const cached = syncFormatters.get(timeZone);
  const formatter =
    cached ??
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });

  if (!cached) syncFormatters.set(timeZone, formatter);

  return formatter.format(new Date(isoTimestamp));
}

export function AccountSyncTime({
  lastSyncAt,
  timeZone,
  label = "Synced",
  emptyLabel = "Not synced",
}: {
  lastSyncAt: string | null;
  timeZone: string;
  label?: string;
  /** Shown when there is no timestamp; must match what `label` describes. */
  emptyLabel?: string;
}) {
  const timestamp = lastSyncAt
    ? formatSyncTimestamp(lastSyncAt, timeZone)
    : emptyLabel;

  return (
    <div
      aria-label={`${label} ${timestamp}. Account timezone ${timeZone}.`}
      className="topbar__meta topbar__meta--sync"
      title={`Account timezone: ${timeZone}`}
    >
      <span>{label}</span>
      <strong>{timestamp}</strong>
    </div>
  );
}
