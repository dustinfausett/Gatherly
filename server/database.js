import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password TEXT, google_id TEXT UNIQUE, avatar_id TEXT,
      last_community_id TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      avatar_id TEXT, owner_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS community_members (
      community_id TEXT REFERENCES communities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
      PRIMARY KEY(community_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS subcommunities (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar_id TEXT
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      subcommunity_id TEXT REFERENCES subcommunities(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar_id TEXT,
      private INTEGER NOT NULL DEFAULT 0, admin_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS scoped_admins (
      scope_type TEXT NOT NULL CHECK(scope_type IN ('subcommunity','group')),
      scope_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(scope_type,scope_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE, muted INTEGER NOT NULL DEFAULT 0,
      last_read INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(group_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      token_hash TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL DEFAULT '',
      reply_to INTEGER REFERENCES messages(id), deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS messages_group ON messages(group_id,id);
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, disk_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_files (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      file_id TEXT UNIQUE REFERENCES files(id), PRIMARY KEY(message_id,file_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription TEXT NOT NULL
    );
  `);
  // Keep historical storage names for existing invitations, messages, and clients:
  // subcommunities are Groups; groups are Circles in the product.
  if (!db.prepare('PRAGMA table_info(groups)').all().some(c => c.name === 'community_id')) {
    if (path !== ':memory:' && !existsSync(`${path}.before-circles.bak`)) db.prepare('VACUUM INTO ?').run(`${path}.before-circles.bak`);
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE groups_next (
        id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
        subcommunity_id TEXT REFERENCES subcommunities(id) ON DELETE CASCADE,
        name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar_id TEXT,
        private INTEGER NOT NULL DEFAULT 0, admin_only INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO groups_next SELECT g.id,s.community_id,g.subcommunity_id,g.name,g.description,g.avatar_id,g.private,g.admin_only
        FROM groups g JOIN subcommunities s ON s.id=g.subcommunity_id;
      DROP TABLE groups;
      ALTER TABLE groups_next RENAME TO groups;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Hierarchy migration failed its relationship check.');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.exec('PRAGMA foreign_keys=ON'); }
  }
  const addColumn = (table, name, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn('group_members', 'pin_position', 'INTEGER');
  addColumn('group_members', 'marked_unread', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'urgent', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS circles_community ON groups(community_id);
    CREATE TRIGGER IF NOT EXISTS circle_parent_insert BEFORE INSERT ON groups
    WHEN NEW.subcommunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcommunities WHERE id=NEW.subcommunity_id AND community_id=NEW.community_id)
    BEGIN SELECT RAISE(ABORT,'Circle parent must belong to its Community'); END;
    CREATE TRIGGER IF NOT EXISTS circle_parent_update BEFORE UPDATE OF subcommunity_id,community_id ON groups
    WHEN NEW.subcommunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcommunities WHERE id=NEW.subcommunity_id AND community_id=NEW.community_id)
    BEGIN SELECT RAISE(ABORT,'Circle parent must belong to its Community'); END;`);
  return db;
}
