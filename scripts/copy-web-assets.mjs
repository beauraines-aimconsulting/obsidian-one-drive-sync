import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve('src/web/public');
const targetDir = path.resolve('dist/web/public');

if (!existsSync(sourceDir)) {
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
