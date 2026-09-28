-- 0052: a customer's answer to an estimate goes through the shop's server only.
--
-- respond_public_quote is SECURITY DEFINER and anon could EXECUTE it, so anyone
-- holding an estimate link could call it straight from a browser with the public
-- key and skip /api/quote/respond — supplying any IP and user agent, approving
-- with no consent tick and a one-letter name. That writes an "approved"
-- quote_approvals row indistinguishable from a real one, weakening the
-- AS 45.45 authorization record. Security review 2026-09-27.
--
-- Same shape as 0025 for service requests: the route now calls this function
-- with the service-role key (commit "Estimate answers go through the server
-- only"). APPLY ONLY AFTER that route is deployed — revoking first would stop
-- every customer from approving an estimate.

revoke all on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) from public;
revoke all on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) from anon;
revoke all on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) from authenticated;
grant execute on function public.respond_public_quote(uuid, text, text, boolean, text, text, uuid[]) to service_role;

-- Verify (expect false, false, true):
--   select has_function_privilege('anon', 'public.respond_public_quote(uuid,text,text,boolean,text,text,uuid[])', 'execute'),
--          has_function_privilege('authenticated', 'public.respond_public_quote(uuid,text,text,boolean,text,text,uuid[])', 'execute'),
--          has_function_privilege('service_role', 'public.respond_public_quote(uuid,text,text,boolean,text,text,uuid[])', 'execute');
