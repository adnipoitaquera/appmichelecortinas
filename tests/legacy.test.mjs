import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { runInContext } from 'node:vm';
import { createStore } from '../lib/michele-store.mjs';

const scripts = ['legacy-app.js', 'orcamento-impressao.js', 'persianas-catalogo.js',
  'persianas-materiais.js', 'plano-corte-persianas.js', 'plano-corte-cortinas.js', 'layout-ficha.js'];

test('legacy forms initialize with cloud data and save a customer through the Supabase adapter', async () => {
  const page = await readFile(new URL('../app/page.jsx', import.meta.url), 'utf8');
  const html = JSON.parse(page.match(/const ORIGINAL_HTML = ("[\s\S]*");\s*$/)[1]);
  const dom = new JSDOM(html, { url: 'https://appmichelecortinas.vercel.app/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let store;
  try {
    const writes = [];
    const states = [];
    window.alert = () => {};
    window.scrollTo = () => {};
    window.localStorage.setItem('michele_clientes', JSON.stringify([{ codigo: 'LOCAL-1', nome: 'Original local' }]));
    const original = window.localStorage.getItem('michele_clientes');
    store = createStore({
      client: { rpc: async (_, args) => { writes.push(args.p_alteracoes); return { data: args.p_alteracoes.map(r => ({ ...r, versao: r.versao + 1 })) }; } },
      rows: [{ chave: 'michele_clientes', valor: [{ codigo: 'CLI-1', nome: 'Cliente do Supabase', cpf: '', telefone: '', email: '', endereco: '' }], versao: 1 }],
      storage: window.localStorage, journalKey: 'test-draft', role: 'Administrador', onStatus: state => states.push(state),
    });
    window.micheleStorage = store;
    window.micheleCloud = { usuario: { id: 'ADMIN-1', nome: 'Admin', cargo: 'Administrador', email: 'admin@example.test' }, signOut: () => {} };
    for (const name of scripts) runInContext(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'), dom.getInternalVMContext(), { filename: name });
    window.inicializarSistema();
    store.finishInitialization();
    await store.flush();
    assert.equal(window.document.getElementById('login-screen').style.display, 'none');
    assert.equal(window.document.getElementById('app-shell').style.display, 'block');
    assert.equal(window.document.getElementById('dash-clientes').textContent, '1');
    assert.equal(window.document.getElementById('p-senha').disabled, true);
    window.document.getElementById('c-codigo').value = 'CLI-2';
    window.document.getElementById('c-nome').value = 'Novo cliente';
    window.salvarNovoClienteNoBanco();
    await store.flush();
    const saved = writes.flat().filter(r => r.chave === 'michele_clientes').at(-1);
    assert.equal(saved.valor.length, 2);
    assert.equal(saved.valor[1].nome, 'Novo cliente');
    assert.equal(saved.versao, 1);
    assert.equal(window.localStorage.getItem('michele_clientes'), original);
    assert.equal(states.at(-1).state, 'saved');
  } finally { store?.dispose(); window.close(); }
});
