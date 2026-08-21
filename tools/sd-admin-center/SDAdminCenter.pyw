from __future__ import annotations

import os
import threading
import tkinter as tk
from tkinter import messagebox, ttk

from sd_admin_core import (
    AdminApiError,
    RoadmapStore,
    SupabaseAdminClient,
    activity_summary,
    chapter_progress,
    extract_activities,
    format_balance,
    format_kst,
    overall_progress,
    recent_activity_label,
)

APP_TITLE = "SD 관리자 도구"


class ScrollableFrame(ttk.Frame):
    def __init__(self, master):
        super().__init__(master)
        self.canvas = tk.Canvas(self, highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.body = ttk.Frame(self.canvas)
        self.window = self.canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>", lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self.window, width=e.width))
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

    def _on_mousewheel(self, event):
        try:
            self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        except tk.TclError:
            pass


class RoadmapPage(ttk.Frame):
    def __init__(self, master):
        super().__init__(master, padding=(18, 16))
        self.store = RoadmapStore()
        self.expanded: set[str] = set()

        top = ttk.Frame(self)
        top.pack(fill="x")
        ttk.Label(top, text="로드맵", style="Title.TLabel").pack(side="left")
        ttk.Button(top, text="데이터 폴더", command=self.open_data_folder).pack(side="right", padx=(8, 0))
        ttk.Button(top, text="새로고침", command=self.refresh).pack(side="right")

        self.summary = ttk.Label(self, text="", style="Summary.TLabel")
        self.summary.pack(fill="x", pady=(14, 6))
        self.total_bar = ttk.Progressbar(self, maximum=100)
        self.total_bar.pack(fill="x", pady=(0, 14))

        self.scroller = ScrollableFrame(self)
        self.scroller.pack(fill="both", expand=True)
        self.path_label = ttk.Label(self, text="", style="Muted.TLabel")
        self.path_label.pack(fill="x", pady=(10, 0))
        self.refresh()

    def open_data_folder(self):
        folder = self.store.path.parent
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(folder)  # type: ignore[attr-defined]
        else:
            messagebox.showinfo("데이터 폴더", str(folder))

    def refresh(self):
        try:
            data = self.store.load()
        except Exception as exc:
            messagebox.showerror("로드맵", str(exc))
            return
        for child in self.scroller.body.winfo_children():
            child.destroy()
        chapters = data.get("chapters", [])
        done, total, pct = overall_progress(chapters)
        self.summary.configure(text=f"전체 진행도  {done}/{total}  ·  {pct:.1f}%")
        self.total_bar["value"] = pct
        self.path_label.configure(text=f"데이터: {self.store.path}")
        for chapter in chapters:
            self._render_chapter(chapter)

    def _render_chapter(self, chapter):
        cid = str(chapter.get("id", ""))
        frame = ttk.Frame(self.scroller.body, padding=(12, 10))
        frame.pack(fill="x", pady=5)
        header = ttk.Frame(frame)
        header.pack(fill="x")
        title = f"{cid}. {chapter.get('title', '')}"
        ttk.Button(
            header,
            text=("▼ " if cid in self.expanded else "▶ ") + title,
            command=lambda c=cid: self.toggle(c),
            style="Chapter.TButton",
        ).pack(side="left", fill="x", expand=True)
        status = chapter.get("label") or chapter.get("status") or ""
        ttk.Label(header, text=status, style="Status.TLabel").pack(side="right", padx=(10, 0))
        done, total, pct = chapter_progress(chapter)
        line = ttk.Frame(frame)
        line.pack(fill="x", pady=(8, 0))
        ttk.Progressbar(line, maximum=100, value=pct).pack(side="left", fill="x", expand=True)
        ttk.Label(line, text=f"{done}/{total} · {pct:.1f}%", width=15, anchor="e").pack(side="right", padx=(10, 0))
        if cid in self.expanded:
            detail = ttk.Frame(frame, padding=(28, 8, 8, 0))
            detail.pack(fill="x")
            for step in chapter.get("steps", []):
                state = step.get("status", "pending")
                mark = "✓" if state == "complete" else ("●" if state == "in_progress" else "○")
                text = f"{mark}  {step.get('id', '')}  {step.get('title', '')}"
                ttk.Label(detail, text=text, style="Step.TLabel").pack(anchor="w", pady=2)

    def toggle(self, cid):
        if cid in self.expanded:
            self.expanded.remove(cid)
        else:
            self.expanded.add(cid)
        self.refresh()


class AccessPage(ttk.Frame):
    ACTIVITY_COLUMN = "#7"

    def __init__(self, master):
        super().__init__(master, padding=(18, 16))
        self.client = SupabaseAdminClient()
        self.members: dict[str, dict] = {}
        self.logged_in = False
        self._busy = False

        title_row = ttk.Frame(self)
        title_row.pack(fill="x")
        ttk.Label(title_row, text="접속 현황", style="Title.TLabel").pack(side="left")
        self.refresh_btn = ttk.Button(title_row, text="새로고침", command=self.refresh_members, state="disabled")
        self.refresh_btn.pack(side="right")

        login = ttk.Frame(self)
        login.pack(fill="x", pady=(14, 12))
        ttk.Label(login, text="관리자 이메일").pack(side="left")
        self.email = ttk.Entry(login, width=30)
        self.email.pack(side="left", padx=(8, 14))
        ttk.Label(login, text="비밀번호").pack(side="left")
        self.password = ttk.Entry(login, width=24, show="•")
        self.password.pack(side="left", padx=(8, 14))
        self.password.bind("<Return>", lambda _e: self.login())
        self.login_btn = ttk.Button(login, text="로그인", command=self.login)
        self.login_btn.pack(side="left")

        filter_row = ttk.Frame(self)
        filter_row.pack(fill="x", pady=(0, 8))
        ttk.Label(filter_row, text="검색").pack(side="left")
        self.filter_var = tk.StringVar()
        self.filter_var.trace_add("write", lambda *_: self.render_members())
        ttk.Entry(filter_row, textvariable=self.filter_var, width=32).pack(side="left", padx=(8, 0))
        self.state_label = ttk.Label(filter_row, text="로그인 필요", style="Muted.TLabel")
        self.state_label.pack(side="right")

        columns = ("nickname", "email", "member", "balance", "platform", "activity_state", "activity", "last_seen")
        self.tree = ttk.Treeview(self, columns=columns, show="headings", height=20)
        headings = {
            "nickname": "닉네임", "email": "이메일", "member": "계정 상태", "balance": "잔액",
            "platform": "기기", "activity_state": "최근 상태", "activity": "활동", "last_seen": "마지막 기록",
        }
        widths = {
            "nickname": 120, "email": 220, "member": 100, "balance": 120,
            "platform": 160, "activity_state": 95, "activity": 180, "last_seen": 155,
        }
        for col in columns:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], minwidth=70, anchor="w")
        self.tree.column("balance", anchor="e")
        ybar = ttk.Scrollbar(self, orient="vertical", command=self.tree.yview)
        xbar = ttk.Scrollbar(self, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=ybar.set, xscrollcommand=xbar.set)
        self.tree.pack(fill="both", expand=True, side="top")
        xbar.pack(fill="x")
        ybar.place(relx=1.0, rely=0.22, relheight=0.68, anchor="ne")
        self.tree.bind("<Double-1>", self.open_selected_detail)
        self.tree.bind("<ButtonRelease-1>", self.on_tree_click)

        bottom = ttk.Frame(self)
        bottom.pack(fill="x", pady=(8, 0))
        ttk.Button(bottom, text="선택 상세", command=self.open_selected_detail).pack(side="left")
        ttk.Label(bottom, text="접속 상태는 heartbeat 마지막 기록 기준이며 실제 연결 여부를 추정해 확정하지 않습니다.", style="Muted.TLabel").pack(side="right")

    def _set_busy(self, value: bool, text: str | None = None):
        self._busy = value
        self.login_btn.configure(state="disabled" if value else "normal")
        self.refresh_btn.configure(state="disabled" if (value or not self.logged_in) else "normal")
        if text is not None:
            self.state_label.configure(text=text)

    def login(self):
        if self._busy:
            return
        email = self.email.get().strip()
        password = self.password.get()
        self._set_busy(True, "로그인 확인 중")

        def work():
            try:
                self.client.sign_in(email, password)
                members = self.client.list_members()
            except AdminApiError as exc:
                self.after(0, lambda: self._login_failed(str(exc)))
                return
            self.after(0, lambda: self._login_ok(members))
        threading.Thread(target=work, daemon=True).start()

    def _login_failed(self, message):
        self.logged_in = False
        self.password.delete(0, "end")
        self._set_busy(False, "로그인 실패")
        messagebox.showerror("접속 현황", message)

    def _login_ok(self, members):
        self.logged_in = True
        self.password.delete(0, "end")
        self._set_busy(False, f"{len(members)}명 조회")
        self.set_members(members)

    def refresh_members(self):
        if self._busy or not self.logged_in:
            return
        self._set_busy(True, "조회 중")

        def work():
            try:
                members = self.client.list_members()
            except AdminApiError as exc:
                self.after(0, lambda: self._refresh_failed(str(exc)))
                return
            self.after(0, lambda: self._refresh_ok(members))
        threading.Thread(target=work, daemon=True).start()

    def _refresh_failed(self, message):
        self._set_busy(False, "조회 실패")
        messagebox.showerror("접속 현황", message)

    def _refresh_ok(self, members):
        self._set_busy(False, f"{len(members)}명 조회")
        self.set_members(members)

    def set_members(self, members):
        self.members = {str(m.get("user_id", i)): m for i, m in enumerate(members)}
        self.render_members()

    def render_members(self):
        query = self.filter_var.get().strip().lower()
        self.tree.delete(*self.tree.get_children())
        for key, m in self.members.items():
            hay = " ".join(str(m.get(k) or "") for k in (
                "nickname", "email", "member_role", "member_status", "latest_platform", "latest_browser", "latest_page",
            )).lower()
            if query and query not in hay:
                continue
            member_state = f"{m.get('member_role') or '-'} / {m.get('member_status') or '-'}"
            platform = " · ".join(x for x in (str(m.get("latest_platform") or "").strip(), str(m.get("latest_browser") or "").strip()) if x) or "-"
            values = (
                m.get("nickname") or "-", m.get("email") or "-", member_state, format_balance(m.get("balance")), platform,
                recent_activity_label(m.get("latest_device_last_seen_at")), activity_summary(m), format_kst(m.get("latest_device_last_seen_at")),
            )
            self.tree.insert("", "end", iid=key, values=values)

    def on_tree_click(self, event):
        row = self.tree.identify_row(event.y)
        col = self.tree.identify_column(event.x)
        if row and col == self.ACTIVITY_COLUMN:
            m = self.members.get(row)
            if m and len(extract_activities(m)) > 1:
                self.open_activity_list(m)

    def open_selected_detail(self, _event=None):
        selected = self.tree.selection()
        if not selected:
            return
        m = self.members.get(selected[0])
        if not m:
            return
        win = tk.Toplevel(self)
        win.title("접속 상세")
        win.geometry("520x520")
        win.transient(self.winfo_toplevel())
        body = ttk.Frame(win, padding=18)
        body.pack(fill="both", expand=True)
        rows = [
            ("닉네임", m.get("nickname")), ("이메일", m.get("email")), ("권한", m.get("member_role")),
            ("계정 상태", m.get("member_status")), ("잔액", format_balance(m.get("balance"))),
            ("연결 PC", m.get("linked_pc_count")), ("브라우저 기기", m.get("browser_device_count")),
            ("플랫폼", m.get("latest_platform")), ("브라우저", m.get("latest_browser")),
            ("최근 활동", recent_activity_label(m.get("latest_device_last_seen_at"))),
            ("마지막 기록", format_kst(m.get("latest_device_last_seen_at"))), ("활동", activity_summary(m)),
        ]
        for i, (label, value) in enumerate(rows):
            ttk.Label(body, text=label, style="Muted.TLabel").grid(row=i, column=0, sticky="nw", pady=5, padx=(0, 18))
            ttk.Label(body, text=str(value if value not in (None, "") else "-"), wraplength=330).grid(row=i, column=1, sticky="nw", pady=5)
        body.columnconfigure(1, weight=1)
        activities = extract_activities(m)
        if len(activities) > 1:
            ttk.Button(body, text=f"활동 목록 +{len(activities)-1}", command=lambda: self.open_activity_list(m)).grid(row=len(rows), column=1, sticky="w", pady=(14, 0))

    def open_activity_list(self, member):
        acts = extract_activities(member)
        if not acts:
            return
        win = tk.Toplevel(self)
        win.title("활동 목록")
        win.geometry("360x300")
        body = ttk.Frame(win, padding=16)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text=member.get("nickname") or "사용자", style="Title.TLabel").pack(anchor="w", pady=(0, 10))
        for item in acts:
            ttk.Label(body, text=f"• {item}", style="Step.TLabel").pack(anchor="w", pady=4)


class SDAdminCenter(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1320x820")
        self.minsize(1120, 700)
        self.option_add("*Font", ("Malgun Gothic", 11))
        style = ttk.Style(self)
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("Malgun Gothic", 20, "bold"))
        style.configure("Summary.TLabel", font=("Malgun Gothic", 13, "bold"))
        style.configure("Muted.TLabel", foreground="#666666")
        style.configure("Status.TLabel", font=("Malgun Gothic", 10, "bold"))
        style.configure("Step.TLabel", font=("Malgun Gothic", 11))
        style.configure("Chapter.TButton", font=("Malgun Gothic", 12, "bold"), anchor="w")

        shell = ttk.Frame(self)
        shell.pack(fill="both", expand=True)
        sidebar = ttk.Frame(shell, padding=(12, 16))
        sidebar.pack(side="left", fill="y")
        ttk.Label(sidebar, text="SD 관리자 도구", font=("Malgun Gothic", 15, "bold")).pack(anchor="w", pady=(0, 18))
        ttk.Button(sidebar, text="로드맵", command=lambda: self.show("roadmap"), width=18).pack(fill="x", pady=4)
        ttk.Button(sidebar, text="접속 현황", command=lambda: self.show("access"), width=18).pack(fill="x", pady=4)
        ttk.Separator(shell, orient="vertical").pack(side="left", fill="y")
        self.container = ttk.Frame(shell)
        self.container.pack(side="left", fill="both", expand=True)
        self.pages = {"roadmap": RoadmapPage(self.container), "access": AccessPage(self.container)}
        for page in self.pages.values():
            page.place(relx=0, rely=0, relwidth=1, relheight=1)
        self.show("roadmap")

    def show(self, name):
        self.pages[name].tkraise()


if __name__ == "__main__":
    SDAdminCenter().mainloop()
