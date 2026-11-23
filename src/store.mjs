import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { initialState } from './model.mjs';

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.path = join(directory, 'state.json');
    try {
      this.state = JSON.parse(readFileSync(this.path, 'utf8'));
      if (this.state.version !== 1 || !this.state.settings || !this.state.overrides) throw new Error('Unsupported state file');
      chmodSync(this.path, 0o600);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // Never silently replace damaged service data.
      this.state = initialState();
      this.save(this.state);
    }
  }
  save(state) {
    const temporary = `${this.path}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(state, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, this.path);
    const directoryFd = openSync(this.directory, 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    this.state = state;
  }
  update(edit) {
    const next = structuredClone(this.state);
    edit(next);
    this.save(next);
    return next;
  }
}
