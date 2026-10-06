-- Meta issues a long-lived (about 60-day) access token and never a refresh
-- token. `refresh_token` was NOT NULL, so the OAuth callback stored an empty
-- string to mean "absent". NULL is the honest representation.
--
-- Backward compatible with the application code deployed before this
-- migration: that code still writes '' for Meta, which remains accepted.

alter table public.connector_tokens
  alter column refresh_token drop not null;

update public.connector_tokens
  set refresh_token = null
  where refresh_token = '';

-- Platforms whose access token expires within the hour cannot work without a
-- refresh token. The callback already refuses to store such a consent; this
-- keeps the invariant in the database too.
alter table public.connector_tokens
  drop constraint if exists connector_tokens_refresh_token_required_check;
alter table public.connector_tokens
  add constraint connector_tokens_refresh_token_required_check
  check (
    platform not in (
      'google-ads',
      'google-analytics',
      'google-search-console',
      'bing-ads'
    )
    or nullif(refresh_token, '') is not null
  );

comment on column public.connector_tokens.refresh_token is
  'Null when the platform issues no refresh token (Meta long-lived access tokens); expires_at is then the only lifetime. Service role only.';
