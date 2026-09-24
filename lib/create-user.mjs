// Used only by the server route. Never import this module into client components.
export async function createUser(request, { createClient, env }) {
  const reply = (status, error) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return reply(401, 'Entre novamente como administrador.');
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey) return reply(503, 'O servidor não está conectado ao Supabase.');
  try {
    const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
    const caller = createClient(url, publicKey, { auth, global: { headers: { Authorization: `Bearer ${token}` } } });
    const account = await caller.auth.getUser(token);
    if (account.error || !account.data?.user) return reply(401, 'Sessão expirada. Entre novamente.');
    const profile = await caller.rpc('michele_perfil');
    if (profile.error || profile.data?.perfil !== 'Administrador') return reply(403, 'Somente administradores podem criar contas.');
    if (!secret) return reply(503, 'O profissional foi salvo, mas a criação de acesso precisa ser configurada: adicione SUPABASE_SECRET_KEY no servidor e reinicie o sistema.');
    let body;
    try { body = await request.json(); } catch { return reply(400, 'Dados inválidos.'); }
    if (!body || typeof body.id !== 'string' || body.id.length > 100 || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      return reply(400, 'Informe o profissional e uma senha entre 8 e 128 caracteres.');
    }
    // Derive all identity and permission fields from the saved record, not the request.
    const rows = await caller.from('michele_dados').select('valor').eq('chave', 'michele_profissionais').maybeSingle();
    if (rows.error) return reply(503, 'Não foi possível consultar os profissionais. Tente novamente.');
    const professional = rows.data?.valor?.find(p => p.id === body.id);
    if (!professional) return reply(404, 'Salve o profissional antes de criar o acesso.');
    const email = professional.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !professional.nome?.trim() || professional.status !== 'Ativo' || !['Administrador', 'Gerente', 'Vendedor'].includes(professional.cargo)) {
      return reply(400, 'Informe um e-mail válido e selecione um profissional ativo com cargo Administrador, Gerente ou Vendedor.');
    }
    const admin = createClient(url, secret, { auth });
    const existing = await admin.from('michele_acessos').select('email').eq('email', email).maybeSingle();
    if (existing.error) return reply(503, 'Não foi possível consultar as permissões de acesso.');
    if (existing.data) return reply(409, 'Esse e-mail já tem uma autorização. A senha existente não foi alterada. Gerencie essa conta no Supabase.');
    const created = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true });
    if (created.error || !created.data?.user) {
      if (['email_exists', 'user_already_exists'].includes(created.error?.code)) return reply(409, 'Esse e-mail já possui uma conta. A senha existente não foi alterada.');
      if (created.error?.code === 'weak_password') return reply(400, 'A senha não atende à política do projeto. Escolha uma senha mais forte.');
      return reply(502, 'Não foi possível criar a conta. Confira a configuração do Supabase e tente novamente.');
    }
    let saved;
    try {
      saved = await admin.from('michele_acessos').insert({ email, nome: professional.nome.trim(), perfil: professional.cargo, profissional_id: professional.id, ativo: true });
    } catch {
      // A lost response may mean the permission was committed. Do not delete blindly.
      return reply(502, 'A conta foi criada, mas não foi possível confirmar a autorização. Confira Authentication e michele_acessos no Supabase antes de tentar novamente.');
    }
    if (saved.error) {
      const rollback = await admin.auth.admin.deleteUser(created.data.user.id);
      return reply(502, rollback.error
        ? 'A conta foi criada sem acesso e precisa de revisão no Supabase. Não foi possível desfazer a criação.'
        : 'Não foi possível autorizar o acesso. A conta recém-criada foi desfeita; o cadastro profissional foi mantido.');
    }
    return Response.json({ email }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return reply(502, 'Não foi possível confirmar a operação. Confira a conta no Supabase antes de tentar novamente.');
  }
}
