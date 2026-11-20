# Xenora · Observatório de mundos

A partir da pasta `lab/`, abra o laboratório servindo a pasta `public` com `python3 -m http.server 8000 --bind 127.0.0.1 --directory public` e acesse `http://localhost:8000`. A simulação e os checkpoints locais funcionam em hospedagem estática.

Para repetir um experimento, use a mesma semente e mova a luz nos mesmos passos. O arquivo JSON de checkpoint permite retomar o estado do mundo, incluindo o gerador pseudoaleatório. O laboratório começa com organismos digitais programados. Matéria e energia são medidas em unidades arbitrárias próprias da simulação.

Execute `npm test` na pasta `lab/` para verificar o replay, a conservação da matéria e a rejeição de checkpoints inválidos com o executor de testes do Node.js 22 ou superior.

## Mundo evolutivo

A rota principal abre o mapa de uma superfície planetária em evolução. A sonda consulta as reservas do solo, a água, a temperatura e os organismos do ponto selecionado. As camadas usam os campos do motor. A ampliação de 1× a 4× permite inspecionar o terreno e os indivíduos. Em **Mundo**, a sonda e o campo usam a mesma seleção. **Experimentos de origem e de química** reúne os instrumentos opcionais. Os endereços anteriores de Origens e da lagoa molecular abrem esses instrumentos no próprio observatório. Uma amostra transferida a partir da condensação mineral mantém a procedência.

Em **Variáveis**, a luz incide sobre o planeta e um pulso de nutriente entra na célula selecionada pela sonda. A tabela compara as leituras de ambos no mesmo passo. O botão **+50 passos** permite observar o estado futuro mantendo o mundo em foco.

Os habitats resultam das condições de cada região. A água pode mudar de fase e as condições podem favorecer gelo, terreno seco ou lâminas de água. Nos mundos com fundadores, os recursos e o desempenho fisiológico de cada indivíduo afetam a reprodução. Um alelo térmico é copiado durante a divisão e pode sofrer mutação. A aba **Evolução** mostra a distribuição dos onze alelos e as famílias sobreviventes. Na mesma aba, o controle neutro permite repetir uma trajetória com o efeito fisiológico do alelo desligado para medir a variação de frequências por outros mecanismos, incluindo a deriva.

Na aba **Aprendizagem**, a ação é ficar no sítio ou explorar um vizinho. O contexto distingue dois níveis locais de nutriente. O saldo de energia e a matéria assimilada após a ação atualizam a memória daquele indivíduo. Cada descendente começa com memória vazia. O ensaio duplica o mundo em foco, zera a memória individual nos dois ramos e compara 240 passos com aprendizagem ligada ou desligada. As taxas usam as decisões observadas em cada contexto. Também é possível baixar a tabela em CSV. A partir de `lab/`, execute `node test/experiments/evolving-selection.mjs` para o ensaio de seleção ou `node test/experiments/evolving-learning.mjs` para a comparação de aprendizagem em várias sementes.

Em **Mundos e ramos**, até quatro execuções locais podem ser acompanhadas em paralelo, inclusive dois ramos da mesma população sob intensidades de luz diferentes. A árvore identifica a execução de origem e o passo de cada ramificação. **Revisões salvas**, em **Mundo**, abre o arquivo remoto do Supabase. A sessão local do mundo em foco preserva pausa e velocidade. Ao reabrir uma execução, o navegador simula até 2.400 passos decorridos. O relógio do mundo só avança quando o motor executa seus passos.

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

## Origens e cultura de superfície

Abra `/primordial.html` em **Universo primordial**. Os passos representam épocas comprimidas. O fundo cosmológico segue temperatura relativa proporcional a 1/a e densidade de matéria proporcional a 1/a³. O colapso local usa um limiar de sobredensidade. A ejeção estelar é uma entrada tabelada com procedência e quantidade registrada, e a condensação de forsterita a pressão prescrita utiliza dois lotes de Mg, um de Si e quatro de O por lote de Mg₂SiO₄. Cada elemento tem seu próprio saldo. O controle sem silício exporta o Si disponível. Um controle iniciado após a condensação mantém os sólidos anteriores à intervenção.

Na época de lagoa, um domínio local representa a superfície com 120 partículas, fontes de energia e sítios associados ao inventário mineral. A dinâmica por ligações locais pode produzir agregados persistentes. O observador acompanha sua estrutura. A superfície e o disco usam escalas e unidades distintas. A condensação e a transição à superfície são aproximações parametrizadas.

**Observar uma célula neste meio** abre uma cultura molecular com um único fundador fornecido pelo pesquisador. As posições da amostra, os sítios minerais e a fonte de energia vêm do mundo primordial. O inóculo tem seu próprio orçamento inicial. A sua descendência usa o motor da lagoa e pode ser acompanhada no inspetor. O link **Voltar à origem** retoma o checkpoint da amostra na mesma aba. A origem ambiental e a introdução do fundador ficam registradas na cultura.

## Arquivo científico no Supabase

Em instalações novas, aplique `schema-supabase.sql` e em seguida `schema-origins.sql`, no mesmo projeto. Para um arquivo já instalado na versão anterior, `migrations/001-evolving-world.sql` habilita o mundo evolutivo e preserva mundos, chaves e revisões existentes. O arquivo usa o gateway privado já configurado. Na interface de cada laboratório, **Salvar revisão** cria um mundo e um ramo ou acrescenta uma revisão à execução aberta. Em **Chave e histórico de revisões**, copie a chave para poder recuperar o mundo em outro navegador, abra um passo anterior e bifurque o ramo. A chave concede leitura e escrita nesse mundo. Uma chave anterior de checkpoint continua válida na opção **Experimento** da lagoa.

As rotas sob `/api/worlds` aceitam os modos `primordial` e `lagoon-molecular`. O cliente gera os identificadores e o segredo do mundo antes do envio. A escrita usa um identificador de operação estável e a revisão esperada. O Worker restaura o estado, calcula as observações e envia o lote. O PostgreSQL arquiva a revisão e o recibo em uma transação. Uma repetição idêntica recebe o mesmo recibo, e uma escrita obsoleta recebe HTTP 409. Um fork copia o estado e as observações da revisão de origem. Uma revisão pode ser consultada independentemente do ramo corrente.

As tabelas `science_worlds`, `science_runs`, `science_revisions`, `science_observations` e `science_requests` estão no esquema `xenora_private`. As observações preservam amostras, procedência de minerais, inventários, eventos e evidência genealógica presente nas revisões enviadas. As janelas do motor são limitadas e grandes intervalos sem envio podem deixar lacunas. A opção de salvamento periódico exige uma revisão inicial, uma aba aberta e conexão. O motor roda no navegador.

Além de `npm test` na pasta `lab`, o ensaio independente em `test/postgres` verifica a migração reaplicável, concorrência, isolamento entre mundos, rollback e a leitura dos checkpoints antigos em PostgreSQL real.

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
