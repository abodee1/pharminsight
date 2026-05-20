
-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text check (role in ('owner_manager','consultant_analyst')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- handle_new_user trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- pharmacies (public read)
create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  ods_code text unique not null,
  name text not null,
  address text,
  postcode text,
  region text,
  country text check (country in ('England','Scotland','Wales','Northern Ireland')),
  type text check (type in ('community','distance selling','appliance')) default 'community',
  created_at timestamptz not null default now()
);
alter table public.pharmacies enable row level security;
create policy "pharmacies_public_read" on public.pharmacies for select using (true);

-- dispensing data (public read)
create table public.dispensing_data (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  month int not null check (month between 1 and 12),
  year int not null,
  items_dispensed int not null default 0,
  nms_count int not null default 0,
  pharmacy_first_count int not null default 0,
  flu_vaccinations int not null default 0,
  eps_nominations int not null default 0,
  eps_items int not null default 0,
  created_at timestamptz not null default now(),
  unique (pharmacy_id, month, year)
);
create index on public.dispensing_data (pharmacy_id);
create index on public.dispensing_data (year, month);
alter table public.dispensing_data enable row level security;
create policy "dispensing_public_read" on public.dispensing_data for select using (true);

-- user <-> pharmacy
create table public.user_pharmacy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, pharmacy_id)
);
alter table public.user_pharmacy enable row level security;
create policy "up_select_own" on public.user_pharmacy for select using (auth.uid() = user_id);
create policy "up_insert_own" on public.user_pharmacy for insert with check (auth.uid() = user_id);
create policy "up_update_own" on public.user_pharmacy for update using (auth.uid() = user_id);
create policy "up_delete_own" on public.user_pharmacy for delete using (auth.uid() = user_id);

-- private uploads
create table public.private_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid references public.pharmacies(id) on delete set null,
  upload_type text not null check (upload_type in ('glp1','aesthetics','general')),
  file_name text not null,
  parsed_data jsonb not null default '{}'::jsonb,
  period_start date,
  period_end date,
  created_at timestamptz not null default now()
);
alter table public.private_uploads enable row level security;
create policy "pu_select_own" on public.private_uploads for select using (auth.uid() = user_id);
create policy "pu_insert_own" on public.private_uploads for insert with check (auth.uid() = user_id);
create policy "pu_delete_own" on public.private_uploads for delete using (auth.uid() = user_id);

-- ai insights
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid references public.pharmacies(id) on delete set null,
  insight_type text not null check (insight_type in ('swot','benchmark','trend','acquisition')),
  prompt_context jsonb not null default '{}'::jsonb,
  insight_text text not null,
  generated_at timestamptz not null default now()
);
alter table public.ai_insights enable row level security;
create policy "ai_select_own" on public.ai_insights for select using (auth.uid() = user_id);
create policy "ai_insert_own" on public.ai_insights for insert with check (auth.uid() = user_id);
create policy "ai_delete_own" on public.ai_insights for delete using (auth.uid() = user_id);
