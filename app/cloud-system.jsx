'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { changes, dataset, equal, fingerprint, label, mergeImport, readLegacy } from '../lib/michele-data.mjs';
import { createStore } from '../lib/michele-store.mjs';
import './cloud.css';

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLIC_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SCRIPTS = ['/legacy-app.js', '/orcamento-impressao.js', '/persianas-catalogo.js',
  '/persianas-materiais.js', '/plano-corte-persianas.js', '/plano-corte-cortinas.js', '/layout-ficha.js'];

function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function message(error) {
  if (['PGRST202', '42P01', 'PGRST205'].includes(error?.code)) return 'O banco ainda não foi preparado. Execute o arquivo 001_michele.sql no SQL Editor do Supabase.';
  return error?.message || 'Não foi possível conectar ao Supabase. Tente novamente.';
}
function Panel({ children }) { return <main className="cloud-screen"><section className="cloud-card"><p className="cloud-brand">MICHELE CORTINAS</p>{children}</section></main>; }

export default function CloudSystem({ html }) {
  const [phase, setPhase] = useState('boot');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState({ state: 'loading', message: 'Carregando…' });
  const [profile, setProfile] = useState(null);
  const [source, setSource] = useState(null);
  const [choices, setChoices] = useState({});
  const [remote, setRemote] = useState([]);
  const client = useRef(null);
  const store = useRef(null);
  const journalKey = useRef('');
  const started = useRef(false);
  const currentProfile = useRef(null);
  const fileInput = useRef(null);
  const active = useRef(false);

  async function loadRows() {
    const { data, error } = await client.current.from('michele_dados').select('chave,valor,versao');
    if (error) throw error;
    return data;
  }
  function activate(rows) {
    const user = currentProfile.current;
    const instance = createStore({ client: client.current, rows, storage: localStorage,
      journalKey: journalKey.current, role: user.perfil, onStatus: setStatus });
    store.current = instance;
    const raw = localStorage.getItem(journalKey.current);
    if (raw) {
      try { instance.restore(JSON.parse(raw)); }
      catch (e) { setError(message(e)); setPhase('recovery'); return; }
    }
    window.micheleStorage = instance;
    window.micheleCloud = {
      usuario: { id: user.profissional_id || user.id, nome: user.nome, cargo: user.perfil,
        email: user.email, usuario: user.email, status: 'Ativo' },
      signOut,
      importarBackup: chooseBackup,
    };
    setPhase('ready');
  }
  async function loadAccount() {
    setPhase('loading'); setError('');
    const { data: account, error: authError } = await client.current.auth.getUser();
    if (authError || !account.user) { setPhase('login'); return; }
    const { data: member, error: memberError } = await client.current.rpc('michele_perfil');
    if (memberError) throw memberError;
    if (!member) throw new Error('Este e-mail ainda não tem acesso ao sistema. Confira o cadastro em michele_acessos e a confirmação do e-mail no Supabase.');
    currentProfile.current = member; setProfile(member);
    journalKey.current = 'michele:pendente:' + new URL(URL_SUPABASE).host + ':' + account.user.id;
    const rows = await loadRows(); setRemote(rows);
    // Pending edits take priority; never let importing a backup hide them.
    if (localStorage.getItem(journalKey.current)) { activate(rows); return; }
    if (member.perfil === 'Administrador') {
      const legacy = readLegacy(localStorage);
      if (Object.keys(legacy).length) {
        const id = await fingerprint(legacy);
        const { data: imported, error: importError } = await client.current.from('michele_importacoes').select('id').eq('id', id).maybeSingle();
        if (importError) throw importError;
        if (!imported) { setSource({ data: legacy, name: 'Dados deste navegador' }); setChoices({}); setPhase('migration'); return; }
      }
    }
    activate(rows);
  }
  useEffect(() => {
    if (!URL_SUPABASE || !PUBLIC_KEY) { setPhase('config'); return; }
    if (!client.current) client.current = createClient(URL_SUPABASE, PUBLIC_KEY, { auth: { detectSessionInUrl: false } });
    const { data: subscription } = client.current.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && active.current) { active.current = false; setPhase('login'); window.location.reload(); }
    });
    client.current.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (data.session) await loadAccount(); else setPhase('login');
    }).catch(e => { setError(message(e)); setPhase('error'); });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (phase !== 'ready' || started.current) return;
    started.current = true; active.current = true;
    (async () => {
      for (const src of SCRIPTS) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src; script.async = false; script.onload = resolve;
        script.onerror = () => reject(new Error('Não foi possível carregar o sistema. Atualize a página.'));
        document.body.appendChild(script);
      });
      window.inicializarSistema();
      store.current.finishInitialization();
    })().catch(e => { setError(message(e)); setPhase('error'); });
  }, [phase]);

  useEffect(() => {
    const beforeUnload = event => { if (store.current?.hasPending()) { event.preventDefault(); event.returnValue = ''; } };
    const online = () => { if (store.current?.hasPending()) void store.current.flush(); };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('online', online); };
  }, []);

  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error } = await client.current.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error('Não foi possível entrar. Confira o e-mail, a senha e a confirmação da conta no Supabase.');
      setPassword(''); await loadAccount();
    } catch (e) { setError(message(e)); if (!active.current) setPhase('login'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (store.current?.hasPending() && !await store.current.flush()) {
      alert('Existem alterações ainda não enviadas. Resolva a pendência ou baixe uma cópia antes de sair.'); return;
    }
    const { error } = await client.current.auth.signOut();
    if (error) { setError('Não foi possível sair. Tente novamente.'); return; }
    sessionStorage.removeItem('michele_usuario_atual'); window.location.reload();
  }
  async function chooseBackup(file) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (currentProfile.current.perfil !== 'Administrador') throw new Error('Somente o administrador pode importar backups.');
      if (store.current?.hasPending() && !await store.current.flush()) throw new Error('Confirme as alterações pendentes antes de importar.');
      const parsed = JSON.parse(await file.text());
      const data = dataset(parsed.dados || parsed);
      const rows = await loadRows();
      // Validate the preview before displaying an import dialog.
      mergeImport(Object.fromEntries(rows.map(row => [row.chave, row.valor])), data);
      setRemote(rows); setSource({ data, name: file.name }); setChoices({});
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  let preview = null, previewError = '';
  if (source) {
    try { preview = mergeImport(Object.fromEntries(remote.map(row => [row.chave, row.valor])), source.data, choices); }
    catch (e) { previewError = message(e); }
  }
  async function importData() {
    if (!preview || preview.conflicts.length) return;
    setBusy(true); setError('');
    try {
      const delta = changes(remote, preview.merged);
      const { data, error } = await client.current.rpc('michele_salvar', {
        p_alteracoes: delta,
        p_importacao: { id: await fingerprint(source.data), origem: source.name, dados: source.data },
      });
      if (error) {
        if (error.code === '40001') { setRemote(await loadRows()); setChoices({}); throw new Error('Os dados mudaram em outro navegador. Confira novamente as diferenças antes de importar.'); }
        throw error;
      }
      if (!delta.every(row => data.some(saved => saved.chave === row.chave && equal(saved.valor, row.valor)))) {
        throw new Error('Não foi possível verificar todos os cadastros importados. Os dados originais continuam preservados.');
      }
      window.location.reload();
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function archiveAndReload() {
    try {
      const raw = localStorage.getItem(journalKey.current);
      if (raw) {
        // Keep an on-device archive even if the download is interrupted.
        localStorage.setItem(journalKey.current + ':arquivo:' + Date.now(), raw);
        download(JSON.parse(raw), 'alteracoes-pendentes-michele.json');
        localStorage.removeItem(journalKey.current);
      }
      window.location.reload();
    } catch (e) { setError('Não foi possível guardar a cópia. Nenhuma alteração foi descartada. ' + message(e)); }
  }
  function dismissImport() {
    setSource(null); setChoices({}); setError('');
    if (phase === 'migration') activate(remote);
  }
  const conflictList = source ? (() => {
    try { return mergeImport(Object.fromEntries(remote.map(row => [row.chave, row.valor])), source.data).conflicts; }
    catch { return []; }
  })() : [];
  const migration = source && <div className="cloud-overlay"><section className="cloud-card cloud-migration" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <h1 id="import-title">Importar cadastros para o Supabase</h1>
    <p>Origem: {source.name}. Os dados originais deste navegador serão preservados.</p>
    <p>Os registros novos serão acrescentados. Se um código já existir com dados diferentes, escolha qual versão usar. A cópia importada também fica arquivada no banco.</p>
    <ul>{Object.entries(source.data).map(([key, value]) => <li key={key}>{label(key)}: {Array.isArray(value) ? value.length + ' registros' : 'incluído'}</li>)}</ul>
    {conflictList.length > 0 && <p><strong>{conflictList.length} diferenças precisam de revisão.</strong> Confira também os vínculos entre clientes, pedidos e profissionais quando houver códigos repetidos.</p>}
    {conflictList.map(c => <fieldset key={c.token}><legend>{label(c.key)} — {c.id}</legend>
      <div className="cloud-comparison"><div><strong>Supabase</strong><pre>{JSON.stringify(c.cloud, null, 2)}</pre></div><div><strong>Backup</strong><pre>{JSON.stringify(c.incoming, null, 2)}</pre></div></div>
      <label><input type="radio" name={c.token} checked={choices[c.token] === 'cloud'} onChange={() => setChoices(old => ({ ...old, [c.token]: 'cloud' }))} /> Manter versão do Supabase</label>
      <label><input type="radio" name={c.token} checked={choices[c.token] === 'source'} onChange={() => setChoices(old => ({ ...old, [c.token]: 'source' }))} /> Usar versão do backup</label>
    </fieldset>)}
    {(error || previewError) && <p role="alert" className="cloud-error">{error || previewError}</p>}
    <div className="cloud-actions"><button disabled={busy || !preview || preview.conflicts.length > 0} onClick={importData}>{busy ? 'Importando…' : 'Importar e conferir'}</button>
      <button className="cloud-secondary" disabled={busy} onClick={() => download(source.data, 'backup-antes-da-migracao.json')}>Baixar cópia</button>
      <button className="cloud-secondary" disabled={busy} onClick={dismissImport}>{phase === 'migration' ? 'Usar dados do Supabase sem importar agora' : 'Cancelar'}</button></div>
  </section></div>;

  if (phase === 'config') return <Panel><h1>Conectar ao Supabase</h1><p>Configure a URL e a chave pública do projeto nas variáveis de ambiente e publique novamente o sistema.</p></Panel>;
  if (phase === 'boot' || phase === 'loading') return <Panel><p role="status">Conectando ao Supabase…</p></Panel>;
  if (phase === 'login') return <Panel><h1>Acesse sua conta</h1><p>Entre com o e-mail e a senha cadastrados para este sistema.</p>
    <form onSubmit={login}><label>E-mail<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="cloud-error">{error}</p>}<button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button></form></Panel>;
  if (phase === 'recovery') return <Panel><h1>Recuperar alterações pendentes</h1><p role="alert">{error}</p><p>A cópia será mantida neste computador e baixada para revisão. Depois, você poderá importá-la pelo botão Importar backup.</p><button onClick={archiveAndReload}>Baixar cópia e carregar o Supabase</button></Panel>;
  if (phase === 'error') return <Panel><h1>Não foi possível abrir o sistema</h1><p role="alert">{error}</p><div className="cloud-actions"><button onClick={() => window.location.reload()}>Tentar novamente</button><button className="cloud-secondary" onClick={signOut}>Trocar conta</button></div></Panel>;
  return <>
    {phase === 'ready' && <>
      <div className="cloud-bar" role="status" aria-live="polite"><span>{status.message}</span><div className="cloud-actions">
        {status.state === 'error' && <button onClick={() => store.current.flush()}>Tentar enviar novamente</button>}
        <button onClick={async () => { if (!store.current.hasPending() || await store.current.flush()) window.location.reload(); }}>Atualizar dados</button>
        {profile?.perfil === 'Administrador' && <button disabled={busy} onClick={() => fileInput.current.click()}>Importar backup</button>}
        <button onClick={() => download(store.current.snapshot(), 'backup-michele-' + new Date().toISOString().slice(0, 10) + '.json')}>Baixar backup</button>
      </div></div>
      {error && !source && <p className="cloud-error" role="alert">{error}</p>}
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />
    </>}
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => chooseBackup(e.target.files?.[0])} />
    {migration}
    {status.state === 'conflict' && <div className="cloud-overlay"><section className="cloud-card" role="alertdialog" aria-modal="true"><h1>Há alterações em outro navegador</h1><p>{status.message}</p><p>Depois de atualizar, use Importar backup para revisar e recuperar a cópia baixada.</p><button onClick={archiveAndReload}>Baixar alterações e atualizar</button></section></div>}
  </>;
}
