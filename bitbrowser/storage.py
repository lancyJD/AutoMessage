import random
import sqlite3
from pathlib import Path

from .exceptions import ProxyBindingError, ProxyExhaustedError
from .models import AllocationMode, ProxyBinding, ProxyEndpoint, ProxyRecord


DEFAULT_GROUP = "__ungrouped__"


class Storage:
    def __init__(self, db_path, random_choice=None):
        self.db_path = str(Path(db_path))
        self.random_choice = random_choice or random.choice
        self.initialize()

    def connect(self):
        conn = sqlite3.connect(self.db_path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def initialize(self):
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS proxies (
                    id INTEGER PRIMARY KEY, scheme TEXT NOT NULL, host TEXT NOT NULL,
                    port INTEGER NOT NULL, username TEXT NOT NULL DEFAULT '',
                    password TEXT NOT NULL DEFAULT '', exit_ip TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    UNIQUE(scheme, host, port, username)
                );
                CREATE TABLE IF NOT EXISTS bindings (
                    id INTEGER PRIMARY KEY, group_key TEXT NOT NULL,
                    browser_key TEXT NOT NULL UNIQUE, browser_id TEXT UNIQUE,
                    proxy_id INTEGER NOT NULL REFERENCES proxies(id),
                    exit_ip TEXT NOT NULL, status TEXT NOT NULL
                        CHECK(status IN ('reserved','active','uncertain'))
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ux_binding_group_ip
                    ON bindings(group_key, exit_ip);
            """)

    def add_proxy(self, endpoint: ProxyEndpoint, exit_ip: str) -> int:
        with self.connect() as conn:
            cursor = conn.execute("""INSERT INTO proxies(scheme,host,port,username,password,exit_ip)
                VALUES(?,?,?,?,?,?) ON CONFLICT(scheme,host,port,username)
                DO UPDATE SET password=excluded.password, exit_ip=excluded.exit_ip
                RETURNING id""", (endpoint.scheme, endpoint.host, endpoint.port, endpoint.username, endpoint.password, exit_ip))
            return int(cursor.fetchone()[0])

    @staticmethod
    def _proxy(row):
        return ProxyRecord(row["id"], ProxyEndpoint(row["scheme"], row["host"], row["port"], row["username"], row["password"]), row["exit_ip"], bool(row["enabled"]))

    @staticmethod
    def _binding(row):
        return ProxyBinding(row["id"], row["group_key"], row["browser_key"], row["browser_id"], row["proxy_id"], row["exit_ip"], row["status"])

    def get_proxy(self, proxy_id):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM proxies WHERE id=?", (proxy_id,)).fetchone()
        if row is None:
            raise ProxyBindingError(f"Proxy {proxy_id} does not exist")
        return self._proxy(row)

    def list_proxies(self, enabled_only=False):
        sql = "SELECT * FROM proxies" + (" WHERE enabled=1" if enabled_only else "") + " ORDER BY id"
        with self.connect() as conn:
            return [self._proxy(row) for row in conn.execute(sql)]

    def set_proxy_enabled(self, proxy_id, enabled):
        with self.connect() as conn:
            conn.execute("UPDATE proxies SET enabled=? WHERE id=?", (int(enabled), proxy_id))

    def reserve_proxy(self, group_id, browser_key, mode, proxy_id=None):
        mode = AllocationMode(mode)
        group_key = group_id or DEFAULT_GROUP
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            if mode is AllocationMode.MANUAL:
                if proxy_id is None:
                    raise ProxyBindingError("manual allocation requires proxy_id")
                rows = list(conn.execute("SELECT * FROM proxies WHERE id=? AND enabled=1", (proxy_id,)))
            else:
                rows = list(conn.execute("""SELECT p.* FROM proxies p WHERE p.enabled=1
                    AND NOT EXISTS(SELECT 1 FROM bindings b WHERE b.group_key=? AND b.exit_ip=p.exit_ip)
                    ORDER BY p.id""", (group_key,)))
            if mode is AllocationMode.RANDOM and rows:
                row = self.random_choice(rows)
            else:
                row = rows[0] if rows else None
            if row is None:
                raise ProxyExhaustedError(f"No available proxy for group {group_key}")
            occupied = conn.execute("SELECT 1 FROM bindings WHERE group_key=? AND exit_ip=?", (group_key, row["exit_ip"])).fetchone()
            if occupied:
                raise ProxyExhaustedError(f"Exit IP is already used in group {group_key}")
            cursor = conn.execute("INSERT INTO bindings(group_key,browser_key,proxy_id,exit_ip,status) VALUES(?,?,?,?, 'reserved')", (group_key, browser_key, row["id"], row["exit_ip"]))
            binding_id = cursor.lastrowid
            conn.commit()
            return ProxyBinding(binding_id, group_key, browser_key, None, row["id"], row["exit_ip"], "reserved")
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def confirm_binding(self, browser_key, browser_id):
        with self.connect() as conn:
            conn.execute("UPDATE bindings SET browser_id=?, status='active' WHERE browser_key=?", (browser_id, browser_key))

    def mark_binding_uncertain(self, browser_key):
        with self.connect() as conn:
            conn.execute("UPDATE bindings SET status='uncertain' WHERE browser_key=?", (browser_key,))

    def release_binding(self, browser_ref):
        with self.connect() as conn:
            conn.execute("DELETE FROM bindings WHERE browser_key=? OR browser_id=?", (browser_ref, browser_ref))

    def get_binding(self, browser_ref):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM bindings WHERE browser_key=? OR browser_id=?", (browser_ref, browser_ref)).fetchone()
        if row is None:
            raise ProxyBindingError(f"Browser {browser_ref} has no proxy binding")
        return self._binding(row)

    def ensure_group_available(self, browser_ref, target_group_id):
        binding = self.get_binding(browser_ref)
        target = target_group_id or DEFAULT_GROUP
        with self.connect() as conn:
            occupied = conn.execute(
                "SELECT 1 FROM bindings WHERE group_key=? AND exit_ip=? AND id<>?",
                (target, binding.exit_ip, binding.id),
            ).fetchone()
        if occupied:
            raise ProxyBindingError(f"Exit IP {binding.exit_ip} is already used in group {target}")

    def move_binding(self, browser_ref, target_group_id):
        self.ensure_group_available(browser_ref, target_group_id)
        target = target_group_id or DEFAULT_GROUP
        try:
            with self.connect() as conn:
                conn.execute("UPDATE bindings SET group_key=? WHERE browser_key=? OR browser_id=?", (target, browser_ref, browser_ref))
        except sqlite3.IntegrityError as exc:
            raise ProxyBindingError(f"Exit IP is already used in group {target}") from exc

    def reassign_proxy(self, browser_ref, mode, proxy_id=None):
        mode = AllocationMode(mode)
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            binding = conn.execute("SELECT * FROM bindings WHERE browser_key=? OR browser_id=?", (browser_ref, browser_ref)).fetchone()
            if binding is None:
                raise ProxyBindingError(f"Browser {browser_ref} has no proxy binding")
            if mode is AllocationMode.MANUAL:
                if proxy_id is None:
                    raise ProxyBindingError("manual allocation requires proxy_id")
                rows = list(conn.execute("SELECT * FROM proxies WHERE id=? AND enabled=1", (proxy_id,)))
            else:
                rows = list(conn.execute("""SELECT p.* FROM proxies p WHERE p.enabled=1 AND p.id<>?
                    AND NOT EXISTS(SELECT 1 FROM bindings other WHERE other.group_key=?
                    AND other.exit_ip=p.exit_ip AND other.id<>?) ORDER BY p.id""",
                    (binding["proxy_id"], binding["group_key"], binding["id"])))
            row = self.random_choice(rows) if mode is AllocationMode.RANDOM and rows else (rows[0] if rows else None)
            if row is None:
                raise ProxyExhaustedError(f"No available replacement proxy for group {binding['group_key']}")
            occupied = conn.execute("SELECT 1 FROM bindings WHERE group_key=? AND exit_ip=? AND id<>?", (binding["group_key"], row["exit_ip"], binding["id"])).fetchone()
            if occupied:
                raise ProxyExhaustedError(f"Exit IP is already used in group {binding['group_key']}")
            old_proxy_id = binding["proxy_id"]
            conn.execute("UPDATE bindings SET proxy_id=?, exit_ip=?, status='active' WHERE id=?", (row["id"], row["exit_ip"], binding["id"]))
            conn.commit()
            return old_proxy_id, self._proxy(row)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def restore_proxy(self, browser_ref, proxy_id):
        proxy = self.get_proxy(proxy_id)
        with self.connect() as conn:
            conn.execute("UPDATE bindings SET proxy_id=?, exit_ip=?, status='active' WHERE browser_key=? OR browser_id=?", (proxy.id, proxy.exit_ip, browser_ref, browser_ref))

    def list_bindings(self):
        with self.connect() as conn:
            return [self._binding(row) for row in conn.execute("SELECT * FROM bindings ORDER BY id")]
