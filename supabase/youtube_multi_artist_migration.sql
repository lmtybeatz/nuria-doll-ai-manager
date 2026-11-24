-- NURIA DOLL AI MANAGER — YouTube multi-artistes
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à AI Manager.
-- Préserve la connexion YouTube existante en l'affectant à l'artiste par défaut.

begin;

alter table public.ai_social_connections
  add column if not exists artist_id uuid;

update public.ai_social_connections c
set artist_id = a.id
from public.ai_artists a
where c.artist_id is null
  and a.owner_id = c.owner_id
  and a.is_default = true;

do $$
begin
  if exists (select 1 from public.ai_social_connections where artist_id is null) then
    raise exception 'Certaines connexions YouTube ne peuvent pas être associées à un artiste par défaut. Vérifie ai_artists avant de relancer.';
  end if;
end $$;

alter table public.ai_social_connections
  alter column artist_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_social_connections_artist_id_fkey'
      and conrelid = 'public.ai_social_connections'::regclass
  ) then
    alter table public.ai_social_connections
      add constraint ai_social_connections_artist_id_fkey
      foreign key (artist_id) references public.ai_artists(id) on delete cascade;
  end if;
end $$;

alter table public.ai_social_connections
  drop constraint if exists ai_social_connections_owner_id_provider_key;

create unique index if not exists ai_social_connections_owner_artist_provider_uidx
  on public.ai_social_connections(owner_id, artist_id, provider);

create index if not exists ai_social_connections_artist_provider_idx
  on public.ai_social_connections(artist_id, provider);

commit;

-- Contrôle :
-- select c.owner_id, a.artist_name, c.provider, c.connected_at
-- from public.ai_social_connections c
-- join public.ai_artists a on a.id = c.artist_id;
