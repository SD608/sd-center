import unittest
from datetime import datetime, timezone

from sd_admin_core import (
    activity_summary,
    chapter_progress,
    extract_activities,
    format_balance,
    format_kst,
    overall_progress,
    recent_activity_label,
)


class CoreTests(unittest.TestCase):
    def test_chapter_progress_only_counts_complete(self):
        ch = {"steps": [
            {"status":"complete"},
            {"status":"complete"},
            {"status":"in_progress"},
            {"status":"pending"},
        ]}
        self.assertEqual(chapter_progress(ch), (2, 4, 50.0))

    def test_overall_progress(self):
        chapters = [
            {"steps":[{"status":"complete"},{"status":"pending"}]},
            {"steps":[{"status":"complete"},{"status":"complete"}]},
        ]
        self.assertEqual(overall_progress(chapters), (3, 4, 75.0))

    def test_activity_summary_latest_page_without_fabrication(self):
        m = {"latest_page":"잔액 랭킹"}
        self.assertEqual(extract_activities(m), ["잔액 랭킹"])
        self.assertEqual(activity_summary(m), "잔액 랭킹")

    def test_activity_summary_future_concurrent_list(self):
        m = {"active_extensions":["광부","물류센터","카지노"], "latest_page":"홈"}
        self.assertEqual(activity_summary(m), "광부 +2")

    def test_format_balance(self):
        self.assertEqual(format_balance(1234567), "1,234,567")

    def test_recent_activity(self):
        now = datetime(2026, 8, 22, 0, 10, tzinfo=timezone.utc)
        self.assertEqual(recent_activity_label("2026-08-22T00:08:00+00:00", now), "최근 활동")
        self.assertEqual(recent_activity_label("2026-08-21T00:08:00+00:00", now), "오래됨")

    def test_format_kst(self):
        self.assertEqual(format_kst("2026-08-22T00:00:00+00:00"), "2026-08-22 09:00:00")


if __name__ == "__main__":
    unittest.main()
