# Michele Cortinas — Supabase

O sistema usa Supabase Auth e PostgreSQL. Os dados existentes em `localStorage` são mantidos intactos e podem ser importados depois de entrar como administrador. O site continua sendo publicado na Vercel.

## 1. Preparar o banco

No projeto Supabase usado pelo sistema, abra **SQL Editor → New query**, cole todo o conteúdo de `supabase/001_michele.sql` e clique em **Run**. O arquivo é transacional, pode ser executado novamente e não apaga cadastros existentes.

O SQL autoriza `decoracaoeestilo@hotmail.com` como administrador. Ele NÃO cria uma senha nem uma conta no Supabase Auth.

Na tela de login, `admin` é um atalho para `decoracaoeestilo@hotmail.com`.
Use a senha dessa conta no Supabase; não existe senha padrão nem acesso sem
autenticação. O e-mail completo continua sendo aceito. Outros usuários entram
com seus próprios e-mails.

Em **Authentication → Users**, crie a conta desse e-mail com uma senha escolhida pelo titular e o e-mail confirmado. A conta que entra no painel de administração do Supabase e a conta de usuário do seu aplicativo são cadastros diferentes. Não coloque a senha no código ou no chat.

As tabelas são:

- `michele_acessos`: e-mails autorizados, cargo e vínculo opcional ao profissional.
- `michele_dados`: clientes, pedidos, fornecedores, profissionais, catálogos, financeiro, produção, configuração e contadores, separados pela coluna `chave`. JSONB conserva os campos e as estruturas aninhadas do sistema antigo.
- `michele_importacoes`: cópias dos backups importados, acessíveis somente ao administrador. Senhas antigas dos profissionais não são enviadas; autenticação passa a ser feita pelo Supabase Auth.

Não existe política pública de acesso. Usuários não autorizados não podem acessar cadastros. Escritas usam a função `michele_salvar`, que valida a permissão e a versão de cada grupo de dados e grava o lote inteiro numa transação. Gravar diretamente pelo Table Editor não atualiza automaticamente as versões: faça alterações operacionais pelo sistema.

## 2. Configurar e publicar

Use `.env.example` como referência. No desenvolvimento, as variáveis devem estar em `.env.local`. Na Vercel, configure as mesmas variáveis no projeto e gere uma nova publicação:

- `NEXT_PUBLIC_SUPABASE_URL`: URL do mesmo projeto onde o SQL foi executado.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave pública do projeto. Como alternativa, a chave legada `NEXT_PUBLIC_SUPABASE_ANON_KEY` já utilizada pelo projeto continua aceita.

Não use uma chave `service_role` ou `sb_secret_` em variáveis `NEXT_PUBLIC_`.

Sem configuração, o sistema mostra uma tela de preparação; não muda silenciosamente para um banco local. Se o banco estiver indisponível ao entrar, o sistema informa o erro e não interpreta a falha como uma base vazia.

```sh
npm install
npm test
npm run build
npm run dev
```

## 3. Importar todos os dados existentes

1. Execute o SQL e crie o usuário de acesso antes de publicar a nova versão.
2. Publique a versão configurada no mesmo endereço `https://appmichelecortinas.vercel.app/`. Os dados locais pertencem a esse endereço; localhost, outro domínio ou outro perfil de navegador não verá os mesmos cadastros.
3. Abra o sistema no Chrome usado anteriormente e entre com o e-mail do administrador.
4. O sistema detecta os dados locais e mostra a quantidade de registros por grupo. Baixe uma cópia e use **Importar e conferir**. Os dados locais originais não são removidos.
5. Repita no Edge e em outros computadores/perfis utilizados. Registros iguais são reconhecidos. Códigos iguais com conteúdo diferente exigem escolha explícita; revise também os vínculos entre pedidos, clientes e profissionais antes de confirmar.
6. Um backup JSON anterior também pode ser selecionado em **Importar backup**. A importação acrescenta registros; a ausência de um registro no arquivo não o remove do banco.
7. Compare as quantidades e exemplos reais de clientes, orçamentos, pedidos, financeiro e produção. Faça um cadastro de teste e confirme, após atualizar, que ele aparece no outro navegador.

O backup da versão antiga publicada não incluía financeiro, produção ou configurações. A importação direta no navegador lê essas categorias também. Um arquivo antigo que não possui essas categorias não consegue recuperá-las sozinho.

As cópias importadas ficam em `michele_importacoes`. Importar um navegador não importa automaticamente os demais. A migração só está completa depois da conferência dos dados reais de todas as origens.

## 4. Uso e recuperação

Em **Minha conta → Alterar minha senha**, informe a senha atual e confirme a
nova senha (8 a 128 caracteres). A operação altera apenas a própria conta pelo
Supabase Auth, sem gravar senhas nos cadastros ou backups.

Na entrada, **Esqueci minha senha** aceita `admin` ou o e-mail da conta. O usuário
solicita um link por e-mail e define a senha no próprio site. Isso não cria contas
ausentes. Configure no Supabase Auth os endereços autorizados de redirecionamento
`https://appmichelecortinas.vercel.app` e `http://localhost:3000`, além do serviço
de envio de e-mails. O retorno de recuperação abre a troca de senha antes de
carregar os cadastros. Após salvar, o usuário volta ao login.
Referência: https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail

A faixa no topo informa quando os dados foram confirmados no Supabase. Enquanto houver alterações pendentes, elas são guardadas num rascunho separado neste navegador. Não limpe os dados do navegador antes da confirmação.

A leitura do banco acontece ao abrir ou atualizar o sistema. Use **Atualizar dados** para consultar mudanças de outro computador; o sistema não substitui um formulário em edição automaticamente.

Se outro navegador salvar primeiro o mesmo grupo de dados, a gravação antiga é recusada. Baixe a cópia pendente e atualize. Uma cópia adicional é mantida no armazenamento do navegador. Depois, importe o arquivo e revise as diferenças. Importar é aditivo: exclusões pendentes precisam ser refeitas conscientemente na base atualizada.

## 5. Outros usuários

O administrador pode criar um novo acesso em **Equipe**: preencha nome, e-mail,
cargo (Administrador, Gerente ou Vendedor), status Ativo e a senha opcional
(8 a 128 caracteres), depois clique em **Salvar profissional**. O login usa o
e-mail. Sem senha, o botão salva somente o cadastro profissional. Contas existentes
não têm sua senha, cargo ou autorização alterados por esse formulário.

Para habilitar a criação, configure `SUPABASE_SECRET_KEY` (ou a chave legada
`SUPABASE_SERVICE_ROLE_KEY`) no `.env.local` e reinicie o servidor. Na Vercel,
adicione a variável no ambiente do servidor e publique novamente. Essa chave
nunca deve ter prefixo `NEXT_PUBLIC_`, ser enviada pelo chat ou ir para o Git.
A rota `/api/usuarios` verifica a sessão e o cargo do administrador antes de
criar a conta confirmada e a autorização. A senha vai apenas para o Supabase Auth,
sem entrar nos cadastros, backups ou rascunhos locais. A criação não envia e-mail.
Se a autorização falhar, a rota tenta desfazer somente a conta recém-criada.

Alternativamente, para criar ou administrar contas diretamente no Supabase:

Cadastre cada conta em **Authentication → Users** e autorize seu e-mail no SQL Editor. Exemplo (substitua os valores):

```sql
insert into public.michele_acessos (email, nome, perfil, profissional_id)
values ('vendedor@empresa.com', 'Nome do vendedor', 'Vendedor', 'PROF-000002');
```

Use `Administrador`, `Gerente` ou `Vendedor`. `profissional_id` é o código do cadastro existente, necessário para a seleção automática do vendedor. Salvar um profissional sem senha não cria uma conta Auth nem altera sua permissão no banco. Desative o acesso definindo `ativo = false` em `michele_acessos`.

## Validação e limites

Os testes usam dados fictícios: integração dos formulários em DOM simulado, preservação de backups, falhas de rede e concorrência, além de execução do SQL em PostgreSQL via PGlite com papéis autenticado/anônimo. Não substituem a verificação no projeto real do Supabase nem a conferência da migração dos cadastros reais.
