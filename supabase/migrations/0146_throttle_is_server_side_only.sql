-- ─── The auth throttle must not be reachable from the browser ───────────────
-- Phase 1 exposed auth_throttle_check/fail/clear to anon, reasoning that
-- sign-in happens before a session exists. Reviewing it in Phase 2 showed that
-- was wrong in two ways, both verified against a running instance:
--
--   * anon could call auth_throttle_clear and reset the counter, so the whole
--     control was bypassable by anyone who could read this file — brute force
--     simply clears between attempts;
--   * anon could call auth_throttle_fail for any username, driving a named
--     employee to the maximum wait at will and holding them there. That is the
--     account denial-of-service the design set out to avoid, reintroduced
--     through the back door.
--
-- The throttle belongs entirely on the server. The sign-in action runs there
-- and uses the service-role client, which never reaches the browser, so no
-- client-callable grant is needed at all.
revoke execute on function public.auth_throttle_check(text[]) from anon, authenticated, public;
revoke execute on function public.auth_throttle_fail(text[])  from anon, authenticated, public;
revoke execute on function public.auth_throttle_clear(text[]) from anon, authenticated, public;

-- Revoking from PUBLIC also removes the grant service_role inherited through
-- it, so the server's own client is named explicitly. This is the only role
-- that may touch the throttle, and its key never leaves the server.
grant execute on function public.auth_throttle_check(text[]) to service_role;
grant execute on function public.auth_throttle_fail(text[])  to service_role;
grant execute on function public.auth_throttle_clear(text[]) to service_role;
