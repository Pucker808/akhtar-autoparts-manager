/**
 * Local folder storage for Akhtar Autos.
 * Uses the browser File System Access API (Chrome / Edge / desktop WebView).
 * Data is still queried via Dexie for speed; the chosen folder holds a full
 * JSON snapshot that is written after each change and can be restored on open.
 */
import { db, DATA_TABLES } from "./db";

const BACKUP_NAME = "akhtar-autos-backup.json";
const HANDLE_META_KEY = "localFolderHandle";
const AUTO_META_KEY = "localFolderAutoSave";
const LAST_META_KEY = "localFolderLastSync";

export type LocalFolderStatus = {
  supported: boolean;
  connected: boolean;
  folderName: string;
  lastSync: string;
  autoSave: boolean;
};

function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

export function localFolderSupported(): boolean {
  return supportsDirectoryPicker();
}

/** Persist a directory handle in IndexedDB meta so it survives reloads. */
async function saveHandle(handle: FileSystemDirectoryHandle | null) {
  if (handle) {
    await db.meta.put({ key: HANDLE_META_KEY, value: handle as unknown as object });
  } else {
    await db.meta.delete(HANDLE_META_KEY);
  }
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const row = await db.meta.get(HANDLE_META_KEY);
  const h = row?.value as FileSystemDirectoryHandle | undefined;
  if (!h || typeof (h as any).getFileHandle !== "function") return null;
  return h;
}

async function ensurePermission(handle: FileSystemDirectoryHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const opts = { mode } as any;
  const anyHandle = handle as any;
  if (typeof anyHandle.queryPermission === "function") {
    let state = await anyHandle.queryPermission(opts);
    if (state === "granted") return true;
    if (typeof anyHandle.requestPermission === "function") {
      state = await anyHandle.requestPermission(opts);
      return state === "granted";
    }
  }
  try {
    await handle.getFileHandle(BACKUP_NAME, { create: true });
    return true;
  } catch {
    return false;
  }
}

export async function pickLocalFolder(): Promise<string> {
  if (!supportsDirectoryPicker()) {
    throw new Error("This browser cannot choose a folder. Use Chrome or Edge on a PC, or the desktop app.");
  }
  const handle = await (window as any).showDirectoryPicker({
    id: "akhtar-autos-data",
    mode: "readwrite",
    startIn: "documents",
  }) as FileSystemDirectoryHandle;
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) throw new Error("Permission to write to the folder was denied.");
  await saveHandle(handle);
  const autoRow = await db.meta.get(AUTO_META_KEY);
  if (autoRow?.value === undefined) {
    await db.meta.put({ key: AUTO_META_KEY, value: true });
  }
  await saveToFolder(handle);
  const now = new Date().toISOString();
  await db.meta.put({ key: LAST_META_KEY, value: now });
  return handle.name || "Selected folder";
}

export async function disconnectLocalFolder() {
  await saveHandle(null);
}

export async function getLocalFolderStatus(): Promise<LocalFolderStatus> {
  const supported = supportsDirectoryPicker();
  const handle = await loadHandle();
  const autoRow = await db.meta.get(AUTO_META_KEY);
  const lastRow = await db.meta.get(LAST_META_KEY);
  let connected = false;
  let folderName = "";
  if (handle) {
    const ok = await ensurePermission(handle, "read");
    connected = ok;
    folderName = handle.name || "Selected folder";
  }
  return {
    supported,
    connected,
    folderName,
    lastSync: String(lastRow?.value || ""),
    autoSave: Boolean(autoRow?.value),
  };
}

export async function setLocalFolderAutoSave(on: boolean) {
  await db.meta.put({ key: AUTO_META_KEY, value: on });
}

async function buildPayload() {
  const data: Record<string, unknown> = {
    app: "Akhtar Autos",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
  };
  for (const name of DATA_TABLES) {
    data[name] = await db.table(name).toArray();
  }
  return data;
}

async function saveToFolder(handle: FileSystemDirectoryHandle) {
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) throw new Error("No write permission for the local folder. Choose the folder again.");
  const payload = await buildPayload();
  const fileHandle = await handle.getFileHandle(BACKUP_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
}

/** Write current database snapshot into the selected folder. */
export async function uploadLocalBackup(): Promise<string> {
  const handle = await loadHandle();
  if (!handle) throw new Error("No local folder selected. Choose a folder first.");
  await saveToFolder(handle);
  const now = new Date().toISOString();
  await db.meta.put({ key: LAST_META_KEY, value: now });
  return now;
}

/** Load snapshot from the selected folder into Dexie (replaces local tables). */
export async function restoreLocalBackup(): Promise<string> {
  const handle = await loadHandle();
  if (!handle) throw new Error("No local folder selected. Choose a folder first.");
  const ok = await ensurePermission(handle, "read");
  if (!ok) throw new Error("No read permission for the local folder. Choose the folder again.");
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await handle.getFileHandle(BACKUP_NAME);
  } catch {
    throw new Error("No " + BACKUP_NAME + " found in the selected folder.");
  }
  const file = await fileHandle.getFile();
  const payload = JSON.parse(await file.text());
  if (payload.app !== "Akhtar Autos" || !payload.formatVersion) {
    throw new Error("Backup file is not a valid Akhtar Autos snapshot.");
  }
  await db.transaction("rw", DATA_TABLES.map((name) => db.table(name)), async () => {
    for (const name of DATA_TABLES) {
      const rows = payload[name];
      if (!Array.isArray(rows)) throw new Error("Backup is missing table: " + name);
      await db.table(name).clear();
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
  const stamp = payload.exportedAt || new Date().toISOString();
  await db.meta.put({ key: LAST_META_KEY, value: stamp });
  return stamp;
}

/** Best-effort auto-save after a successful write. Does not throw. */
export async function tryAutoSaveLocal(): Promise<string | null> {
  try {
    const auto = await db.meta.get(AUTO_META_KEY);
    if (!auto?.value) return null;
    const handle = await loadHandle();
    if (!handle) return null;
    return await uploadLocalBackup();
  } catch {
    return null;
  }
}

/** One-shot download of a JSON backup (works on any browser / phone). */
export async function downloadBackupFile() {
  const payload = await buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = BACKUP_NAME;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import a user-picked JSON file (works on any browser / phone). */
export async function importBackupFile(file: File): Promise<string> {
  const payload = JSON.parse(await file.text());
  if (payload.app !== "Akhtar Autos" || !payload.formatVersion) {
    throw new Error("File is not a valid Akhtar Autos backup.");
  }
  await db.transaction("rw", DATA_TABLES.map((name) => db.table(name)), async () => {
    for (const name of DATA_TABLES) {
      const rows = payload[name];
      if (!Array.isArray(rows)) throw new Error("Backup is missing table: " + name);
      await db.table(name).clear();
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
  return payload.exportedAt || new Date().toISOString();
}
