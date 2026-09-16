-- Women's Basketball History — conservative 2024 P54 evidence classifier v2
--
-- A Wikidata P54 statement with no end qualifier is NOT evidence that the player remained on that
-- club in 2024. Historical items often keep stale open-ended memberships. Only claims with BOTH
-- temporal bounds may be classified as bounded 2024 overlap; all one-sided claims stay unbounded.

begin;

create or replace view public.wbh_wnba_2024_membership_evidence
with (security_invoker = true) as
select
  c.membership_claim_id,
  c.person_id,
  c.team_id,
  c.source_team_qid,
  c.source_statement_id,
  c.statement_rank,
  c.started_on,
  c.started_on_precision,
  c.ended_on,
  c.ended_on_precision,
  case
    when c.started_on is null and c.ended_on is null then 'undated_claim'
    when c.started_on is null or c.ended_on is null then 'unbounded_claim'
    when c.started_on <= date '2024-12-31'
     and (case c.ended_on_precision
            when 'day' then c.ended_on
            when 'month' then (c.ended_on + interval '1 month - 1 day')::date
            when 'year' then make_date(extract(year from c.ended_on)::integer, 12, 31)
            else c.ended_on
          end) >= date '2024-01-01' then 'bounded_overlap'
    else 'outside_2024'
  end as evidence_class,
  c.qualifier_evidence,
  c.observed_at,
  c.recorded_at
from public.wbh_person_team_membership_claims c
join public.wbh_ingestion_runs r on r.run_id = c.ingestion_run_id
join public.wbh_sources s on s.source_id = r.source_id
where c.team_id is not null
  and not c.is_synthetic
  and s.rights_state = any (public.wbh_ingestible_states());

comment on view public.wbh_wnba_2024_membership_evidence is
  'Evidence only. bounded_overlap requires both start and end qualifiers. unbounded/undated P54 statements never establish a 2024 roster fact.';

revoke all on public.wbh_wnba_2024_membership_evidence from anon, authenticated;
grant select on public.wbh_wnba_2024_membership_evidence to service_role;

commit;
