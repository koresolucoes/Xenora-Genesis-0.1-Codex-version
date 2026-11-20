# Xenora · Lagoa

A partir da pasta `lab/`, abra o laboratório servindo a pasta `public` com `python3 -m http.server 8000 --bind 127.0.0.1 --directory public` e acesse `http://localhost:8000`. A simulação e os checkpoints locais funcionam em hospedagem estática.

Para repetir um experimento, use a mesma semente e mova a luz nos mesmos passos. O arquivo JSON de checkpoint permite retomar o estado do mundo, incluindo o gerador pseudoaleatório. O laboratório começa com organismos digitais programados. Matéria e energia são medidas em unidades arbitrárias próprias da simulação.

Execute `npm test` na pasta `lab/` para verificar o replay, a conservação da matéria e a rejeição de checkpoints inválidos com o executor de testes do Node.js 22 ou superior.

## Experimentos na água

A água é um campo de volumes finitos de 24 × 24 células. O mundo mede uma unidade de lado (L), e o relógio avança em passos (T). As massas de soluto são medidas em unidades de matéria (M). A sonda mostra concentração superficial em M/L². As camadas de corrente, luz, resíduos e nutrientes usam o estado que também determina as interações dos organismos.

- A difusão de Fick transporta nutrientes e resíduos dos pontos de maior concentração para os de menor concentração. A advecção carrega ambos por uma corrente prescrita de divergência discreta zero. As margens são fechadas ao fluxo. Os coeficientes de difusão de nutriente e resíduo são 0,000028 e 0,000014 L²/T.
- O resíduo solúvel retorna a nutriente por cinética de primeira ordem. A taxa basal de 0,0022/T aumenta até seis vezes nas proximidades de minerais. A disponibilidade de luz segue Beer–Lambert, com transmissão igual a exp(−0,020 × concentração superficial de resíduo). Essas são leis físicas e cinéticas conhecidas, parametrizadas para uma simulação fictícia em unidades próprias.
- Um indivíduo captura material local para aumentar a biomassa, consome energia e devolve resíduos. Uma injeção de nutriente é uma entrada externa registrada. O painel compara a matéria atual com os estoques iniciais e as entradas acumuladas. A parte energética contabiliza as reservas dos organismos, a energia absorvida e a dissipada.
- Em **Injetar nutriente**, escolha um ponto da lagoa. Use a camada **Nutrientes** e o inspetor da água para acompanhar a pluma. Em **Dados ao vivo**, consulte as séries e exporte o CSV. O botão **Comparar pulso com controle** simula duas cópias independentes do mesmo estado durante 150 passos e informa a diferença de população, biomassa e nutriente. A lagoa que está na tela continua intacta. O checkpoint mantém até 512 amostras. Durante a execução normal, coleta uma amostra a cada dez passos.

O renderizador realiza o desenho da água em Canvas. A coloração local responde aos solutos e à transmissão da luz. Os detalhes de refração na superfície são uma representação artística. Os testes de laboratório verificam o fluxo de Fick, a convergência espacial em três resoluções, o transporte em corrente, a cinética, a atenuação da luz e a reprodução a partir de checkpoints.

## Motor molecular

Cada organismo possui quatro estoques físicos em unidades de matéria. A soma de membrana, pigmentos, transportadores e reserva é a biomassa já contabilizada na lagoa. A energia disponível é um saldo separado. O inspetor mostra a composição atual e o que a célula captou no último passo. As formas e os poros desenhados na lente representam abundâncias, e cada traço do modelo pode ser conferido nos valores numéricos do inspetor.

A fita hereditária tem 20 símbolos binários. A fração de símbolos 1 orienta quanto do material destinado aos componentes funcionais se torna pigmento. Os símbolos 0 favorecem os transportadores. A maquinaria já construída determina a captação e a assimilação. Crescer consome matéria e energia de síntese. Quando entra pouco nutriente e nenhum grão é ingerido, uma célula com energia disponível pode mobilizar uma parte de sua reserva material para montar pigmentos e transportadores. Essa conversão preserva a massa corporal e dissipa energia. Ao se dividir, a célula reparte os estoques existentes e copia a fita. Uma mutação troca um símbolo da cópia. A nova alocação afeta as próximas sínteses da filha. Os componentes e os coeficientes usam unidades da simulação.

Em **Dados ao vivo**, o ensaio de seleção compara duas linhagens fundadoras sob 50% e 100% de luz incidente, com e sem uma adição de 12 unidades de nutriente. As duas condições sem adição contêm os recursos habituais da lagoa. As quatro sementes e a troca recíproca dos tipos nas posições de fundação produzem 32 lagoas independentes do mundo aberto. Cada execução dura 600 passos. O resultado por condição é o número de descendentes vivos por fundador, com média e desvio-padrão das quatro sementes. As mutações espontâneas participam do ensaio. A identificação dos descendentes segue a linhagem fundadora.

O formato v3 preserva fitas, compartimentos, fluxos e histórico de medições. Ao abrir v1 ou v2, as células existentes recebem uma fita equilibrada e os compartimentos dividem a biomassa preexistente. O relógio, a energia e o estado do gerador aleatório são preservados. As medições moleculares começam no passo da migração. A partir desse ponto, as cópias do mesmo mundo podem ser reproduzidas com as mesmas intervenções.

## Checkpoints remotos opcionais

O Worker entrega os arquivos de `public` e atende as rotas de armazenamento. Para desenvolvimento local, instale as dependências com `npm ci` e execute `npm run dev`. O comando `npm run build` empacota o Worker em modo de simulação de deploy. Para publicar pelo Sites, `npm run build:sites` gera o módulo único `dist/server/index.js`, com a API e uma cópia dos arquivos de `public`. O manifesto do Site usa o modo Worker, e os segredos são variáveis do ambiente de execução. Um caminho de arquivo de saída pode ser passado após `--` quando o checkout do Site estiver em outro diretório.

**Supabase Free.** Aplique `schema-supabase.sql` no SQL Editor do projeto e habilite a Data API para o esquema `public`. A tabela e a configuração de acesso ficam em `xenora_private` com RLS. Para ligar um Worker com a chave publicável do projeto:

1. Gere uma credencial aleatória de 32 bytes usando um gerenciador de segredos e codifique-a em 64 caracteres hexadecimais minúsculos. No servidor, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e o segredo `XENORA_GATEWAY_TOKEN` com essa credencial.
2. Calcule o SHA-256 dos 64 caracteres UTF-8 do token e grave **apenas o digest** de 64 caracteres no SQL abaixo. Executar o mesmo comando com um novo digest faz a rotação. Atualize também o segredo do Worker.
3. Valide a configuração criando e reabrindo um checkpoint. O Worker autentica o acesso às RPCs com a credencial de gateway, enviada em cabeçalho HTTPS. A leitura de cada checkpoint exige ainda seu token individual.

```sql
INSERT INTO xenora_private.gateway_secret (singleton, token_hash)
VALUES (true, decode('<digest SHA-256 em hexadecimal>', 'hex'))
ON CONFLICT (singleton) DO UPDATE SET token_hash = EXCLUDED.token_hash;
```

Se já existir uma integração por papel de serviço, o Worker também aceita `SUPABASE_URL` e o segredo `SUPABASE_SERVICE_ROLE_KEY` sem os dois parâmetros do gateway.

**Neon.** Como alternativa, aplique `schema.sql` pela conexão direta e configure o segredo `DATABASE_URL` com uma conexão Neon com pool e um papel com permissões de `INSERT` e `SELECT` na tabela.

A presença de qualquer configuração Supabase seleciona esse provedor. O modo com chave publicável tem precedência e requer a configuração completa do gateway. Os dados de cada provedor são independentes. Em desenvolvimento, as variáveis podem ser fornecidas ao Wrangler pela opção `--env-file` apontando para um arquivo privado fora do projeto.

- `GET /api/health` retorna se a conexão está configurada. A primeira leitura ou gravação confirma a disponibilidade do banco.
- `POST /api/checkpoints` recebe um corpo JSON de até 4 MiB no formato `{"checkpoint":{...}}` e devolve `{"id":"...","token":"..."}` com status 201. Cada envio cria uma nova cópia.
- `GET /api/checkpoints/<id>` recebe o cabeçalho `Authorization: Bearer <token>` e devolve o objeto salvo em `checkpoint`. Guarde juntos o ID e o token de leitura. Quem possuir o par consegue abrir esse checkpoint.
