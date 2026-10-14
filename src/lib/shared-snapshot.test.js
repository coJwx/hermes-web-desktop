import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { syncSharedSnapshot } from '../../scripts/sync-hermes-shared.mjs';

const owned = [];
afterEach(() => {
  for (const directory of owned.splice(0)) {
    const resolved = realpathSync(directory);
    const prefix = realpathSync(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(prefix)) throw new Error('Fixture cleanup escaped the temp directory');
    rmSync(resolved, { recursive: true, force: true });
  }
});
function fixture() {
  const source = mkdtempSync(path.join(os.tmpdir(), 'hermes-shared-fixture-')); owned.push(source);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet'); git('config', 'core.autocrlf', 'false'); git('config', 'user.name', 'Snapshot test'); git('config', 'user.email', 'snapshot@example.test');
  const dir = path.join(source, 'apps/shared/src'); mkdirSync(dir, { recursive: true });
  const initial = 'export const version = "committed";\r\n';
  writeFileSync(path.join(dir, 'index.ts'), initial);
  writeFileSync(path.join(dir, 'obsolete.ts'), 'export const old = true;\n');
  writeFileSync(path.join(source, 'apps/shared/package.json'), '{"name":"@hermes/shared","type":"module"}\n');
  writeFileSync(path.join(source, 'LICENSE'), 'Fixture license\n');
  git('add', '.'); git('-c', 'core.autocrlf=false', 'commit', '--quiet', '-m', 'Shared baseline');
  const ref = git('rev-parse', 'HEAD');
  const target = path.join(source, 'snapshot');
  return { source, git, ref, dir, initial, target };
}

it('copies the explicit Git revision and license, records hashes, and refuses to overwrite a modified snapshot', () => {
  const f = fixture();
  writeFileSync(path.join(f.dir, 'index.ts'), 'uncommitted source edit');
  syncSharedSnapshot(f);
  const copied = readFileSync(path.join(f.target, 'src/index.ts'));
  const committed = execFileSync('git', ['-C', f.source, 'show', `${f.ref}:apps/shared/src/index.ts`]);
  expect(copied.equals(committed)).toBe(true);
  expect(readFileSync(path.join(f.target, 'LICENSE'), 'utf8')).toBe('Fixture license\n');
  const manifest = JSON.parse(readFileSync(path.join(f.target, 'UPSTREAM.json'), 'utf8'));
  expect(manifest.commit).toBe(f.ref);
  expect(manifest.files['src/index.ts']).toBe(createHash('sha256').update(committed).digest('hex'));
  writeFileSync(path.join(f.target, 'src/index.ts'), 'local snapshot edit');
  expect(() => syncSharedSnapshot(f)).toThrow('Local snapshot changed');
  expect(readFileSync(path.join(f.target, 'src/index.ts'), 'utf8')).toBe('local snapshot edit');
});

it('refreshes only managed snapshot files when a new revision changes its shared file set', () => {
  const f = fixture(); syncSharedSnapshot(f);
  writeFileSync(path.join(f.target, 'maintainer-note.txt'), 'keep this');
  writeFileSync(path.join(f.dir, 'new.ts'), 'export const added = true;\n');
  writeFileSync(path.join(f.dir, 'new.test.ts'), 'upstream test excluded from runtime snapshot');
  f.git('rm', '--quiet', 'apps/shared/src/obsolete.ts');
  writeFileSync(path.join(f.dir, 'index.ts'), 'export { added } from "./new";\n');
  f.git('add', 'apps/shared'); f.git('commit', '--quiet', '-m', 'Shared update');
  syncSharedSnapshot({ ...f, ref: f.git('rev-parse', 'HEAD') });
  expect(readFileSync(path.join(f.target, 'src/new.ts'), 'utf8')).toContain('added');
  expect(existsSync(path.join(f.target, 'src/new.test.ts'))).toBe(false);
  expect(existsSync(path.join(f.target, 'src/obsolete.ts'))).toBe(false);
  expect(readFileSync(path.join(f.target, 'maintainer-note.txt'), 'utf8')).toBe('keep this');
});
