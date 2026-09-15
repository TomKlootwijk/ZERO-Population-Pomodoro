'use strict';
// Package the existing SVG identity and local app into a standalone Windows folder.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Resvg } = require('@resvg/resvg-js');
const ROOT = path.resolve(__dirname, '..');

async function main() {
  if (process.platform !== 'win32') throw new Error('Build this Windows package on Windows.');
  execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
  const runtime = path.dirname(require('electron'));
  const output = path.join(ROOT, 'dist', `ZERO-win32-${process.arch}`);
  const assets = path.join(ROOT, 'build');
  await fs.mkdir(assets, { recursive: true });
  const svg = await fs.readFile(path.join(ROOT, 'web/icon.svg'), 'utf8');
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngs = sizes.map(width => new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
  await fs.writeFile(path.join(assets, 'icon.png'), pngs[4]);
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(pngs[i].length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
    offset += pngs[i].length;
  });
  await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([directory, ...pngs]));
  await fs.mkdir(output, { recursive: true });
  await fs.cp(runtime, output, { recursive: true });
  const exe = path.join(output, 'ZERO.exe');
  await fs.copyFile(path.join(output, 'electron.exe'), exe);
  await fs.unlink(path.join(output, 'electron.exe'));
  await fs.unlink(path.join(output, 'resources/default_app.asar')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const appRoot = path.join(output, 'resources/app');
  await fs.mkdir(appRoot, { recursive: true });
  for (const name of ['index.html', 'web', 'desktop', 'data', 'build', 'LICENSE']) {
    await fs.cp(path.join(ROOT, name), path.join(appRoot, name), { recursive: true });
  }
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
    name: pkg.name, productName: 'ZERO', version: pkg.version,
    description: pkg.description, main: pkg.main, license: pkg.license
  }, null, 2) + '\n');
  const { rcedit } = await import('rcedit');
  await rcedit(exe, {
    icon: path.join(assets, 'icon.ico'),
    'file-version': pkg.version, 'product-version': pkg.version,
    'version-string': { ProductName: 'ZERO', FileDescription: 'ZERO — Population & Focus',
      CompanyName: 'ZERO', OriginalFilename: 'ZERO.exe', InternalName: 'ZERO' }
  });
  console.log(`Packaged: ${exe}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
