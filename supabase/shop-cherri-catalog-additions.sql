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
