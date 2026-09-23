import { canWrite, equal, validateValue } from './michele-data.mjs';

// Synchronous facade for the legacy forms. Supabase is authoritative;
// localStorage is used only for an explicit recovery journal, never as fallback.
export function createStore({ client, rows, storage, journalKey, role, onStatus }) {
  const base = new Map(rows.map(row => [row.chave, { ...row }]));
  const values = new Map(rows.map(row => [row.chave, row.valor]));
  const pending = new Map();
  let initializing = true, timer, running, blocked = false;
  const status = (state, message) => onStatus({ state, message, pending: pending.size });
  function journal(proposed = pending) {
    if (!proposed.size) { storage.removeItem(journalKey); return; }
    storage.setItem(journalKey, JSON.stringify({ dados: Object.fromEntries(proposed),
      versoes: Object.fromEntries([...proposed.keys()].map(key => [key, base.get(key)?.versao || 0])) }));
  }
  function queue(key, value) {
    const next = new Map(pending);
    next.set(key, value);
    journal(next); // Fail before mutating memory if local recovery storage is full.
    pending.set(key, value);
    status('pending', 'Alterações aguardando envio ao Supabase.');
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 400);
  }
  function setItem(key, raw) {
    const value = validateValue(key, JSON.parse(raw));
    if (equal(values.get(key), value)) return;
    if (!initializing) {
      if (blocked) throw new Error('Resolva o conflito antes de continuar.');
      if (!canWrite(key, role)) throw new Error('Cadastro restrito ao administrador.');
      queue(key, value);
    }
    values.set(key, value);
  }
  async function saveBatch() {
    while (pending.size && !blocked) {
      const sent = [...pending].map(([chave, valor]) => ({ chave, valor, versao: base.get(chave)?.versao || 0 }));
      status('saving', 'Salvando no Supabase…');
      let response;
      try { response = await client.rpc('michele_salvar', { p_alteracoes: sent }); }
      catch { status('error', 'Sem conexão. As alterações estão guardadas neste navegador, mas ainda não foram confirmadas no Supabase.'); return false; }
      let { data, error } = response;
      if (error?.code === '40001') {
        // A lost response can mean the preceding request already committed.
        const latest = await client.from('michele_dados').select('chave,valor,versao').in('chave', sent.map(x => x.chave));
        if (!latest.error && sent.every(x => latest.data.some(r => r.chave === x.chave && equal(r.valor, x.valor)))) {
          data = latest.data; error = null;
        } else {
          blocked = true;
          status('conflict', 'Outro navegador alterou estes cadastros. Suas alterações foram preservadas; baixe a cópia antes de atualizar.');
          return false;
        }
      }
      if (error) {
        status('error', 'Não foi possível confirmar a gravação no Supabase. Suas alterações continuam neste navegador. ' + (error.code === '42501' ? 'Confira a permissão da sua conta.' : 'Tente novamente.'));
        return false;
      }
      if (!Array.isArray(data) || !sent.every(row => data.some(saved => saved.chave === row.chave && equal(saved.valor, row.valor) && saved.versao > row.versao))) {
        status('error', 'O Supabase nao confirmou todos os dados. As alteracoes continuam guardadas neste navegador.');
        return false;
      }
      for (const row of data) base.set(row.chave, row);
      for (const row of sent) if (equal(pending.get(row.chave), row.valor)) pending.delete(row.chave);
      try { journal(); }
      catch { status('error', 'Dados enviados, mas não foi possível atualizar a cópia de recuperação neste navegador.'); return false; }
    }
    status('saved', 'Dados salvos no Supabase.');
    return true;
  }
  function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (blocked) return Promise.resolve(false);
    running = saveBatch().finally(() => { running = null; });
    return running;
  }
  return {
    getItem: key => values.has(key) ? JSON.stringify(values.get(key)) : null,
    setItem,
    finishInitialization() {
      initializing = false;
      for (const [key, value] of values) if (canWrite(key, role) && !equal(base.get(key)?.valor, value)) queue(key, value);
      if (!pending.size) status('saved', 'Dados carregados do Supabase.');
    },
    restore(draft) {
      if (!draft?.dados || !draft.versoes) throw new Error('Cópia de recuperação inválida.');
      const edits = Object.entries(draft.dados).map(([key, raw]) => [key, validateValue(key, raw)]);
      for (const [key, value] of edits) {
        if (!canWrite(key, role)) throw new Error('Sua conta não pode recuperar estes cadastros.');
        if ((base.get(key)?.versao || 0) !== draft.versoes[key] && !equal(base.get(key)?.valor, value)) {
          throw new Error('Há alterações pendentes deste navegador e alterações mais recentes no Supabase. Baixe a cópia para revisar antes de atualizar.');
        }
      }
      for (const [key, value] of edits) if (!equal(base.get(key)?.valor, value)) { values.set(key, value); pending.set(key, value); }
    },
    flush,
    hasPending: () => pending.size > 0,
    snapshot: () => Object.fromEntries(values),
    dispose() { clearTimeout(timer); },
  };
}
