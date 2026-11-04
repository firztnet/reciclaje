// Base de control de la plataforma (una sola): superadministradores, clientes, su web y la actividad.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Cada migración se aplica una vez, en orden (PRAGMA user_version guarda la última)
const MIGRATIONS = [
  `CREATE TABLE superadmins (
     id             INTEGER PRIMARY KEY,
     name           TEXT NOT NULL,
     email          TEXT NOT NULL UNIQUE,
     password_hash  TEXT NOT NULL,
     active         INTEGER NOT NULL DEFAULT 1,
     created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );
   CREATE TABLE admin_sessions (
     token_hash  TEXT PRIMARY KEY,
     admin_id    INTEGER NOT NULL REFERENCES superadmins(id) ON DELETE CASCADE,
     expires_at  TEXT NOT NULL
   );
   -- Cada cliente es una chatarrería; «slug» es su subdominio y «web» el contenido de su página (JSON)
   CREATE TABLE tenants (
     id                INTEGER PRIMARY KEY,
     slug              TEXT NOT NULL UNIQUE,
     name              TEXT NOT NULL,
     status            TEXT NOT NULL DEFAULT 'prueba' CHECK (status IN ('prueba', 'activo', 'suspendido')),
     trial_ends        TEXT,
     renews_on         TEXT,
     suspended_reason  TEXT NOT NULL DEFAULT '',
     contact_name      TEXT NOT NULL DEFAULT '',
     contact_email     TEXT NOT NULL DEFAULT '',
     contact_phone     TEXT NOT NULL DEFAULT '',
     company_name      TEXT NOT NULL DEFAULT '',
     tax_id            TEXT NOT NULL DEFAULT '',
     notes             TEXT NOT NULL DEFAULT '',
     web               TEXT NOT NULL DEFAULT '{}',
     created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     last_seen_at      TEXT
   );
   -- Visitas a la web de cada cliente, por mes (AAAA-MM)
   CREATE TABLE web_visits (
     tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     month      TEXT NOT NULL,
     n          INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, month)
   );
   CREATE TABLE admin_activity (
     id         INTEGER PRIMARY KEY,
     at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     admin_id   INTEGER REFERENCES superadmins(id),
     tenant_id  INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
     summary    TEXT NOT NULL
   );
   CREATE INDEX idx_admin_activity_at ON admin_activity (at);
   -- Clientes eliminados: se guarda la ficha completa por si hubiera que recuperarla
   CREATE TABLE deleted_tenants (
     id          INTEGER PRIMARY KEY,
     slug        TEXT NOT NULL,
     name        TEXT NOT NULL,
     data        TEXT NOT NULL,
     deleted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );`,

  // 2 · Panel del titular (una cuenta por cliente) y fotos propias de cada cliente
  `CREATE TABLE owners (
     id             INTEGER PRIMARY KEY,
     tenant_id      INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
     name           TEXT NOT NULL,
     email          TEXT NOT NULL,
     password_hash  TEXT NOT NULL,
     must_change    INTEGER NOT NULL DEFAULT 1,
     created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     last_login_at  TEXT
   );
   CREATE TABLE owner_sessions (
     token_hash  TEXT PRIMARY KEY,
     owner_id    INTEGER NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
     expires_at  TEXT NOT NULL
   );
   -- Los archivos van en <datos>/clientes/<subdominio>/fotos/<file>
   CREATE TABLE photos (
     id           INTEGER PRIMARY KEY,
     tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     file         TEXT NOT NULL UNIQUE,
     bytes        INTEGER NOT NULL,
     uploaded_by  TEXT NOT NULL DEFAULT '',
     created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
   );
   CREATE INDEX idx_photos_tenant ON photos (tenant_id, id);`,

  // 3 · Comunicados a todos los clientes (mantenimientos, avisos, novedades)
  `CREATE TABLE announcements (
     id            INTEGER PRIMARY KEY,
     kind          TEXT NOT NULL CHECK (kind IN ('mantenimiento', 'aviso', 'novedad')),
     title         TEXT NOT NULL,
     body          TEXT NOT NULL DEFAULT '',
     starts_at     TEXT,
     ends_at       TEXT NOT NULL,
     show_on_web   INTEGER NOT NULL DEFAULT 0,
     created_by    INTEGER REFERENCES superadmins(id),
     created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     cancelled_at  TEXT
   );
   CREATE INDEX idx_announcements_ends ON announcements (ends_at);`,

  // 4 · Los comunicados se mandan por WhatsApp: a quién se ha enviado ya cada uno
  // (la columna show_on_web de la migración 3 ya no se usa)
  `CREATE TABLE announcement_sends (
     announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
     tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     sent_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
     PRIMARY KEY (announcement_id, tenant_id)
   );`,
];

export function openControl(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'plataforma.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const done = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = done; i < MIGRATIONS.length; i++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
