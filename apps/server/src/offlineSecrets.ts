import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

export type OfflineSecretStatus = "stored" | "reading" | "burned" | "expired";

export interface CreateOfflineSecretInput {
  ciphertext: string;
  iv: string;
  aad: string;
  salt: string;
  kdfParams: string;
  unreadTtlMs: number;
  readTtlMs: number;
}

export interface OfflineSecretRow {
  secret_id: string;
  read_token_hash: string;
  ciphertext: string;
  iv: string;
  aad: string;
  salt: string;
  kdf_params: string;
  read_ttl_ms: number;
  created_at: number;
  unread_expire_at: number;
  read_at: number | null;
  read_expire_at: number | null;
  burned_at: number | null;
  status: OfflineSecretStatus;
}

export interface CreatedOfflineSecret {
  secretId: string;
  readToken: string;
  createdAt: number;
  unreadExpireAt: number;
  readTtlMs: number;
}

export interface OfflineSecretMeta {
  secretId: string;
  status: OfflineSecretStatus;
  salt: string;
  kdfParams: string;
  readTtlMs: number;
  createdAt: number;
  unreadExpireAt: number;
  readAt?: number;
  readExpireAt?: number;
  burnedAt?: number;
}

export interface OpenedOfflineSecret extends OfflineSecretMeta {
  ciphertext: string;
  iv: string;
  aad: string;
  readTtlMs: number;
}

interface SqliteAdapter {
  exec(sql: string): void;
  get<T extends Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T | undefined;
  all<T extends Record<string, unknown>>(sql: string, params?: Record<string, unknown>): T[];
  run(sql: string, params?: Record<string, unknown>): void;
}

const safeIdPattern = /^[A-Za-z0-9_-]+$/u;

const nowMs = () => Date.now();

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

const base64UrlToken = (bytes = 24) =>
  randomBytes(bytes).toString("base64url");

const safeCompare = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
};

const sqlString = (value: unknown) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const applyParams = (sql: string, params: Record<string, unknown> = {}) =>
  sql.replace(/@([A-Za-z0-9_]+)/gu, (match, key) => (Object.hasOwn(params, key) ? sqlString(params[key]) : match));

const sqliteCliNull = "__SRNULL__";

const parseSqliteCliRows = (output: string): Array<Record<string, unknown>> => {
  const lines = output.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= 1) return [];

  const headerLine = lines.shift();
  if (!headerLine) return [];

  const headers = headerLine.split("\t");
  return lines.map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => {
        const value = values[index];
        return [header, value === sqliteCliNull || value === undefined ? null : value];
      })
    );
  });
};

class CliSqliteAdapter implements SqliteAdapter {
  constructor(private readonly dbPath: string) {}

  exec(sql: string) {
    this.runRaw(sql);
  }

  get<T extends Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}) {
    return this.all<T>(sql, params)[0] as T | undefined;
  }

  all<T extends Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}) {
    const rowsSql = [
      ".bail on",
      ".headers on",
      ".mode tabs",
      `.nullvalue ${sqliteCliNull}`,
      applyParams(sql, params)
    ].join("\n");
    return parseSqliteCliRows(this.runRaw(rowsSql)) as T[];
  }

  run(sql: string, params: Record<string, unknown> = {}) {
    this.runRaw(applyParams(sql, params));
  }

  private runRaw(sql: string) {
    const result = spawnSync("sqlite3", [this.dbPath], {
      input: sql,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(result.stderr || `sqlite3 exited with ${result.status}`);
    }
    return result.stdout;
  }
}

class NodeSqliteAdapter implements SqliteAdapter {
  private readonly db: {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      get: (...params: unknown[]) => Record<string, unknown> | undefined;
      all: (...params: unknown[]) => Array<Record<string, unknown>>;
      run: (...params: unknown[]) => unknown;
    };
  };

  constructor(dbPath: string, DatabaseSync: new (path: string) => NodeSqliteAdapter["db"]) {
    this.db = new DatabaseSync(dbPath);
  }

  exec(sql: string) {
    this.db.exec(sql);
  }

  get<T extends Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}) {
    return this.db.prepare(applyParams(sql, params)).get() as T | undefined;
  }

  all<T extends Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}) {
    return this.db.prepare(applyParams(sql, params)).all() as T[];
  }

  run(sql: string, params: Record<string, unknown> = {}) {
    this.db.prepare(applyParams(sql, params)).run();
  }
}

const createSqliteAdapter = async (dbPath: string): Promise<SqliteAdapter> => {
  if (process.env.SECRET_ROOM_SQLITE_ADAPTER === "cli") {
    return new CliSqliteAdapter(dbPath);
  }

  try {
    const sqlite = await import("node:sqlite");
    if ("DatabaseSync" in sqlite) {
      return new NodeSqliteAdapter(dbPath, sqlite.DatabaseSync as new (path: string) => NodeSqliteAdapter["db"]);
    }
  } catch {
    // Node 20 on the server has no node:sqlite; fall through to the sqlite3 CLI.
  }
  return new CliSqliteAdapter(dbPath);
};

const toStatus = (value: unknown): OfflineSecretStatus =>
  value === "reading" || value === "burned" || value === "expired" ? value : "stored";

const normalizeRow = (row: Record<string, unknown>): OfflineSecretRow => ({
  secret_id: String(row.secret_id),
  read_token_hash: String(row.read_token_hash),
  ciphertext: String(row.ciphertext),
  iv: String(row.iv),
  aad: String(row.aad),
  salt: String(row.salt),
  kdf_params: String(row.kdf_params),
  read_ttl_ms: Number(row.read_ttl_ms ?? 30000),
  created_at: Number(row.created_at),
  unread_expire_at: Number(row.unread_expire_at),
  read_at: row.read_at === null || row.read_at === undefined ? null : Number(row.read_at),
  read_expire_at: row.read_expire_at === null || row.read_expire_at === undefined ? null : Number(row.read_expire_at),
  burned_at: row.burned_at === null || row.burned_at === undefined ? null : Number(row.burned_at),
  status: toStatus(row.status)
});

const publicMeta = (row: OfflineSecretRow): OfflineSecretMeta => ({
  secretId: row.secret_id,
  status: row.status,
  salt: row.salt,
  kdfParams: row.kdf_params,
  readTtlMs: row.read_ttl_ms,
  createdAt: row.created_at,
  unreadExpireAt: row.unread_expire_at,
  ...(typeof row.read_at === "number" ? { readAt: row.read_at } : {}),
  ...(typeof row.read_expire_at === "number" ? { readExpireAt: row.read_expire_at } : {}),
  ...(typeof row.burned_at === "number" ? { burnedAt: row.burned_at } : {})
});

export class OfflineSecretStore {
  private constructor(private readonly db: SqliteAdapter) {}

  static async open(dbPath: string) {
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });
    const db = await createSqliteAdapter(resolved);
    const store = new OfflineSecretStore(db);
    store.migrate();
    return store;
  }

  create(input: CreateOfflineSecretInput): CreatedOfflineSecret {
    const createdAt = nowMs();
    const secretId = base64UrlToken(18);
    const readToken = base64UrlToken(24);
    const unreadExpireAt = createdAt + input.unreadTtlMs;

    this.db.run(
      `INSERT INTO offline_secrets (
        secret_id, read_token_hash, ciphertext, iv, aad, salt, kdf_params,
        read_ttl_ms, created_at, unread_expire_at, read_at, read_expire_at, burned_at, status
      ) VALUES (
        @secretId, @readTokenHash, @ciphertext, @iv, @aad, @salt, @kdfParams,
        @readTtlMs, @createdAt, @unreadExpireAt, NULL, NULL, NULL, 'stored'
      );`,
      {
        secretId,
        readTokenHash: hashToken(readToken),
        ciphertext: input.ciphertext,
        iv: input.iv,
        aad: input.aad,
        salt: input.salt,
        kdfParams: input.kdfParams,
        readTtlMs: input.readTtlMs,
        createdAt,
        unreadExpireAt
      }
    );

    return {
      secretId,
      readToken,
      createdAt,
      unreadExpireAt,
      readTtlMs: input.readTtlMs
    };
  }

  getMeta(secretId: string): OfflineSecretMeta | undefined {
    const row = this.find(secretId);
    if (!row) return undefined;
    const current = this.expireIfNeeded(row);
    return publicMeta(current);
  }

  openSecret(secretId: string, readToken: string, _requestedReadTtlMs: number): OpenedOfflineSecret | undefined {
    const row = this.find(secretId);
    if (!row) return undefined;
    const current = this.expireIfNeeded(row);
    if (current.status === "expired" || current.status === "burned") return undefined;
    if (!safeCompare(current.read_token_hash, hashToken(readToken))) return undefined;

    const at = nowMs();
    let next = current;
    if (current.status === "stored") {
      next = {
        ...current,
        status: "reading",
        read_at: at,
        read_expire_at: at + current.read_ttl_ms
      };
      this.db.run(
        `UPDATE offline_secrets
         SET status = 'reading', read_at = @readAt, read_expire_at = @readExpireAt
         WHERE secret_id = @secretId AND status = 'stored';`,
        {
          secretId,
          readAt: next.read_at,
          readExpireAt: next.read_expire_at
        }
      );
    }

    if (typeof next.read_expire_at === "number" && next.read_expire_at <= at) {
      this.burn(secretId, at, "expired");
      return undefined;
    }

    return {
      ...publicMeta(next),
      ciphertext: next.ciphertext,
      iv: next.iv,
      aad: next.aad,
      readTtlMs: next.read_ttl_ms
    };
  }

  burn(secretId: string, at = nowMs(), status: "burned" | "expired" = "burned") {
    if (!safeIdPattern.test(secretId)) return;
    this.db.run(
      `UPDATE offline_secrets
       SET ciphertext = '', iv = '', aad = '', burned_at = @burnedAt, status = @status
       WHERE secret_id = @secretId AND status NOT IN ('burned', 'expired');`,
      { secretId, burnedAt: at, status }
    );
  }

  burnWithToken(secretId: string, readToken: string, at = nowMs()) {
    const row = this.find(secretId);
    if (!row) return false;
    const current = this.expireIfNeeded(row, at);
    if (current.status === "expired" || current.status === "burned") return false;
    if (!safeCompare(current.read_token_hash, hashToken(readToken))) return false;
    this.burn(secretId, at, "burned");
    return true;
  }

  cleanupExpired(at = nowMs()) {
    this.db.run(
      `UPDATE offline_secrets
       SET ciphertext = '', iv = '', aad = '', burned_at = @now, status = 'expired'
       WHERE status = 'stored' AND unread_expire_at <= @now;`,
      { now: at }
    );
    this.db.run(
      `UPDATE offline_secrets
       SET ciphertext = '', iv = '', aad = '', burned_at = @now, status = 'expired'
       WHERE status = 'reading' AND read_expire_at IS NOT NULL AND read_expire_at <= @now;`,
      { now: at }
    );
  }

  private migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS offline_secrets (
        secret_id TEXT PRIMARY KEY,
        read_token_hash TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        aad TEXT NOT NULL,
        salt TEXT NOT NULL,
        kdf_params TEXT NOT NULL,
        read_ttl_ms INTEGER NOT NULL DEFAULT 30000,
        created_at INTEGER NOT NULL,
        unread_expire_at INTEGER NOT NULL,
        read_at INTEGER,
        read_expire_at INTEGER,
        burned_at INTEGER,
        status TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_offline_secrets_status_expire
        ON offline_secrets(status, unread_expire_at, read_expire_at);
    `);
    try {
      this.db.exec("ALTER TABLE offline_secrets ADD COLUMN read_ttl_ms INTEGER NOT NULL DEFAULT 30000;");
    } catch {
      // Existing databases already have the column.
    }
  }

  private find(secretId: string) {
    if (!safeIdPattern.test(secretId)) return undefined;
    const row = this.db.get<Record<string, unknown>>(
      "SELECT * FROM offline_secrets WHERE secret_id = @secretId LIMIT 1;",
      { secretId }
    );
    return row ? normalizeRow(row) : undefined;
  }

  private expireIfNeeded(row: OfflineSecretRow, at = nowMs()) {
    const unreadExpired = row.status === "stored" && row.unread_expire_at <= at;
    const readExpired = row.status === "reading" && typeof row.read_expire_at === "number" && row.read_expire_at <= at;
    if (!unreadExpired && !readExpired) return row;
    this.burn(row.secret_id, at, "expired");
    return {
      ...row,
      ciphertext: "",
      iv: "",
      aad: "",
      burned_at: at,
      status: "expired" as const
    };
  }
}

const defaultDataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");

export const resolveOfflineSecretDbPath = () =>
  process.env.OFFLINE_SECRET_DB_PATH ?? resolve(process.env.SECRET_ROOM_DATA_DIR ?? defaultDataDir, "offline-secrets.sqlite");
