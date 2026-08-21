begin;
create or replace function private.sd_mukjjippa_set_hand(p_session uuid,p_hand int)
returns void language plpgsql volatile security definer set search_path='' as $$
declare m text:=private.sd_mukjjippa_move(); n text:=replace(gen_random_uuid()::text,'-',''); c text;
begin
 c:=encode(extensions.digest(p_session::text||':'||p_hand::text||':'||m||':'||n,'sha256'),'hex');
 update public.sd_mukjjippa_server_sessions set computer_move=m,computer_nonce=n,computer_commitment=c where id=p_session;
end$$;
revoke all on function private.sd_mukjjippa_set_hand(uuid,int) from public,anon,authenticated;
commit;