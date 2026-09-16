-- Women's Basketball History — external-id namespace hardening v1
--
-- The original linked-id uniqueness key treated an external value as globally unique inside a
-- source. That is too broad for Wikidata, where multiple identifier properties may legitimately
-- reuse the same string/number. The identifier namespace (id_space) is part of identity.
--
-- Example: Wikidata P3588=123 and P8286=123 are unrelated identifiers and must not collide.
-- This migration changes only the linked external-id uniqueness index.

begin;

-- Every linked identifier must name its namespace. Candidate/rejected rows may remain namespace-less
-- while being investigated, but canonical linked aliases may not.
create or replace function public.wbh_entity_source_ids_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_table text;
  target_column text;
  target_exists boolean;
begin
  case new.entity_type
    when 'person' then target_table := 'wbh_persons'; target_column := 'person_id';
    when 'franchise' then target_table := 'wbh_franchises'; target_column := 'franchise_id';
    when 'team' then target_table := 'wbh_teams'; target_column := 'team_id';
    when 'team_edition' then target_table := 'wbh_team_editions'; target_column := 'team_edition_id';
    when 'venue' then target_table := 'wbh_venues'; target_column := 'venue_id';
    when 'competition' then target_table := 'wbh_competitions'; target_column := 'competition_id';
    when 'edition' then target_table := 'wbh_competition_editions'; target_column := 'edition_id';
    when 'game' then target_table := 'wbh_games'; target_column := 'game_id';
  end case;

  execute format('select exists (select 1 from public.%I where %I = $1)', target_table, target_column)
    into target_exists using new.entity_id;
  if not target_exists then
    raise exception 'wbh: % source id points at missing canonical % %', new.source_id, new.entity_type, new.entity_id
      using errcode = 'P0001';
  end if;

  if new.status = 'linked' and nullif(btrim(new.id_space), '') is null then
    raise exception 'wbh: linked source ids require id_space so identifiers cannot collide across namespaces'
      using errcode = 'P0001';
  end if;
  if new.status = 'linked' and new.tier = 'T5' then
    raise exception 'wbh: tier T5 (name plus weak context) may never be linked automatically'
      using errcode = 'P0001', hint = 'record it as a candidate and have a human review it';
  end if;
  if new.status = 'linked' and new.tier in ('T3', 'T4') and new.reviewed_at is null and new.confidence < 0.90 then
    raise exception 'wbh: a % link below 0.90 confidence needs human review before it is linked', new.tier
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop index if exists public.wbh_entity_source_ids_linked_unique;
create unique index wbh_entity_source_ids_linked_unique
  on public.wbh_entity_source_ids (source_id, entity_type, id_space, external_id)
  where status = 'linked';

-- Keep helper functions server-only after CREATE OR REPLACE.
revoke execute on function public.wbh_entity_source_ids_guard() from public, anon, authenticated;
grant execute on function public.wbh_entity_source_ids_guard() to service_role;

commit;
