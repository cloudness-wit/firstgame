# HOPRISE - Plano de implementação

Protótipo de jogo vertical em TypeScript e Canvas 2D. O projeto mantém os assets disponíveis em `public/assets/` e gera os módulos JavaScript e arquivos estáticos em `dist/`, usados também pelos projetos nativos Capacitor.

## Executar na web

1. Instale Node.js 22 ou superior.
2. Rode `npm install`.
3. Rode `npm run build`.
4. Sirva o projeto por HTTP e abra `index.html`, ou sirva a pasta `dist/`.
5. Rode `npm run typecheck` para verificar os tipos sem emitir arquivos.
6. Rode `npm run validate` para executar os testes das regras centrais e validar os builds web/Android/iOS.

## Controles

- **A / seta esquerda** e **D / seta direita**: mover no teclado.
- **Shift**: selecionar corrida no solo.
- **Toque**: tocar ou manter pressionado um lado da área do jogo para mover; arrastar o dedo para o outro lado troca a direção.
- **INCL.**: aparece no menu de pausa; solicite permissão e calibre o controle por inclinação enquanto o jogo está pausado, depois retome a partida.
- **Enter / Espaço**: iniciar ou reiniciar.
- **Esc** ou botão de pausa: pausar ou continuar.

O controle por inclinação usa `DeviceOrientationEvent`, solicita permissão quando necessário, aguarda uma leitura real do sensor para calibrar e suaviza a resposta. Se o sensor ou a permissão não estiverem disponíveis, a interface avisa e teclado/toque continuam disponíveis. Ao sair do app ou trocar de aba durante a partida, o jogo pausa e solta entradas pressionadas.

## Fases do projeto

- **Fase 0 - Fundação técnica e preparação dos assets**: estrutura do projeto, organização dos arquivos e pipeline de arte.
- **Fase 1 - Personagem e sensação de movimento**: física, controles, salto automático e animações básicas.
- **Fase 2 - Câmera e ciclo completo de partida**: câmera vertical, wrap-around, queda, derrota e reinício.
- **Fase 3 - Plataformas e geração procedural**: tipos de plataformas, distribuição e dificuldade justa. Nesta entrega, há plataformas normais, móveis, frágeis e de mola; a progressão limita os vãos e reduz gradualmente a largura. A geração garante plataformas seguras recorrentes e calcula a distância alcançável considerando também o curso das plataformas móveis. A câmera mantém a plataforma de origem visível durante o salto, inclusive ao saltar de uma mola, permitindo aterrissar nela novamente.
- **Fase 4 - Cenário, identidade visual e efeitos**: cenário Canvas com camadas de cidade e serras em velocidades de parallax distintas, nuvens com movimento próprio, transição gradual para céu de altitude e estrelas. A iluminação inclui luz atmosférica, névoa, vinheta, sombra e brilho do personagem; partículas aparecem em corrida, aterrissagens, saltos de mola e quebra de plataformas. A arte final de produção ainda pode substituir esses elementos procedurais sem modificar os assets originais.
- **Fase 5 - Obstáculos, moedas e power-ups**: espinhos e sentinelas aparecem em plataformas selecionadas; o personagem pode saltar sobre sentinelas para derrotá-las ou gastar escudo para bloquear um impacto. Fileiras de moedas variam aleatoriamente entre 1 e 4 moedas por plataforma. Escudo dura 10 s ou até absorver um golpe, foguete impulsiona por 2,4 s e ímã atrai moedas próximas por 12 s. Os indicadores de buff só aparecem na HUD enquanto o efeito está ativo; os ícones coletáveis ficam no cenário. Esses itens e inimigos são desenhados pelo Canvas e usam arte procedural.
- **Fase 6 - Interface, progressão e áudio**: menus inicial, pausa e fim de partida com resumo; pontuação calculada como `altura em metros + moedas × 25`; recordes de altura e de pontos; total acumulado de moedas; pontos flutuantes ao coletar moedas e derrotar sentinelas; efeitos sonoros sintetizados para salto, aterrissagem, mola, coleta, buff, impacto, derrota e novo recorde. O som pode ser ligado/desligado no menu ou pela tecla **M**. Recorde de pontos, total de moedas e preferência de som ficam salvos localmente; no Capacitor, os dados de progressão também são gravados em Preferences.
- **Fase 7 - Experiência mobile e Capacitor**: controles por toque com multi-toque e troca de direção ao arrastar; controle de inclinação com solicitação de permissão, leitura do sensor, calibração e retorno de indisponibilidade; feedback tátil em aterrissagens, coletas, buffs, golpes, saltos sobre sentinelas e recordes, com limitação de vibrações repetidas; orientação retrato nativa e tentativa de bloqueio em navegadores móveis; manutenção da tela ativa durante a partida e pausa automática ao ocultar o app; layout adaptável à área segura e a telas baixas. A experiência está preparada no código web e nos arquivos nativos do Capacitor; a validação em aparelhos físicos continua pendente.
- **Fase 8 - Polimento, testes e preparação para lançamento**: a renderização usa atualização completa durante a partida e reduz para 15 quadros/s em menus/pausa e 4 quadros/s em segundo plano. Builds limpos removem arquivos antigos antes de emitir; a validação confere módulos, assets, import map Capacitor e igualdade dos arquivos web nos projetos Android/iOS. Testes automatizados cobrem pontuação, limite aleatório de moedas e colisão de aterrissagem nos espinhos. A preparação técnica está implementada; validação em aparelhos físicos, compilação nativa assinada e publicação ainda dependem das ferramentas/contas de lançamento.

## Estrutura

- `src/game.ts`: loop, física, entrada, colisão e renderização.
- `src/audio.ts`: sons sintetizados no navegador e controle da preferência de áudio.
- `src/mobile.ts`: Capacitor Preferences, orientação, tela ativa, inclinação e feedback tátil.
- `src/gameRules.ts`: regras puras de pontuação, quantidade de moedas e colisão com espinhos, cobertas pelos testes.
- `tests/gameRules.test.mjs`: testes integrados pelo executor nativo do Node.js, sem dependência extra.
- `scripts/validate-build.mjs`: valida os arquivos web e confere as cópias para Android/iOS.
- `public/assets/source/`: cópias dos assets disponíveis; os arquivos originais permanecem preservados.
- `public/assets/frames/`: folhas usadas para animação no Canvas.
- `scripts/copy-static.mjs`: copia HTML, CSS, assets e módulos de plugins para `dist/`.
- `capacitor.config.json`: configuração dos projetos nativos.
- `android/` e `ios/`: projetos de plataforma gerados pelo Capacitor.

## Build e limites de validação

- `npm run typecheck`: `tsc --noEmit`.
- `npm run build`: limpa e emite os módulos JavaScript, gera `dist/`, atualiza os diretórios Android/iOS e valida as saídas.
- `npm test`: recompila/valida e executa a suíte de regras com `node --test`.
- `npm run validate`: executa a verificação TypeScript e todos os testes/build checks.
- `npm run cap:sync`: build web e sincronização dos projetos Android/iOS.
- `npm run cap:android` e `npm run cap:ios`: sincronizam e abrem a plataforma correspondente.

Não foi feita compilação nativa assinada nem teste em dispositivo físico. Android requer Android Studio e SDK; iOS requer macOS e Xcode. Capacitor 8 requer Node.js 22 ou superior.
