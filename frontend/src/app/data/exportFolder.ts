import { request } from "./documents";

type WriteDirectory = FileSystemDirectoryHandle & {
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};

const folderPicker = (window as Window & {
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<WriteDirectory>;
}).showDirectoryPicker;

export const canChooseExportFolder = Boolean(folderPicker);

async function storeRequest<T>(
  mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("documind-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("export-folders");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("export-folders", mode);
      const request = action(transaction.objectStore("export-folders"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const getExportFolder = (email: string) =>
  storeRequest<WriteDirectory | undefined>("readonly", (store) => store.get(email.toLowerCase()));

export async function chooseExportFolder(email: string) {
  if (!folderPicker) return;
  const folder = await folderPicker.call(window, { mode: "readwrite" });
  await storeRequest("readwrite", (store) => store.put(folder, email.toLowerCase()));
  return folder.name;
}

export const clearExportFolder = (email: string) =>
  storeRequest("readwrite", (store) => store.delete(email.toLowerCase()));

export async function exportDocument(email: string, url: string, fileName: string) {
  const folder = canChooseExportFolder ? await getExportFolder(email) : undefined;
  if (folder && await folder.requestPermission({ mode: "readwrite" }) !== "granted") {
    throw new Error("Could not save to the export folder.");
  }
  const response = await request(url);
  if (!response.ok) throw new Error("Export failed (" + response.status + ")");
  const blob = await response.blob();
  if (folder) {
    const handle = await folder.getFileHandle(fileName, { create: true });
    const file = await handle.createWritable();
    await file.write(blob);
    await file.close();
    return true;
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 30000);
  return false;
}

