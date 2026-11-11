import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { ADMIN_PASSWORD, store } from "../config.js";
import { log } from "@bargames/gamekit/server";

// The admin password is one of two things, checked in this order:
//  1. the ADMIN_PASSWORD env var (always wins if set), or
//  2. a scrypt hash chosen once on the /admin setup screen, kept in
//     DATA_DIR/admin.json. Whoever completes setup first becomes admin -
//     the usual self-hosted bootstrap - so do it right after deploying.

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const FILE = "admin.json";
const KEY_LEN = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

interface HashFile {
  salt: string;
  hash: string;
}

let stored: HashFile | null = null;
const sessions = new Map<string, number>(); // token -> expiry

export async function initAdminAuth(): Promise<void> {
  stored = await store.read<HashFile>(FILE);
}

export function setupNeeded(): boolean {
  return !ADMIN_PASSWORD && !stored;
}

// Async scrypt runs on libuv's threadpool, so a stream of guesses can't
// stall the event loop that runs every game. Failures are also throttled
// per IP.
const fails = new Map<string, number[]>();
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAILS_ALLOWED = 10;

export function loginBlocked(ip: string): boolean {
  const now = Date.now();
  const recent = (fails.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
  fails.set(ip, recent);
  return recent.length >= FAILS_ALLOWED;
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, KEY_LEN);
}

export async function setupPassword(password: string): Promise<string> {
  if (!setupNeeded()) throw new Error("Admin is already set up.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  // Re-check after the await: two setups racing must not both win.
  if (!setupNeeded()) throw new Error("Admin is already set up.");
  stored = { salt: salt.toString("hex"), hash: hash.toString("hex") };
  await store.write(FILE, stored);
  log.info("admin", "admin password set via setup screen");
  return newSession();
}

export async function login(password: string, ip: string): Promise<string | null> {
  let ok = false;
  if (ADMIN_PASSWORD) {
    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_PASSWORD);
    ok = a.length === b.length && timingSafeEqual(a, b);
  } else if (stored) {
    const hash = await hashPassword(password, Buffer.from(stored.salt, "hex"));
    ok = timingSafeEqual(hash, Buffer.from(stored.hash, "hex"));
  }
  if (!ok) {
    const list = fails.get(ip) ?? [];
    list.push(Date.now());
    fails.set(ip, list);
    log.warn("admin", "failed admin login", { ip });
    return null;
  }
  fails.delete(ip);
  log.info("admin", "admin logged in", { ip });
  return newSession();
}

function newSession(): string {
  const token = randomBytes(24).toString("base64url");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function logout(token: string | undefined): void {
  if (token) sessions.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  for (const [ip, list] of fails) if (list.every((t) => now - t >= FAIL_WINDOW_MS)) fails.delete(ip);
}, 10 * 60 * 1000).unref();
