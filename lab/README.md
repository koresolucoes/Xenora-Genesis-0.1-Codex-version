# Xenora · Matéria em organização

A entrada `/` executa um único microdomínio de átomos neutros dispersos de H, C, N, O, P e S. Cada átomo tem ID, elemento, isótopo, massa, posição e energia. As moléculas são componentes das ligações entre esses mesmos IDs. O estado inicial tem zero ligações.

A partir de `lab/`, execute `npm ci` e `npm test`. Para explorar a interface local, sirva `public/` com `python3 -m http.server 8000 --bind 127.0.0.1 --directory public`.

## Fundamentos materiais

`atomic-elements.js` registra número atômico, prótons, nêutrons, elétrons, massa isotópica, raio covalente de referência e limite de valência. As fontes são NIST, Cordero et al. e OpenStax. Os núcleos conservam a identidade. Os quarks de valência dos núcleons aparecem como composição de referência. Suas interações nucleares requerem outra escala de modelo.

O grafo químico usa ligações covalentes simplificadas com ordens permitidas e energias médias de dissociação. Ele conserva elementos, núcleos e elétrons. Cada componente informa fórmula, massa e constituintes. A fórmula bruta permite consultar a composição. A identificação de uma substância exige também sua estrutura e distribuição eletrônica.

A interface mede volume do recipiente, massa e densidade. A comparação de pressão do gás ideal usa o número de componentes moleculares independentes. O raio covalente define um volume geométrico de referência para cada átomo. O volume de uma amostra depende também do arranjo e das condições físicas. A fase macroscópica permanece sem classificação até que um modelo de interação e equilíbrio valide essa análise.

A integração usa partículas clássicas e potenciais efetivos. Um corretor da energia cinética fecha o saldo numérico e registra a correção acumulada. O calor liberado ou absorvido nas mudanças de ligação é acompanhado em um reservatório explícito de reação. A alteração do volume reescala as posições e registra a mudança de potencial como trabalho. Esses mecanismos permitem verificar a contabilidade. Previsões quantitativas de cinética ou propriedades de substâncias exigem validação adicional do modelo.

## Um motor e uma observação

`atomic-world.js` implementa a dinâmica do mundo. As operações do observador não criam estruturas e não alteram as forças. Uma ligação muda a composição do componente molecular. Movimento, compressão do recipiente e troca de calor alteram as condições físicas. As alterações da fonte e do recipiente têm contabilização explícita.

A cena permite selecionar átomos, ligações e moléculas no mesmo passo. Os controles alteram condições do mesmo mundo. O inventário e o arquivo usam o formato `particle-world`, versão 2, com identidade do motor `particle-world-v2`. A sessão local e os ramos preservam seus constituintes.

Para atualizar um banco que já aplicou a migração 002, aplique `migrations/003-atomic-world.sql`. Instalações novas usam `schema-supabase.sql` e `schema-origins.sql`.

## Bancada de reações moleculares

No microscópio, abra **Bancada**. Cada espécie é identificada pelo elemento, isótopo, carga, conectividade e ordens de ligação. Os IDs individuais ficam disponíveis para rastrear os átomos. Espécies com a mesma fórmula podem ter identidades diferentes. A chave descreve conectividade, sem resolução de estereoquímica. Uma busca que excede seu orçamento computacional permanece inconclusiva.

A tabela agrupa associações, dissociações e rearranjos por identidade dos reagentes e produtos. Mostra as ocorrências, as evidências materiais e a duração dos produtos. A observação mantém até 128 passos, limitada também a 2.048 edições de ligações. Os tempos são amostrados a cada 4,8 fs. Produtos ainda presentes têm apenas um tempo mínimo de sobrevivência observado. Os existentes antes da janela são identificados como observação inicial, sem atribuir uma formação passada.

A exportação CSV leva o intervalo, as contagens e os resultados de persistência. A consulta ao painel é passiva. Ao restaurar um v2 anterior à bancada, o primeiro intervalo começa no passo restaurado e preserva o checkpoint antigo até que a execução avance.

### Ensaios H₂ e H₂O

Em **Bancada**, use **Medir H₂ e H₂O**. O ensaio prepara moléculas isoladas de topologia fixa e usa o potencial e o integrador do motor. A comparação usa o mesmo tempo físico, 480 fs, com subpassos de 1,2 e 0,6 fs e 401 amostras por trajetória. As tolerâncias de triagem adotadas são 2% para comprimento, 3° para ângulo e 10% para frequência. Elas são critérios do modelo. A referência não modifica o mundo em foco.

| Medida | Motor atual | Referência | Resultado da triagem |
| --- | --- | --- | --- |
| Comprimento H–H | 0,062000 nm | 0,074144 nm | Inadequado |
| Frequência harmônica de H₂, pela curvatura | 943,614 cm⁻¹ | 4.401,213 cm⁻¹ | Inadequado |
| Frequência de H₂, pela trajetória | Sem medida confiável | 4.401,213 cm⁻¹ | Sem medida |
| Comprimento O–H | 0,097000 nm | 0,095777 nm | Aceito |
| Ângulo H–O–H | 60,406° | 104,48° | Inadequado |

O integrador repetiu posições em 284 de 400 subpassos de H₂ e em 654 de 800 ao reduzir o passo. A comparação exibe esse dado junto da correção energética acumulada. O saldo energético fechado precisa ser interpretado com essas medições. Esses resultados delimitam falhas atuais de geometria e dinâmica. [Referência de H₂](https://webbook.nist.gov/cgi/cbook.cgi?ID=C1333740&Mask=1000) · [Geometria espectroscópica da água](https://doi.org/10.1063/1.1924506)

Para reproduzir o relatório JSON, execute `node test/experiments/molecular-reference.mjs` em `lab/`. O número de subpassos é fixo em cada execução. Checkpoints anteriores usam quatro. O protocolo da bancada inclui a migração incremental `migrations/004-reaction-bench.sql`, aplicada após a 003.

## Limite científico atual

O objetivo é estudar a formação de estruturas materiais que possam sustentar manutenção, reprodução e herança. O núcleo atual trata formação e transformação de moléculas no seu modelo reduzido. Para demonstrar organismos surgindo desse substrato, ainda é necessário obter compartimentação funcional, metabolismo acoplado e reprodução sustentada. As evidências de cada etapa devem vir das trajetórias dos mesmos átomos.

## Recuperação de registros anteriores

`/recovery.html` lê arquivos ou revisões dos modelos anteriores e permite baixar o JSON. Esses registros identificam a versão e o tipo de experimento que os gerou. Os endereços anteriores de cosmologia e lagoa levam a essa recuperação. As implementações anteriores permanecem versionadas como experimentos de cronologia, agregação ou populações introduzidas.

## Experimentos anteriores de lagoa

As seções seguintes documentam o acervo anterior, preservado para testes e leitura de registros. A entrada principal usa o núcleo atômico.

### Experimentos na água

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

Em instalações novas, aplique `schema-supabase.sql` e em seguida `schema-origins.sql`, no mesmo projeto. Em arquivos existentes, aplique as migrações pendentes em ordem. `migrations/001-evolving-world.sql` habilita o mundo evolutivo. `migrations/002-particle-world.sql` acrescenta o mundo de partículas e preserva mundos, chaves e revisões. A migração `migrations/003-atomic-world.sql` acrescenta o motor atômico v2 ao mesmo modo. Cada revisão v2 registra o inventário H, C, N, O, P e S, a massa em unidades atômicas e as fórmulas dos componentes ligados no passo salvo. O histórico de medições pode ser consultado entre revisões. O arquivo usa o gateway privado já configurado. Na interface de cada laboratório, **Salvar revisão** cria um mundo e um ramo ou acrescenta uma revisão à execução aberta. Em **Chave e histórico de revisões**, copie a chave para poder recuperar o mundo em outro navegador, abra um passo anterior e bifurque o ramo. A chave concede leitura e escrita nesse mundo. Uma chave anterior de checkpoint continua válida na opção **Experimento** da lagoa.

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
