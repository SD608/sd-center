begin;

create or replace function public.list_sd_member_wallets()
returns table(
  user_id uuid,
  nickname text,
  account_number text,
  balance bigint,
  role text,
  status text,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id as user_id,
    p.nickname,
    case
      when p.id = auth.uid()
        or exists (
          select 1
          from public.profiles viewer
          where viewer.id = auth.uid()
            and viewer.role = 'admin'
            and viewer.status = 'active'
        )
      then w.account_number
      else null
    end as account_number,
    w.balance,
    p.role,
    p.status,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  join public.wallets w on w.user_id = p.id
  where auth.uid() is not null
    and p.status = 'active'
  order by w.balance desc, lower(p.nickname), w.account_number;
$$;

revoke all on function public.list_sd_member_wallets() from public, anon;
grant execute on function public.list_sd_member_wallets() to authenticated;

commit;
