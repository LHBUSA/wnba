-- STAGED, NOT APPLIED. Needs owner approval.
-- Target: Supabase tkmlnhmylqnttmnsnief.
--
-- Post-apply verification of 20260915200000_wnba_pbe_ledger_v1.sql (applied 2026-09-15 19:50:44Z) found
-- service_role holding INSERT on the view public.wnba_pbe_current_grades. The grant came from Supabase default
-- privileges; v1 revoked update/delete/truncate/references/trigger on the view but not insert.
--
-- It is inert: a DISTINCT ON view is not updatable, and there are no INSTEAD rules or triggers. Proven on
-- production, rollback-scoped: 55000 cannot insert into view (supabase/apply/verify-current-grades-view-inert.ps1).
-- This revoke only makes the grant match the intent: the view is select-only for service_role.

begin;
revoke insert on public.wnba_pbe_current_grades from service_role;
commit;
