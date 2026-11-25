begin;
alter table public.ai_social_connections drop constraint if exists ai_social_connections_provider_check;
alter table public.ai_social_connections add constraint ai_social_connections_provider_check check (provider in ('youtube','meta','tiktok'));
create index if not exists ai_social_connections_owner_artist_provider_idx on public.ai_social_connections(owner_id,artist_id,provider);
commit;
