'use client';

import { useState } from 'react';
import { changePassword } from '../lib/account-password.mjs';

export default function PasswordForm({ auth, recovery = false, onDone, onCancel }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await changePassword(auth, { currentPassword, password, confirmation, recovery });
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setCurrentPassword(''); setPassword(''); setConfirmation(''); setBusy(false); }
  }
  return <><h1 id="password-title">{recovery ? 'Definir nova senha' : 'Alterar minha senha'}</h1>
    {saved ? <><p role="status">Senha alterada com sucesso. Use a nova senha no próximo acesso.</p><button onClick={onDone}>Continuar</button></> :
      <form onSubmit={submit}>
        <p>Escolha uma senha de 8 a 128 caracteres.</p>
        {!recovery && <label>Senha atual<input autoFocus type="password" autoComplete="current-password" required disabled={busy} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>}
        <label>Nova senha<input autoFocus={recovery} type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        {error && <p role="alert" className="cloud-error">{error}</p>}
        <button disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
        {onCancel && <button type="button" className="cloud-secondary" disabled={busy} onClick={onCancel}>Cancelar</button>}
      </form>}
  </>;
}
