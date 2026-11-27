-- AI Music Manager — Community inbox (phase 1)
-- One normalized, private inbox for each owner / artist / social platform.
begin;

create table if not exists public.ai_community_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_id uuid not null references public.ai_artists(id) on delete cascade,
  provider text not null check (provider in ('tiktok','instagram','facebook','youtube')),
  external_comment_id text not null,
  external_parent_id text,
  external_media_id text not null,
  media_title text,
  media_url text,
  author_platform_id text,
  author_name text,
  message_text text not null check (char_length(message_text) between 1 and 5000),
  comment_created_at timestamptz,
  like_count integer not null default 0 check (like_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  platform_status text,
  workflow_status text not null default 'new'
    check (workflow_status in ('new','read','drafted','awaiting_approval','replied','ignored','failed')),
  intent text not null default 'unclassified'
    check (intent in ('unclassified','compliment','question','commercial','complaint','sensitive','spam','other')),
  risk_level text not null default 'unclassified'
    check (risk_level in ('unclassified','low','medium','high','sensitive')),
  ai_draft text,
  published_reply text,
  platform_reply_id text,
  replied_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_community_messages_external_unique
    unique (owner_id, artist_id, provider, external_comment_id)
);

create index if not exists ai_community_messages_inbox_idx
  on public.ai_community_messages(owner_id, artist_id, workflow_status, comment_created_at desc);
create index if not exists ai_community_messages_provider_idx
  on public.ai_community_messages(owner_id, artist_id, provider, comment_created_at desc);
create index if not exists ai_community_messages_artist_id_idx
  on public.ai_community_messages(artist_id);

alter table public.ai_community_messages enable row level security;

-- Revoke default Data API grants first, then grant only signed-in manager operations.
revoke all on table public.ai_community_messages from anon, authenticated;
grant select, insert, update, delete on table public.ai_community_messages to authenticated;

drop policy if exists "Owner reads own artist community messages" on public.ai_community_messages;
create policy "Owner reads own artist community messages"
  on public.ai_community_messages for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_community_messages.artist_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owner inserts own artist community messages" on public.ai_community_messages;
create policy "Owner inserts own artist community messages"
  on public.ai_community_messages for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_community_messages.artist_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owner updates own artist community messages" on public.ai_community_messages;
create policy "Owner updates own artist community messages"
  on public.ai_community_messages for update to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_community_messages.artist_id
        and a.owner_id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_community_messages.artist_id
        and a.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Owner deletes own artist community messages" on public.ai_community_messages;
create policy "Owner deletes own artist community messages"
  on public.ai_community_messages for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.ai_artists a
      where a.id = ai_community_messages.artist_id
        and a.owner_id = (select auth.uid())
    )
  );

commit;
