-- Records a credential set saved through the Data sources form.
--
-- Google Ads can now be connected without OAuth: an operator types the
-- developer token, OAuth client, and refresh token for one brand, and the
-- server verifies them against Google before storing them in
-- `connector_tokens`. That changes what the deployment can reach exactly as an
-- OAuth consent does, so it is audited, under its own action: an investigator
-- needs to tell "someone consented on Google's screen" from "someone pasted a
-- credential", because only the second can carry a secret obtained elsewhere.
--
-- The action list in 0007 is an inline column check, which Postgres names
-- `activity_audit_log_action_check`. It is replaced whole; every existing
-- action is kept, so no stored row can fall outside the new list.
--
-- Apply BEFORE deploying the code that writes the action. The route stores the
-- credential either way, but until this runs the check refuses the audit row
-- for every save, and the route reports `auditRecorded: false`.
--
-- The row still carries identifiers only (brand, customer id, whether a
-- manager was set): the route never passes a secret, and `sanitiseAuditDetail`
-- redacts any key that names one.

alter table public.activity_audit_log
  drop constraint if exists activity_audit_log_action_check;

alter table public.activity_audit_log
  add constraint activity_audit_log_action_check
  check (
    action in (
      'audience.export',
      'sync.manual',
      'sync.backfill',
      'sync.scheduled',
      'connector.connected',
      'connector.disconnected',
      'connector.credentials_saved'
    )
  );
