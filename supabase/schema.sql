-- Wedstrijdopstellingen — database voor Supabase
-- Plak dit hele bestand in Supabase > SQL Editor en klik op Run.
-- Startpincode: 1234. Wijzig die meteen (zie onderaan).

create extension if not exists pgcrypto with schema extensions;

-- Tabellen ---------------------------------------------------------------
create table if not exists public.players (
  id         text primary key,
  name       text not null,
  voorkeur   text not null default 'Middenveld',
  posities   text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id           text primary key,
  datum        date not null,
  tegenstander text not null default '',
  blokken      jsonb not null default '[]',
  afgemeld     text[] not null default '{}',
  updated_at   timestamptz not null default now()
);

create table if not exists public.settings (
  id       int primary key check (id = 1),
  pin_hash text not null
);

-- Toegang: iedereen met de link mag lezen, niemand mag direct schrijven ----
alter table public.players  enable row level security;
alter table public.matches  enable row level security;
alter table public.settings enable row level security;

drop policy if exists "lezen spelers" on public.players;
create policy "lezen spelers" on public.players for select to anon, authenticated using (true);
drop policy if exists "lezen wedstrijden" on public.matches;
create policy "lezen wedstrijden" on public.matches for select to anon, authenticated using (true);
-- settings heeft bewust geen policy: de pincode-hash is niet leesbaar.

-- Schrijven gaat alleen via deze functies, die de pincode controleren -----
create or replace function public.check_pin(p_pin text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from settings where id = 1 and pin_hash = crypt(coalesce(p_pin, ''), pin_hash));
$$;

create or replace function public.require_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not check_pin(p_pin) then raise exception 'Onjuiste pincode'; end if;
end $$;

create or replace function public.save_player(p_pin text, p_id text, p_name text, p_voorkeur text, p_posities text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  insert into players (id, name, voorkeur, posities, updated_at)
  values (p_id, p_name, p_voorkeur, coalesce(p_posities, '{}'), now())
  on conflict (id) do update set name = excluded.name, voorkeur = excluded.voorkeur, posities = excluded.posities, updated_at = now();
end $$;

create or replace function public.delete_player(p_pin text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  delete from players where id = p_id;
end $$;

create or replace function public.save_match(p_pin text, p_id text, p_datum date, p_tegenstander text, p_blokken jsonb, p_afgemeld text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  insert into matches (id, datum, tegenstander, blokken, afgemeld, updated_at)
  values (p_id, p_datum, coalesce(p_tegenstander, ''), coalesce(p_blokken, '[]'), coalesce(p_afgemeld, '{}'), now())
  on conflict (id) do update set datum = excluded.datum, tegenstander = excluded.tegenstander,
    blokken = excluded.blokken, afgemeld = excluded.afgemeld, updated_at = now();
end $$;

create or replace function public.delete_match(p_pin text, p_id text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform require_pin(p_pin);
  delete from matches where id = p_id;
end $$;

revoke all on function public.require_pin(text) from public, anon, authenticated;
grant execute on function public.check_pin(text) to anon, authenticated;
grant execute on function public.save_player(text, text, text, text, text[]) to anon, authenticated;
grant execute on function public.delete_player(text, text) to anon, authenticated;
grant execute on function public.save_match(text, text, date, text, jsonb, text[]) to anon, authenticated;
grant execute on function public.delete_match(text, text) to anon, authenticated;

-- Live bijwerken op alle telefoons --------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.matches; exception when duplicate_object then null; end;
end $$;

-- Startpincode ------------------------------------------------------------
insert into public.settings (id, pin_hash) values (1, extensions.crypt('1234', extensions.gen_salt('bf')))
on conflict (id) do nothing;

-- Spelers ------------------------------------------------------------------
insert into public.players (id, name, voorkeur, posities) values
  ('benjamin','Benjamin','Keeper','{K}'),
  ('dante','Dante','Verdediging','{RB,RCV,LB}'),
  ('imre','Imre','Verdediging','{RCV}'),
  ('kai','Kai','Verdediging','{LCV,RCV,LB}'),
  ('matteo','Matteo','Middenveld','{LCV,RCV,CM}'),
  ('mikel','Mikel','Verdediging','{LB}'),
  ('skip','Skip','Verdediging','{LB,RB}'),
  ('otto','Otto','Middenveld','{LM}'),
  ('youssef','Youssef','Middenveld','{CM,SP,RBU}'),
  ('niek','Niek','Middenveld','{RM,LB}'),
  ('bodin','Bodin','Middenveld','{RM,LM}'),
  ('jip','Jip','Middenveld','{RM}'),
  ('yves','Yves','Aanval','{LBU,CM}'),
  ('sky','Sky','Aanval','{RBU}'),
  ('ivy','Ivy','Aanval','{SP}'),
  ('matty','Matty','Aanval','{LBU,RBU}'),
  ('tos','Tos','Aanval','{RBU,SP}')
on conflict (id) do nothing;

-- Wedstrijd 06-11-2026 ----------------------------------------------------
insert into public.matches (id, datum, tegenstander, blokken, afgemeld) values (
  'w-2026-11-06', '2026-11-06', '',
  '[
    {"start":0,"end":25,"opstelling":{"K":"benjamin","RB":"skip","RCV":"imre","LCV":"matteo","LB":"mikel","LM":"otto","CM":"youssef","RM":"niek","RBU":"sky","SP":"ivy","LBU":"matty"}},
    {"start":25,"end":50,"opstelling":{"K":"benjamin","RB":"skip","RCV":"imre","LCV":"kai","LB":"jip","LM":"otto","CM":"youssef","RM":"bodin","RBU":"tos","SP":"ivy","LBU":"yves"}},
    {"start":50,"end":65,"opstelling":{"K":"benjamin","RB":"jip","RCV":"matteo","LCV":"kai","LB":"mikel","LM":"yves","CM":"niek","RM":"bodin","RBU":"matty","SP":"tos","LBU":"youssef"}}
  ]'::jsonb, '{}'
) on conflict (id) do nothing;

-- Pincode wijzigen (vervang 5678 door je eigen code en voer alleen deze regel uit):
-- update public.settings set pin_hash = extensions.crypt('5678', extensions.gen_salt('bf')) where id = 1;
