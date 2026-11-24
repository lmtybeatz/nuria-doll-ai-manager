-- NURIA DOLL AI MANAGER — Phase 2.2 : fondation multi-artistes
-- Migration additive et idempotente.
-- À exécuter UNIQUEMENT dans le projet Supabase dédié à AI Manager.
-- Ne pas exécuter dans le projet Supabase du site public NURIA DOLL.
--
-- Cette migration conserve les données existantes. Le profil artistique actuel
-- devient le premier artiste du compte. Les tables historiques gardent owner_id
-- et leurs politiques RLS ; artist_id ajoute l'isolation par artiste.

begin;

create table if not exists public.ai_artists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  artist_name text not null check (char_length(trim(artist_name)) between 1 and 180),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_artists_owner_status_idx
  on public.ai_artists(owner_id, status, created_at);

alter table public.ai_artists enable row level security;
drop policy if exists "Owner manages own artists" on public.ai_artists;
create policy "Owner manages own artists"
  on public.ai_artists for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

revoke all on public.ai_artists from anon;
grant select, insert, update, delete on public.ai_artists to authenticated;

-- 1. Créer un artiste initial pour chaque compte déjà présent dans les tables.
-- L'ID du profil historique est réutilisé comme ID artiste afin de faciliter
-- une migration stable et de ne pas toucher aux fichiers ni aux identifiants existants.
insert into public.ai_artists (id, owner_id, artist_name, is_default)
select
  p.id,
  p.owner_id,
  coalesce(nullif(trim(p.artist_name), ''), 'Mon artiste'),
  true
from public.ai_brand_profile p
where not exists (
  select 1
  from public.ai_artists a
  where a.owner_id = p.owner_id
    and lower(trim(a.artist_name)) =
        lower(trim(coalesce(nullif(p.artist_name, ''), 'Mon artiste')))
)
on conflict do nothing;

-- Si l'artiste existe déjà sous un autre identifiant, le conserver et le définir
-- comme espace par défaut lorsqu'aucun autre artiste par défaut n'existe.
update public.ai_artists a
set is_default = true
from public.ai_brand_profile p
where a.owner_id = p.owner_id
  and lower(trim(a.artist_name)) =
      lower(trim(coalesce(nullif(p.artist_name, ''), 'Mon artiste')))
  and not exists (
    select 1 from public.ai_artists d
    where d.owner_id = a.owner_id and d.is_default
  );

-- Les comptes sans profil artistique reçoivent un espace vide.
insert into public.ai_artists (owner_id, artist_name, is_default)
select u.owner_id, 'Mon artiste', true
from (
  select owner_id from public.ai_settings
  union select owner_id from public.ai_media_library
  union select owner_id from public.ai_marketing_campaigns
  union select owner_id from public.ai_parent_approvals
  union select owner_id from public.ai_marketing_recommendations
) u
where not exists (
  select 1 from public.ai_artists a where a.owner_id = u.owner_id
);

-- 2. Ajouter le lien artiste aux données déjà existantes.
alter table public.ai_brand_profile add column if not exists artist_id uuid;
alter table public.ai_settings add column if not exists artist_id uuid;
alter table public.ai_media_library add column if not exists artist_id uuid;
alter table public.ai_marketing_campaigns add column if not exists artist_id uuid;
alter table public.ai_parent_approvals add column if not exists artist_id uuid;
alter table public.ai_marketing_recommendations add column if not exists artist_id uuid;

update public.ai_brand_profile p
set artist_id = a.id
from public.ai_artists a
where p.artist_id is null
  and a.owner_id = p.owner_id
  and lower(trim(a.artist_name)) =
      lower(trim(coalesce(nullif(p.artist_name, ''), 'Mon artiste')));
update public.ai_settings s
set artist_id = a.id
from public.ai_artists a
where s.artist_id is null and a.owner_id = s.owner_id and a.is_default;
update public.ai_media_library m
set artist_id = a.id
from public.ai_artists a
where m.artist_id is null and a.owner_id = m.owner_id and a.is_default;
update public.ai_marketing_campaigns c
set artist_id = a.id
from public.ai_artists a
where c.artist_id is null and a.owner_id = c.owner_id and a.is_default;
update public.ai_parent_approvals p
set artist_id = a.id
from public.ai_artists a
where p.artist_id is null and a.owner_id = p.owner_id and a.is_default;
update public.ai_marketing_recommendations r
set artist_id = a.id
from public.ai_artists a
where r.artist_id is null and a.owner_id = r.owner_id and a.is_default;

-- 3. Garantir l'intégrité des liens et l'isolation des lignes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_brand_profile','ai_settings','ai_media_library',
    'ai_marketing_campaigns','ai_parent_approvals','ai_marketing_recommendations'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_artist_id_fkey'
        and conrelid = format('public.%I', t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (artist_id) references public.ai_artists(id) on delete cascade',
        t, t || '_artist_id_fkey'
      );
    end if;
    execute format('create index if not exists %I on public.%I(owner_id, artist_id)', t || '_owner_artist_idx', t);
  end loop;
end $$;

-- 4. Lever les contraintes "un seul profil/paramétrage par compte".
-- Les données ne sont pas supprimées ; la clé primaire de chaque ligne reste inchangée.
alter table public.ai_brand_profile drop constraint if exists ai_brand_profile_owner_id_key;
alter table public.ai_settings drop constraint if exists ai_settings_owner_id_key;

create unique index if not exists ai_brand_profile_artist_id_uidx
  on public.ai_brand_profile(artist_id);
create unique index if not exists ai_settings_artist_id_uidx
  on public.ai_settings(artist_id);

-- Les règles RLS existantes fondées sur owner_id restent en place.
-- Les politiques de ai_artists empêchent un compte de consulter les artistes d'un autre.

commit;

-- Après exécution, vérifier :
-- select artist_name, is_default, status from public.ai_artists order by created_at;
-- select artist_id, artist_name from public.ai_brand_profile;
