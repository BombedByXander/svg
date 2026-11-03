-- Vaulted shop and rewards. Run AFTER berri-accounts.sql in Supabase SQL Editor.
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
