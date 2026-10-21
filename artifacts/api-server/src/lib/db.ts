import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// lowdb v1 is CommonJS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const low: any = require("lowdb");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FileSync: any = require("lowdb/adapters/FileSync");

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
  approved: boolean;
  accessGranted: boolean;
  revoked?: boolean;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LowDb = any;

let db: LowDb | null = null;

export function getDb(): LowDb {
  if (!db) {
    const dbPath = path.join(process.cwd(), "db.json");
    const adapter = new FileSync(dbPath);
    db = low(adapter);
    db.defaults({ users: [], allowed_emails: [] }).write();
  }
  return db;
}

export function initDb(): void {
  getDb();
}
