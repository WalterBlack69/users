// Storage abstraction: Netlify Blobs in production / `netlify dev`,
// a plain-folder fallback when LOCAL_DATA_DIR is set (used by the tests).
import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

class FileStore {
  constructor(root) {
    this.root = root;
  }
  file(key) {
    return path.join(this.root, encodeURIComponent(key));
  }
  async get(key, { type } = {}) {
    try {
      const buf = await fs.readFile(this.file(key));
      if (type === "json") return JSON.parse(buf.toString("utf8"));
      if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return buf.toString("utf8");
    } catch {
      return null;
    }
  }
  async set(key, value) {
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(this.file(key), Buffer.from(value));
  }
  async setJSON(key, value) {
    await this.set(key, JSON.stringify(value));
  }
  async delete(key) {
    await fs.rm(this.file(key), { force: true });
  }
  async list({ prefix = "" } = {}) {
    await fs.mkdir(this.root, { recursive: true });
    const names = (await fs.readdir(this.root)).map(decodeURIComponent);
    return { blobs: names.filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

export function openStore(name) {
  if (process.env.LOCAL_DATA_DIR) return new FileStore(path.join(process.env.LOCAL_DATA_DIR, name));
  return getStore({ name, consistency: "strong" });
}
