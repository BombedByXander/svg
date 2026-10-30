-- Give xqc the custom shop-style profile tag. Safe to run more than once.
insert into public.profile_tags (user_id, tag, icon, color)
select id, 'Coolest Person', 'Sparkles', '#ff6b9d'
from public.profiles
where lower(username) = 'xqc'
on conflict (user_id, tag) do update
set icon = excluded.icon,
    color = excluded.color;
