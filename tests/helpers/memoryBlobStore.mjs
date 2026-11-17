export class MemoryBlobStore {
  constructor(entries = {}, pageSize = 2) {
    this.entries = new Map();
    this.revision = 0;
    this.pageSize = pageSize;
    this.writes = 0;
    this.deletes = [];
    for (const [key, data] of Object.entries(entries)) this.putText(key, JSON.stringify(data));
  }

  putText(key, data) {
    this.revision += 1;
    this.entries.set(key, { data, etag: String(this.revision) });
  }

  async getWithMetadata(key, { type } = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (type !== "text" && type !== "json") throw new Error("Unsupported fixture read type");
    return {
      data: type === "json" ? JSON.parse(entry.data) : entry.data,
      etag: entry.etag,
      metadata: {}
    };
  }

  async setJSON(key, data, options = {}) {
    const entry = this.entries.get(key);
    if ((options.onlyIfNew && entry) ||
        (options.onlyIfMatch !== undefined && entry?.etag !== options.onlyIfMatch)) {
      return { modified: false };
    }
    this.putText(key, JSON.stringify(data));
    this.writes += 1;
    return { modified: true, etag: this.entries.get(key).etag };
  }

  async delete(key) {
    this.entries.delete(key);
    this.deletes.push(key);
  }

  async *list({ paginate } = {}) {
    if (paginate !== true) throw new Error("Fixture expects paginated listing");
    const blobs = [...this.entries].sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => ({ key, etag: entry.etag }));
    for (let offset = 0; offset < blobs.length; offset += this.pageSize) {
      yield { blobs: blobs.slice(offset, offset + this.pageSize), directories: [] };
    }
  }
}
