import BetterSqlite3 from 'better-sqlite3'
import { migrations } from './migrations'

/**
 * Manages the KeePic SQLite database connection and schema migrations.
 *
 * The database file lives in the OS application data directory, never inside
 * the shared library folder (which must remain sync-safe).
 *
 * Usage:
 *   const db = new KeePicDatabase(app.getPath('userData') + '/index.db')
 *   db.open()
 *   // use db.db for queries
 *   db.close()
 */
export class KeePicDatabase {
  private _db: BetterSqlite3.Database | null = null
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  open(): void {
    this._db = new BetterSqlite3(this.path)
    this._db.pragma('journal_mode = WAL')
    this._db.pragma('foreign_keys = ON')
    this._db.pragma('busy_timeout = 5000')
    this.runMigrations()
  }

  close(): void {
    this._db?.close()
    this._db = null
  }

  get db(): BetterSqlite3.Database {
    if (!this._db) {
      throw new Error('Database is not open. Call open() first.')
    }
    return this._db
  }

  private runMigrations(): void {
    const db = this.db
    const currentVersion = db.pragma('user_version', { simple: true }) as number

    for (let i = currentVersion; i < migrations.length; i++) {
      db.transaction(() => {
        db.exec(migrations[i])
        db.pragma(`user_version = ${i + 1}`)
      })()
    }
  }
}
