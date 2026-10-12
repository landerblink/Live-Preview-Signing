-- Run after schema.sql
create table strokes (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  color text not null,
  width real not null,
  points jsonb not null,           -- [[x, y, pressure], ...] on a 1000x750 board
  created_at timestamptz default now()
);
create index on strokes(project_id, created_at);
alter table strokes enable row level security;
create policy s_sel on strokes for select using (role_of(project_id) is not null);
create policy s_ins on strokes for insert with check (role_of(project_id) in ('owner','editor') and user_id = auth.uid());
create policy s_del on strokes for delete using (role_of(project_id) in ('owner','editor'));
alter publication supabase_realtime add table strokes;
