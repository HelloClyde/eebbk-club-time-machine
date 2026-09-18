"""Build a resumable SQLite FTS5 index from the complete EEBBK CSV archive."""
from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import time
from pathlib import Path

from server import DB_PATH, DEFAULT_ARCHIVE, NUXT_RE, clean_message


def schema(db: sqlite3.Connection) -> None:
    db.executescript("""
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      post_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      author_user_id TEXT NOT NULL DEFAULT '',
      publish_time TEXT NOT NULL DEFAULT '',
      board TEXT NOT NULL DEFAULT '',
      online_url TEXT NOT NULL DEFAULT '',
      local_html_path TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      body_indexed INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_post_id_path ON posts(post_id, local_html_path);
    CREATE INDEX IF NOT EXISTS idx_posts_publish_time ON posts(publish_time DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_board_time ON posts(board, publish_time DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      title, author, board, body, content='posts', content_rowid='id', tokenize='trigram'
    );
    """)


def load_metadata(db: sqlite3.Connection, csv_path: Path) -> int:
    if db.execute("SELECT count(*) FROM posts").fetchone()[0]:
        return db.execute("SELECT count(*) FROM posts").fetchone()[0]
    started = time.time()
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        batch = []
        for row in reader:
            batch.append((row["post_id"], row["title"], row["author"], row["author_user_id"], row["publish_time"], row["board"], row["online_url"], row["local_html_path"]))
            if len(batch) == 2000:
                db.executemany("INSERT OR IGNORE INTO posts(post_id,title,author,author_user_id,publish_time,board,online_url,local_html_path) VALUES(?,?,?,?,?,?,?,?)", batch)
                db.commit(); batch.clear()
        if batch:
            db.executemany("INSERT OR IGNORE INTO posts(post_id,title,author,author_user_id,publish_time,board,online_url,local_html_path) VALUES(?,?,?,?,?,?,?,?)", batch)
            db.commit()
    db.execute("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')")
    db.commit()
    count = db.execute("SELECT count(*) FROM posts").fetchone()[0]
    print(f"metadata: {count:,} posts in {time.time()-started:.1f}s", flush=True)
    return count


def first_body(path: str) -> str:
    try:
        source = Path(path).read_text(encoding="utf-8", errors="ignore")
        match = NUXT_RE.search(source)
        if not match:
            return ""
        posts = json.loads(match.group(1))["data"][0].get("postsVOList") or []
        return clean_message(posts[0].get("message") or "") if posts else ""
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return ""


def load_bodies(db: sqlite3.Connection, limit: int | None = None) -> None:
    started = time.time(); done = 0
    query = "SELECT id, local_html_path FROM posts WHERE body_indexed = 0 ORDER BY id"
    if limit:
        query += f" LIMIT {int(limit)}"
    rows = db.execute(query)
    batch = []
    for row_id, path in rows:
        batch.append((first_body(path), row_id))
        if len(batch) == 250:
            db.executemany("UPDATE posts SET body=?, body_indexed=1 WHERE id=?", batch)
            db.commit(); done += len(batch); batch.clear()
            if done % 2500 == 0:
                print(f"bodies: {done:,} this run", flush=True)
    if batch:
        db.executemany("UPDATE posts SET body=?, body_indexed=1 WHERE id=?", batch)
        db.commit(); done += len(batch)
    if done:
        db.execute("INSERT INTO posts_fts(posts_fts) VALUES('rebuild')")
        db.execute("PRAGMA optimize")
        db.commit()
    total = db.execute("SELECT sum(body_indexed) FROM posts").fetchone()[0]
    print(f"body index: {total:,} total ({done:,} this run) in {time.time()-started:.1f}s", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    csv_path = args.archive / "帖子索引.csv"
    if not csv_path.is_file():
        raise SystemExit(f"找不到索引：{csv_path}")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        schema(db)
        load_metadata(db, csv_path)
        if not args.metadata_only:
            load_bodies(db, args.limit)


if __name__ == "__main__":
    main()
