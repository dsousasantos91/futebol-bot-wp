# futebol-bot-wp

### Comandos para usuários participantes

Utilize os comandos abaixo para adicionar ou remover sua participação:

- **/add** (Para adicionar na lista principal ou espera)
- **/rm** (Para remover da lista principal ou espera)
- **/addgol** (Para adicionar na lista de goleiros)
- **/rmgol** (Para remover da lista de goleiros)

### Comandos para administradores do grupo

- **/addlista** (_Add um jogador ou uma lista de jogadores separados por vírgula_)
**Exemplo:**
    - /addlista <lista> (_Pode ser apenas um nome ou vários separados por vígula._)
    - /addlista jogador1 _OU_ /addlista jogador1,jogador2,jogador3...

- **/rmp** (_Remover jogador da lista principal por posição_)
**Exemplo:**
    - /rmp <posicao>
    - /rmp 12 (_Remove o jogador da posição 12 da lista_...)

- **/rmpgol** (_Remover goleiro da lista de goleiros por posição_)
**Exemplo:**
    - /rmpgol <posicao>
    - /rmpgol 1 _Remove o jogador da posição 1 da lista_...

- **/limpar** (_Limpa todas as lista e retorna a principal ao seu estado inicial com adms._)
**Exemplo:**
    - /limpar

- **/sortear** (_Faz o sorteio dos times seguinda a regra: 3 times de 5 jogadores_)
**Exemplo:**
    - /sortear.

- **/pg** (_Informar pagamento realizado por um jogador_)
**Exemplo:**
    - /pg <posicao> <tipoPagamento> (Formas de pagamento possíveis: **pix**, **dinheiro** e **cartao**)
    - /pg 9 pix (_Marca na lista como pago para o jogador da posição 9._)

- **/ver** (_Ver todas as listas_)
**Exemplo:**
    - /ver