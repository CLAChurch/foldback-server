import { readFileSync, statSync } from 'node:fs';

export function physicalOutputs(path = '/run/foldback-display/outputs.json') {
  try {
    if (statSync(path).size > 65536) return [];
    const outputs = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(outputs) ? outputs.filter(output =>
      typeof output.name === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(output.name) &&
      typeof output.connected === 'boolean').map(({ name, connected }) => ({ name, connected })) : [];
  } catch { return []; }
}
