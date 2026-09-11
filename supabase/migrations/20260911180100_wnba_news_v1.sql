-- PropBetEdge WNBA newsroom schema v1
-- STAGED. Additive only. Apply only with owner approval.
--
-- Owned by the wnba-news Worker lane, independent from wnba-api/wnba-ingest and
-- from every NBA newsroom table. Service role only; browsers read via the Worker.
--
-- Rights rule: external publisher items store headline, link, publisher-supplied
-- summary/description and metadata ONLY — never article bodies. PropBetEdge
-- stories (wnba_pbe_stories) are written by our deterministic generator from
-- structured source records and cite every record in `evidence`.

begin;

create table if not exists public.wnba_news_sources (
  source_id      text primary key,
  name           text not null,
  kind           text not null check (kind in ('official','external_publisher','provider_api','owned')),
  home_url       text,
  feed_url       text,
  usage_policy   text not null,            -- what we store / display for this source
  attribution    text not null,            -- visible attribution string
  wnba_scope     text not null,            -- 'wnba_only' | 'mixed_filter_required'
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.wnba_news_clusters (
  cluster_id        text primary key,
  canonical_item_id text,
  headline          text not null,
  story_type        text not null,
  entities          jsonb not null default '[]',
  item_count        int not null default 1,
  first_seen_at     timestamptz not null,
  updated_at        timestamptz not null default now()
);

create table if not exists public.wnba_news_items (
  item_id           text primary key,      -- sha-256(canonical_url) prefix
  source_id         text not null references public.wnba_news_sources(source_id),
  canonical_url     text not null unique,
  headline          text not null,
  summary           text,                  -- publisher-supplied description, truncated
  byline            text,
  published_at      timestamptz,           -- publisher's original timestamp
  source_updated_at timestamptz,           -- publisher's updated timestamp, if any
  first_captured_at timestamptz not null,
  last_captured_at  timestamptz not null,
  story_type        text not null,
  relevance         numeric not null,
  relevance_reasons jsonb not null default '[]',
  entities          jsonb not null default '[]',
  cluster_id        text references public.wnba_news_clusters(cluster_id),
  rights            text not null default 'headline_link_summary',
  status            text not null default 'published' check (status in ('published','suppressed')),
  suppression_reason text
);
create index if not exists wnba_news_items_pub_idx on public.wnba_news_items(published_at desc);
create index if not exists wnba_news_items_cluster_idx on public.wnba_news_items(cluster_id);

create table if not exists public.wnba_news_entities (
  item_id       text not null,
  entity_type   text not null check (entity_type in ('player','team','game')),
  entity_id     text not null,
  match_method  text not null,             -- provider_tag | exact_full_name | exact_team_name
  primary key (item_id, entity_type, entity_id)
);
create index if not exists wnba_news_entities_lookup_idx on public.wnba_news_entities(entity_type, entity_id);

create table if not exists public.wnba_pbe_stories (
  story_id          text primary key,      -- deterministic: kind + subject + evidence hash
  kind              text not null,         -- availability_change | transaction | result | clinch
  headline          text not null,
  body              text not null,
  entities          jsonb not null default '[]',
  evidence          jsonb not null,        -- [{source, record, url, captured_at}]
  generator_version text not null,
  published_at      timestamptz not null,
  updated_at        timestamptz not null default now(),
  status            text not null default 'published' check (status in ('published','retracted')),
  constraint wnba_pbe_stories_evidence_required check (jsonb_array_length(evidence) > 0)
);
create index if not exists wnba_pbe_stories_pub_idx on public.wnba_pbe_stories(published_at desc);

create table if not exists public.wnba_news_runs (
  id            bigint generated always as identity primary key,
  run_at        timestamptz not null default now(),
  source_id     text,
  status        text not null check (status in ('PASS','DEGRADED','FAIL')),
  fetched       int,
  candidates    int,
  accepted      int,
  duplicates    int,
  rejected      int,
  detail        jsonb
);

do $$
declare t text;
begin
  foreach t in array array['wnba_news_sources','wnba_news_clusters','wnba_news_items','wnba_news_entities','wnba_pbe_stories','wnba_news_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end $$;

commit;
