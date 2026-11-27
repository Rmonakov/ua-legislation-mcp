#!/usr/bin/env node
// Переносить версію з package.json (єдине джерело) у manifest.json.
// Використання:
//   node scripts/sync-version.mjs              — оновити manifest.json
//   node scripts/sync-version.mjs --check      — лише перевірити, що версії збігаються
//   node scripts/sync-version.mjs --expect X.Y.Z — перевірити, що package.json має саме цю версію (тег релізу)
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const pkgFile = new URL('package.json', root);
const manifestFile = new URL('manifest.json', root);

const args = process.argv.slice(2);
const version = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version || '')) {
  console.error(`package.json: некоректна версія «${version}»`);
  process.exit(1);
}

const expectIdx = args.indexOf('--expect');
if (expectIdx >= 0) {
  const expected = String(args[expectIdx + 1] || '').replace(/^v/, '');
  if (expected !== version) {
    console.error(`Тег релізу ${expected} не збігається з версією в package.json (${version}). Оновіть package.json (npm version ${expected}) і зробіть реліз ще раз.`);
    process.exit(1);
  }
}

const text = fs.readFileSync(manifestFile, 'utf8');
const manifest = JSON.parse(text);
if (manifest.version === version) {
  console.log(`manifest.json: версія ${version} — збігається з package.json`);
  process.exit(0);
}
if (args.includes('--check')) {
  console.error(`manifest.json має версію ${manifest.version}, а package.json — ${version}. Запустіть: npm run version:sync`);
  process.exit(1);
}
manifest.version = version;
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest.json: версія ${version}`);
