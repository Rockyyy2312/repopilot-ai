from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass

DB_PATH = os.environ.get("REPOPILOT_AUTH_DB", "/tmp/repopilot-auth.sqlite3")
SESSION_TTL = 60 * 60 * 24 * 7
SESSION_COOKIE = "repopilot_session"
SESSION_SECRET = os.environ.get("REPOPILOT_SESSION_SECRET") or secrets.token_hex(32)


@dataclass(frozen=True)
class User:
    id: str
    email: str


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with _connect() as connection:
        connection.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        """)


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = encoded.split("$", 2)
        if algorithm != "scrypt":
            return False
        candidate = _password_hash(password, bytes.fromhex(salt_hex)).split("$", 2)[2]
        return hmac.compare_digest(candidate, digest_hex)
    except (ValueError, TypeError):
        return False


def create_user(email: str, password: str) -> User:
    user_id = secrets.token_hex(16)
    try:
        with _connect() as connection:
            connection.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (user_id, email, _password_hash(password), int(time.time())))
    except sqlite3.IntegrityError as exc:
        raise ValueError("an account with that email already exists") from exc
    return User(user_id, email)


def authenticate(email: str, password: str) -> User | None:
    with _connect() as connection:
        row = connection.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        return None
    return User(row["id"], row["email"])


def create_session(user_id: str) -> str:
    raw = secrets.token_urlsafe(32)
    token_hash = hmac.new(SESSION_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()
    with _connect() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        connection.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token_hash, user_id, int(time.time()) + SESSION_TTL))
    return raw


def get_user(session_token: str | None) -> User | None:
    if not session_token:
        return None
    token_hash = hmac.new(SESSION_SECRET.encode(), session_token.encode(), hashlib.sha256).hexdigest()
    with _connect() as connection:
        row = connection.execute("SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?", (token_hash, int(time.time()))).fetchone()
    return User(row["id"], row["email"]) if row else None


def delete_session(session_token: str | None) -> None:
    if not session_token:
        return
    token_hash = hmac.new(SESSION_SECRET.encode(), session_token.encode(), hashlib.sha256).hexdigest()
    with _connect() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def reset_db() -> None:
    with _connect() as connection:
        connection.execute("DELETE FROM sessions")
        connection.execute("DELETE FROM users")


init_db()
