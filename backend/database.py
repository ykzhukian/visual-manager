"""SQLite database for Visual Manager persistence.

Stores photo paths, descriptions, and user-managed categories.
Database file: backend/visual_manager.db (auto-created on first use).
"""

import sqlite3
from pathlib import Path

_db_path: str | None = None


def _connect() -> sqlite3.Connection:
    """Open a connection to the database."""
    conn = sqlite3.connect(_db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str | None = None) -> None:
    """Initialize the database, creating tables if they don't exist."""
    global _db_path
    if db_path is None:
        db_path = str(Path(__file__).resolve().parent / "visual_manager.db")
    _db_path = db_path

    conn = _connect()
    try:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS photos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            path        TEXT UNIQUE NOT NULL,
            added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS descriptions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            description TEXT NOT NULL,
            status      TEXT DEFAULT 'ok',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS categories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT UNIQUE NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS photo_categories (
            photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (photo_id, category_id)
        );

        CREATE INDEX IF NOT EXISTS idx_desc_photo_id ON descriptions(photo_id);
        CREATE INDEX IF NOT EXISTS idx_pc_photo_id ON photo_categories(photo_id);
        CREATE INDEX IF NOT EXISTS idx_pc_category_id ON photo_categories(category_id);
        """)
        conn.commit()
        print(f"[database] Initialized at {_db_path}")
    finally:
        conn.close()


# ======================================================================
# Photo management
# ======================================================================

def add_photos(paths: list[str]) -> int:
    """Add photo paths. Duplicates ignored. Returns count of newly inserted."""
    conn = _connect()
    try:
        added = 0
        for p in paths:
            try:
                conn.execute("INSERT OR IGNORE INTO photos (path) VALUES (?)", (p,))
                if conn.changes > 0:
                    added += 1
            except Exception:
                pass
        conn.commit()
        return added
    finally:
        conn.close()


def remove_photo(path: str) -> bool:
    """Remove a photo by path. Cascade deletes descriptions + category links."""
    conn = _connect()
    try:
        cursor = conn.execute("DELETE FROM photos WHERE path = ?", (path,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted
    finally:
        conn.close()


# ======================================================================
# Categories
# ======================================================================

def get_categories() -> list[dict]:
    """Return all categories with photo counts."""
    conn = _connect()
    try:
        rows = conn.execute("""
            SELECT c.id, c.name, c.created_at,
                   COUNT(pc.photo_id) AS photo_count
            FROM categories c
            LEFT JOIN photo_categories pc ON pc.category_id = c.id
            GROUP BY c.id
            ORDER BY c.name
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_category(name: str) -> dict | None:
    """Create a new category. Returns {id, name} or None if duplicate."""
    conn = _connect()
    try:
        cursor = conn.execute("INSERT INTO categories (name) VALUES (?)", (name,))
        conn.commit()
        return {"id": cursor.lastrowid, "name": name}
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def rename_category(category_id: int, name: str) -> bool:
    """Rename a category. Returns True on success."""
    conn = _connect()
    try:
        conn.execute("UPDATE categories SET name = ? WHERE id = ?", (name, category_id))
        conn.commit()
        return conn.total_changes > 0
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def delete_category(category_id: int) -> bool:
    """Delete a category. Cascade removes photo-category links."""
    conn = _connect()
    try:
        cursor = conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        return deleted
    finally:
        conn.close()


# ======================================================================
# Photo-category assignment
# ======================================================================

def categorize_photos(paths: list[str], category_ids: list[int]) -> int:
    """Assign categories to photos. Returns number of links created."""
    conn = _connect()
    try:
        added = 0
        for p in paths:
            photo = conn.execute("SELECT id FROM photos WHERE path = ?", (p,)).fetchone()
            if photo is None:
                continue
            for cid in category_ids:
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO photo_categories (photo_id, category_id) VALUES (?, ?)",
                        (photo["id"], cid),
                    )
                    if conn.changes > 0:
                        added += 1
                except Exception:
                    pass
        conn.commit()
        return added
    finally:
        conn.close()


def uncategorize_photos(paths: list[str], category_ids: list[int]) -> int:
    """Remove categories from photos. Returns number of links removed."""
    conn = _connect()
    try:
        removed = 0
        for p in paths:
            photo = conn.execute("SELECT id FROM photos WHERE path = ?", (p,)).fetchone()
            if photo is None:
                continue
            for cid in category_ids:
                cursor = conn.execute(
                    "DELETE FROM photo_categories WHERE photo_id = ? AND category_id = ?",
                    (photo["id"], cid),
                )
                removed += cursor.rowcount
        conn.commit()
        return removed
    finally:
        conn.close()


# ======================================================================
# Queries
# ======================================================================

def get_all_photos(category_id: int | None = None, query: str | None = None) -> list[dict]:
    """Return photos with latest description and assigned categories.

    Args:
        category_id: If set, only return photos in this category.
        query: If set, filter by description or category name (case-insensitive).

    Returns list of dicts:
        {"path": ..., "description": ..., "categories": [{"id": ..., "name": ...}, ...]}
    """
    conn = _connect()
    try:
        sql = "SELECT id, path, added_at FROM photos"
        params: list = []
        conditions: list[str] = []

        if category_id is not None:
            conditions.append("id IN (SELECT photo_id FROM photo_categories WHERE category_id = ?)")
            params.append(category_id)

        if query and query.strip():
            q = f"%{query.strip()}%"
            conditions.append(
                "("
                "  id IN (SELECT photo_id FROM descriptions WHERE description LIKE ?)"
                "  OR id IN ("
                "    SELECT pc.photo_id FROM photo_categories pc"
                "    JOIN categories c ON c.id = pc.category_id"
                "    WHERE c.name LIKE ?"
                "  )"
                ")"
            )
            params.extend([q, q])

        if conditions:
            sql += " WHERE " + " AND ".join(conditions)

        sql += " ORDER BY added_at DESC"

        photos = conn.execute(sql, params).fetchall()

        results = []
        for photo in photos:
            pid = photo["id"]

            desc_row = conn.execute(
                "SELECT description, status FROM descriptions "
                "WHERE photo_id = ? ORDER BY created_at DESC LIMIT 1",
                (pid,),
            ).fetchone()

            cat_rows = conn.execute(
                "SELECT c.id, c.name FROM categories c "
                "JOIN photo_categories pc ON pc.category_id = c.id "
                "WHERE pc.photo_id = ? ORDER BY c.name",
                (pid,),
            ).fetchall()

            results.append({
                "path": photo["path"],
                "description": desc_row["description"] if desc_row else None,
                "descriptionStatus": desc_row["status"] if desc_row else None,
                "categories": [{"id": r["id"], "name": r["name"]} for r in cat_rows],
            })

        return results
    finally:
        conn.close()


# ======================================================================
# Save results
# ======================================================================

def save_descriptions(results: list[dict]) -> None:
    """Save BLIP description results. Latest wins on query."""
    conn = _connect()
    try:
        for r in results:
            photo = conn.execute(
                "SELECT id FROM photos WHERE path = ?", (r["path"],)
            ).fetchone()
            if photo is None:
                continue
            conn.execute(
                "INSERT INTO descriptions (photo_id, description, status) VALUES (?, ?, ?)",
                (photo["id"], r.get("description", ""), r.get("status", "ok")),
            )
        conn.commit()
    finally:
        conn.close()
