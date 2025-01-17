const express = require('express');
const schedule = require('node-schedule');
const { google } = require("googleapis");
const fs = require("fs");
const { Client, Buttons, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const qrcodeBrowser = require('qrcode');
const FILE_PATH = "listas-bot.json";
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const ADMINS = process.env.ADMINS.split(',');
const JOGADORES_FIXOS = process.env.JOGADORES_FIXOS.split(',');
const ABRIR = process.env.ABRIR;
const FECHAR = process.env.FECHAR;
const TAXA_PARTICIPANTE = parseInt(process.env.TAXA_PARTICIPANTE);
const GRUPO = process.env.GRUPO
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = process.env.GOOGLE_SHEET_SCOPES || "https://www.googleapis.com/auth/spreadsheets";

let listaAberta = process.env.LISTA_ABERTA.toLocaleLowerCase() === 'true';
let qrCodeData = null;

const orientacoes = '\n\nUtilize os comandos abaixo para adicionar ou remover sua participação:\n' +
'\n- */add* _(Para adicionar na lista principal ou espera)_' +
'\n- */rm* _(Para remover da lista principal ou espera)_' +
'\n- */addgol* _(Para adicionar na lista de goleiros)_' +
'\n- */rmgol* _(Para remover da lista de goleiros)_'
;

class FutebolEventManager {
    constructor() { }

    async init() {
        const data = await this.carregarListasDaPlanilha();
        this.listaGoleiros = [...data.listaGoleiros, ...Array(3 - data.listaGoleiros.length).fill(null)];
        this.listaPrincipal = [...data.listaPrincipal, ...Array(15 - data.listaPrincipal.length).fill(null)];
        this.listaEspera = data.listaEspera || [];
        this.listaPagos = data.listaPagos || [];
    }

    async carregarListasDaPlanilha() {
        try {
            // Carregar credenciais
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [SCOPES],
            });
    
            const sheets = google.sheets({ version: "v4", auth });
    
            // Inicializa as listas com valores padrão
            const data = {
                listaGoleiros: Array(3).fill(null),
                listaPrincipal: Array(15).fill(null),
                listaEspera: [],
                listaPagos: []
            };
    
            // Tenta carregar os dados de cada aba
            for (const key of Object.keys(data)) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: SHEET_ID,
                        range: `${key}!A2:B`, // Ignora a primeira linha (cabeçalho)
                    });
    
                    const values = response.data.values || [];
                    data[key] = values.map(row => {
                        if (key === 'listaPagos') {
                            return { nome: row[0], dataPagamento: row[1]}
                        }
                        return row[0];
                    }); // Extrai o valor de cada linha
                } catch (error) {
                    console.warn(`Erro ao carregar a aba ${key}:`, error.message);
                }
            }
    
            return data;
        } catch (error) {
            console.error("Erro ao carregar listas da planilha:", error);
            return { listaGoleiros: Array(3).fill(null), listaPrincipal: Array(15).fill(null), listaEspera: [] };
        }
    }    

    async salvarListasNaPlanilha() {
        try {
            // Carregar credenciais
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [SCOPES],
            });

            const sheets = google.sheets({ version: "v4", auth });

            const data = {
                listaGoleiros: this.listaGoleiros || [],
                listaPrincipal: this.listaPrincipal || [],
                listaEspera: this.listaEspera || []
            };

            // Limpar dados existentes nas abas correspondentes
            for (const key of Object.keys(data)) {
                const range = `${key}!A1:Z1000`; // Ajuste o intervalo conforme necessário
                await sheets.spreadsheets.values.clear({
                    spreadsheetId: SHEET_ID,
                    range,
                });
            }

            // Preparar dados para escrita
            const requests = Object.keys(data).map((key) => {
                const values = data[key].map(item => [item]); // Converte os dados em matriz
                return {
                    range: `${key}!A1`, // Cada chave corresponde ao nome de uma aba
                    values: [["Jogadores"], ...values], // Adiciona um cabeçalho
                };
            });

            // Escrever novos dados
            for (const { range, values } of requests) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range,
                    valueInputOption: "RAW",
                    requestBody: { values },
                });
            }

            console.log("Listas salvas no Google Sheets com sucesso!");
        } catch (error) {
            console.error("Erro ao salvar listas no Google Sheets:", error);
        }
    }

    async salvarPagamentoNaPlanilha() {
        try {
            // Carregar credenciais
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [SCOPES],
            });
    
            const sheets = google.sheets({ version: "v4", auth });
    
            // Obter os dados existentes da planilha
            const existingDataResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `listaPagos!A:B`, // Intervalo da tabela
            });
    
            const existingData = existingDataResponse.data.values || [];
    
            // Construir os valores a partir de this.listaPagos que ainda não existem na planilha
            const newValues = this.listaPagos
            .filter((pagoPor) =>
                    !existingData.some((row) => row[0] === pagoPor.nome && row[1] === pagoPor.dataPagamento)
            )
            .map(pagoPor => [pagoPor.nome, pagoPor.dataPagamento]);
    
            if (newValues.length === 0) {
                console.log("Nenhum novo pagamento para salvar.");
                return;
            }
    
            // Adiciona os novos pagamentos à planilha
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: `listaPagos!A:B`, // Intervalo da tabela
                valueInputOption: 'RAW',
                resource: {
                    values: newValues, // Adiciona apenas as entradas que não são duplicadas
                },
            });
    
            console.log("Novos pagamentos salvos no Google Sheets com sucesso!");
        } catch (error) {
            console.error("Erro ao salvar lista de pagamento no Google Sheets:", error);
        }
    }   
    

    exibirListas() {
        let mensagem = "\nLista Pelada\nQuinta 21:40\n";
        mensagem += "\n*🥅 Goleiros:*\n";
        this.listaGoleiros.forEach((goleiro, index) => {
            mensagem += `${index + 1} - ${goleiro || ""}\n`;
        });

        mensagem += "\n*📋 Jogadores:*\n";
        this.listaPrincipal.forEach((jogador, index) => {
            mensagem += `${index + 1} - ${jogador || ""}\n`;
        });

        if (listaAberta) {
            mensagem += "\n*⏳ Lista de espera*\n";
            if (this.listaEspera.length) {
                this.listaEspera.forEach((jogador, index) => {
                    mensagem += `${index + 1} - ${jogador}\n`;
                });
            }

            if (!this.listaEspera.length) {
                mensagem += '_A lista de espera está vazia._'
            }
        }

        if (!listaAberta) {
            mensagem += "\n*💲 Pagos:*\n";
            this.listaPagos
                .map(jogador => jogador.nome)
                .forEach((jogador, index) => {
                    mensagem += `${index + 1} - ${jogador || ""}\n`;
                });
        }

        return mensagem;
    }

    adicionar(nome, isGoleiro = false) {
        if (!isGoleiro && (this.listaPrincipal.includes(nome) || this.listaEspera.includes(nome))) {
            return `\nO jogador "${nome}" já está registrado em uma das listas.`;
        }

        if (isGoleiro) {
            const posicaoGoleiro = this.listaGoleiros.indexOf(null);
            if (posicaoGoleiro === -1) {
                return "\nNão há espaço disponível para novos goleiros.";
            }
            this.listaGoleiros[posicaoGoleiro] = nome;
        } else {
            const posicaoPrincipal = this.listaPrincipal.indexOf(null);
            if (posicaoPrincipal !== -1) {
                this.listaPrincipal[posicaoPrincipal] = nome;
            } else {
                this.listaEspera.push(nome);
            }
        }
    }

    adicionarJogador(nome, isGoleiro = false) {
        this.adicionar(nome, isGoleiro);
        this.salvarListasNaPlanilha();
        return this.exibirListas();
    }

    removerJogador(nome, isGoleiro = false) {
        const indexPrincipal = this.listaPrincipal.indexOf(nome);
        const indexGoleiros = this.listaGoleiros.indexOf(nome);
        const indexEspera = this.listaEspera.indexOf(nome);

        if(indexGoleiros === -1 && indexPrincipal === -1 && indexEspera === -1) {
            return "\nJogador não encontrado na lista.";
        }

        if (indexGoleiros !== -1 && isGoleiro) {
            this.listaGoleiros[indexGoleiros] = null;
        } 
        
        if (indexPrincipal !== -1) {
            this.listaPrincipal[indexPrincipal] = null;
            if (this.listaEspera.length > 0) {
                this.listaPrincipal[indexPrincipal] = this.listaEspera[0];
                this.listaEspera.splice(0, 1);
            }
        } else if (indexEspera !== -1) {
            this.listaEspera.splice(indexEspera, 1);
        } 

        this.salvarListasNaPlanilha();
        return this.exibirListas();
    }

    removerJogadorPosicao(posicao, isGoleiro = false) {
        if (isGoleiro) {
            if (posicao < 1 || posicao > 3) {
                return "\nPosição inválida. Escolha uma posição entre 1 e 3.";
            }
            const index = posicao - 1;
            if (this.listaGoleiros[index] === null) {
                return "\nNão há goleiro nesta posição para remover.";
            }
            this.listaGoleiros[index] = null;
        } else {
            if (posicao < 1 || posicao > 15) {
                return "\nPosição inválida. Escolha uma posição entre 1 e 15.";
            }

            const index = posicao - 1;
            if (this.listaPrincipal[index] === null) {
                return "\nNão há jogador nesta posição para remover.";
            }

            this.listaPrincipal[index] = null;
            if (this.listaEspera.length > 0) {
                this.listaPrincipal[index] = this.listaEspera[0];
                this.listaEspera.splice(0, 1);
            }
        }

        this.salvarListasNaPlanilha();
        return this.exibirListas();
    }

    informarPagamento(posicao, tipoPagamento) {
        if (posicao < 1 || posicao > 15) {
            return "\nPosição inválida. Escolha uma posição entre 1 e 15.";
        }

        const index = posicao - 1;
        if (this.listaPrincipal[index] === null) {
            return "\nNão há jogador nesta posição para remover.";
        }

        const tipos = { '1': '🔄', '2': '💵', '3': '💳' };

        const jogadorPagante = this.listaPrincipal[index] + ' => ' + tipos[tipoPagamento];
        const indexPgt = this.listaPagos.findIndex(
            (pagoPor) => jogadorPagante.includes(pagoPor.nome) && pagoPor.dataPagamento === getDateNow()
        );
        
        if(indexPgt !== -1) {
            return "\nPagamento já informado para o jogador " + this.listaPagos[indexPgt];
        }

        this.listaPagos.push({ nome: jogadorPagante, dataPagamento: getDateNow()});
        this.listaPrincipal.splice(index, 1);
        this.listaPrincipal = this.listaPrincipal.filter(jogador => jogador !== null);

        this.salvarPagamentoNaPlanilha();
        this.salvarListasNaPlanilha();
        this.registrarCaixaNaPlanilha();
        return this.exibirListas();
    }

    resumoCaixa() {
        const totais = {
            pix: 0,
            dinheiro: 0,
            cartao: 0,
        };
    
        // Contar as ocorrências de cada forma de pagamento
        this.listaPagos.forEach((pagoPor) => {
            if (pagoPor.nome.includes('🔄')) {
                totais.pix += TAXA_PARTICIPANTE;
            } 
            if (pagoPor.nome.includes('💵')) {
                totais.dinheiro += TAXA_PARTICIPANTE;
            } 
            if (pagoPor.nome.includes('💳')) {
                totais.cartao += TAXA_PARTICIPANTE;
            }
        });

        const qtdPendencias = this.listaPrincipal.filter(jogador => jogador !== null).length;
    
        // Montar a mensagem formatada para WhatsApp
        const mensagem = `*Resumo do Caixa do Dia ${getDateNow()}:*\n` +
            `🔄 *Pix*: R$ ${totais.pix} \n` +
            `💵 *Dinheiro*: R$ ${totais.dinheiro} \n` +
            `💳 *Cartão*: R$ ${totais.cartao} \n` +
            `\n💰 *Total Recebido*: R$ ${totais.pix + totais.dinheiro + totais.cartao} \n` +
            `\n💸 *Total pendente*: R$ ${qtdPendencias * TAXA_PARTICIPANTE} \n`;
    
        return mensagem;
    }

    async registrarCaixaNaPlanilha() {
        try {
            // Carregar credenciais
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [SCOPES],
            });
    
            const sheets = google.sheets({ version: "v4", auth });
    
            // Calcular o resumo do caixa
            const totais = {
                pix: 0,
                dinheiro: 0,
                cartao: 0,
            };
    
            this.listaPagos.forEach((pagoPor) => {
                if (pagoPor.nome.includes('🔄')) {
                    totais.pix += TAXA_PARTICIPANTE;
                }
                if (pagoPor.nome.includes('💵')) {
                    totais.dinheiro += TAXA_PARTICIPANTE;
                }
                if (pagoPor.nome.includes('💳')) {
                    totais.cartao += TAXA_PARTICIPANTE;
                }
            });
    
            const totalRecebido = totais.pix + totais.dinheiro + totais.cartao;
            const dataAtual = getDateNow(); // Formato: dd/mm/aaaa
    
            // Buscar registros existentes para a data atual
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `resumoCaixa!A:A`, // Buscar apenas a coluna A (datas)
            });
    
            const rows = response.data.values || [];
    
            // Verificar se já existe um registro para a data
            const indexExistente = rows.findIndex(row => row[0] === dataAtual);
    
            if (indexExistente !== -1) {
                // Se já existe, atualizar o registro
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `resumoCaixa!A${indexExistente + 1}:G${indexExistente + 1}`, // Atualizar a linha correspondente
                    valueInputOption: 'RAW',
                    resource: {
                        values: [
                            [dataAtual, totais.pix, totais.dinheiro, totais.cartao, totalRecebido, this.listaPrincipal.join('\n'), this.listaPrincipal.length * TAXA_PARTICIPANTE],
                        ],
                    },
                });
                console.log("Resumo do caixa atualizado no Google Sheets com sucesso!");
            } else {
                // Se não existe, adicionar um novo registro
                const values = [
                    [dataAtual, totais.pix, totais.dinheiro, totais.cartao, totalRecebido, this.listaPrincipal.join('\n'), this.listaPrincipal.length * TAXA_PARTICIPANTE],
                ];
    
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SHEET_ID,
                    range: `resumoCaixa!A:F`, // Intervalo da tabela
                    valueInputOption: 'RAW',
                    resource: {
                        values: values,
                    },
                });
                console.log("Resumo do caixa registrado no Google Sheets com sucesso!");
            }
        } catch (error) {
            console.error("Erro ao registrar ou atualizar resumo do caixa no Google Sheets:", error);
        }
    } 
    
    adicionarListaCompleta(nomes, isGoleiros = false) {
        nomes.forEach(nome => this.adicionar(nome, isGoleiros));
        this.salvarListasNaPlanilha();
        return this.exibirListas();
    }

    limparListas() {
        this.listaGoleiros = Array(3).fill(null);
        this.listaPrincipal = Array(15).fill(null);
        this.listaEspera = [];
        console.log("\nListas foram limpas.");
        this.salvarListasNaPlanilha();
        this.exibirListas();
    }

    reiniciarListas() {
        this.listaGoleiros = Array(3).fill(null);
        this.listaPrincipal = [...JOGADORES_FIXOS, ...Array(15 - JOGADORES_FIXOS.length).fill(null)];
        this.listaEspera = [];
        console.log("\nListas foram reiniciadas.");
        this.salvarListasNaPlanilha();
        this.exibirListas();
    }

    sortearTimes() {
        // Filtrar jogadores válidos (não nulos)
        const jogadoresValidos = this.listaPrincipal.filter(jogador => jogador);

        if (jogadoresValidos.length < 15) {
            return "\nNão há jogadores suficientes na lista principal para formar 3 times de 5 jogadores.";
        }

        // Embaralhar a lista de jogadores
        const jogadoresEmbaralhados = jogadoresValidos.sort(() => Math.random() - 0.5);

        // Dividir os jogadores em 3 times de 5
        const times = [[], [], []];
        jogadoresEmbaralhados.forEach((jogador, index) => {
            times[index % 3].push(jogador);
        });

        // Criar a mensagem com os times sorteados
        let mensagem = "\n*Times Sorteados:*\n";
        times.forEach((time, index) => {
            mensagem += `\n*Time ${index + 1}:*\n`;
            time.forEach(jogador => {
                mensagem += `- ${jogador}\n`;
            });
        });

        return mensagem;
    }

    abrirLista() {
        listaAberta = true;
    }

    fecharLista() {
        listaAberta = false;
        this.listaEspera = [];
        this.salvarListasNaPlanilha();
    }
}

const gerenciador = new FutebolEventManager();
gerenciador.init();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-extensions',
        ],
        headless: true,
      },
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    qrCodeData = qr;
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');

    // Agendando a abertura da lista para segundas-feiras às 12h
    schedule.scheduleJob(ABRIR, async () => {
        const message = '⚠️ *ATENÇÃO* ⚠️\n' + 
        '\nEstá *ABERTA* a inscrição de jogadores da ' + GRUPO + orientacoes;

        const chat = await findGroupByName(GRUPO);
        if (chat) {
            gerenciador.abrirLista();
            gerenciador.reiniciarListas();
            chat.sendMessage(gerenciador.exibirListas());
            chat.sendMessage(message);
            console.log(`Mensagem enviada para o grupo: ${GRUPO}`);
        } else {
            console.log(`Grupo com o nome "${GRUPO}" não foi encontrado.`);
        }
    });

    // Agendando o fechamento da lista para quintas-feiras às 17h
    schedule.scheduleJob(FECHAR, async () => {
        const message = '⚠️ *ATENÇÃO* ⚠️\n' + 
        '\nA lista de jogadores está *FECHADA*. Caso desista, entre em contato com um administrador.\n' + 
        '\n*Lembre-se:* desistências resultam em suspensão na pelada da próxima semana.';

        const chat = await findGroupByName(GRUPO);
        if (chat) {
            gerenciador.fecharLista();
            chat.sendMessage(message);
            console.log(`Mensagem enviada para o grupo: ${GRUPO}`);
        } else {
            console.log(`Grupo com o nome "${GRUPO}" não foi encontrado.`);
        }
    });

    console.log('Scheduler configurado com as mensagens para os grupos.');
});

client.on('message', async msg => {
    const comando = msg.body.toLowerCase().split(' ')[0];
    const args = msg.body.split(' ').slice(1);

    // Obter informações do contato
    const contato = await msg.getContact();
    const numero = msg.author ? msg.author.split('@')[0] : msg.from.split('@')[0];
    const nomeUsuario = contato.pushname || contato.name || `@${numero}`;

    const comandosListas = [
        "/add",
        "/rm",
        "/addgol",
        "/rmgol"
    ];

    const comandosAdmins = [
        "/addlista",
        "/rmp",
        "/rmpgol",
        "/limpar",
        "/reiniciar",
        "/sortear",
        "/pg",
        "/caixa",
        "/ver"
    ];

    if (comandosListas.includes(comando) && args[0]) {
        msg.reply("⚠️ Comando não permitido." + orientacoes);
        return;
    }

    if (comandosListas.includes(comando) && !listaAberta) {
        msg.reply("Lista fechada. Entre em contato com um administrador do grupo.");
        return;
    }

    if (comandosAdmins.includes(comando) && !ADMINS.includes(numero)) {
        msg.reply("Apenas administradores podem executar o comando enviado.");
        return;
    }

    if(comando === "/add") {
        const respostaAdd = gerenciador.adicionarJogador(`${nomeUsuario} (${numero})`);
        msg.reply(respostaAdd);
        return;
    }
        

    if(comando === "/rm") {
        const respostaRemover = gerenciador.removerJogador(`${nomeUsuario} (${numero})`);
        msg.reply(respostaRemover);
        return;
    }

    if(comando === "/addgol") {
        const respostaAdd = gerenciador.adicionarJogador(`${nomeUsuario} (${numero})`, true);
        msg.reply(respostaAdd);
        return;
    }
        
    if(comando === "/rmgol") {
        const respostaRemover = gerenciador.removerJogador(`${nomeUsuario} (${numero})`, true);
        msg.reply(respostaRemover);
        return;
    }

    if(comando === "/ver") {
        const listas = gerenciador.exibirListas();
        if (listas.length < 1) {
            msg.reply("Lista vazia.\nNenhuma jogador add.")
            return;
        }
        msg.reply(listas);
        return;
    }

    if(comando === "/addlista") {
        const lista = args.join(' ').split(',').map(nome => nome.trim());
        gerenciador.adicionarListaCompleta(lista);
        msg.reply(gerenciador.exibirListas());
        return;
    }

    if(comando === "/addlistag") {
        const lista = args.join(' ').split(',').map(nome => nome.trim());
        gerenciador.adicionarListaCompleta(lista, true);
        msg.reply(gerenciador.exibirListas());
        return;
    }

    if(comando === "/rmp") {
        if (!args[0]) {
            msg.reply("Posição não informada. *Exemplo: /rmp 1*");
            return;
        }
        const respostaRemover = gerenciador.removerJogadorPosicao(parseInt(args[0]));
        msg.reply(respostaRemover);
        return;
    }

    if(comando === "/rmpgol") {
        if (!args[0]) {
            msg.reply("Posição não informada. *Exemplo: /rmpgol 1*");
            return;
        }
        const respostaRemover = gerenciador.removerJogadorPosicao(parseInt(args[0]), true);
        msg.reply(respostaRemover);
        return;
    }

    if(comando === "/limpar") {
        gerenciador.limparListas();
        msg.reply("Limpeza da lista realizada com sucesso!!!");
        return;
    }

    if(comando === "/reiniciar") {
        gerenciador.reiniciarListas();
        msg.reply("Listas reiniciadas com sucesso!!!");
        return;
    }


    if(comando === "/sortear") {
        const resultadoTimes = gerenciador.sortearTimes();
        msg.reply(resultadoTimes);
        return;
    }

    if (comando === "/pg") {
        if (!args[0]) {
            msg.reply("Posição não informada. *Exemplo: /pg 1*");
            return;
        }

        // Criar botões para selecionar o método de pagamento
        const opcoes = '*Escolha o método de pagamento:*\n\n' +
            ['1. Pix', '2. Dinheiro', '3. Cartão'].join('\n') +
            '\n\nMétodo de Pagamento' +
            '\nSelecione uma das opções acima';

        // Enviar os botões para o usuário
        msg.reply(opcoes);

        // Adicionar listener para capturar a resposta do botão
        client.on('message', async (buttonResponse) => {
            if (buttonResponse.author === msg.author || buttonResponse.from === msg.from) {
                const resposta = buttonResponse.body; // O texto do botão clicado
                const posicao = parseInt(args[0]);

                // Chamar o método informarPagamento com base na resposta
                if (['1', '2', '3'].includes(resposta)) {
                    const respostaPagamento = gerenciador.informarPagamento(posicao, resposta.toLowerCase());
                    msg.reply(respostaPagamento);
                } else {
                    msg.reply('Método de pagamento inválido.');
                }
            }
        });

        return;
    }

    if(comando === "/caixa") {
        const respostaCaixa = gerenciador.resumoCaixa();
        msg.reply(respostaCaixa);
        return;
    }
});

async function findGroupByName(name) {
    const chats = await client.getChats();
    return chats.find(chat => chat.name === name);
}

function getDateNow() {
    return new Date().toLocaleDateString('pt-BR');
}

client.initialize();

// Rota principal
app.get('/', (req, res) => {
    res.send('Bot do WhatsApp está ativo!');
});


app.get(`/qrcode`, (req, res) => {
    if (!qrCodeData) {
        return res.send('QR Code ainda não foi gerado.');
    }

    qrcodeBrowser.toDataURL(qrCodeData, (err, url) => {
        if (err) return res.send('Erro ao gerar QR Code.');
        res.send(`<img src="${url}" />`);
    });
});

// Iniciar o servidor Express
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
