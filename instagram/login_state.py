import sqlite3
from pathlib import Path


class LoginState:
    def __init__(self, path):
        self.path = Path(path)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS instagram_logins (username TEXT PRIMARY KEY, browser_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")

    def get(self, username):
        with sqlite3.connect(self.path) as db:
            return db.execute("SELECT browser_id, status FROM instagram_logins WHERE username=?", (username,)).fetchone()

    def save(self, username, browser_id, status):
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO instagram_logins(username,browser_id,status) VALUES(?,?,?) ON CONFLICT(username) DO UPDATE SET browser_id=excluded.browser_id,status=excluded.status,updated_at=CURRENT_TIMESTAMP", (username, browser_id, status))
