-- SD Flea PC authority v2 segment 1/6
begin;

-- SD Flea Market PC server authority v2
-- Server owns mission issuance, RNG loot, bank settlement and the 13 PC-only achievement metrics.
-- Existing flea inventory/progress is preserved; client-submitted achievement values are never trusted.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.sd_flea_pc_item_catalog (
  item_key text primary key,
  name text not null,
  tier text not null check (tier in ('worn','normal','fancy','premium','safe')),
  server_value bigint not null check (server_value >= 0),
  loot_weight integer not null default 1 check (loot_weight > 0),
  collection_required boolean not null default true,
  limited boolean not null default false,
  sellable boolean not null default true
);

alter table public.sd_flea_pc_item_catalog enable row level security;
drop policy if exists sd_flea_pc_item_catalog_read on public.sd_flea_pc_item_catalog;
create policy sd_flea_pc_item_catalog_read on public.sd_flea_pc_item_catalog
  for select to authenticated using (true);
revoke insert,update,delete,truncate on public.sd_flea_pc_item_catalog from anon,authenticated;
grant select on public.sd_flea_pc_item_catalog to authenticated;

insert into public.sd_flea_pc_item_catalog(item_key,name,tier,server_value,loot_weight,collection_required,limited,sellable) values
 ('worn:pen','볼펜','worn',1000,1,true,false,true),
 ('worn:clips','클립 한 통','worn',2000,1,true,false,true),
 ('worn:eraser','지우개','worn',1000,1,true,false,true),
 ('worn:ruler','15cm 자','worn',2000,1,true,false,true),
 ('worn:notebook','작은 수첩','worn',4000,1,true,false,true),
 ('worn:keyring','열쇠고리','worn',5000,1,true,false,true),
 ('worn:mug','머그컵','worn',7000,1,true,false,true),
 ('worn:usb-cable','USB 케이블','worn',10000,1,true,false,true),
 ('normal:earphone','유선 이어폰','normal',25000,1,true,false,true),
 ('normal:charger','휴대폰 충전기','normal',30000,1,true,false,true),
 ('normal:fan','미니 선풍기','normal',35000,1,true,false,true),
 ('normal:usb-memory','USB 메모리','normal',40000,1,true,false,true),
 ('normal:mouse','무선 마우스','normal',50000,1,true,false,true),
 ('normal:powerbank','보조배터리','normal',60000,1,true,false,true),
 ('normal:headset','저가형 헤드셋','normal',75000,1,true,false,true),
 ('fancy:gamepad','게임패드','fancy',90000,1,true,false,true),
 ('fancy:keyboard','기계식 키보드','fancy',120000,1,true,false,true),
 ('fancy:sneakers','브랜드 운동화','fancy',150000,1,true,false,true),
 ('fancy:speaker','블루투스 스피커','fancy',180000,1,true,false,true),
 ('fancy:wireless-earbuds','무선 이어폰','fancy',200000,1,true,false,true),
 ('fancy:smartwatch','스마트워치','fancy',240000,1,true,false,true),
 ('premium:handheld','휴대용 게임기 세트','premium',250000,1,true,false,true),
 ('premium:headphones','프리미엄 헤드폰','premium',300000,1,true,false,true),
 ('premium:tablet','고급 태블릿','premium',350000,1,true,false,true),
 ('premium:camera','미러리스 카메라','premium',400000,1,true,false,true),
 ('premium:phone','플래그십 스마트폰','premium',450000,1,true,false,true),
 ('premium:gpu','고성능 그래픽카드','premium',500000,1,true,false,true),
 ('safe:ring','금반지','safe',220000,26,true,false,true),
 ('safe:coin','희귀 주화','safe',280000,20,true,false,true),
 ('safe:necklace','금목걸이','safe',350000,18,true,false,true),
 ('safe:gold-coins','금화 세트','safe',450000,14,true,false,true),
 ('safe:watch','명품 시계','safe',600000,10,true,false,true),
 ('safe:gem','보석 원석','safe',850000,7,true,false,true),
 ('safe:small-bar','소형 금괴','safe',1200000,4,true,false,true),
 ('safe:large-bar','대형 금괴','safe',2500000,1,true,false,true),
 ('safe:red-diamond','레드 다이아몬드','safe',1,1,false,true,false)
on conflict (item_key) do update set
 name=excluded.name,tier=excluded.tier,server_value=excluded.server_value,loot_weight=excluded.loot_weight,
 collection_required=excluded.collection_required,limited=excluded.limited,sellable=excluded.sellable;

create table if not exists public.sd_flea_pc_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bank_successes bigint not null default 0 check (bank_successes >= 0),
  bank_failures bigint not null default 0 check (bank_failures >= 0),
  boxes_looted bigint not null default 0 check (boxes_looted >= 0),
  red_diamond_found boolean not null default false,
  highest_tier_found boolean not null default false,
  lowest_only_boxes bigint not null default 0 check (lowest_only_boxes >= 0),
  max_top_speed_distance_m numeric not null default 0 check (max_top_speed_distance_m >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sd_flea_pc_missions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_type text not null check (mission_type in ('regular','bank')),
  location_id text not null check (location_id in ('alley','abandoned_store','logistics','bank')),
  status text not null default 'active' check (status in ('active','escaping','completed','failed','abandoned','expired')),
  node_count integer not null default 0 check (node_count >= 0 and node_count <= 32),
  special_node integer null,
  search_count integer not null default 0 check (search_count >= 0),
  found_boxes integer not null default 0 check (found_boxes >= 0),
  miss_streak integer not null default 0 check (miss_streak >= 0),
  max_boxes integer not null default 0 check (max_boxes >= 0 and max_boxes <= 16),
  carried_safes integer not null default 0 check (carried_safes >= 0 and carried_safes <= 6),
  bank_door_code text null,
  bank_door_unlocked boolean not null default false,
  bank_guards_neutralized integer not null default 0 check (bank_guards_neutralized between 0 and 6),
  last_bank_combat_at timestamptz null,
  escape_started_at timestamptz null,
  last_checkpoint_at timestamptz null,
  escape_checkpoint_count integer not null default 0 check (escape_checkpoint_count >= 0),
  top_speed_distance_m numeric not null default 0 check (top_speed_distance_m >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '2 hours'),
  completed_at timestamptz null
);

create unique index if not exists sd_flea_pc_one_live_mission_per_user
  on public.sd_flea_pc_missions(user_id)
  where status in ('active','escaping');
create index if not exists sd_flea_pc_missions_user_created_idx
  on public.sd_flea_pc_missions(user_id,created_at desc);

create table if not exists public.sd_flea_pc_nodes (
  mission_id uuid not null references public.sd_flea_pc_missions(id) on delete cascade,
  node_index integer not null check (node_index between 1 and 32),
  searched_at timestamptz null,
  box_id uuid null,
  primary key(mission_id,node_index)
);

create table if not exists public.sd_flea_pc_boxes (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.sd_flea_pc_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tier text not null check (tier in ('worn','normal','fancy','premium','safe')),
  source_kind text not null check (source_kind in ('regular','bank_safe')),
  empty boolean not null default false,
  carried boolean not null default false,
  opened_at timestamptz null,
  created_at timestamptz not null default now()
);
create index if not exists sd_flea_pc_boxes_user_idx on public.sd_flea_pc_boxes(user_id,created_at desc);

create table if not exists public.sd_flea_pc_bank_guards (
  mission_id uuid not null references public.sd_flea_pc_missions(id) on delete cascade,
  guard_no integer not null check (guard_no between 1 and 6),
  hp integer not null check (hp between 0 and 50),
  max_hp integer not null check (max_hp in (25,50)),
  neutralized_at timestamptz null,
  primary key(mission_id,guard_no)
);

create table if not exists public.sd_flea_pc_loot_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null references public.sd_flea_pc_missions(id) on delete cascade,
  box_id uuid not null references public.sd_flea_pc_boxes(id) on delete cascade,
  flea_item_id uuid null references public.sd_flea_items(id) on delete set null,
  catalog_key text not null references public.sd_flea_pc_item_catalog(item_key),
  sellable boolean not null,
  server_value bigint not null check (server_value >= 0),
  created_at timestamptz not null default now(),
  unique(box_id)
);

create table if not exists public.sd_flea_pc_item_counts (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_key text not null references public.sd_flea_pc_item_catalog(item_key),
  acquired_count bigint not null default 0 check (acquired_count >= 0),
  first_acquired_at timestamptz not null default now(),
  last_acquired_at timestamptz not null default now(),
  primary key(user_id,catalog_key)
);

create table if not exists public.sd_flea_pc_actions (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (char_length(action_type) between 1 and 64),
  mission_id uuid null,
  input jsonb not null default '{}'::jsonb check (jsonb_typeof(input)='object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.sd_flea_pc_accounts enable row level security;
alter table public.sd_flea_pc_missions enable row level security;
alter table public.sd_flea_pc_nodes enable row level security;
alter table public.sd_flea_pc_boxes enable row level security;
alter table public.sd_flea_pc_bank_guards enable row level security;
alter table public.sd_flea_pc_loot_receipts enable row level security;
alter table public.sd_flea_pc_item_counts enable row level security;
alter table public.sd_flea_pc_actions enable row level security;

revoke all on public.sd_flea_pc_accounts,public.sd_flea_pc_missions,public.sd_flea_pc_nodes,public.sd_flea_pc_boxes,public.sd_flea_pc_bank_guards,
 public.sd_flea_pc_loot_receipts,public.sd_flea_pc_item_counts,public.sd_flea_pc_actions from anon;
revoke insert,update,delete,truncate on public.sd_flea_pc_accounts,public.sd_flea_pc_missions,public.sd_flea_pc_nodes,public.sd_flea_pc_boxes,public.sd_flea_pc_bank_guards,
 public.sd_flea_pc_loot_receipts,public.sd_flea_pc_item_counts,public.sd_flea_pc_actions from authenticated;
grant select on public.sd_flea_pc_accounts,public.sd_flea_pc_missions,public.sd_flea_pc_nodes,public.sd_flea_pc_boxes,public.sd_flea_pc_bank_guards,
 public.sd_flea_pc_loot_receipts,public.sd_flea_pc_item_counts,public.sd_flea_pc_actions to authenticated;

-- Own-row read policies only. Writes happen only through SECURITY DEFINER RPCs.
drop policy if exists sd_flea_pc_accounts_read_own on public.sd_flea_pc_accounts;
create policy sd_flea_pc_accounts_read_own on public.sd_flea_pc_accounts for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_missions_read_own on public.sd_flea_pc_missions;
create policy sd_flea_pc_missions_read_own on public.sd_flea_pc_missions for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_boxes_read_own on public.sd_flea_pc_boxes;
create policy sd_flea_pc_boxes_read_own on public.sd_flea_pc_boxes for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_bank_guards_read_own on public.sd_flea_pc_bank_guards;
create policy sd_flea_pc_bank_guards_read_own on public.sd_flea_pc_bank_guards for select to authenticated using (
  exists(select 1 from public.sd_flea_pc_missions m where m.id=mission_id and m.user_id=auth.uid())
);
drop policy if exists sd_flea_pc_receipts_read_own on public.sd_flea_pc_loot_receipts;
create policy sd_flea_pc_receipts_read_own on public.sd_flea_pc_loot_receipts for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_counts_read_own on public.sd_flea_pc_item_counts;
create policy sd_flea_pc_counts_read_own on public.sd_flea_pc_item_counts for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_actions_read_own on public.sd_flea_pc_actions;
create policy sd_flea_pc_actions_read_own on public.sd_flea_pc_actions for select to authenticated using (user_id=auth.uid());
drop policy if exists sd_flea_pc_nodes_read_own on public.sd_flea_pc_nodes;
create policy sd_flea_pc_nodes_read_own on public.sd_flea_pc_nodes for select to authenticated using (
  exists(select 1 from public.sd_flea_pc_missions m where m.id=mission_id and m.user_id=auth.uid())
);

commit;
