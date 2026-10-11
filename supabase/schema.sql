-- Tabel sinkronisasi Fokara: satu baris JSON per pengguna.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "Users manage their own data" on public.user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
