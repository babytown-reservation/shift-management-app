create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  name text not null,
  note text default '',
  workdays int[] not null default '{1,2,3,4,5}',
  min_days int not null default 5,
  max_days int not null default 22,
  weekly_days int not null default 5,
  monthly_max int not null default 22,
  created_at timestamptz not null default now()
);

alter table public.staff
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

alter table public.staff
  add column if not exists email text;

alter table public.staff
  add column if not exists min_days int not null default 5;

alter table public.staff
  add column if not exists max_days int not null default 22;

alter table public.staff
  add column if not exists weekly_days int not null default 5;

alter table public.staff
  add column if not exists monthly_max int not null default 22;

create unique index if not exists staff_email_unique_idx
on public.staff (lower(email))
where email is not null;

create table if not exists public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  date date not null,
  memo text default '',
  submitted_at timestamptz not null default now(),
  unique (staff_id, date)
);

create table if not exists public.required_staff (
  date date primary key,
  required_count int not null default 0
);

create table if not exists public.shift_periods (
  id uuid primary key default gen_random_uuid(),
  target_month text not null unique,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shift_periods
  add column if not exists is_published boolean not null default false;

create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  staff_id uuid not null references public.staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (date, staff_id)
);

alter table public.shift_assignments
  add column if not exists id uuid default gen_random_uuid();

update public.shift_assignments
set id = gen_random_uuid()
where id is null;

alter table public.shift_assignments
  alter column id set default gen_random_uuid(),
  alter column id set not null;

do $$
declare
  pk_columns text[];
begin
  select array_agg(a.attname order by a.attnum)
  into pk_columns
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = 'public.shift_assignments'::regclass
    and i.indisprimary;

  if pk_columns is null then
    alter table public.shift_assignments add constraint shift_assignments_pkey primary key (id);
  elsif pk_columns <> array['id'] then
    alter table public.shift_assignments drop constraint if exists shift_assignments_pkey;
    alter table public.shift_assignments add constraint shift_assignments_pkey primary key (id);
  end if;
end $$;

with duplicated_shift_assignments as (
  select
    ctid,
    row_number() over (partition by date, staff_id order by created_at desc, id desc) as row_number
  from public.shift_assignments
)
delete from public.shift_assignments
where ctid in (
  select ctid
  from duplicated_shift_assignments
  where row_number > 1
);

create unique index if not exists shift_assignments_date_staff_unique_idx
on public.shift_assignments (date, staff_id);

alter table public.staff enable row level security;
alter table public.time_off_requests enable row level security;
alter table public.required_staff enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_periods enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role' = 'admin';
$$;

create or replace function public.is_own_staff(target_staff_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.staff s
    where s.id = target_staff_id
      and (
        s.auth_user_id = auth.uid()
        or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

drop policy if exists "Admins can manage staff" on public.staff;
create policy "Admins can manage staff"
on public.staff for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Staff can read own staff row" on public.staff;
create policy "Staff can read own staff row"
on public.staff for select
using (
  auth.uid() = auth_user_id
  or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "Admins can manage time off" on public.time_off_requests;
create policy "Admins can manage time off"
on public.time_off_requests for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Staff can manage own time off" on public.time_off_requests;
create policy "Staff can manage own time off"
on public.time_off_requests for all
using (public.is_own_staff(staff_id))
with check (public.is_own_staff(staff_id));

drop policy if exists "Admins can manage required staff" on public.required_staff;
create policy "Admins can manage required staff"
on public.required_staff for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage shift periods" on public.shift_periods;
create policy "Admins can manage shift periods"
on public.shift_periods for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage shift assignments" on public.shift_assignments;
create policy "Admins can manage shift assignments"
on public.shift_assignments for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Staff can read own shift assignments" on public.shift_assignments;
create policy "Staff can read own shift assignments"
on public.shift_assignments for select
using (public.is_own_staff(staff_id));
