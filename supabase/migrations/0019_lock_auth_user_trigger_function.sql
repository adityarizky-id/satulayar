-- The auth trigger function is not an API.
--
-- `handle_new_auth_user()` runs as SECURITY DEFINER so the auth trigger can
-- write `app_users`. Supabase grants EXECUTE on public-schema functions to
-- `anon` and `authenticated` by default, which exposed it at
-- /rest/v1/rpc/handle_new_auth_user. The trigger itself does not need those
-- grants: triggers run with the privileges of the function owner.
--
-- The membership helpers (`can_access_client`, `has_client_role`,
-- `can_manage_user`) keep their `authenticated` grant on purpose: every RLS
-- policy calls them as the signed-in user, and each only answers about the
-- caller's own memberships.

revoke execute on function public.handle_new_auth_user() from anon, authenticated;
