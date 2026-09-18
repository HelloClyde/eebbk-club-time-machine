"""Local Python API and static server for the EEBBK forum time machine."""
from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import sqlite3
from datetime import datetime
from functools import lru_cache
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "data" / "forum.db"
DEFAULT_ARCHIVE = Path(r"D:\Downloads\步步高官方论坛帖子")
DIST_DIR = APP_DIR / "dist"
NUXT_RE = re.compile(r"window\.__NUXT__=(.*?);</script>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
UPLOAD_RE = re.compile(
    r"\[upload=(?P<kind>[^,\]]+),(?P<name>[^\]]+)\](?P<path>.*?)\[/upload\]",
    re.I | re.S,
)


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def clean_message(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    value = re.sub(r"</(?:p|div|li)>", "\n", value, flags=re.I)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(TAG_RE.sub("", value))).strip()


def safe_url(value: str, *, image: bool = False) -> str:
    value = html.unescape(value or "").strip()
    if image and value == "/rar.png":
        return value
    if value.startswith(("http://", "https://")):
        return value
    if image and value.startswith("data:image/"):
        return value
    if value.startswith(("javascript:", "data:", "vbscript:")):
        return ""
    return "https://club.eebbk.com/bbkbbs/" + value.lstrip("/") if value else ""


class SafeMessageParser(HTMLParser):
    allowed = {"p", "div", "span", "br", "b", "strong", "i", "em", "u", "s", "blockquote", "ul", "ol", "li", "font", "a", "img", "hr"}
    void = {"br", "img", "hr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "iframe", "object"}:
            self.skip += 1
            return
        if self.skip or tag not in self.allowed:
            return
        values = {key.lower(): value or "" for key, value in attrs}
        safe_attrs: list[tuple[str, str]] = []
        if values.get("align", "").lower() in {"left", "center", "right", "justify"}:
            safe_attrs.append(("align", values["align"].lower()))
        if values.get("class") in {"legacy-attachment", "attachment-heading", "attachment-file", "archive-file-icon"}:
            safe_attrs.append(("class", values["class"]))
        if tag == "img":
            source = safe_url(values.get("src", ""), image=True)
            if not source:
                return
            safe_attrs.extend([("src", source), ("alt", values.get("alt", "帖子图片")), ("loading", "lazy"), ("referrerpolicy", "no-referrer")])
        elif tag == "a":
            target = safe_url(values.get("href", ""))
            if target:
                safe_attrs.extend([("href", target), ("target", "_blank"), ("rel", "noreferrer")])
        elif tag == "font":
            color = values.get("color", "")
            if re.fullmatch(r"#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}", color):
                safe_attrs.append(("color", color))
            if values.get("size", "").isdigit():
                safe_attrs.append(("size", values["size"][:1]))
        rendered = "".join(f' {key}="{html.escape(value, quote=True)}"' for key, value in safe_attrs)
        self.parts.append(f"<{tag}{rendered}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "iframe", "object"}:
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in self.allowed and tag not in self.void:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(html.escape(html.unescape(html.unescape(data))))


def sanitize_message(value: str) -> str:
    parser = SafeMessageParser()
    parser.feed(render_ubb(value or ""))
    parser.close()
    return "".join(parser.parts).strip()


def render_ubb(value: str) -> str:
    # Convert legacy Dvbbs UBB before the HTML allowlist is applied.
    value = re.sub(r"\[align=(left|right|center|justify)\]", r'<div align="\1">', value, flags=re.I)
    value = re.sub(r"\[/align\]", "</div>", value, flags=re.I)
    value = re.sub(r"\[color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})\]", r'<font color="\1">', value, flags=re.I)
    value = re.sub(r"\[/color\]", "</font>", value, flags=re.I)
    value = re.sub(r"\[size=([1-7])\]", r'<font size="\1">', value, flags=re.I)
    value = re.sub(r"\[/size\]", "</font>", value, flags=re.I)
    for tag, target in {"b": "b", "i": "i", "u": "u", "quote": "blockquote"}.items():
        value = re.sub(r"\[" + tag + r"\]", f"<{target}>", value, flags=re.I)
        value = re.sub(r"\[/" + tag + r"\]", f"</{target}>", value, flags=re.I)
    value = re.sub(r"\[img\](.*?)\[/img\]", lambda m: '<img src="' + html.escape(safe_url(m[1], image=True), quote=True) + '">', value, flags=re.I | re.S)
    return value


def extract_attachments(value: str) -> tuple[str, list[dict]]:
    attachments = []
    def replace(match):
        path = html.unescape(match.group("path")).strip()
        name = html.unescape(match.group("name")).strip() or Path(path).name
        kind = match.group("kind").strip().upper()
        url = path if path.startswith(("http://", "https://")) else "https://club.eebbk.com/bbkbbs/" + path.lstrip("/")
        attachments.append({"name": name, "kind": kind, "url": url})
        escaped_url = html.escape(safe_url(url), quote=True)
        escaped_name = html.escape(name)
        if kind in {"BMP", "PNG", "JPG", "JPEG", "GIF", "WEBP"}:
            return f'<img src="{escaped_url}" alt="{escaped_name}">'
        return ('<div class="legacy-attachment"><div class="attachment-heading">'
                '<b>下载信息</b> [文件大小：未收录　下载次数：未收录]</div>'
                f'<div class="attachment-file"><a href="{escaped_url}">'
                '<img class="archive-file-icon" src="/rar.png" alt="压缩包">'
                f'点击浏览该文件:{escaped_name}</a></div></div>')
    return UPLOAD_RE.sub(replace, value or ""), attachments


def clean_signature(value: str) -> str:
    signature = clean_message(value or "")
    if re.fullmatch(r"[A-Za-z0-9_-]{18,32}", signature):
        return ""
    return signature


@lru_cache(maxsize=1)
def historical_profiles() -> dict:
    profiles = {}
    folder = APP_DIR.parent / 'eebbk_archive_threads' / 'html'
    for path in sorted(folder.glob('*.html')):
        source = path.read_text('gb18030', errors='replace')
        for block in re.split(r'<table[^>]*class="bbslist border0"', source)[1:]:
            user = re.search(r'class="username".*?<b>(.*?)</b>', block, re.S)
            if not user:
                continue
            fields = {}
            for key, label in [('rank', '等级'), ('posts', '帖子'), ('points', '积分'), ('coins', 'G 币'), ('essence', '精华'), ('registered', '注册')]:
                match = re.search(re.escape(label) + r'：(.*?)</span>', block, re.S)
                if match:
                    fields[key] = clean_message(match[1])
            if fields.get('rank'):
                fields['snapshot'] = path.name[:8]
                profiles[clean_message(user[1])] = fields
    return profiles


def parse_archive(path: str) -> dict:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8", errors="ignore")
    match = NUXT_RE.search(source)
    if not match:
        return {"replies": [], "body": ""}
    data = json.loads(match.group(1))["data"][0]
    replies = []
    for item in data.get("postsVOList") or []:
        user = item.get("postLeftUserInfo") or {}
        created = item.get("createTime")
        raw_message, attachments = extract_attachments(item.get("message") or "")
        avatar_url = user.get("avatarUrl") or ""
        replies.append({
            "pid": item.get("pid"),
            "author": user.get("nickName") or "",
            "user_group": user.get("userGroupTitle") or "",
            "historical_profile": historical_profiles().get(user.get("nickName") or "", {}),
            "avatar_url": avatar_url,
            "is_default_avatar": avatar_url.endswith("/img/club/bbkbbs/1/head.gif"),
            "created_at": datetime.fromtimestamp(created / 1000).isoformat(timespec="minutes") if created else "",
            "message": clean_message(raw_message),
            "message_html": sanitize_message(raw_message),
            "attachments": attachments,
            "signature": clean_signature(user.get("privateSign") or ""),
        })
    return {"replies": replies, "body": replies[0]["message"] if replies else ""}


def safe_highlight(value: str, query: str) -> str:
    escaped = html.escape(value)
    if not query:
        return escaped
    terms = [re.escape(html.escape(part)) for part in query.split() if part]
    if not terms:
        return escaped
    return re.sub("(" + "|".join(terms) + ")", r"<mark>\1</mark>", escaped, flags=re.I)


class Handler(BaseHTTPRequestHandler):
    server_version = "EEBBKTimeMachine/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def json_response(self, payload: object, status: int = 200) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        try:
            if parsed.path == "/api/stats":
                return self.get_stats()
            if parsed.path == "/api/boards":
                return self.get_boards()
            if parsed.path == "/api/posts":
                return self.get_posts(parse_qs(parsed.query))
            match = re.fullmatch(r"/api/posts/(\d+)", parsed.path)
            if match:
                return self.get_post(int(match.group(1)))
            original = re.fullmatch(r"/api/posts/(\d+)/original", parsed.path)
            if original:
                return self.get_original(int(original.group(1)))
            return self.serve_static(parsed.path)
        except FileNotFoundError:
            self.json_response({"error": "找不到对应的本地存档"}, 404)
        except (sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
            self.json_response({"error": f"读取存档失败：{exc}"}, 500)

    def get_stats(self) -> None:
        with connect() as db:
            row = db.execute("""SELECT count(*) total_posts, sum(body_indexed) body_indexed,
                min(CASE WHEN publish_time >= '2000' THEN substr(publish_time,1,4) END) year_min,
                max(CASE WHEN publish_time >= '2000' THEN substr(publish_time,1,4) END) year_max
                FROM posts""").fetchone()
            self.json_response(dict(row))

    def get_boards(self) -> None:
        with connect() as db:
            rows = db.execute("SELECT board, count(*) count FROM posts GROUP BY board ORDER BY count(*) DESC").fetchall()
            self.json_response({"items": [dict(row) for row in rows]})

    def get_posts(self, params: dict[str, list[str]]) -> None:
        query = (params.get("q") or [""])[0].strip()[:100]
        board = (params.get("board") or [""])[0].strip()[:100]
        year = (params.get("year") or [""])[0].strip()[:4]
        page = max(1, int((params.get("page") or ["1"])[0]))
        page_size = min(60, max(10, int((params.get("page_size") or ["30"])[0])))
        where, args = [], []
        join = ""
        if query:
            if len(query) >= 3:
                join = "JOIN posts_fts ON posts_fts.rowid = posts.id"
                where.append("posts_fts MATCH ?")
                args.append('"' + query.replace('"', '""') + '"')
            else:
                where.append("(posts.title LIKE ? OR posts.author LIKE ? OR posts.body LIKE ?)")
                args.extend([f"%{query}%"] * 3)
        if board:
            where.append("posts.board = ?"); args.append(board)
        if year:
            where.append("posts.publish_time >= ? AND posts.publish_time < ?"); args.extend([f"{year}-01-01", f"{int(year)+1}-01-01"])
        clause = "WHERE " + " AND ".join(where) if where else ""
        with connect() as db:
            total = db.execute(f"SELECT count(*) FROM posts {join} {clause}", args).fetchone()[0]
            rows = db.execute(f"SELECT posts.id, posts.post_id, posts.title, posts.author, posts.publish_time, posts.board FROM posts {join} {clause} ORDER BY posts.publish_time DESC, posts.id DESC LIMIT ? OFFSET ?", [*args, page_size, (page - 1) * page_size]).fetchall()
            items = [dict(row) for row in rows]
            for item in items:
                item["title_highlight"] = safe_highlight(item["title"], query)
            self.json_response({"items": items, "total": total, "page": page, "page_size": page_size})

    def get_post(self, row_id: int) -> None:
        with connect() as db:
            row = db.execute("SELECT * FROM posts WHERE id = ?", (row_id,)).fetchone()
        if not row:
            return self.json_response({"error": "帖子不存在"}, 404)
        result = dict(row)
        parsed = parse_archive(result["local_html_path"])
        result["replies_list"] = parsed["replies"]
        result["body"] = parsed["body"] or result.get("body", "")
        self.json_response(result)

    def get_original(self, row_id: int) -> None:
        with connect() as db:
            row = db.execute("SELECT local_html_path FROM posts WHERE id = ?", (row_id,)).fetchone()
        if not row:
            return self.json_response({"error": "帖子不存在"}, 404)
        path = Path(row[0]).resolve()
        archive = Path(os.environ.get("EEBBK_ARCHIVE", DEFAULT_ARCHIVE)).resolve()
        if archive not in path.parents or not path.is_file():
            raise FileNotFoundError(path)
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Security-Policy", "default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline' http: https:")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def serve_static(self, request_path: str) -> None:
        target = DIST_DIR / unquote(request_path).lstrip("/")
        if request_path == "/" or not target.is_file():
            target = DIST_DIR / "index.html"
        if not target.is_file():
            return self.json_response({"error": "前端尚未构建，请先运行 npm run build"}, 503)
        content = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    parser = argparse.ArgumentParser(description="步步高论坛时光机服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    if not DB_PATH.is_file():
        raise SystemExit("索引不存在，请先运行：python build_index.py")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"步步高论坛时光机：http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
