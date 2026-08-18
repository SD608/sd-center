-- 2026-08-18 · 게임 업적 실시간/누적 보정
-- 적용된 Live Supabase migration: fix_game_achievement_live_progress_and_realtime
-- 핵심 내용:
-- 1) sd_achievement_progress를 Supabase Realtime publication에 추가
-- 2) PC 레거시 업적 진행도와 서버 게임 기록이 max()로 서로 가려지던 문제 수정
-- 3) 최초 서버 통합 시각을 기준점으로 저장하고 이후 서버 게임 delta를 기존 진행도 뒤에 이어붙임
-- 4) 다음 SD Link 레거시 업로드가 더 크더라도 기준점을 재조정해 이후 서버 게임이 계속 +1/+금액으로 증가

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sd_achievement_progress'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sd_achievement_progress;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.upsert_sd_game_achievement(
  p_user_id uuid,
  p_achievement_id text,
  p_server_value numeric,
  p_target numeric,
  p_game text,
  p_metric text,
  p_additive boolean DEFAULT false,
  p_server_base_value numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_value numeric := 0;
  v_existing_unlocked boolean := false;
  v_existing_unlocked_at timestamptz := null;
  v_existing_metadata jsonb := '{}'::jsonb;
  v_server_value numeric := greatest(0, coalesce(p_server_value, 0));
  v_server_base numeric := greatest(0, coalesce(p_server_base_value, 0));
  v_progress_base numeric := 0;
  v_delta numeric := 0;
  v_effective numeric := 0;
  v_unlocked boolean := false;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  SELECT current_value, unlocked, unlocked_at, coalesce(metadata, '{}'::jsonb)
  INTO v_existing_value, v_existing_unlocked, v_existing_unlocked_at, v_existing_metadata
  FROM public.sd_achievement_progress
  WHERE user_id = p_user_id
    AND achievement_id = p_achievement_id;

  IF NOT FOUND THEN
    v_existing_value := 0;
    v_existing_unlocked := false;
    v_existing_unlocked_at := null;
    v_existing_metadata := '{}'::jsonb;
  END IF;

  IF p_additive THEN
    IF (v_existing_metadata ? 'server_base_value')
       AND (v_existing_metadata ? 'progress_base_value')
       AND (v_existing_metadata->>'server_base_value') ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND (v_existing_metadata->>'progress_base_value') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      v_server_base := greatest(0, (v_existing_metadata->>'server_base_value')::numeric);
      v_progress_base := greatest(0, (v_existing_metadata->>'progress_base_value')::numeric);
    ELSE
      IF v_existing_value > v_server_value THEN
        v_progress_base := v_existing_value;
      ELSE
        v_progress_base := v_server_base;
      END IF;
    END IF;

    v_delta := greatest(0, v_server_value - v_server_base);
    v_effective := v_progress_base + v_delta;

    IF v_existing_value > v_effective THEN
      v_progress_base := greatest(0, v_existing_value - v_delta);
      v_effective := v_existing_value;
    END IF;
  ELSE
    v_effective := greatest(v_existing_value, v_server_value);
  END IF;

  v_unlocked := v_existing_unlocked OR v_effective >= greatest(0, coalesce(p_target, 0));
  v_metadata := v_existing_metadata || jsonb_build_object(
    'game', p_game,
    'metric', p_metric,
    'server_value', v_server_value
  );

  IF p_additive THEN
    v_metadata := v_metadata || jsonb_build_object(
      'server_base_value', v_server_base,
      'progress_base_value', v_progress_base
    );
  END IF;

  INSERT INTO public.sd_achievement_progress
    (user_id, achievement_id, current_value, unlocked, unlocked_at, source_app, metadata, updated_at)
  VALUES
    (
      p_user_id,
      p_achievement_id,
      v_effective,
      v_unlocked,
      CASE
        WHEN v_existing_unlocked_at IS NOT NULL THEN v_existing_unlocked_at
        WHEN v_unlocked THEN now()
        ELSE NULL
      END,
      'game-server',
      v_metadata,
      now()
    )
  ON CONFLICT ON CONSTRAINT sd_achievement_progress_pkey DO UPDATE
    SET current_value = excluded.current_value,
        unlocked = excluded.unlocked,
        unlocked_at = excluded.unlocked_at,
        source_app = excluded.source_app,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION private.upsert_sd_game_achievement(uuid,text,numeric,numeric,text,text,boolean,numeric)
FROM public, anon, authenticated;

-- refresh_sd_game_achievements의 누적형 항목은 아래 기준으로 upsert helper를 사용합니다.
-- 최초 서버 통합 기준 시각: 2026-08-18 01:14:47.282408+00
-- 슬롯: slot-04/05(spins), slot-07(cumulative_payout)
-- 홀짝: oddeven-04/05/06(wins)
-- 연승/연패/특수조건처럼 합산하면 안 되는 항목은 기존처럼 전체 서버 기록의 max/boolean을 사용합니다.

-- Live DB에는 위 helper를 호출하도록 private.refresh_sd_game_achievements(uuid,text)를 교체한 뒤
-- 기존 completed game_rounds 사용자 전체를 한 번 재계산했습니다.
