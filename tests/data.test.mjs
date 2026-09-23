import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataset, mergeImport, changes, readLegacy, equal } from '../lib/michele-data.mjs';
import { createStore } from '../lib/michele-store.mjs';

function memory() {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
const a = { codigo: 'CLI-1234', nome: 'Maria', extra: { observacao: 'Preservar' } };
const b = { codigo: 'CLI-1234', nome: 'Maria alterada', extra: { observacao: 'Preservar' } };

test('imports append new clients without dropping cloud records', () => {
  const result = mergeImport({ michele_clientes: [a] }, { michele_clientes: [{ codigo: 'CLI-9999', nome: 'Maria' }] });
  assert.equal(result.merged.michele_clientes.length, 2);
  assert.equal(result.conflicts.length, 0);
});
test('client code conflict requires an explicit choice and preserves originals', () => {
  const source = { michele_clientes: [b] };
  const remote = { michele_clientes: [a] };
  const first = mergeImport(remote, source);
  assert.equal(first.conflicts.length, 1);
  const chosen = mergeImport(remote, source, { [first.conflicts[0].token]: 'source' });
  assert.equal(chosen.conflicts.length, 0);
  assert.deepEqual(chosen.merged.michele_clientes, [b]);
  assert.deepEqual(remote.michele_clientes, [a]);
});
test('document IDs match edited orders; data and nested configuration survive', () => {
  const old = { idDocumento: 'DOC-1', cliente: a, configuracaoAmbientes: [{ custom: 55 }], total: 5 };
  const result = mergeImport({ michele_pedidos: [old] }, { michele_pedidos: [{ ...old, total: 7 }] });
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.merged.michele_pedidos, [old]);
});
test('identical data is deduplicated despite property order', () => {
  const result = mergeImport({ michele_clientes: [a] }, { michele_clientes: [{ extra: a.extra, nome: a.nome, codigo: a.codigo }] });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.merged.michele_clientes.length, 1);
});
test('finance, production, company settings and counters are covered', () => {
  const storage = memory();
  const raw = { michele_financeiro: [{ id: 'FIN-1', valor: 12.5 }], michele_producao: { 'DOC-1-0': 'Pronto' }, michele_config_empresa: { logo: 'data:image/png;base64,test' }, michele_numero_pedido: 25 };
  for (const [k, v] of Object.entries(raw)) storage.setItem(k, JSON.stringify(v));
  assert.deepEqual(readLegacy(storage), raw);
  const merged = mergeImport({ michele_numero_pedido: 50 }, { michele_numero_pedido: '25' });
  assert.equal(merged.merged.michele_numero_pedido, 50);
});
test('legacy passwords are omitted from cloud imports without mutating source', () => {
  const raw = { michele_profissionais: [{ id: 'PROF-1', senha: 'old-password', nome: 'Pessoa' }] };
  assert.equal(dataset(raw).michele_profissionais[0].senha, undefined);
  assert.equal(raw.michele_profissionais[0].senha, 'old-password');
});
test('invalid backup and invalid counters are rejected', () => {
  assert.throws(() => dataset({}));
  assert.throws(() => dataset({ michele_clientes: null }));
  assert.throws(() => dataset({ michele_clientes: [null] }));
  assert.throws(() => dataset({ michele_numero_pedido: -1 }));
  assert.throws(() => dataset({ michele_numero_pedido: 'NaN' }));
});
test('changes include expected versions and omit equal rows', () => {
  assert.deepEqual(changes([{ chave: 'michele_clientes', valor: [a], versao: 7 }], { michele_clientes: [b], michele_pedidos: [] }), [
    { chave: 'michele_clientes', valor: [b], versao: 7 }, { chave: 'michele_pedidos', valor: [], versao: 0 },
  ]);
});
function harness(rpc) {
  const storage = memory(), states = [];
  const client = { rpc };
  const store = createStore({ client, rows: [{ chave: 'michele_clientes', valor: [a], versao: 1 }], storage, journalKey: 'draft', role: 'Administrador', onStatus: state => states.push(state) });
  store.finishInitialization();
  return { store, storage, states, client };
}
test('successful save clears journal only after database confirmation', async () => {
  const h = harness(async (_, { p_alteracoes }) => ({ data: p_alteracoes.map(x => ({ ...x, versao: x.versao + 1 })), error: null }));
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  assert.ok(h.storage.getItem('draft'));
  assert.equal(await h.store.flush(), true);
  assert.equal(h.storage.getItem('draft'), null);
  assert.equal(h.states.at(-1).state, 'saved');
  h.store.dispose();
});
test('network failure keeps pending edits for reload and retry', async () => {
  const h = harness(async () => ({ error: { message: 'network failed' } }));
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  assert.equal(await h.store.flush(), false);
  assert.ok(h.storage.getItem('draft'));
  assert.equal(h.store.hasPending(), true);
  assert.equal(h.states.at(-1).state, 'error');
  h.store.dispose();
});
test('concurrent change blocks overwrite and keeps recovery journal', async () => {
  const h = harness(async () => ({ error: { code: '40001' } }));
  h.client.from = () => ({ select: () => ({ in: async () => ({ data: [{ chave: 'michele_clientes', valor: [{ ...a, nome: 'Outra pessoa' }], versao: 2 }] }) }) });
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  assert.equal(await h.store.flush(), false);
  assert.equal(h.states.at(-1).state, 'conflict');
  assert.ok(h.storage.getItem('draft'));
  assert.throws(() => h.store.setItem('michele_clientes', JSON.stringify([a])));
  h.store.dispose();
});
test('lost acknowledgement is recovered only when the server data matches', async () => {
  const h = harness(async () => ({ error: { code: '40001' } }));
  h.client.from = () => ({ select: () => ({ in: async () => ({ data: [{ chave: 'michele_clientes', valor: [b], versao: 2 }] }) }) });
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  assert.equal(await h.store.flush(), true);
  assert.equal(h.storage.getItem('draft'), null);
  h.store.dispose();
});
test('stale recovery journal cannot silently replace newer cloud records', () => {
  const h = harness(async () => ({}));
  assert.throws(() => h.store.restore({ dados: { michele_clientes: [b] }, versoes: { michele_clientes: 0 } }));
  assert.deepEqual(h.store.snapshot().michele_clientes, [a]);
  h.store.dispose();
});
test('an edit made while saving is sent using the new database version', async () => {
  const sent = [];
  let resolveFirst;
  const h = harness(async (_, args) => {
    sent.push(args.p_alteracoes);
    if (sent.length === 1) await new Promise(resolve => { resolveFirst = resolve; });
    return { data: args.p_alteracoes.map(x => ({ ...x, versao: x.versao + 1 })) };
  });
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  const saving = h.store.flush();
  h.store.setItem('michele_clientes', JSON.stringify([{ ...b, telefone: '123' }]));
  resolveFirst();
  assert.equal(await saving, true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1][0].versao, 2);
  assert.equal(sent[1][0].valor[0].telefone, '123');
  h.store.dispose();
});
test('full disk does not mutate the store without a recovery journal', () => {
  const h = harness(async () => ({}));
  h.storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => h.store.setItem('michele_clientes', JSON.stringify([b])));
  assert.deepEqual(h.store.snapshot().michele_clientes, [a]);
  h.store.dispose();
});
test('incomplete server response cannot clear the recovery journal', async () => {
  const h = harness(async () => ({ data: [], error: null }));
  h.store.setItem('michele_clientes', JSON.stringify([b]));
  assert.equal(await h.store.flush(), false);
  assert.equal(h.store.hasPending(), true);
  assert.ok(h.storage.getItem('draft'));
  assert.equal(h.states.at(-1).state, 'error');
  h.store.dispose();
});
