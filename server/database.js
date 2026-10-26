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
  addColumn('messages', 'edited_at', 'TEXT');
  addColumn('messages', 'edit_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'edit_client_id', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS messages_edit_client_id ON messages(edit_client_id) WHERE edit_client_id IS NOT NULL');
  addColumn('messages', 'message_kind', "TEXT NOT NULL DEFAULT 'chat'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignment_lists (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      allow_member_adds INTEGER NOT NULL DEFAULT 0 CHECK(allow_member_adds IN (0,1)),
      revision INTEGER NOT NULL DEFAULT 0,
      settings_message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS assignment_items (
      id TEXT PRIMARY KEY,
      list_id INTEGER NOT NULL REFERENCES assignment_lists(message_id) ON DELETE CASCADE,
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS assignment_operations (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      list_id INTEGER NOT NULL REFERENCES assignment_lists(message_id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      metadata TEXT NOT NULL,
      UNIQUE(list_id,revision)
    );
    CREATE TABLE IF NOT EXISTS rsvps (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
      canceled INTEGER NOT NULL DEFAULT 0 CHECK(canceled IN (0,1)),
      response_deadline TEXT
    );
    CREATE TABLE IF NOT EXISTS rsvp_responses (
      event_id INTEGER NOT NULL REFERENCES rsvps(message_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY(event_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS polls (
      message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id INTEGER NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      PRIMARY KEY(poll_id,user_id)
    );
  `);
  addColumn('messages', 'ciphertext', 'TEXT');
  addColumn('messages', 'client_id', 'TEXT');
  addColumn('messages', 'encrypted_by', 'TEXT REFERENCES users(id)');
  addColumn('messages', 'e2ee_version', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'recipient_hash', 'TEXT');
  addColumn('files', 'encrypted', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('group_members', 'joined_after', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('group_members', 'join_token', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id ON messages(client_id) WHERE client_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS e2ee_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS e2ee_identities (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL, fingerprint TEXT NOT NULL UNIQUE, backup TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS e2ee_devices (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS e2ee_transfers (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,device_name TEXT NOT NULL,public_key TEXT NOT NULL,
      nonce TEXT NOT NULL,expires_at INTEGER NOT NULL,grant_ciphertext TEXT
    );
    CREATE TABLE IF NOT EXISTS e2ee_recipients (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(message_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS e2ee_legacy_readers (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(message_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS e2ee_plaintext_cleanup (disk_name TEXT PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS e2ee_join_floor AFTER INSERT ON group_members
      WHEN EXISTS(SELECT 1 FROM e2ee_meta WHERE key='active' AND value='1')
      BEGIN
        UPDATE group_members SET
          joined_after=COALESCE((SELECT MAX(id) FROM messages WHERE group_id=NEW.group_id),0),
          last_read=MAX(last_read,COALESCE((SELECT MAX(id) FROM messages WHERE group_id=NEW.group_id),0)),
          join_token=lower(hex(randomblob(16)))
          WHERE group_id=NEW.group_id AND user_id=NEW.user_id;
      END;
  `);
  addColumn('e2ee_identities', 'custody', "TEXT NOT NULL DEFAULT 'self'");
  addColumn('e2ee_identities', 'history_backup', 'TEXT');
  addColumn('messages', 'signer_fingerprint', 'TEXT');
  addColumn('messages', 'self_encrypted', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS e2ee_managed_keys (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, encrypted_key TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS e2ee_key_history (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, public_key TEXT NOT NULL,
      next_fingerprint TEXT NOT NULL, transition_payload TEXT NOT NULL, transition_signature TEXT NOT NULL,
      PRIMARY KEY(user_id,fingerprint)
    );
    UPDATE messages SET signer_fingerprint=(SELECT fingerprint FROM e2ee_identities WHERE user_id=messages.encrypted_by),
      self_encrypted=CASE WHEN client_id LIKE 'legacy-%' THEN 0 ELSE 1 END
      WHERE e2ee_version=1 AND signer_fingerprint IS NULL;
  `);
  addColumn('users','email','TEXT');
  addColumn('users','email_verified_at','INTEGER');
  addColumn('users','pending_email','TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS users_recovery_email ON users(email) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS account_tokens (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('reset','verify')),email TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS account_tokens_user ON account_tokens(user_id,created_at);`);
  addColumn('users', 'bird_id', "TEXT NOT NULL DEFAULT 'blue'");
  // Keep existing profile pictures. New accounts start with a Bluebird avatar.
  addColumn('users', 'avatar_style', "TEXT NOT NULL DEFAULT 'photo'");
  if (!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='avatar_choice')) {
    addColumn('users','avatar_choice',"TEXT NOT NULL DEFAULT 'blue'");
    // Preserve uploaded photos and map legacy bird pictures to independent portraits.
    db.exec("UPDATE users SET avatar_choice=bird_id,avatar_style='portrait' WHERE avatar_style='bird'");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS bird_unlocks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bird_id TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('code','purchase')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(user_id,bird_id)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS invitation_codes (
    code_hash TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE REFERENCES invitations(token_hash) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS nest_invitations (
    id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
    UNIQUE(group_id,recipient_id)
  );
  CREATE INDEX IF NOT EXISTS nest_invitations_recipient ON nest_invitations(recipient_id,status,expires_at);
  CREATE TRIGGER IF NOT EXISTS nest_invitation_joined AFTER INSERT ON group_members BEGIN
    UPDATE nest_invitations SET status='accepted' WHERE group_id=NEW.group_id AND recipient_id=NEW.user_id AND status='pending';
  END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS personal_contacts (
    id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,phone TEXT,linked_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,UNIQUE(owner_id,phone),UNIQUE(owner_id,linked_user_id)
  );
  CREATE TABLE IF NOT EXISTS birdhouses(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS birdhouse_contacts(birdhouse_id TEXT REFERENCES birdhouses(id) ON DELETE CASCADE,contact_id TEXT REFERENCES personal_contacts(id) ON DELETE CASCADE,PRIMARY KEY(birdhouse_id,contact_id));
  CREATE TABLE IF NOT EXISTS private_conversations (
    id TEXT PRIMARY KEY,user_low TEXT NOT NULL REFERENCES users(id),user_high TEXT NOT NULL REFERENCES users(id),
    blocked_low INTEGER NOT NULL DEFAULT 0,blocked_high INTEGER NOT NULL DEFAULT 0,
    read_low INTEGER NOT NULL DEFAULT 0,read_high INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,CHECK(user_low<user_high),UNIQUE(user_low,user_high)
  );
  CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES private_conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,recipient_hash TEXT NOT NULL,
    ciphertext TEXT NOT NULL,signer_fingerprint TEXT NOT NULL,self_encrypted INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(user_id,client_id)
  );
  CREATE INDEX IF NOT EXISTS private_messages_conversation ON private_messages(conversation_id,id);
  CREATE TABLE IF NOT EXISTS private_message_files(message_id INTEGER REFERENCES private_messages(id) ON DELETE CASCADE,file_id TEXT NOT NULL REFERENCES files(id),PRIMARY KEY(message_id,file_id));
  CREATE TABLE IF NOT EXISTS tree_join_requests (
    id TEXT PRIMARY KEY,community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),invited_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined')),
    created_at INTEGER NOT NULL,reviewed_by TEXT REFERENCES users(id),UNIQUE(community_id,user_id)
  );`);
  addColumn('users', 'birth_date', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS family_links (
      id TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES users(id),child_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('pending','active','removed')),created_at INTEGER NOT NULL,confirmed_at INTEGER,
      UNIQUE(parent_id,child_id),CHECK(parent_id<>child_id)
    );
    CREATE INDEX IF NOT EXISTS family_links_child ON family_links(child_id,status);
    CREATE TABLE IF NOT EXISTS family_codes (
      token_hash TEXT PRIMARY KEY,parent_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,claimed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS private_approvals (
      child_id TEXT NOT NULL REFERENCES users(id),adult_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('pending','approved','declined')),requested_by TEXT NOT NULL REFERENCES users(id),
      reviewed_by TEXT REFERENCES users(id),created_at INTEGER NOT NULL,PRIMARY KEY(child_id,adult_id),CHECK(child_id<>adult_id)
    );
    CREATE TABLE IF NOT EXISTS private_message_readers (
      message_id INTEGER NOT NULL REFERENCES private_messages(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(message_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS private_guardian_copies (
      message_id INTEGER NOT NULL REFERENCES private_messages(id) ON DELETE CASCADE,parent_id TEXT NOT NULL REFERENCES users(id),
      ciphertext TEXT NOT NULL,shared_by TEXT NOT NULL REFERENCES users(id),signature TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(message_id,parent_id)
    );
    INSERT OR IGNORE INTO private_message_readers SELECT pm.id,c.user_low FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id;
    INSERT OR IGNORE INTO private_message_readers SELECT pm.id,c.user_high FROM private_messages pm JOIN private_conversations c ON c.id=pm.conversation_id;
  `);
  addColumn('invitations','requires_approval','INTEGER NOT NULL DEFAULT 0');
  db.exec("CREATE TRIGGER IF NOT EXISTS tree_request_joined AFTER INSERT ON community_members BEGIN UPDATE tree_join_requests SET status='approved' WHERE community_id=NEW.community_id AND user_id=NEW.user_id AND status='pending'; END;");
  // Existing Trees stay moderated when member creation is introduced.
  addColumn('communities', 'branch_approval_required', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('communities', 'nest_approval_required', 'INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE TABLE IF NOT EXISTS creation_requests (
    id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('branch','nest')),
    parent_id TEXT REFERENCES subcommunities(id) ON DELETE CASCADE,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, result_id TEXT
  );
  CREATE INDEX IF NOT EXISTS creation_requests_tree ON creation_requests(community_id,status);`);
  addColumn('creation_requests', 'deleted_parent_name', 'TEXT');
  addColumn('creation_requests', 'result_deleted', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE INDEX IF NOT EXISTS circles_community ON groups(community_id);
    CREATE TRIGGER IF NOT EXISTS circle_parent_insert BEFORE INSERT ON groups
    WHEN NEW.subcommunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcommunities WHERE id=NEW.subcommunity_id AND community_id=NEW.community_id)
    BEGIN SELECT RAISE(ABORT,'Circle parent must belong to its Community'); END;
    CREATE TRIGGER IF NOT EXISTS circle_parent_update BEFORE UPDATE OF subcommunity_id,community_id ON groups
    WHEN NEW.subcommunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcommunities WHERE id=NEW.subcommunity_id AND community_id=NEW.community_id)
    BEGIN SELECT RAISE(ABORT,'Circle parent must belong to its Community'); END;`);
  // Seed Group membership once from existing Circle memberships and Group admin roles.
  // Explicitly leaving a Group must remain effective after subsequent restarts.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collection_members'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE collection_members (
        subcommunity_id TEXT NOT NULL REFERENCES subcommunities(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(subcommunity_id,user_id)
      );
      INSERT OR IGNORE INTO collection_members
        SELECT g.subcommunity_id,gm.user_id FROM groups g JOIN group_members gm ON gm.group_id=g.id
        JOIN community_members cm ON cm.community_id=g.community_id AND cm.user_id=gm.user_id
        WHERE g.subcommunity_id IS NOT NULL;
      INSERT OR IGNORE INTO collection_members
        SELECT s.id,a.user_id FROM subcommunities s JOIN scoped_admins a ON a.scope_id=s.id AND a.scope_type='subcommunity'
        JOIN community_members cm ON cm.community_id=s.community_id AND cm.user_id=a.user_id;`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return db;
}
