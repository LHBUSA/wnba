-- Women's Basketball History — precision-aware membership date ranges
--
-- Wikidata can qualify P54 memberships at year or month precision. We store the canonical
-- representative date at the start of that interval (year => Jan 1, month => first of month)
-- plus the explicit precision. A range check therefore must compare the start floor with the
-- end CEILING, not compare the two representative dates as if both were exact days.

begin;

alter table public.wbh_person_team_membership_claims
  drop constraint if exists wbh_membership_range;

alter table public.wbh_person_team_membership_claims
  add constraint wbh_membership_range check (
    started_on is null
    or ended_on is null
    or started_on <= case ended_on_precision
      when 'day' then ended_on
      when 'month' then (ended_on + interval '1 month - 1 day')::date
      when 'year' then make_date(extract(year from ended_on)::integer, 12, 31)
      else ended_on
    end
  );

comment on constraint wbh_membership_range on public.wbh_person_team_membership_claims is
  'Precision-aware: partial end dates are intervals. Stored representative dates are interval floors; validation compares start floor against end ceiling.';

commit;
