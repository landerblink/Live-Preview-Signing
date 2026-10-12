-- Run in Supabase SQL editor
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null default 'Untitled site',
  theme jsonb not null default '{"font":"Inter, sans-serif","accent":"#6366f1","bg":"#ffffff","text":"#111827"}',
  created_at timestamptz default now()
);
create table members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  role text not null check (role in ('editor','viewer')),
  primary key (project_id, user_id)
);
create table blocks (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  position double precision not null,
  type text not null,
  props jsonb not null default '{}',
  updated_at timestamptz default now()
);
create index on blocks(project_id);

create function role_of(pid uuid) returns text language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from projects where id = pid and owner_id = auth.uid()) then 'owner'
  else (select role from members where project_id = pid and user_id = auth.uid()) end
$$;

alter table projects enable row level security;
alter table members enable row level security;
alter table blocks enable row level security;

create policy p_sel on projects for select using (owner_id = auth.uid() or role_of(id) is not null);
create policy p_ins on projects for insert with check (owner_id = auth.uid());
create policy p_upd on projects for update using (role_of(id) in ('owner','editor'));
create policy p_del on projects for delete using (owner_id = auth.uid());

create policy m_sel on members for select using (role_of(project_id) is not null);
create policy m_ins on members for insert with check (role_of(project_id) = 'owner');
create policy m_del on members for delete using (role_of(project_id) = 'owner');

create policy b_sel on blocks for select using (role_of(project_id) is not null);
create policy b_ins on blocks for insert with check (role_of(project_id) in ('owner','editor'));
create policy b_upd on blocks for update using (role_of(project_id) in ('owner','editor'));
create policy b_del on blocks for delete using (role_of(project_id) in ('owner','editor'));

-- Field-level atomic merges: concurrent edits to different fields never overwrite each other
create function patch_block(b uuid, patch jsonb) returns void language sql as
$$ update blocks set props = props || patch, updated_at = now() where id = b $$;
create function patch_theme(p uuid, patch jsonb) returns void language sql as
$$ update projects set theme = theme || patch where id = p $$;

create function share_project(p uuid, target_email text, r text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if role_of(p) <> 'owner' then raise exception 'only the owner can share'; end if;
  select id into uid from auth.users where lower(email) = lower(target_email);
  if uid is null then raise exception 'no user with that email (they must sign up first)'; end if;
  insert into members(project_id, user_id, email, role) values (p, uid, target_email, r)
  on conflict (project_id, user_id) do update set role = excluded.role;
end $$;

alter publication supabase_realtime add table blocks, projects;
