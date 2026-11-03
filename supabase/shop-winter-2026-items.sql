-- Vaulted Winter collection shop catalog additions from cherriunblocked/svg.
-- Safe to run more than once. Asset files are bundled under b/elements/.
begin;
insert into public.shop_catalog(id,kind,name,description,price,payload,sort_order) values
('avatar_decoration-borealis','avatar_decoration','Borealis','Winter collection avatar decoration',150,'{"asset":"borealis.png"}'::jsonb,73),
('avatar_decoration-freshpine','avatar_decoration','Fresh Pine','Winter collection avatar decoration',150,'{"asset":"freshpine.png"}'::jsonb,74),
('avatar_decoration-snowglobe','avatar_decoration','Snow Globe','Winter collection avatar decoration',150,'{"asset":"snowglobe.png"}'::jsonb,75),
('avatar_decoration-starry','avatar_decoration','Starry','Winter collection avatar decoration',150,'{"asset":"starry.png"}'::jsonb,76),
('avatar_decoration-starwaves','avatar_decoration','Star Waves','Winter collection avatar decoration',150,'{"asset":"starwaves.png"}'::jsonb,77),
('avatar_decoration-stringlights','avatar_decoration','String Lights','Winter collection avatar decoration',150,'{"asset":"stringlights.png"}'::jsonb,78),
('avatar_decoration-winterbuddy','avatar_decoration','Winter Buddy','Winter collection avatar decoration',150,'{"asset":"winterbuddy.png"}'::jsonb,79),
('avatar_decoration-winterfox','avatar_decoration','Winter Fox','Winter collection avatar decoration',150,'{"asset":"winterfox.png"}'::jsonb,80),
('profile_effect-aurora','profile_effect','Aurora','Winter collection profile effect',250,'{"asset":"aurora.png"}'::jsonb,81),
('profile_effect-bluemoon','profile_effect','Blue Moon','Winter collection profile effect',250,'{"asset":"bluemoon.png"}'::jsonb,82),
('profile_effect-slidingpenguins','profile_effect','Sliding Penguins','Winter collection profile effect',250,'{"asset":"slidingpenguins.png"}'::jsonb,83),
('profile_effect-snowangel','profile_effect','Snow Angel','Winter collection profile effect',250,'{"asset":"snowangel.png"}'::jsonb,84),
('profile_effect-snowman','profile_effect','Snowman','Winter collection profile effect',250,'{"asset":"snowman.png"}'::jsonb,85),
('profile_effect-starwaves','profile_effect','Star Waves','Winter collection profile effect',250,'{"asset":"starwaves.png"}'::jsonb,86),
('tag-jolly','name_tag','JOLLY','Winter collection name tag',50,'{"text":"JOLLY","color":"#22c55e"}'::jsonb,87),
('tag-naughty','name_tag','NAUGHTY','Winter collection name tag',50,'{"text":"NAUGHTY","color":"#ef4444"}'::jsonb,88),
('tag-nice','name_tag','NICE','Winter collection name tag',50,'{"text":"NICE","color":"#7dd3fc"}'::jsonb,89),
('tag-grinch','name_tag','GRINCH','Winter collection name tag',50,'{"text":"GRINCH","color":"#84cc16"}'::jsonb,90)
on conflict(id) do update set name=excluded.name,description=excluded.description,price=excluded.price,payload=excluded.payload,sort_order=excluded.sort_order;
commit;
