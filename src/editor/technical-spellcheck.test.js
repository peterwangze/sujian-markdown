import assert from 'node:assert/strict';
import test from 'node:test';
import { technicalSpellcheckRanges } from './technical-spellcheck.js';

const exclusions = (text) => technicalSpellcheckRanges(text).map(({ from, to }) => text.slice(from, to));

test('keeps prose eligible while excluding identifiers, technology names and command flags', () => {
  assert.deepEqual(exclusions('配置 TypeScript and JSON. Call fetchUser, HTTPServer, fetch_user, parse(), --dry-run and C++. Check recieve.'),
    ['TypeScript', 'JSON', 'fetchUser', 'HTTPServer', 'fetch_user', 'parse', '--dry-run', 'C++']);
});

test('excludes paths and addresses without consuming trailing punctuation', () => {
  assert.deepEqual(exclusions('See https://example.org/api, dev@example.org, ./config.yml and src/main.jsx.'),
    ['https://example.org/api', 'dev@example.org', './config.yml', 'src/main.jsx']);
});
