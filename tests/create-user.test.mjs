import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUser } from '../lib/create-user.mjs';

function fixture(options = {}) {
  const calls = [];
  const person = { id: 'PROF-1', nome: 'Vendedora', email: 'nova@example.test', cargo: 'Vendedor', status: 'Ativo', ...options.person };
  const caller = {
    auth: { getUser: async () => options.invalidToken ? { error: {} } : { data: { user: { id: 'ADMIN-1' } } } },
    rpc: async () => ({ data: { perfil: options.role || 'Administrador' } }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { valor: [person] } }) }) }) }),
  };
  const admin = {
    auth: { admin: {
      createUser: async value => { calls.push(['create', value]); return options.createError ? { error: { code: options.createError } } : { data: { user: { id: 'NEW-1' } } }; },
      deleteUser: async id => { calls.push(['delete', id]); return { error: options.rollbackError }; },
    } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: options.existing ? { email: person.email } : null }) }) }),
      insert: async value => { calls.push(['insert', value]); if(options.lostResponse) throw new Error('network'); return { error: options.insertError }; },
    }),
  };
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public', SUPABASE_SECRET_KEY: options.noSecret ? '' : 'secret' };
  return { calls, deps: { env, createClient: (_, key) => key === 'secret' ? admin : caller } };
}
const request = (body = {}, token = 'valid') => new Request('http://localhost/api/usuarios', {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
  body: JSON.stringify({ id: 'PROF-1', password: 'Senha-teste-123', ...body }),
});

test('only verified administrators can create accounts', async () => {
  for (const [opts, token, status] of [[{}, '', 401], [{ invalidToken: true }, 'bad', 401], [{ role: 'Vendedor' }, 'valid', 403], [{ role: 'Gerente' }, 'valid', 403]]) {
    const f = fixture(opts);
    assert.equal((await createUser(request({}, token), f.deps)).status, status);
    assert.deepEqual(f.calls, []);
  }
});
test('missing configuration and invalid inputs cause no account writes', async () => {
  for (const [opts, body, status] of [[{ noSecret: true }, {}, 503], [{}, { password: '1234' }, 400], [{}, { id: 'missing' }, 404], [{ person: { status: 'Inativo' } }, {}, 400], [{ person: { cargo: 'Instalador' } }, {}, 400], [{ person: { email: '' } }, {}, 400]]) {
    const f = fixture(opts);
    assert.equal((await createUser(request(body), f.deps)).status, status);
    assert.deepEqual(f.calls, []);
  }
});
test('creates an account using saved permissions and never stores the password in access data', async () => {
  const f = fixture();
  const response = await createUser(request({ perfil: 'Administrador', email: 'attacker@example.test' }), f.deps);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { email: 'nova@example.test' });
  assert.deepEqual(f.calls[0], ['create', { email: 'nova@example.test', password: 'Senha-teste-123', email_confirm: true }]);
  assert.deepEqual(f.calls[1], ['insert', { email: 'nova@example.test', nome: 'Vendedora', perfil: 'Vendedor', profissional_id: 'PROF-1', ativo: true }]);
});
test('existing access or auth accounts cannot be overwritten', async () => {
  const f = fixture({ existing: true });
  assert.equal((await createUser(request(), f.deps)).status, 409);
  assert.deepEqual(f.calls, []);
  const g = fixture({ createError: 'email_exists' });
  assert.equal((await createUser(request(), g.deps)).status, 409);
  assert.deepEqual(g.calls.map(c => c[0]), ['create']);
});
test('permission failures roll back only the newly created account', async () => {
  const f = fixture({ insertError: { code: '23505' } });
  assert.equal((await createUser(request(), f.deps)).status, 502);
  assert.deepEqual(f.calls.at(-1), ['delete', 'NEW-1']);
  const g = fixture({ insertError: {}, rollbackError: {} });
  const response = await createUser(request(), g.deps);
  assert.match((await response.json()).error, /revisão/);
});
test('ambiguous permission responses require review without deleting a possibly authorized user', async () => {
  const f = fixture({ lostResponse: true });
  const response = await createUser(request(), f.deps);
  assert.equal(response.status, 502);
  assert.deepEqual(f.calls.map(c => c[0]), ['create', 'insert']);
});
