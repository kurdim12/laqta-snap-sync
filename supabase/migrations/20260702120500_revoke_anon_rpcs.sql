-- Phase 0.2 — restore server-side gating on anon-callable RPCs.
--
-- Background: the app was migrated to call these SECURITY DEFINER functions
-- directly from the anon client, which removed the IP rate limiting that the
-- server functions provided. This re-closes those surfaces. The features keep
-- working because they are re-routed through server functions that run with
-- the service role (getGalleryByCode, checkAdminExists) and are rate limited.
--
-- Reversible: GRANT EXECUTE back to anon to restore the previous behaviour.

-- 1. get_code_gallery — the /g/CODE gallery now loads through the rate-limited
--    server function getGalleryByCode. Direct anon calls had no throttle, which
--    allowed enumeration of guest galleries by code. get_code_gallery is no
--    longer called from the client, so revoke execute entirely.
REVOKE EXECUTE ON FUNCTION public.get_code_gallery(text) FROM PUBLIC, anon, authenticated;

-- 2. admin_exists — only the first-run admin setup screen needs this, and it
--    now asks the checkAdminExists server function instead of calling the RPC
--    directly. Revoke anon/PUBLIC execute so it is not an open probe endpoint.
REVOKE EXECUTE ON FUNCTION public.admin_exists() FROM PUBLIC, anon;
