import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const SELLER = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';

test('SQL migration, RLS, authorization, atomicity and stale versions', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      insert into auth.users values
        ('${ADMIN}', 'decoracaoeestilo@hotmail.com', now()),
        ('${SELLER}', 'vendedor@example.test', now()),
        ('${UNKNOWN}', 'desconhecido@example.test', now());
    `);
    const sql = await readFile(new URL('../supabase/001_michele.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // Safe to re-run: no records dropped or permissions widened.
    await db.exec("insert into public.michele_acessos (email,nome,perfil) values ('vendedor@example.test','Vendedor','Vendedor')");
    async function asUser(id, role = 'authenticated') {
      await db.exec(`reset role; set role ${role};`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    }
    const save = async (edits, backup = null) => (await db.query('select public.michele_salvar($1::jsonb,$2::jsonb) as result', [JSON.stringify(edits), backup ? JSON.stringify(backup) : null])).rows[0].result;
    await t.test('anonymous users cannot read records or call write RPC', async () => {
      await asUser('', 'anon');
      await assert.rejects(db.query('select * from public.michele_dados'), e => e.code === '42501');
      await assert.rejects(save([]), e => e.code === '42501');
    });
    await t.test('unlisted authenticated accounts see no data and cannot write', async () => {
      await asUser(UNKNOWN);
      assert.equal((await db.query('select public.michele_perfil() as p')).rows[0].p, null);
      assert.deepEqual((await db.query('select * from public.michele_dados')).rows, []);
      await assert.rejects(save([]), e => e.code === '42501');
    });
    await t.test('admin can save original record fields and version is returned', async () => {
      await asUser(ADMIN);
      const rows = await save([{ chave: 'michele_clientes', valor: [{ codigo: 'CLI-1', nome: 'Cliente', dadosAntigos: { preserve: true } }], versao: 0 }]);
      assert.equal(rows[0].versao, 1);
      assert.equal(rows[0].valor[0].dadosAntigos.preserve, true);
    });
    await t.test('a stale writer cannot replace existing records', async () => {
      await assert.rejects(save([{ chave: 'michele_clientes', valor: [], versao: 0 }]), e => e.code === '40001');
      assert.equal((await db.query("select valor from public.michele_dados where chave='michele_clientes'")).rows[0].valor.length, 1);
    });
    await t.test('a conflict rolls back every change in a multi-key write', async () => {
      await assert.rejects(save([
        { chave: 'michele_pedidos', valor: [{ idDocumento: 'DOC-1' }], versao: 0 },
        { chave: 'michele_clientes', valor: [], versao: 0 },
      ]), e => e.code === '40001');
      assert.equal((await db.query("select * from public.michele_dados where chave='michele_pedidos'")).rows.length, 0);
    });
    await t.test('passwords are removed by the database, including archived imports', async () => {
      const people = [{ id: 'PROF-1', nome: 'Pessoa', senha: 'old-plaintext' }];
      const result = await save([{ chave: 'michele_profissionais', valor: people, versao: 0 }], {
        id: 'a'.repeat(64), origem: 'Chrome', dados: { michele_profissionais: people },
      });
      assert.equal(result[0].valor[0].senha, undefined);
      assert.equal((await db.query('select dados from public.michele_importacoes')).rows[0].dados.michele_profissionais[0].senha, undefined);
    });
    await t.test('invalid shape aborts the transaction', async () => {
      await assert.rejects(save([{ chave: 'michele_producao', valor: [], versao: 0 }]), e => e.code === '22023');
      await assert.rejects(save([{ chave: 'michele_numero_pedido', valor: -5, versao: 0 }]), e => e.code === '22023');
    });
    await t.test('seller can write operational data but cannot change access or catalogs', async () => {
      await asUser(SELLER);
      await save([{ chave: 'michele_pedidos', valor: [{ idDocumento: 'DOC-2' }], versao: 0 }]);
      await assert.rejects(save([{ chave: 'michele_profissionais', valor: [], versao: 1 }]), e => e.code === '42501');
      await assert.rejects(db.query("update public.michele_acessos set perfil='Administrador'"), e => e.code === '42501');
      await assert.rejects(save([], { id: 'b'.repeat(64), dados: {} }), e => e.code === '42501');
      assert.deepEqual((await db.query('select * from public.michele_importacoes')).rows, []);
    });
    await t.test('direct data writes are forbidden, even for admin application users', async () => {
      await asUser(ADMIN);
      await assert.rejects(db.query('delete from public.michele_dados'), e => e.code === '42501');
      await assert.rejects(db.query("update public.michele_dados set valor='[]'"), e => e.code === '42501');
    });
    await t.test('unconfirmed email cannot claim the seeded administrator access', async () => {
      await db.exec('reset role');
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [ADMIN]);
      await asUser(ADMIN);
      assert.equal((await db.query('select public.michele_perfil() as p')).rows[0].p, null);
      await assert.rejects(save([]), e => e.code === '42501');
    });
  } finally { await db.close(); }
});
