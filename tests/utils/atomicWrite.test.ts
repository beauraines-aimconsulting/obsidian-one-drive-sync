import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFileAtomic } from '../../src/utils/atomicWrite.js';

describe('writeFileAtomic', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('writes a new file', () => {
    const target = path.join(directory, 'file.json');
    writeFileAtomic(target, '{"a":1}');

    expect(fs.readFileSync(target, 'utf-8')).toBe('{"a":1}');
  });

  it('replaces existing contents completely', () => {
    const target = path.join(directory, 'file.json');
    fs.writeFileSync(target, 'a much longer previous value');
    writeFileAtomic(target, 'short');

    expect(fs.readFileSync(target, 'utf-8')).toBe('short');
  });

  it('creates missing parent directories', () => {
    const target = path.join(directory, 'nested', 'deeper', 'file.txt');
    writeFileAtomic(target, 'hello');

    expect(fs.readFileSync(target, 'utf-8')).toBe('hello');
  });

  it('leaves no temp files behind', () => {
    const target = path.join(directory, 'file.txt');
    writeFileAtomic(target, 'one');
    writeFileAtomic(target, 'two');

    expect(fs.readdirSync(directory)).toEqual(['file.txt']);
  });
});
