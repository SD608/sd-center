from __future__ import annotations

import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SUPABASE_URL = "https://qmatphbjzafdtlyviqoa.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_H2qTl_30-7hPUYFhJ_N_QA_X71xZswO"
KST = timezone(timedelta(hours=9))


class AdminApiError(RuntimeError):
    pass


def resource_path(name: str) -> Path:
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return root / name


def app_data_dir() -> Path:
    root = os.environ.get("LOCALAPPDATA")
    if root:
        return Path(root) / "SDAdminCenter"
    return Path.home() / ".sd_admin_center"


def ensure_roadmap_file() -> Path:
    target_dir = app_data_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "roadmap.json"
    if not target.exists():
        shutil.copy2(resource_path("roadmap.default.json"), target)
    return target


def chapter_progress(chapter: dict[str, Any]) -> tuple[int, int, float]:
    steps = chapter.get("steps") or []
    total = len(steps)
    done = sum(1 for step in steps if step.get("status") == "complete")
    pct = 0.0 if total == 0 else (done / total) * 100.0
    return done, total, pct


def overall_progress(chapters: Iterable[dict[str, Any]]) -> tuple[int, int, float]:
    done = 0
    total = 0
    for chapter in chapters:
        c_done, c_total, _ = chapter_progress(chapter)
        done += c_done
        total += c_total
    pct = 0.0 if total == 0 else (done / total) * 100.0
    return done, total, pct


def _normalise_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        raw = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                raw = parsed
            else:
                raw = [text]
        except json.JSONDecodeError:
            raw = [part.strip() for part in text.split(",")]
    else:
        raw = [str(value)]

    result: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def extract_activities(member: dict[str, Any]) -> list[str]:
    for key in ("active_apps", "active_extensions", "running_apps"):
        values = _normalise_list(member.get(key))
        if values:
            return values
    page = str(member.get("latest_page") or "").strip()
    return [page] if page else []


def activity_summary(member: dict[str, Any]) -> str:
    activities = extract_activities(member)
    if not activities:
        return "-"
    if len(activities) == 1:
        return activities[0]
    return f"{activities[0]} +{len(activities) - 1}"


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def format_kst(value: Any) -> str:
    dt = parse_timestamp(value)
    if dt is None:
        return "-"
    return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S")


def recent_activity_label(value: Any, now: datetime | None = None) -> str:
    dt = parse_timestamp(value)
    if dt is None:
        return "기록 없음"
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    delta = max(timedelta(0), now.astimezone(timezone.utc) - dt.astimezone(timezone.utc))
    seconds = delta.total_seconds()
    if seconds <= 300:
        return "최근 활동"
    if seconds <= 3600:
        return "1시간 이내"
    if seconds <= 86400:
        return "24시간 이내"
    return "오래됨"


def format_balance(value: Any) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return "-"


def friendly_api_error(status: int | None, raw: str) -> str:
    text = (raw or "").lower()
    if status in (401, 403):
        if "admin" in text or "관리자" in raw:
            return "관리자 권한이 확인되지 않았습니다."
        return "로그인 정보가 만료되었거나 올바르지 않습니다."
    if status == 429:
        return "요청이 너무 많습니다. 잠시 후 다시 시도하세요."
    if status and status >= 500:
        return "서버 응답에 문제가 있습니다."
    if "invalid login" in text or "invalid_credentials" in text:
        return "이메일 또는 비밀번호를 확인하세요."
    return "요청을 처리하지 못했습니다."


class RoadmapStore:
    def __init__(self, path: Path | None = None):
        self.path = path or ensure_roadmap_file()

    def load(self) -> dict[str, Any]:
        with self.path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        chapters = data.get("chapters")
        if not isinstance(chapters, list):
            raise ValueError("roadmap.json의 chapters 형식이 올바르지 않습니다.")
        return data


@dataclass
class AdminSession:
    access_token: str
    refresh_token: str | None


class SupabaseAdminClient:
    def __init__(
        self,
        base_url: str = SUPABASE_URL,
        publishable_key: str = SUPABASE_PUBLISHABLE_KEY,
        timeout: int = 15,
    ):
        self.base_url = base_url.rstrip("/")
        self.publishable_key = publishable_key
        self.timeout = timeout
        self.session: AdminSession | None = None

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        bearer: str | None = None,
    ) -> Any:
        url = self.base_url + path
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "apikey": self.publishable_key,
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if bearer:
            headers["Authorization"] = f"Bearer {bearer}"

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                raw = res.read().decode("utf-8", "replace")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            raise AdminApiError(friendly_api_error(exc.code, raw)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise AdminApiError("서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.") from None

    def sign_in(self, email: str, password: str) -> None:
        email = email.strip()
        if not email or not password:
            raise AdminApiError("이메일과 비밀번호를 입력하세요.")
        data = self._request(
            "POST",
            "/auth/v1/token?grant_type=password",
            {"email": email, "password": password},
        )
        token = (data or {}).get("access_token")
        if not token:
            raise AdminApiError("로그인 정보를 확인하지 못했습니다.")
        self.session = AdminSession(token, (data or {}).get("refresh_token"))

    def sign_out_local(self) -> None:
        self.session = None

    def list_members(self) -> list[dict[str, Any]]:
        if not self.session:
            raise AdminApiError("먼저 관리자 로그인을 하세요.")
        data = self._request(
            "POST",
            "/rest/v1/rpc/admin_list_sd_members",
            {},
            bearer=self.session.access_token,
        )
        if not isinstance(data, list):
            raise AdminApiError("접속 현황 응답 형식이 올바르지 않습니다.")
        return data
