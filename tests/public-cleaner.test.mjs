import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../server/policy.mjs';

function compile(file, imports) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in imports)) throw Error('Unexpected import '+name);
    return imports[name];
  }, URL, Request, Response, console });
  return module.exports;
}

function app(identity=null) {
  const unavailable = () => { throw Error('Public cleaning must not depend on account storage or billing'); };
  const billing = { billingMode: () => 'live', getPlans: unavailable };
  const templates = Object.fromEntries(['landing','cleaner','training','privacy'].map(name => [
    './templates/'+name+'.html?raw', fs.readFileSync(new URL('../server/templates/'+name+'.html', import.meta.url),'utf8'),
  ]));
  const render = compile('../server/render.ts', { ...templates, 'cloudflare:workers': { env: {} }, './billing': billing });
  return compile('../server/router.ts', {
    '../app/chatgpt-auth': { getChatGPTUser: async () => identity },
    './store': { accountFor: unavailable, subscriptionFor: unavailable, first: unavailable, all: unavailable, run: unavailable },
    './policy.mjs': policy, './billing': billing, './render': render,
  }).handleRequest;
}

test('Landing cleaning buttons open the full uploader without an account or billing dependency', async () => {
  const response = await app()(new Request('https://example.com/'));
  assert.equal(response.status,200);
  const html = await response.text();
  assert.match(html,/href="\/sheet-cleaner.html">Clean a spreadsheet/);
  assert.match(html,/Free to use. No sign-up./);
  assert.doesNotMatch(html,/Continue with ChatGPT|Start free trial|href="\/account"/);
});

test('Anonymous and expired-account visitors can upload, clean and export from the public workspace', async () => {
  for (const identity of [null,{userId:'expired-account',email:'expired@example.com',displayName:'Expired'}]) {
    for (const path of ['/cleaner','/sheet-cleaner.html','/sheet-cleaner.html?sample=1']) {
      const response=await app(identity)(new Request('https://example.com'+path));
      assert.equal(response.status,200);
      const html=await response.text();
      const session=JSON.parse(html.match(/id="tidysheet-session" type="application\/json">([^<]+)</)[1]);
      assert.equal(session.publicCleaner,true);
      assert.equal(session.sampleOnly,false);
      assert.equal(session.access.business,true);
      assert.equal(session.access.training,false);
      assert.match(html,/id="browse"/);
      assert.doesNotMatch(html,/Continue with ChatGPT|Start free trial/);
    }
  }
});

test('Public cleaning does not grant account, billing, training or stored activity access', async () => {
  const route=app();
  assert.equal((await route(new Request('https://example.com/training'))).headers.get('Location'),'/account');
  for (const path of ['/api/trial','/api/billing/checkout','/api/activity','/api/usage/clean']) {
    const response=await route(new Request('https://example.com'+path,{method:'POST',headers:{origin:'https://example.com','Content-Type':'application/json'},body:'{}'}));
    assert.equal(response.status,401,path);
  }
});
