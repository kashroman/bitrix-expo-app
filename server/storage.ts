export interface IStorage {
  health(): Promise<{ ok: true }>;
}

export class MemoryStorage implements IStorage {
  async health(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

export const storage = new MemoryStorage();
