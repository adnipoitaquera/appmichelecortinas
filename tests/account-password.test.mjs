import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changePassword, loginEmail } from '../lib/account-password.mjs';

function authFixture({ invalidSession, wrongPassword, changedAccount, updateError } = {}) {
  const calls = [];
  return { calls, auth: {
    getUser: async () => invalidSession ? { error: {} } : { data: { user: { id: 'u1', email: 'owner@example.test' } } },
    signInWithPassword: async args => { calls.push(['verify', args]); return wrongPassword ? { error: {} } : { data: { user: { id: changedAccount ? 'u2' : 'u1' } } }; },
    updateUser: async args => { calls.push(['update', args]); return { error: updateError }; },
  } };
}
const values = { currentPassword: 'old-password', password: 'new-password', confirmation: 'new-password' };
test('admin alias and email login remain accepted', () => {
  assert.equal(loginEmail(' ADMIN '), 'decoracaoeestilo@hotmail.com');
  assert.equal(loginEmail(' User@Example.test '), 'user@example.test');
});
test('a normal password change verifies the current account and password first', async () => {
  const f = authFixture(); await changePassword(f.auth, values);
  assert.deepEqual(f.calls, [['verify', { email: 'owner@example.test', password: values.currentPassword }], ['update', { password: values.password }]]);
});
test('invalid current credentials cannot change a password', async () => {
  for (const option of [{ invalidSession: true }, { wrongPassword: true }, { changedAccount: true }]) {
    const f = authFixture(option);
    await assert.rejects(changePassword(f.auth, values));
    assert.ok(!f.calls.some(c => c[0] === 'update'));
  }
});
test('password confirmation and length are validated before authentication', async () => {
  for (const value of [{ ...values, confirmation: 'different' }, { ...values, password: '1234' }, { ...values, password: 'a'.repeat(129) }]) {
    const f = authFixture(); await assert.rejects(changePassword(f.auth, value)); assert.deepEqual(f.calls, []);
  }
});
test('a recovery session can set a new password without knowing the old one', async () => {
  const f = authFixture(); await changePassword(f.auth, { ...values, currentPassword: '', recovery: true });
  assert.deepEqual(f.calls, [['update', { password: values.password }]]);
  const expired = authFixture({ invalidSession: true });
  await assert.rejects(changePassword(expired.auth, { ...values, recovery: true }));
  assert.deepEqual(expired.calls, []);
});
test('provider rejection is never reported as success', async () => {
  const f = authFixture({ updateError: { code: 'weak_password' } });
  await assert.rejects(changePassword(f.auth, values), /mais forte/);
});
