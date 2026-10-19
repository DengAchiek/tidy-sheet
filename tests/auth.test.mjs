import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function auth(mode, incoming) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../app/chatgpt-auth.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  let headerReads = 0;
  const imports = {
    'next/headers': { headers: async () => { headerReads++; return new Headers(incoming); } },
    'next/navigation': { redirect: () => { throw Error('Unexpected redirect'); } },
    'cloudflare:workers': { env: mode ? { TIDYSHEET_IDENTITY_MODE: mode } : {} },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => imports[name], URL });
  return { getUser: module.exports.getChatGPTUser, headerReads: () => headerReads };
}

test('Standalone Workers reject forged Sites identity headers before reading an account', async () => {
  const app = auth('disabled', { 'oai-authenticated-user-id': 'forged-user', 'oai-authenticated-user-email': 'forged@example.com' });
  assert.equal(await app.getUser(), null);
  assert.equal(app.headerReads(), 0);
});

test('Sites-managed authentication retains its native gateway identity behavior', async () => {
  const app = auth(undefined, { 'oai-authenticated-user-id': 'native-user', 'oai-authenticated-user-email': 'native@example.com' });
  assert.equal((await app.getUser()).userId, 'native-user');
  assert.equal(await auth(undefined, {}).getUser(), null);
});
