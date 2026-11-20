# Xenora · Lagoa

A partir da pasta `lab/`, abra o laboratório servindo a pasta `public` com `python3 -m http.server 8000 --bind 127.0.0.1 --directory public` e acesse `http://localhost:8000`. A simulação e os checkpoints locais funcionam em hospedagem estática.

Para repetir um experimento, use a mesma semente e mova a luz nos mesmos passos. O arquivo JSON de checkpoint permite retomar o estado do mundo, incluindo o gerador pseudoaleatório. O laboratório começa com organismos digitais programados. Matéria e energia são medidas em unidades arbitrárias próprias da simulação.

Execute `npm test` na pasta `lab/` para verificar o replay, a conservação da matéria e a rejeição de checkpoints inválidos com o executor de testes do Node.js 22 ou superior.

## Checkpoints remotos opcionais

O Worker entrega os arquivos de `public` e atende as rotas de armazenamento. Para desenvolvimento local, instale as dependências com `npm ci` e execute `npm run dev`. O comando `npm run build` empacota o Worker em modo de simulação de deploy.

**Supabase Free.** No projeto Supabase escolhido, abra o SQL Editor e aplique `schema-supabase.sql`. Habilite a Data API para o esquema `public`. A tabela fica em `xenora_private` com RLS. Apenas o papel de serviço pode chamar as funções públicas para gravar e recuperar a cópia. No Worker, configure os segredos `SUPABASE_URL` (URL do projeto) e `SUPABASE_SERVICE_ROLE_KEY` (chave de servidor `sb_secret_…` da página *Settings → API Keys* ou chave `service_role` legada). A chave de servidor permanece no Worker.

**Neon.** Como alternativa, aplique `schema.sql` pela conexão direta e configure o segredo `DATABASE_URL` com uma conexão Neon com pool e um papel com permissões de `INSERT` e `SELECT` na tabela.

A presença de qualquer configuração Supabase seleciona esse provedor. A API passa a aceitar gravações quando as duas variáveis estão presentes. Os dados de cada provedor são independentes. Em desenvolvimento, as variáveis podem ser fornecidas ao Wrangler pela opção `--env-file` apontando para um arquivo privado fora do projeto.

- `GET /api/health` retorna se a conexão está configurada. A primeira leitura ou gravação confirma a disponibilidade do banco.
- `POST /api/checkpoints` recebe um corpo JSON de até 4 MiB no formato `{"checkpoint":{...}}` e devolve `{"id":"...","token":"..."}` com status 201. Cada envio cria uma nova cópia.
- `GET /api/checkpoints/<id>` recebe o cabeçalho `Authorization: Bearer <token>` e devolve o objeto salvo em `checkpoint`. Guarde juntos o ID e o token de leitura. Quem possuir o par consegue abrir esse checkpoint.
