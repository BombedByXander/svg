-- Vaulted shop, rewards, Cherri catalog additions, and Plus passes. Run AFTER berri-accounts.sql in Supabase SQL Editor.
-- Safe to run again: balances and purchases are preserved. All credits are virtual.
begin;
create table if not exists public.shop_catalog (
  id text primary key, kind text not null check(kind in ('avatar_decoration','profile_effect','username_color','name_tag')),
  name text not null, description text not null default '', price integer not null check(price >= 0),
  payload jsonb not null, active boolean not null default true, sort_order integer not null default 0
);
create table if not exists public.shop_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check(balance >= 0),
  reward_day date not null default (now() at time zone 'UTC')::date,
  earned_today integer not null default 0 check(earned_today >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.shop_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.shop_catalog(id), acquired_at timestamptz not null default now(),
  primary key(user_id,item_id)
);
create table if not exists public.shop_equipped (
  user_id uuid not null, item_id text not null, slot text not null,
  primary key(user_id,item_id),
  foreign key(user_id,item_id) references public.shop_inventory(user_id,item_id) on delete cascade
);
create table if not exists public.shop_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null, reason text not null, event_key text,
  created_at timestamptz not null default now(), unique(user_id,event_key)
);
create index if not exists shop_ledger_reward_lookup on public.shop_ledger(user_id,reason,created_at desc);
alter table public.shop_catalog enable row level security;
alter table public.shop_wallets enable row level security;
alter table public.shop_inventory enable row level security;
alter table public.shop_equipped enable row level security;
alter table public.shop_ledger enable row level security;
revoke all on public.shop_catalog,public.shop_wallets,public.shop_inventory,public.shop_equipped,public.shop_ledger from anon,authenticated;
grant select on public.shop_catalog to anon,authenticated;
grant select on public.shop_wallets,public.shop_inventory,public.shop_equipped,public.shop_ledger to authenticated;
drop policy if exists shop_catalog_read on public.shop_catalog;
create policy shop_catalog_read on public.shop_catalog for select using (true);
drop policy if exists shop_wallet_read on public.shop_wallets;
create policy shop_wallet_read on public.shop_wallets for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists shop_inventory_read on public.shop_inventory;
create policy shop_inventory_read on public.shop_inventory for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists shop_equipped_read on public.shop_equipped;
create policy shop_equipped_read on public.shop_equipped for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists shop_ledger_read on public.shop_ledger;
create policy shop_ledger_read on public.shop_ledger for select to authenticated using(user_id=(select auth.uid()));

-- Give each newly-created Auth user 30 credits exactly once.
create or replace function public.vaulted_grant_signup_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shop_wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.shop_ledger (user_id, amount, reason, event_key)
  values (new.id, 30, 'signup_bonus', 'signup:' || new.id::text)
  on conflict (user_id, event_key) do nothing;

  if found then
    update public.shop_wallets
    set balance = balance + 30, updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.vaulted_grant_signup_bonus() from public, anon, authenticated;
drop trigger if exists vaulted_signup_bonus on auth.users;
create trigger vaulted_signup_bonus
after insert on auth.users
for each row execute function public.vaulted_grant_signup_bonus();
create or replace function public.vaulted_wallet() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w public.shop_wallets;
begin
  if u is null then raise exception 'Sign in to use the shop.'; end if;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  select * into w from public.shop_wallets where user_id=u;
  return jsonb_build_object('coins',w.balance,'earnedToday',case when w.reward_day=(now() at time zone 'UTC')::date then w.earned_today else 0 end,'dailyCap',100);
end $$;

create or replace function public.vaulted_reward(p_action text,p_target text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w public.shop_wallets; today date:=(now() at time zone 'UTC')::date;
  amount integer; cooldown interval; event text; previous timestamptz; awarded integer:=0;
begin
  if u is null then raise exception 'Sign in to earn credits.'; end if;
  if p_action is null or p_action not in ('daily','search','launch') then raise exception 'Invalid reward action.'; end if;
  if p_action <> 'daily' and (p_target is null or length(trim(p_target))<2 or length(p_target)>4096) then raise exception 'Invalid reward target.'; end if;
  amount:=case p_action when 'daily' then 25 when 'search' then 2 else 5 end;
  cooldown:=case p_action when 'daily' then interval '0 seconds' else interval '60 seconds' end;
  event:='reward:'||today::text||':'||p_action||':'||case when p_action='daily' then '' else md5(lower(trim(p_target))) end;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  select * into w from public.shop_wallets where user_id=u for update;
  if w.reward_day<>today then
    update public.shop_wallets set reward_day=today,earned_today=0 where user_id=u;
    w.earned_today:=0;
  end if;
  select max(created_at) into previous from public.shop_ledger where user_id=u and reason='reward:'||p_action;
  if w.earned_today<100 and not exists(select 1 from public.shop_ledger where user_id=u and event_key=event)
     and (previous is null or now()-previous>=cooldown) then
    awarded:=least(amount,100-w.earned_today);
    insert into public.shop_ledger(user_id,amount,reason,event_key) values(u,awarded,'reward:'||p_action,event);
    update public.shop_wallets set balance=balance+awarded,earned_today=earned_today+awarded,updated_at=now() where user_id=u;
  end if;
  return public.vaulted_wallet()||jsonb_build_object('awarded',awarded);
end $$;

create or replace function public.vaulted_buy(p_item text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.shop_catalog; w public.shop_wallets;
begin
  if u is null then raise exception 'Sign in to buy items.'; end if;
  select * into item from public.shop_catalog where id=p_item and active;
  if not found then raise exception 'Item is not available.'; end if;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  select * into w from public.shop_wallets where user_id=u for update;
  if exists(select 1 from public.shop_inventory where user_id=u and item_id=p_item) then
    return public.vaulted_wallet()||jsonb_build_object('ok',true,'alreadyOwned',true);
  end if;
  if w.balance<item.price then raise exception 'Not enough credits.'; end if;
  update public.shop_wallets set balance=balance-item.price,updated_at=now() where user_id=u;
  insert into public.shop_inventory(user_id,item_id) values(u,p_item);
  insert into public.shop_ledger(user_id,amount,reason) values(u,-item.price,'purchase:'||p_item);
  return public.vaulted_wallet()||jsonb_build_object('ok',true);
end $$;

create or replace function public.vaulted_equip(p_item text default null,p_slot text default null,p_unequip boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.shop_catalog;
begin
  if u is null then raise exception 'Sign in to equip items.'; end if;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  perform 1 from public.shop_wallets where user_id=u for update;
  if p_item is null then
    if p_slot is null or p_slot not in ('avatar_decoration','profile_effect','username_color','name_tag') then raise exception 'Invalid slot.'; end if;
    delete from public.shop_equipped where user_id=u and slot=p_slot;
  else
    select c.* into item from public.shop_catalog c join public.shop_inventory i on i.item_id=c.id and i.user_id=u where c.id=p_item;
    if not found then raise exception 'You do not own this item.'; end if;
    if p_unequip then delete from public.shop_equipped where user_id=u and item_id=p_item;
    else
      if item.kind='name_tag' then
        if not exists(select 1 from public.shop_equipped where user_id=u and item_id=p_item) and
          (select count(*) from public.shop_equipped where user_id=u and slot='name_tag')>=2 then raise exception 'Unequip a name tag first.'; end if;
      else delete from public.shop_equipped where user_id=u and slot=item.kind;
      end if;
      insert into public.shop_equipped(user_id,item_id,slot) values(u,p_item,item.kind) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('ok',true);
end $$;

-- Public appearance only: no balances, private inventory, or personal account data.
create or replace function public.vaulted_public_cosmetics(p_usernames text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'; person record; item record; appearance jsonb; tags jsonb;
begin
  if coalesce(cardinality(p_usernames),0)>100 then raise exception 'Too many usernames.'; end if;
  for person in select id,username from public.profiles where username=any(p_usernames) loop
    appearance:='{}'; tags:='[]';
    for item in select e.slot,c.id,c.payload from public.shop_equipped e join public.shop_catalog c on c.id=e.item_id where e.user_id=person.id order by c.id loop
      if item.slot='name_tag' then tags:=tags||jsonb_build_array(jsonb_build_object('itemId',item.id,'payload',item.payload));
      else appearance:=appearance||jsonb_build_object(item.slot,jsonb_build_object('itemId',item.id,'payload',item.payload)); end if;
    end loop;
    result:=result||jsonb_build_object(person.username,appearance||jsonb_build_object('name_tags',tags));
  end loop;
  return result;
end $$;

revoke all on function public.vaulted_wallet(),public.vaulted_reward(text,text),public.vaulted_buy(text),public.vaulted_equip(text,text,boolean),public.vaulted_public_cosmetics(text[]) from public,anon,authenticated;
grant execute on function public.vaulted_wallet(),public.vaulted_reward(text,text),public.vaulted_buy(text),public.vaulted_equip(text,text,boolean) to authenticated;
grant execute on function public.vaulted_public_cosmetics(text[]) to anon,authenticated;
-- Gifting is atomic and retry-safe. Item gifts cost the catalog price plus 10%.
create or replace function public.vaulted_gift(p_username text,p_request uuid,p_item text default null,p_amount integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); recipient uuid; cost bigint; item public.shop_catalog; event text;
begin
  if u is null then raise exception 'Sign in to send a gift.'; end if;
  if p_request is null then raise exception 'Missing request ID.'; end if;
  select id into recipient from public.profiles where username=lower(trim(p_username));
  if recipient is null then raise exception 'User not found.'; end if;
  if recipient=u then raise exception 'Choose another user.'; end if;
  if p_item is not null then
    select * into item from public.shop_catalog where id=p_item and active;
    if not found then raise exception 'Item is not available.'; end if;
    cost:=round(item.price*1.1);
  else
    if p_amount is null or p_amount<1 or p_amount>1000000 then raise exception 'Invalid credit amount.'; end if;
    cost:=p_amount;
  end if;
  insert into public.shop_wallets(user_id) values(u),(recipient) on conflict do nothing;
  perform 1 from public.shop_wallets where user_id in (u,recipient) order by user_id for update;
  event:='gift:'||p_request::text;
  if exists(select 1 from public.shop_ledger where user_id=u and event_key=event) then return jsonb_build_object('ok',true); end if;
  if p_item is not null and exists(select 1 from public.shop_inventory where user_id=recipient and item_id=p_item) then raise exception 'This user already owns that item.'; end if;
  if (select balance from public.shop_wallets where user_id=u)<cost then raise exception 'Not enough credits.'; end if;
  update public.shop_wallets set balance=balance-cost,updated_at=now() where user_id=u;
  insert into public.shop_ledger(user_id,amount,reason,event_key) values(u,-cost,'gift_sent',event);
  if p_item is null then
    update public.shop_wallets set balance=balance+cost,updated_at=now() where user_id=recipient;
    insert into public.shop_ledger(user_id,amount,reason,event_key) values(recipient,cost,'gift_received',event);
  else
    insert into public.shop_inventory(user_id,item_id) values(recipient,p_item);
    insert into public.shop_ledger(user_id,amount,reason,event_key) values(recipient,0,'gift_item:'||p_item,event);
  end if;
  return public.vaulted_wallet()||jsonb_build_object('ok',true);
end $$;
revoke all on function public.vaulted_gift(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.vaulted_gift(text,uuid,text,integer) to authenticated;
insert into public.shop_catalog(id,kind,name,description,price,payload,sort_order) values
('avatar_decoration-airforce','avatar_decoration','Air Force','Animated avatar border',150,'{"asset": "airforce.png"}'::jsonb,0),
('avatar_decoration-angelwings','avatar_decoration','Angel Wings','Animated avatar border',150,'{"asset": "angelwings.png"}'::jsonb,1),
('avatar_decoration-aurora','avatar_decoration','Aurora','Animated avatar border',150,'{"asset": "aurora.png"}'::jsonb,2),
('avatar_decoration-catearsblack','avatar_decoration','Black Cat Ears','Animated avatar border',150,'{"asset": "catearsblack.png"}'::jsonb,3),
('avatar_decoration-chomp','avatar_decoration','Chomp','Animated avatar border',150,'{"asset": "chomp.png"}'::jsonb,4),
('avatar_decoration-cloudnine','avatar_decoration','Cloud Nine','Animated avatar border',150,'{"asset": "cloudnine.png"}'::jsonb,5),
('avatar_decoration-cometsdusk','avatar_decoration','Comet at Dusk','Animated avatar border',150,'{"asset": "cometsdusk.png"}'::jsonb,6),
('avatar_decoration-deepseadreams','avatar_decoration','Deep Sea Dreams','Animated avatar border',150,'{"asset": "deepseadreams.png"}'::jsonb,7),
('avatar_decoration-dragon','avatar_decoration','Dragon','Animated avatar border',150,'{"asset": "dragon.png"}'::jsonb,8),
('avatar_decoration-fallfoliage','avatar_decoration','Fall Foliage','Animated avatar border',150,'{"asset": "fallfoliage.png"}'::jsonb,9),
('avatar_decoration-flames','avatar_decoration','Flames','Animated avatar border',150,'{"asset": "flames.png"}'::jsonb,10),
('avatar_decoration-foxtail','avatar_decoration','Fox Tail','Animated avatar border',150,'{"asset": "foxtail.png"}'::jsonb,11),
('avatar_decoration-hallelujamountains','avatar_decoration','Hallelujah Mountains','Animated avatar border',150,'{"asset": "hallelujamountains.png"}'::jsonb,12),
('avatar_decoration-japanesemaple','avatar_decoration','Japanese Maple','Animated avatar border',150,'{"asset": "japanesemaple.png"}'::jsonb,13),
('avatar_decoration-leafloaf','avatar_decoration','Leaf Loaf','Animated avatar border',150,'{"asset": "leafloaf.png"}'::jsonb,14),
('avatar_decoration-loading','avatar_decoration','Loading','Animated avatar border',150,'{"asset": "loading.png"}'::jsonb,15),
('avatar_decoration-lonewolf','avatar_decoration','Lone Wolf','Animated avatar border',150,'{"asset": "lonewolf.png"}'::jsonb,16),
('avatar_decoration-moon','avatar_decoration','Moon','Animated avatar border',150,'{"asset": "moon.png"}'::jsonb,17),
('avatar_decoration-orbital','avatar_decoration','Orbital','Animated avatar border',150,'{"asset": "orbital.png"}'::jsonb,18),
('avatar_decoration-petals','avatar_decoration','Petals','Animated avatar border',150,'{"asset": "petals.png"}'::jsonb,19),
('avatar_decoration-purplering','avatar_decoration','Purple Ring','Animated avatar border',150,'{"asset": "purplering.png"}'::jsonb,20),
('avatar_decoration-purplesparkles','avatar_decoration','Purple Sparkles','Animated avatar border',150,'{"asset": "purplesparkles.png"}'::jsonb,21),
('avatar_decoration-ritualcircle','avatar_decoration','Ritual Circle','Animated avatar border',150,'{"asset": "ritualcircle.png"}'::jsonb,22),
('avatar_decoration-sakuraink','avatar_decoration','Sakura Ink','Animated avatar border',150,'{"asset": "sakuraink.png"}'::jsonb,23),
('avatar_decoration-skillissue','avatar_decoration','Skill Issue','Animated avatar border',150,'{"asset": "skillissue.png"}'::jsonb,24),
('avatar_decoration-spacetravel','avatar_decoration','Space Travel','Animated avatar border',150,'{"asset": "spacetravel.png"}'::jsonb,25),
('avatar_decoration-spirits','avatar_decoration','Spirits','Animated avatar border',150,'{"asset": "spirits.png"}'::jsonb,26),
('avatar_decoration-surprised','avatar_decoration','Surprised','Animated avatar border',150,'{"asset": "surprised.png"}'::jsonb,27),
('avatar_decoration-sweatdrops','avatar_decoration','Sweat Drops','Animated avatar border',150,'{"asset": "sweatdrops.png"}'::jsonb,28),
('avatar_decoration-sweetdreams','avatar_decoration','Sweet Dreams','Animated avatar border',150,'{"asset": "sweetdreams.png"}'::jsonb,29),
('avatar_decoration-swirl','avatar_decoration','Swirl','Animated avatar border',150,'{"asset": "swirl.png"}'::jsonb,30),
('avatar_decoration-whiteroses','avatar_decoration','White Roses','Animated avatar border',150,'{"asset": "whiteroses.png"}'::jsonb,31),
('avatar_decoration-witchinghour','avatar_decoration','Witching Hour','Animated avatar border',150,'{"asset": "witchinghour.png"}'::jsonb,32),
('avatar_decoration-witchinghour2','avatar_decoration','Witching Hour II','Animated avatar border',150,'{"asset": "witchinghour2.png"}'::jsonb,33),
('profile_effect-alwayswatching','profile_effect','Always Watching','Animated profile effect',250,'{"asset": "alwayswatching.png"}'::jsonb,34),
('profile_effect-bonsaieternity','profile_effect','Bonsai Eternity','Animated profile effect',250,'{"asset": "bonsaieternity.png"}'::jsonb,35),
('profile_effect-candlelight','profile_effect','Candlelight','Animated profile effect',250,'{"asset": "candlelight.png"}'::jsonb,36),
('profile_effect-celestial','profile_effect','Celestial','Animated profile effect',250,'{"asset": "celestial.png"}'::jsonb,37),
('profile_effect-comet','profile_effect','Comet','Animated profile effect',250,'{"asset": "comet.png"}'::jsonb,38),
('profile_effect-doves','profile_effect','Doves','Animated profile effect',250,'{"asset": "doves.png"}'::jsonb,39),
('profile_effect-duck','profile_effect','Duck','Animated profile effect',250,'{"asset": "duck.png"}'::jsonb,40),
('profile_effect-fallfoliage','profile_effect','Fall Foliage','Animated profile effect',250,'{"asset": "fallfoliage.png"}'::jsonb,41),
('profile_effect-fog','profile_effect','Fog','Animated profile effect',250,'{"asset": "fog.png"}'::jsonb,42),
('profile_effect-glitch','profile_effect','Glitch','Animated profile effect',250,'{"asset": "glitch.png"}'::jsonb,43),
('profile_effect-greengoo','profile_effect','Green Goo','Animated profile effect',250,'{"asset": "greengoo.png"}'::jsonb,44),
('profile_effect-hallelujamountains','profile_effect','Hallelujah Mountains','Animated profile effect',250,'{"asset": "hallelujamountains.png"}'::jsonb,45),
('profile_effect-hellokitty','profile_effect','Hello Kitty','Animated profile effect',250,'{"asset": "hellokitty.png"}'::jsonb,46),
('profile_effect-leaves','profile_effect','Leaves','Animated profile effect',250,'{"asset": "leaves.png"}'::jsonb,47),
('profile_effect-lonewolf','profile_effect','Lone Wolf','Animated profile effect',250,'{"asset": "lonewolf.png"}'::jsonb,48),
('profile_effect-mists','profile_effect','Mists','Animated profile effect',250,'{"asset": "mists.png"}'::jsonb,49),
('profile_effect-pinkflowers','profile_effect','Pink Flowers','Animated profile effect',250,'{"asset": "pinkflowers.png"}'::jsonb,50),
('profile_effect-purplemists','profile_effect','Purple Mists','Animated profile effect',250,'{"asset": "purplemists.png"}'::jsonb,51),
('profile_effect-samurai','profile_effect','Samurai','Animated profile effect',250,'{"asset": "samurai.png"}'::jsonb,52),
('profile_effect-starstruck','profile_effect','Starstruck','Animated profile effect',250,'{"asset": "starstruck.png"}'::jsonb,53),
('profile_effect-unlimitedvoid','profile_effect','Unlimited Void','Animated profile effect',250,'{"asset": "unlimitedvoid.png"}'::jsonb,54),
('profile_effect-whiteroses','profile_effect','White Roses','Animated profile effect',250,'{"asset": "whiteroses.png"}'::jsonb,55),
('profile_effect-witchinghour','profile_effect','Witching Hour','Animated profile effect',250,'{"asset": "witchinghour.png"}'::jsonb,56),
('username-sky','username_color','Sky','Username style',75,'{"color": "#9CC0EA"}'::jsonb,57),
('username-rosewood','username_color','Rosewood','Username style',75,'{"color": "#e8798f"}'::jsonb,58),
('username-mint','username_color','Mint','Username style',75,'{"color": "#86efac"}'::jsonb,59),
('username-gold','username_color','Gold','Username style',75,'{"color": "#fbbf24"}'::jsonb,60),
('username-lilac','username_color','Lilac','Username style',75,'{"color": "#c4b5fd"}'::jsonb,61),
('username-ocean','username_color','Ocean','Username style',75,'{"gradient": ["#38bdf8", "#a5f3fc"]}'::jsonb,62),
('username-sunset','username_color','Sunset','Username style',75,'{"gradient": ["#fb7185", "#fbbf24"]}'::jsonb,63),
('username-aurora','username_color','Aurora','Username style',75,'{"gradient": ["#a78bfa", "#5eead4"]}'::jsonb,64),
('username-neon-blue','username_color','Neon Blue','Username style',75,'{"color": "#67e8f9", "glow": "#0891b2"}'::jsonb,65),
('username-neon-pink','username_color','Neon Pink','Username style',75,'{"color": "#f9a8d4", "glow": "#db2777"}'::jsonb,66),
('username-monospace','username_color','Monospace','Username style',75,'{"font": "Roboto Mono", "color": "#d4d4d8"}'::jsonb,67),
('username-arcade','username_color','Arcade','Username style',75,'{"font": "Press Start 2P", "color": "#86efac"}'::jsonb,68),
('tag-gamer','name_tag','Gamer','Cosmetic name tag',50,'{"text": "Gamer", "color": "#4f46e5"}'::jsonb,69),
('tag-night-owl','name_tag','Night Owl','Cosmetic name tag',50,'{"text": "Night Owl", "color": "#7c3aed"}'::jsonb,70),
('tag-collector','name_tag','Collector','Cosmetic name tag',50,'{"text": "Collector", "color": "#0891b2"}'::jsonb,71),
('tag-daydreamer','name_tag','Daydreamer','Cosmetic name tag',50,'{"text": "Daydreamer", "color": "#be185d"}'::jsonb,72),
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

-- Public, read-only leaderboard data for Vaulted.
-- Run after berri-accounts.sql and vaulted-shop.sql in Supabase SQL Editor.
create or replace function public.vaulted_leaderboard(p_limit integer default 51, p_offset integer default 0)
returns table (user_id uuid, username text, display_name text, avatar_url text, credits bigint, games_played bigint, play_seconds bigint)
language sql stable security definer set search_path = pg_catalog, public
as $function$
  select p.id, p.username, p.display_name, p.avatar_url,
    coalesce(w.balance, 0)::bigint,
    coalesce(stats.games_played, 0)::bigint,
    coalesce(stats.play_seconds, 0)::bigint
  from public.profiles p
  left join public.shop_wallets w on w.user_id = p.id
  left join (
    select gs.user_id,
      count(*) filter (where gs.play_seconds > 0)::bigint as games_played,
      sum(gs.play_seconds)::bigint as play_seconds
    from public.game_stats gs group by gs.user_id
  ) stats on stats.user_id = p.id
  order by coalesce(w.balance, 0) desc, coalesce(stats.games_played, 0) desc,
    coalesce(stats.play_seconds, 0) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 51), 51)) offset greatest(coalesce(p_offset, 0), 0);
$function$;
revoke all on function public.vaulted_leaderboard(integer, integer) from public, anon, authenticated;
grant execute on function public.vaulted_leaderboard(integer, integer) to anon, authenticated;

-- Add every currently missing item from Cherri's public shop catalog.
-- Source: https://cherrion.top/api/shop (checked 2026-11-13).
-- Cherri's public repo does not publish its server-side seed file. Existing Vaulted
-- catalog entries and prices remain unchanged; this inserts only missing items.
-- The Blood Moon listing has no image in Cherri's public repo, so it uses Vaulted's
-- built-in flame avatar ring fallback instead of pointing at a missing file.
-- Cherri+ passes extend a virtual Plus entitlement; no external payment is involved.
begin;

alter table public.shop_catalog drop constraint if exists shop_catalog_kind_check;
alter table public.shop_catalog add constraint shop_catalog_kind_check
  check (kind in ('avatar_decoration','profile_effect','username_color','name_tag','plus_pass'));

create table if not exists public.shop_plus_passes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.shop_plus_passes enable row level security;
revoke all on public.shop_plus_passes from public, anon, authenticated;

create or replace function public.vaulted_public_plus(p_usernames text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}'; person record;
begin
  if coalesce(cardinality(p_usernames),0)>100 then raise exception 'Too many usernames.'; end if;
  for person in
    select p.username,pass.expires_at
    from public.profiles p
    join public.shop_plus_passes pass on pass.user_id=p.id
    where p.username=any(p_usernames) and pass.expires_at>now()
  loop
    result:=result||jsonb_build_object(person.username,person.expires_at);
  end loop;
  return result;
end $$;
revoke all on function public.vaulted_public_plus(text[]) from public, anon, authenticated;
grant execute on function public.vaulted_public_plus(text[]) to anon, authenticated;

create or replace function public.vaulted_wallet() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); w public.shop_wallets; plus_until timestamptz;
begin
  if u is null then raise exception 'Sign in to use the shop.'; end if;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  select * into w from public.shop_wallets where user_id=u;
  select expires_at into plus_until from public.shop_plus_passes where user_id=u;
  return jsonb_build_object(
    'coins',w.balance,
    'earnedToday',case when w.reward_day=(now() at time zone 'UTC')::date then w.earned_today else 0 end,
    'dailyCap',100,
    'plusUntil',plus_until,
    'isPlus',coalesce(plus_until>now(),false)
  );
end $$;

create or replace function public.vaulted_buy(p_item text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); item public.shop_catalog; w public.shop_wallets;
  pass_days integer; plus_until timestamptz;
begin
  if u is null then raise exception 'Sign in to buy items.'; end if;
  select * into item from public.shop_catalog where id=p_item and active;
  if not found then raise exception 'Item is not available.'; end if;
  if item.kind='plus_pass' then
    pass_days:=nullif(item.payload->>'days','')::integer;
    if pass_days is null or pass_days<1 or pass_days>365 then raise exception 'This Plus pass is not configured.'; end if;
  elsif exists(select 1 from public.shop_inventory where user_id=u and item_id=p_item) then
    return public.vaulted_wallet()||jsonb_build_object('ok',true,'alreadyOwned',true);
  end if;
  insert into public.shop_wallets(user_id) values(u) on conflict do nothing;
  select * into w from public.shop_wallets where user_id=u for update;
  if w.balance<item.price then raise exception 'Not enough credits.'; end if;
  update public.shop_wallets set balance=balance-item.price,updated_at=now() where user_id=u;
  insert into public.shop_ledger(user_id,amount,reason)
    values(u,-item.price,case when item.kind='plus_pass' then 'purchase_plus_pass:'||p_item else 'purchase:'||p_item end);
  if item.kind='plus_pass' then
    insert into public.shop_plus_passes(user_id,expires_at)
      values(u,now()+make_interval(days=>pass_days))
      on conflict(user_id) do update set
        expires_at=greatest(shop_plus_passes.expires_at,now())+make_interval(days=>pass_days),
        updated_at=now()
      returning expires_at into plus_until;
    return public.vaulted_wallet()||jsonb_build_object('ok',true,'plusUntil',plus_until);
  end if;
  insert into public.shop_inventory(user_id,item_id) values(u,p_item);
  return public.vaulted_wallet()||jsonb_build_object('ok',true);
end $$;

create or replace function public.vaulted_gift(p_username text,p_request uuid,p_item text default null,p_amount integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); recipient uuid; cost bigint; item public.shop_catalog; event text;
  pass_days integer; plus_until timestamptz;
begin
  if u is null then raise exception 'Sign in to send a gift.'; end if;
  if p_request is null then raise exception 'Missing request ID.'; end if;
  select id into recipient from public.profiles where username=lower(trim(p_username));
  if recipient is null then raise exception 'User not found.'; end if;
  if recipient=u then raise exception 'Choose another user.'; end if;
  if p_item is not null then
    select * into item from public.shop_catalog where id=p_item and active;
    if not found then raise exception 'Item is not available.'; end if;
    cost:=round(item.price*1.1);
    if item.kind='plus_pass' then
      pass_days:=nullif(item.payload->>'days','')::integer;
      if pass_days is null or pass_days<1 or pass_days>365 then raise exception 'This Plus pass is not configured.'; end if;
    end if;
  else
    if p_amount is null or p_amount<1 or p_amount>1000000 then raise exception 'Invalid credit amount.'; end if;
    cost:=p_amount;
  end if;
  insert into public.shop_wallets(user_id) values(u),(recipient) on conflict do nothing;
  perform 1 from public.shop_wallets where user_id in (u,recipient) order by user_id for update;
  event:='gift:'||p_request::text;
  if exists(select 1 from public.shop_ledger where user_id=u and event_key=event) then return public.vaulted_wallet()||jsonb_build_object('ok',true); end if;
  if p_item is not null then
    if item.kind<>'plus_pass' and exists(select 1 from public.shop_inventory where user_id=recipient and item_id=p_item) then
      raise exception 'This user already owns that item.';
    end if;
  end if;
  if (select balance from public.shop_wallets where user_id=u)<cost then raise exception 'Not enough credits.'; end if;
  update public.shop_wallets set balance=balance-cost,updated_at=now() where user_id=u;
  insert into public.shop_ledger(user_id,amount,reason,event_key) values(u,-cost,'gift_sent',event);
  if p_item is null then
    update public.shop_wallets set balance=balance+cost,updated_at=now() where user_id=recipient;
    insert into public.shop_ledger(user_id,amount,reason,event_key) values(recipient,cost,'gift_received',event);
  elsif item.kind='plus_pass' then
    insert into public.shop_plus_passes(user_id,expires_at)
      values(recipient,now()+make_interval(days=>pass_days))
      on conflict(user_id) do update set
        expires_at=greatest(shop_plus_passes.expires_at,now())+make_interval(days=>pass_days),
        updated_at=now()
      returning expires_at into plus_until;
    insert into public.shop_ledger(user_id,amount,reason,event_key)
      values(recipient,0,'gift_plus_pass:'||p_item,event);
  else
    insert into public.shop_inventory(user_id,item_id) values(recipient,p_item);
    insert into public.shop_ledger(user_id,amount,reason,event_key) values(recipient,0,'gift_item:'||p_item,event);
  end if;
  return public.vaulted_wallet()||jsonb_build_object('ok',true);
end $$;

revoke all on function public.vaulted_wallet(),public.vaulted_buy(text),public.vaulted_gift(text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.vaulted_wallet(),public.vaulted_buy(text),public.vaulted_gift(text,uuid,text,integer) to authenticated;

insert into public.shop_catalog(id,kind,name,description,price,payload,sort_order) values
('deco_bloodmoon','avatar_decoration','Blood Moon','A molten crescent glowing red',1600,'{"style":"flame"}'::jsonb,91),
('tag_merry','name_tag','Merry','Merry and bright',400,'{"text":"MERRY","color":"#4ade80"}'::jsonb,92),
('tag_hohoho','name_tag','Ho Ho Ho','Laughing like a bowl full of jelly',600,'{"text":"HO HO HO","color":"#ef4444"}'::jsonb,93),
('tag_frosty','name_tag','Frosty','Cool as ice',500,'{"text":"FROSTY","color":"#a5f3fc"}'::jsonb,94),
('tag_cozy','name_tag','Cozy','Blanket, cocoa, no plans',400,'{"text":"COZY","color":"#fbbf24"}'::jsonb,95),
('tag_snowedin','name_tag','Snowed In','Not going anywhere',600,'{"text":"SNOWED IN","color":"#e0f2fe"}'::jsonb,96),
('tag_elf','name_tag','Elf','Santa''s little helper',500,'{"text":"ELF","color":"#22c55e"}'::jsonb,97),
('tag_mistletoe','name_tag','Mistletoe','Meet me underneath',700,'{"text":"MISTLETOE","color":"#34d399"}'::jsonb,98),
('tag_cocoa','name_tag','Cocoa','Extra marshmallows',400,'{"text":"COCOA","color":"#d6a77a"}'::jsonb,99),
('tag_akane_fan_9b5f73aa','name_tag','Akane Fan','Professional akane cult member TM no refunds join the cult',150,'{"text":"AKANE FAN","color":"#8fffd4"}'::jsonb,100),
('tag_x8r_fan_246b3dcf','name_tag','x8r fan','Join team x8r today',200,'{"text":"X8R FAN","color":"#1c71d8"}'::jsonb,101),
('tag_star','name_tag','Star','Shine bright',500,'{"text":"STAR","color":"#8be9fd"}'::jsonb,102),
('tag_cool','name_tag','Cool','Effortlessly',600,'{"text":"COOL","color":"#7dd3fc"}'::jsonb,103),
('tag_special','name_tag','Special','One of a kind',900,'{"text":"SPECIAL","color":"#bd93f9"}'::jsonb,104),
('tag_tuff','name_tag','Tuff','Certified tuff',800,'{"text":"TUFF","color":"#ff5555"}'::jsonb,105),
('tag_yummy','name_tag','Yummy','Delicious',300,'{"text":"YUMMY","color":"#ff8fab"}'::jsonb,106),
('tag_femboy','name_tag','Femboy','Thigh highs equipped',500,'{"text":"FEMBOY","color":"#ff9ed8"}'::jsonb,107),
('tag_tomboy_71537e82','name_tag','Tomboy','Flannel equipped',500,'{"text":"TOMBOY","color":"#218372"}'::jsonb,108),
('tag_aura','name_tag','Aura','+1000 aura',700,'{"text":"AURA","color":"#9d7bff"}'::jsonb,109),
('tag_larp','name_tag','LARP','None of it was real',600,'{"text":"LARP","color":"#7ee787"}'::jsonb,110),
('tag_name','name_tag','Name','It just says NAME',300,'{"text":"NAME","color":"#d4d4d8"}'::jsonb,111),
('tag_snek_dea2382f','name_tag','Snek','Boop noodle',500,'{"text":"SNEK","color":"#006b20"}'::jsonb,112),
('tag_beans_190d7c0f','name_tag','Beans','Yum',300,'{"text":"BEANS","color":"#8f4c00"}'::jsonb,113),
('tag_angel_d0f337bd','name_tag','Angel','I''ve done nothing wrong',500,'{"text":"ANGEL","color":"#ffffff"}'::jsonb,114),
('tag_evil_766830d3','name_tag','Evil','muahahaha',666,'{"text":"EVIL","color":"#c20030"}'::jsonb,115),
('tag_tsundere_262415cf','name_tag','Tsundere','It''s not like I like you or anything...',500,'{"text":"TSUNDERE","color":"#ca536f"}'::jsonb,116),
('tag_turtle_50f67d56','name_tag','Turtle','"I like turtles."',500,'{"text":"TURTLE","color":"#5e976a"}'::jsonb,117),
('tag_fih_7c05c8df','name_tag','Fih','Fihhhhhhhh',500,'{"text":"FIH","color":"#007e9e"}'::jsonb,118),
('tag_gay','name_tag','Gay','Out and proud',100,'{"text":"GAY","color":"#c94fff"}'::jsonb,119),
('tag_lesbian_21bfb3d9','name_tag','Lesbian','Out and proud',100,'{"text":"LESBIAN","color":"#d76c14"}'::jsonb,120),
('tag_bisexual_83d526ee','name_tag','Bisexual','Out and proud',100,'{"text":"BISEXUAL","color":"#9404d7"}'::jsonb,121),
('tag_pansexual_6d12f209','name_tag','Pansexual','Out and proud',100,'{"text":"PANSEXUAL","color":"#f5ef4d"}'::jsonb,122),
('tag_trans_72dcc32d','name_tag','Trans','Out and proud',100,'{"text":"TRANS","color":"#3836a6"}'::jsonb,123),
('tag_genderfluid_48f4ceac','name_tag','Genderfluid','Out and proud',100,'{"text":"GENDERFLUID","color":"#703e4a"}'::jsonb,124),
('tag_aroace_59723f3b','name_tag','Aroace','Out and proud',100,'{"text":"AROACE","color":"#272022"}'::jsonb,125),
('tag_aero_c3b479ee','name_tag','Aero','Out and proud',500,'{"text":"AERO","color":"#693542"}'::jsonb,126),
('tag_ace_0bc0aa27','name_tag','Ace','Out and proud',100,'{"text":"ACE","color":"#707070"}'::jsonb,127),
('tag_scammer_673fc81e','name_tag','Scammer','"Hello, this is Microsoft Support Center"',5000,'{"text":"SCAMMER","color":"#20fe45"}'::jsonb,128),
('tag_rich_d79c0c32','name_tag','Rich','Flex your wealth on the peasents',5000,'{"text":"RICH","color":"#ffd700"}'::jsonb,129),
('tag_unc_f47e9734','name_tag','Unc','Pushing 20 btw',500,'{"text":"UNC","color":"#192ed2"}'::jsonb,130),
('tag_gambler_3a2d5190','name_tag','Gambler','1 more round...',777,'{"text":"GAMBLER","color":"#005c02"}'::jsonb,131),
('tag_yin_ef847c65','name_tag','Yin','Darkness',500,'{"text":"YIN","color":"#0d0c0c"}'::jsonb,132),
('tag_yang_38bb0740','name_tag','Yang','Light',500,'{"text":"YANG","color":"#ffffff"}'::jsonb,133),
('tag_dumbass_fea4bac0','name_tag','Dumbass','Professional dumbass',500,'{"text":"DUMBASS","color":"#1066a8"}'::jsonb,134),
('tag_smartass_8477ce6e','name_tag','Smartass','You think you''re so clever...',500,'{"text":"SMARTASS","color":"#31d8a0"}'::jsonb,135),
('tag_nugget_4eb85353','name_tag','Nugget','Just love munching on them',550,'{"text":"NUGGET","color":"#e5a50a"}'::jsonb,136),
('tag_moon_18914267','name_tag','Moon','Shining brighter than a star.',400,'{"text":"MOON","color":"#ffffff"}'::jsonb,137),
('tag_sweet_3b6e321c','name_tag','Sweet','Better than candy.',500,'{"text":"SWEET","color":"#ff14ba"}'::jsonb,138),
('tag_pro_19e82b1d','name_tag','Pro','Better than you at everything.',700,'{"text":"PRO","color":"#57e389"}'::jsonb,139),
('tag_donut_84a584bf','name_tag','Donut','Professional glaze',300,'{"text":"DONUT","color":"#dc8add"}'::jsonb,140),
('plus_1d','plus_pass','Cherri+ for 1 day','24 hours of Plus',3500,'{"days":1}'::jsonb,141),
('plus_3d','plus_pass','Cherri+ for 3 days','72 hours of Plus',8500,'{"days":3}'::jsonb,142)
on conflict(id) do update set name=excluded.name,description=excluded.description,price=excluded.price,payload=excluded.payload,sort_order=excluded.sort_order,active=true;

notify pgrst, 'reload schema';
commit;
