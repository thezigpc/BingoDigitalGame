import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR } from "../config.js";
import { log } from "../util/logger.js";

/** Reads a JSON file from DATA_DIR, or returns null if it's missing or unreadable. */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("store", "could not read data file", { file: name, err: String(err) });
    }
    return null;
  }
}

/** Atomic write (temp file + rename), so a crash mid-write can't corrupt the file. */
export async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}
