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

const JOGADORES_FIXOS = process.env.JOGADORES_FIXOS.split(',');
const ABRIR = process.env.ABRIR;
const FECHAR = process.env.FECHAR;
const TAXA_PARTICIPANTE = parseInt(process.env.TAXA_PARTICIPANTE);
const TAXA_CAMPO = parseInt(process.env.TAXA_CAMPO);
const GRUPO = process.env.GRUPO
const FROM_ADMS = process.env.FROM_ADMS
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SCOPES = process.env.GOOGLE_SHEET_SCOPES || "https://www.googleapis.com/auth/spreadsheets";

let listaAberta = process.env.LISTA_ABERTA.toLocaleLowerCase() === 'true';
let qrCodeData = null;
let dataPeladaAtual = process.env.DATA_PELADA_ATUAL;

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
                        range: `${key}!A2:C`, // Ignora a primeira linha (cabeçalho)
                    });
    
                    const values = response.data.values || [];
                    data[key] = values.map(row => {
                        if (key === 'listaPagos') {
                            return { nome: row[0], tipoPagamento: row[1], dataPagamento: row[2]}
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

    async salvarPagamentoNaPlanilha(novosPagamentos) {
        try {
            if (novosPagamentos.length === 0) return;
            
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({ credentials, scopes: [SCOPES] });
            const sheets = google.sheets({ version: "v4", auth });
            
            const newValues = novosPagamentos.map(pagoPor => [pagoPor.nome, pagoPor.tipoPagamento, pagoPor.dataPagamento]);
            
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: `listaPagos!A:C`,
                valueInputOption: 'RAW',
                requestBody: { values: newValues },
            });
            
            console.log("Novos pagamentos adicionados à planilha com sucesso!");
        } catch (error) {
            console.error("Erro ao salvar pagamento no Google Sheets:", error);
        }
    }   
    

    exibirListas() {
        let mensagem = `\nLista Pelada\nQuinta ${dataPeladaAtual} 21:40\n`;
        mensagem += "\n*🥅 Goleiros:*\n";
        this.listaGoleiros
            .forEach((goleiro, index) => {
                mensagem += `${index + 1} - ${goleiro || ""}\n`;
            });

        mensagem += "\n*📋 Jogadores:*\n";
        this.listaPrincipal
            .forEach((jogador, index) => {
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

    async informarPagamento(posicao, dataPelada, tipoPagamento) {
        try {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({ credentials, scopes: [SCOPES] });
            const sheets = google.sheets({ version: "v4", auth });
    
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'resumoCaixa!A2:I',
            });
            
            const rows = response.data.values;
            if (!rows || rows.length === 0) return 'Nenhuma informação encontrada na planilha.';
    
            const rowIndex = rows.findIndex(row => row[0] === dataPelada);
            let nomeJogador = '<vazio>';
    
            if (rowIndex === -1) {
                nomeJogador = await this.registrarNovaDataPagamento(posicao, dataPelada, tipoPagamento, sheets, nomeJogador);
            }
    
            if (rowIndex !== -1) {
                const dataLinha = rows[rowIndex];
                let [_, pix, cartao, dinheiro, totalRecebido, pendentes, totalPendente] = dataLinha;
    
                let listaPendentes = pendentes ? pendentes.split(',').map(nome => nome.trim()) : [];
                if (posicao < 1 || posicao > listaPendentes.length) {
                    return `Posição inválida. A lista de pendentes tem apenas ${listaPendentes.length} jogadores.`;
                }
                
                nomeJogador = listaPendentes.splice(posicao - 1, 1)[0];
                
                const valorPagamento = parseFloat(TAXA_PARTICIPANTE);
                let novoPix = parseFloat(pix);
                let novoCartao = parseFloat(cartao);
                let novoDinheiro = parseFloat(dinheiro);
                let novoTotalRecebido = parseFloat(totalRecebido) + valorPagamento;
    
                switch (tipoPagamento.toLowerCase()) {
                    case '1': novoPix += valorPagamento; break;
                    case '2': novoDinheiro += valorPagamento; break;
                    case '3': novoCartao += valorPagamento; break;
                    default: return 'Método de pagamento inválido. Use "1 (pix)", "2 (dinheiro)" ou "3 (cartao)".';
                }
    
                const updatedRow = [
                    dataPelada, novoPix, novoCartao, novoDinheiro, novoTotalRecebido,
                    listaPendentes.join(','), totalPendente - valorPagamento, parseFloat(TAXA_CAMPO)
                ];
                
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `resumoCaixa!A${rowIndex + 2}:H${rowIndex + 2}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [updatedRow] },
                });
            }
    
            const tipos = { '1': 'pix', '2': 'dinheiro', '3': 'cartao' };
            this.listaPagos.push({ nome: nomeJogador, tipoPagamento: tipos[tipoPagamento], dataPagamento: dataPelada });
            const novoPagante = this.listaPagos[this.listaPagos.length - 1];
            await this.salvarPagamentoNaPlanilha([novoPagante]);
    
            return `Pagamento de ${nomeJogador} registrado com sucesso como ${tipoPagamento}.`;
        } catch (error) {
            console.error('Erro ao registrar pagamento:', error);
            return 'Erro ao registrar pagamento na planilha.';
        }
    }
    
    async registrarNovaDataPagamento(posicao, dataPelada, tipoPagamento, sheets, nomeJogador) {
        try {
            // Definir os valores iniciais
            const valorPagamento = parseFloat(TAXA_PARTICIPANTE); // Defina TAXA_PARTICIPANTE como constante ou variável
            
            nomeJogador = this.listaPrincipal[posicao - 1]; // Posição é 1-based
            const novoTotalRecebido = valorPagamento;

            const listaPendentes = this.listaPrincipal
                .filter(jogador => jogador !== null)
                .filter(jogador => jogador !== nomeJogador); // Supondo que a lista de pendentes é obtida de algum lugar
    
            let novoPix = 0, novoDinheiro = 0, novoCartao = 0;
            switch (tipoPagamento.toLowerCase()) {
                case '1':
                    novoPix = valorPagamento;
                    break;
                case '2':
                    novoDinheiro = valorPagamento;
                    break;
                case '3':
                    novoCartao = valorPagamento;
                    break;
                default:
                    return 'Método de pagamento inválido.';
            }
    
            // Criar o registro para a nova linha
            const newRow = [
                dataPelada,
                novoPix,
                novoCartao,
                novoDinheiro,
                novoTotalRecebido,
                listaPendentes.join(','),
                valorPagamento * listaPendentes.length,
                parseFloat(TAXA_CAMPO)
            ];
    
            // Adicionar a nova linha à planilha
            await sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: 'resumoCaixa!A2:H',
                valueInputOption: 'RAW',
                requestBody: {
                    values: [newRow],
                },
            });
    
            return nomeJogador;
        } catch (error) {
            console.error('Erro ao registrar nova data na planilha:', error);
            return 'Erro ao registrar nova data na planilha.';
        }
    }    

    async resumoCaixa(dataAtual, msgFrom = null) {
        try {
            // Carregar credenciais
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [SCOPES],
            });
    
            const sheets = google.sheets({ version: "v4", auth });

            // Buscar dados da planilha
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'resumoCaixa!A2:J',
            });
    
            const rows = response.data.values;
    
            if (!rows || rows.length === 0) {
                return 'Nenhuma informação encontrada na planilha.';
            }
    
            // Procurar a linha correspondente à data fornecida
            const dataLinha = rows.find(row => row[0] === dataAtual);
    
            if (!dataLinha) {
                return `Nenhum registro encontrado para a data ${dataAtual}.`;
            }
    
            // Extrair valores da linha correspondente
            const [_, pix, cartao, dinheiro, totalRecebido, pendentes, totalPendente, taxaCampo, caixaDia, fundoCaixa] = dataLinha;
    
            // Processar lista de pendentes
            const listaPendentes = pendentes ? pendentes.split(',').map(nome => nome.trim()) : [];

            const listaPendentesFormatada = listaPendentes.map((jogador, index) => {
                return `${index + 1} - ${jogador || ""}`;
            }) || [];
    

            const listaPagosFormatada = this.listaPagos
                .filter(jogador => jogador.dataPagamento === dataAtual)
                .map((jogador, index) => {
                    return `${index + 1} - ${jogador.nome || ""}`;
                });


            // Montar a mensagem formatada para WhatsApp
            let mensagem = `*Resumo do Caixa do Dia ${dataAtual}:*\n\n` +
                `💲 *Pagos*:\n${listaPagosFormatada.length > 0 ? listaPagosFormatada.join('\n') : 'Nenhum'} \n` +
                `\n🔄 *Pix*: R$ ${parseFloat(pix).toFixed(2)} \n` +
                `💳 *Cartão*: R$ ${parseFloat(cartao).toFixed(2)} \n` +
                `💵 *Dinheiro*: R$ ${parseFloat(dinheiro).toFixed(2)} \n` +
                `\n🪙 *Total Recebido*: R$ ${parseFloat(totalRecebido).toFixed(2)} \n` +
                `\n📋 *Pendentes*:\n${listaPendentesFormatada.length > 0 ? listaPendentesFormatada.join('\n') : 'Nenhum'} \n` +
                `\n💸 *Total pendente*: R$ ${parseFloat(totalPendente).toFixed(2)} \n`;
                
                if (msgFrom === FROM_ADMS) {
                    mensagem += `\n⚽ *Taxa Campo*: R$ ${parseFloat(taxaCampo).toFixed(2)} \n` +
                    `\n💰 *Caixa do Dia*: R$ ${parseFloat(caixaDia).toFixed(2)} \n` +
                    `\n🏦 *Fundo de Caixa*: R$ ${parseFloat(fundoCaixa).toFixed(2)} \n`;
                }
    
            return mensagem;
        } catch (error) {
            console.error('Erro ao acessar a planilha:', error);
            return 'Erro ao buscar informações na planilha.';
        }
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
                if (pagoPor.tipoPagamento === 'pix') {
                    totais.pix += TAXA_PARTICIPANTE;
                }
                if (pagoPor.tipoPagamento === 'dinheiro') {
                    totais.dinheiro += TAXA_PARTICIPANTE;
                }
                if (pagoPor.tipoPagamento === 'cartao') {
                    totais.cartao += TAXA_PARTICIPANTE;
                }
            });
    
            const totalRecebido = totais.pix + totais.dinheiro + totais.cartao;
    
            // Buscar registros existentes para a data atual
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `resumoCaixa!A:A`, // Buscar apenas a coluna A (datas)
            });
    
            const rows = response.data.values || [];
    
            // Verificar se já existe um registro para a data
            const indexExistente = rows.findIndex(row => row[0] === dataPeladaAtual);
    
            if (indexExistente !== -1) {
                // Se já existe, atualizar o registro
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SHEET_ID,
                    range: `resumoCaixa!A${indexExistente + 1}:H${indexExistente + 1}`, // Atualizar a linha correspondente
                    valueInputOption: 'RAW',
                    resource: {
                        values: [
                            [dataPeladaAtual, totais.pix, totais.dinheiro, totais.cartao, totalRecebido, this.listaPrincipal.join('\n'), this.listaPrincipal.length * TAXA_PARTICIPANTE, TAXA_CAMPO],
                        ],
                    },
                });
                console.log("Resumo do caixa atualizado no Google Sheets com sucesso!");
            } else {
                // Se não existe, adicionar um novo registro
                const values = [
                    [dataPeladaAtual, totais.pix, totais.dinheiro, totais.cartao, totalRecebido, this.listaPrincipal.join(','), this.listaPrincipal.length * TAXA_PARTICIPANTE, TAXA_CAMPO],
                ];
    
                await sheets.spreadsheets.values.append({
                    spreadsheetId: SHEET_ID,
                    range: `resumoCaixa!A:H`, // Intervalo da tabela
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
            setDataPeladaAtual();
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
        "/rmgol",
        "/usuario"
    ];

    const comandosAdmins = [
        "/addlista",
        "/addlistag",
        "/rmp",
        "/rmpgol",
        "/limpar",
        "/reiniciar",
        "/sortear",
        "/pg",
        "/caixa"
    ];

    if (comandosListas.includes(comando) && args[0]) {
        msg.reply("⚠️ Comando não permitido." + orientacoes);
        return;
    }

    if (comandosListas.includes(comando) && !listaAberta) {
        msg.reply("Lista fechada. Entre em contato com um administrador do grupo.");
        return;
    }

    if (comandosAdmins.includes(comando) && FROM_ADMS !== msg.from) {
        msg.reply("Apenas administradores podem executar o comando enviado.");
        return;
    }

    if(comando === "/usuario") {
        msg.reply(`${nomeUsuario} (${numero})`);
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
            ['1. Pix', '2. Dinheiro', '3. Cartão', '4. Cancelar'].join('\n') +
            '\n\nMétodo de Pagamento' +
            '\nSelecione uma das opções acima';

        // Enviar os botões para o usuário
        msg.reply(opcoes);

        // Adicionar listener para capturar a resposta do botão
        const listener = async (buttonResponse) => {
            if (buttonResponse.author === msg.author || buttonResponse.from === msg.from) {
                const resposta = buttonResponse.body; // O texto do botão clicado
                const posicao = parseInt(args[0]);

                if (resposta === '4') {
                    msg.reply('Operação cancelada.');
                    client.off('message', listener);
                    return;
                }

                // Chamar o método informarPagamento com base na resposta
                const respostaValida = ['1', '2', '3'].includes(resposta)
                if (respostaValida) {
                    let respostaPagamento = '';
                    respostaPagamento = await gerenciador.informarPagamento(args[0], args[1] || dataPeladaAtual, resposta.toLowerCase());
                    msg.reply(respostaPagamento);
                    const respostaCaixa = await gerenciador.resumoCaixa(args[1] || dataPeladaAtual, msg.from);
                    msg.reply(respostaCaixa); 
                }

                if (!respostaValida) {
                    msg.reply('Método de pagamento inválido.');
                }

                // Remover o listener após capturar a resposta
                client.off('message', listener);
            }
        };

        // Adicionar o listener ao client
        client.on('message', listener);

        return;
    }

    if(comando === "/caixa") {
        const respostaCaixa = await gerenciador.resumoCaixa(args[0] || dataPeladaAtual, msg.from);
        msg.reply(respostaCaixa);
        return;
    }
});

async function findGroupByName(name) {
    const chats = await client.getChats();
    return chats.find(chat => chat.name === name);
}

function setDataPeladaAtual() {
    const dataComTresDias = new Date(new Date());
    dataComTresDias.setDate(dataComTresDias.getDate() + 3);
    dataPeladaAtual = dataComTresDias.toLocaleDateString('pt-BR');    
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
