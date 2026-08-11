-- Create the table for storing shifts
create table public.shifts (
  date text primary key,
  shift_type text not null,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- If the table already exists, just add the note column:
-- ALTER TABLE public.shifts ADD COLUMN note text;

-- Enable Row Level Security (RLS)
alter table public.shifts enable row level security;

-- Create a policy that allows anyone to read the shifts (since it's a family calendar)
create policy "Enable read access for all users"
on public.shifts
for select
to anon
using (true);

-- Create a policy that allows anyone to insert/update (since we use a shared password in the app logic)
-- In a real production app, we would use Supabase Auth, but for this single-file demo, 
-- we allow the 'anon' key to write, and rely on the app's 'Clara' password for UI protection.
create policy "Enable insert/update for all users"
on public.shifts
for all
to anon
using (true)
with check (true);
