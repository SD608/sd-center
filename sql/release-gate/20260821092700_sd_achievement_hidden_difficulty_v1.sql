begin;

update public.sd_achievements
set hidden = true
where code in (
  'bitcoin-04',
  'miner-05',
  'miner-07',
  'miner-09',
  'mukjjippa-01',
  'mukjjippa-02',
  'sta-03'
);

commit;
