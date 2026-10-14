import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Maintenance only: production build never runs Git or fetches shared code.
export function syncSharedSnapshot({ source, ref, target }) {
  source = path.resolve(source);
  target = path.resolve(target);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { maxBuffer: 16 * 1024 ** 2 });
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`).toString().trim();
  const tree = git('rev-parse', `${commit}:apps/shared`).toString().trim();
  const sha256 = data => createHash('sha256').update(data).digest('hex');
  const resolveTarget = relative => {
    const resolved = path.resolve(target, relative);
    const within = path.relative(target, resolved);
    if (!within || within.startsWith('..') || path.isAbsolute(within)) throw new Error(`Invalid snapshot path: ${relative}`);
    return resolved;
  };
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Snapshot directory must not be a symlink');
  const manifestPath = resolveTarget('UPSTREAM.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (previous) {
    for (const [relative, hash] of Object.entries(previous.files)) {
      const file = resolveTarget(relative);
      if (!existsSync(file) || sha256(readFileSync(file)) !== hash) {
        throw new Error(`Local snapshot changed: ${relative}. Preserve or reconcile it before refreshing.`);
      }
    }
  }
  const files = new Map();
  const names = git('ls-tree', '-r', '--name-only', commit, '--', 'apps/shared/src').toString().trim().split('\n');
  for (const name of names) {
    if (!name.endsWith('.ts') && !name.endsWith('.json')) continue;
    if (/\.test(?:-d)?\.ts$/.test(name)) continue;
    const relative = name.slice('apps/shared/'.length);
    files.set(relative, git('show', `${commit}:${name}`));
  }
  files.set('package.json', git('show', `${commit}:apps/shared/package.json`));
  files.set('LICENSE', git('show', `${commit}:LICENSE`));
  if (!files.has('src/index.ts')) throw new Error('Source revision has no shared package entry point');
  // All source objects and current hashes are validated before changing the snapshot.
  for (const [relative, data] of files) {
    const file = resolveTarget(relative);
    if (existsSync(file) && readFileSync(file).equals(data)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  for (const relative of Object.keys(previous?.files ?? {})) {
    if (!files.has(relative)) unlinkSync(resolveTarget(relative));
  }
  const provenance = {
    repository: 'https://github.com/NousResearch/hermes-agent',
    commit, tree, sourcePath: 'apps/shared',
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, sha256(data)])),
  };
  const manifest = JSON.stringify(provenance, null, 2) + '\n';
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifest) writeFileSync(manifestPath, manifest);
  return { commit, files: files.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, ref: { type: 'string' } } });
  if (!values.source || !values.ref) throw new Error('Usage: pnpm sync:shared --source <Hermes checkout> --ref <commit>');
  const result = syncSharedSnapshot({ source: values.source, ref: values.ref,
    target: fileURLToPath(new URL('../vendor/hermes-shared/', import.meta.url)) });
  console.log(`Shared snapshot: ${result.commit}, ${result.files} files (source bytes preserved)`);
}
