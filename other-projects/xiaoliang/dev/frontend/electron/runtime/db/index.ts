import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'
import { runMigrations } from './schema'

let db: Database.Database | null = null

export function getDB() {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'xiaoliang-local-agent.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function closeDB() {
  db?.close()
  db = null
}
