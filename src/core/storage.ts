const DATABASE = "geometry-processing-lab";
const STORE = "workspaces";
const VERSION = 1;

export interface WorkspaceRecord {
  id: string;
  name: string;
  source: string;
  updatedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const operation = action(transaction.objectStore(STORE));
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  const records = await request<WorkspaceRecord[]>("readonly", (store) => store.getAll());
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getWorkspace(id: string): Promise<WorkspaceRecord | undefined> {
  return request("readonly", (store) => store.get(id));
}

export async function putWorkspace(record: Omit<WorkspaceRecord, "id" | "updatedAt"> & { id?: string }): Promise<WorkspaceRecord> {
  const value: WorkspaceRecord = {
    id: record.id ?? crypto.randomUUID(),
    name: record.name,
    source: record.source,
    updatedAt: new Date().toISOString(),
  };
  await request("readwrite", (store) => store.put(value));
  return value;
}

export async function removeWorkspace(id: string): Promise<void> {
  await request("readwrite", (store) => store.delete(id));
}
