-- Michele Cortinas: execute este arquivo inteiro no SQL Editor do projeto.
-- Não apaga tabelas ou cadastros existentes. Não cria nem define senhas.
begin;

create table if not exists public.michele_acessos (
  email text primary key check (email = lower(trim(email))),
  nome text not null,
  perfil text not null check (perfil in ('Administrador', 'Gerente', 'Vendedor')),
  profissional_id text,
  ativo boolean not null default true
);
alter table public.michele_acessos enable row level security;
revoke all on public.michele_acessos from anon, authenticated;

insert into public.michele_acessos (email, nome, perfil)
values ('decoracaoeestilo@hotmail.com', 'Administrador', 'Administrador')
on conflict (email) do nothing;

create or replace function public.michele_perfil()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('email', a.email, 'nome', a.nome,
    'perfil', a.perfil, 'profissional_id', a.profissional_id, 'id', u.id)
  from public.michele_acessos a
  join auth.users u on lower(u.email) = a.email
  where u.id = auth.uid() and u.email_confirmed_at is not null and a.ativo;
$$;
revoke all on function public.michele_perfil() from public, anon;
grant execute on function public.michele_perfil() to authenticated;

-- JSONB preserva todos os campos dos cadastros, itens e históricos legados.
create table if not exists public.michele_dados (
  chave text primary key check (chave in (
    'michele_clientes', 'michele_pedidos', 'michele_fornecedores',
    'michele_profissionais', 'michele_produtos_voal', 'michele_produtos_forro',
    'michele_produtos_persiana', 'michele_produtos_acessorios',
    'michele_produtos_motorizacao', 'michele_produtos_personalizados',
    'michele_numero_orcamento', 'michele_numero_pedido',
    'michele_financeiro', 'michele_producao', 'michele_config_empresa'
  )),
  valor jsonb not null,
  versao integer not null default 1 check (versao > 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);
alter table public.michele_dados enable row level security;
revoke all on public.michele_dados from anon, authenticated;
grant select on public.michele_dados to authenticated;
drop policy if exists michele_leitura on public.michele_dados;
create policy michele_leitura on public.michele_dados for select to authenticated
using ((select public.michele_perfil()) is not null);

create table if not exists public.michele_importacoes (
  id text primary key,
  origem text not null,
  dados jsonb not null,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);
alter table public.michele_importacoes enable row level security;
revoke all on public.michele_importacoes from anon, authenticated;
grant select on public.michele_importacoes to authenticated;
drop policy if exists michele_leitura_importacoes on public.michele_importacoes;
create policy michele_leitura_importacoes on public.michele_importacoes
for select to authenticated
using ((select public.michele_perfil()->>'perfil') = 'Administrador');

-- Todas as alterações do lote são atômicas. Versão antiga causa erro 40001.
create or replace function public.michele_salvar(
  p_alteracoes jsonb, p_importacao jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  perfil jsonb := public.michele_perfil();
  item jsonb;
  chave_atual text;
  esperado integer;
  atual integer;
  valor_atual jsonb;
  resultado jsonb := '[]'::jsonb;
  copia jsonb;
begin
  if perfil is null then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  if jsonb_typeof(p_alteracoes) is distinct from 'array' then
    raise exception 'Lote inválido.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_alteracoes) > 15 then
    raise exception 'Lote muito grande.' using errcode = '22023';
  end if;
  if (select count(*) <> count(distinct e->>'chave') from jsonb_array_elements(p_alteracoes) e) then
    raise exception 'Chaves repetidas.' using errcode = '22023';
  end if;
  if p_importacao is not null and perfil->>'perfil' <> 'Administrador' then
    raise exception 'Somente o administrador pode importar.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(712984361);
  for item in select value from jsonb_array_elements(p_alteracoes) loop
    chave_atual := item->>'chave';
    esperado := (item->>'versao')::integer;
    if esperado is null or esperado < 0 then raise exception 'Versão inválida.' using errcode = '22023'; end if;
    if perfil->>'perfil' <> 'Administrador' and chave_atual not in (
      'michele_clientes', 'michele_pedidos', 'michele_financeiro',
      'michele_producao', 'michele_numero_orcamento', 'michele_numero_pedido'
    ) then raise exception 'Cadastro restrito ao administrador.' using errcode = '42501'; end if;
    select d.versao into atual from public.michele_dados d where d.chave = chave_atual;
    if coalesce(atual, 0) <> esperado then
      raise exception 'Outro navegador alterou %. Atualize antes de salvar.', chave_atual using errcode = '40001';
    end if;
    valor_atual := item->'valor';
    if chave_atual in ('michele_config_empresa', 'michele_producao') then
      if jsonb_typeof(valor_atual) is distinct from 'object' then raise exception 'Objeto inválido.' using errcode = '22023'; end if;
    elsif chave_atual in ('michele_numero_orcamento', 'michele_numero_pedido') then
      if jsonb_typeof(valor_atual) is distinct from 'number' or valor_atual::text !~ '^[0-9]+$' then
        raise exception 'Contador inválido.' using errcode = '22023';
      end if;
    elsif jsonb_typeof(valor_atual) is distinct from 'array' then
      raise exception 'Lista inválida.' using errcode = '22023';
    end if;
    if chave_atual = 'michele_profissionais' then
      select coalesce(jsonb_agg(e - 'senha'), '[]'::jsonb) into valor_atual from jsonb_array_elements(valor_atual) e;
    end if;
    insert into public.michele_dados as d (chave, valor, versao, atualizado_por)
    values (chave_atual, valor_atual, 1, auth.uid())
    on conflict (chave) do update set valor = excluded.valor,
      versao = d.versao + 1, atualizado_em = now(), atualizado_por = auth.uid();
    resultado := resultado || (select jsonb_build_array(jsonb_build_object(
      'chave', d.chave, 'valor', d.valor, 'versao', d.versao
    )) from public.michele_dados d where d.chave = chave_atual);
  end loop;
  if p_importacao is not null then
    copia := p_importacao->'dados';
    if jsonb_typeof(copia) is distinct from 'object' or coalesce(length(p_importacao->>'id'), 0) <> 64 then
      raise exception 'Backup inválido.' using errcode = '22023';
    end if;
    if copia ? 'michele_profissionais' then
      copia := jsonb_set(copia, '{michele_profissionais}',
        (select coalesce(jsonb_agg(e - 'senha'), '[]'::jsonb) from jsonb_array_elements(copia->'michele_profissionais') e));
    end if;
    insert into public.michele_importacoes (id, origem, dados, criado_por)
    values (p_importacao->>'id', coalesce(p_importacao->>'origem', 'Backup'), copia, auth.uid())
    on conflict (id) do nothing;
  end if;
  return resultado;
end;
$$;
revoke all on function public.michele_salvar(jsonb, jsonb) from public, anon;
grant execute on function public.michele_salvar(jsonb, jsonb) to authenticated;
commit;
