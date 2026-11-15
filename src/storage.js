import {AppError} from './core/rules.js';
function storageError(error) {
  if (error?.status === 409) return error;
  const message = error?.name === 'QuotaExceededError'
    ? '浏览器存储空间不足。输入仍保留，请导出备份后释放空间再重试。'
    : '无法读写浏览器存储。输入仍保留，请检查浏览器设置，或导出备份后重试。';
  const result = new AppError(message); result.storageFailure = true; return result;
}
export class BrowserStorage {
  constructor(name, factory = globalThis.indexedDB) {
    this.name = name; this.factory = factory; this.db = null; this.opening = null;
  }
  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      let request, done = false;
      const finish = (error, db) => {
        if (done) { db?.close(); return; }
        done = true; clearTimeout(timer); error ? reject(storageError(error)) : resolve(db);
      };
      const timer = setTimeout(() => finish(Error('open timeout')), 5000);
      try {
        request = this.factory.open(this.name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onerror = () => finish(request.error);
        request.onblocked = () => finish(Error('blocked'));
        request.onsuccess = () => {
          const db = request.result;
          if (!done) {
            this.db = db;
            db.onversionchange = () => { db.close(); this.db = null; };
            db.onclose = () => { if (this.db === db) this.db = null; };
          }
          finish(null, db);
        };
      } catch (error) { finish(error); }
    });
    try { return await this.opening; } finally { this.opening = null; }
  }
  async read() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('state', 'readonly'), request = tx.objectStore('state').get('current');
        let result;
        request.onsuccess = () => { result = request.result || null; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(storageError(tx.error));
        tx.onerror = () => {};
      } catch (error) { reject(storageError(error)); }
    });
  }
  async commit(next, expectedRevision) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state');
        let failure;
        const request = store.get('current');
        request.onsuccess = () => {
          if ((request.result?.revision ?? 0) !== expectedRevision) {
            failure = new AppError('另一个标签页已更新存档。当前输入仍保留，请先导出当前输入，再重新读取存档核对。', 409);
            tx.abort(); return;
          }
          store.put(next, 'current');
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(storageError(failure || tx.error));
        tx.onerror = () => {};
      } catch (error) { reject(storageError(error)); }
    });
  }
  close() { this.db?.close(); this.db = null; }
}
