const express = require('express');
const schedule = require('node-schedule');
const fs = require("fs");
const { Client, Buttons, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const FILE_PATH = "listas-bot.json";
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const ADMINS = process.env.ADMINS.split(',');
const ABRIR = process.env.ABRIR;
const FECHAR = process.env.FECHAR;
const GRUPO = process.env.GRUPO

let listaAberta = true;

class FutebolEventManager {
    constructor() {
        const data = this.carregarListasDoArquivo();
        this.listaGoleiros = data.listaGoleiros || Array(3).fill(null);
        this.listaPrincipal = data.listaPrincipal || Array(15).fill(null);
        this.listaEspera = data.listaEspera || [];
    }

    carregarListasDoArquivo() {
        try {
            if (fs.existsSync(FILE_PATH)) {
                const data = fs.readFileSync(FILE_PATH, "utf8");
                return JSON.parse(data);
            }
        } catch (error) {
            console.error("Erro ao carregar listas do arquivo:", error);
        }
        return { listaGoleiros: Array(3).fill(null), listaPrincipal: Array(15).fill(null), listaEspera: [] };
    }

    salvarListasNoArquivo() {
        try {
            const data = {
                listaGoleiros: this.listaGoleiros,
                listaPrincipal: this.listaPrincipal,
                listaEspera: this.listaEspera
            };
            fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf8");
        } catch (error) {
            console.error("Erro ao salvar listas no arquivo:", error);
        }
    }

    exibirListas() {
        let mensagem = "\nLista Pelada\nQuinta 21:40\n";
        mensagem += "\nGoleiros:\n";
        this.listaGoleiros.forEach((goleiro, index) => {
            mensagem += `${index + 1} - 🥅 ${goleiro || ""}\n`;
        });

        mensagem += "\nJogadores:\n";
        this.listaPrincipal.forEach((jogador, index) => {
            mensagem += `${index + 1} - ${jogador || ""}\n`;
        });

        mensagem += "\nLista de espera\n";
        this.listaEspera.forEach((jogador, index) => {
            mensagem += `${index + 1} - ${jogador}\n`;
        });

        return mensagem;
    }

    adicionarJogador(nome, isGoleiro = false) {

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

        this.salvarListasNoArquivo();
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
                this.listaPrincipal[indexPrincipal] = this.listaEspera.splice(0, 1);
            }
        } else if (indexEspera !== -1) {
            this.listaEspera.splice(indexEspera, 1);
        } 

        this.salvarListasNoArquivo();
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
                this.listaPrincipal[index] = this.listaEspera.splice(0, 1);
            }
        }

        this.salvarListasNoArquivo();
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

        const tipos = { pix: '🔄', dinheiro: '💵', cartao: '💳' };

        this.listaPrincipal[index] += ' => ' + tipos[tipoPagamento];

        this.salvarListasNoArquivo();
        return this.exibirListas();
    }

    adicionarListaCompleta(nomes, isGoleiros = false) {
        nomes.forEach(nome => this.adicionarJogador(nome, isGoleiros));
    }

    limparListas() {
        this.listaGoleiros = Array(3).fill(null);
        this.listaPrincipal = Array(15).fill(null);
        this.listaEspera = [];
        if (fs.existsSync(FILE_PATH)) {
            fs.unlinkSync(FILE_PATH); // Remove o arquivo
        }
        console.log("\nListas foram limpas.");
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
    }
}

const gerenciador = new FutebolEventManager();

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
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');

    // Agendando a abertura da lista para segundas-feiras às 12h
    schedule.scheduleJob(ABRIR, async () => {
        const message = '⚠️ *ATENÇÃO* ⚠️\n' + 
        '\nEstá *ABERTA* a inscrição de jogadores da ' + GRUPO +
        '\n\nUtilize os comandos abaixo para adicionar ou remover sua participação:\n' +
        '\n*/add* _(Para adicionar na lista principal ou espera)_\n' +
        '\n*/rm* _(Para remover da lista principal ou espera)_\n' +
        '\n*/addgol* _(Para adicionar na lista de goleiros)_\n' +
        '\n*/rmgol* _(Para remover da lista de goleiros)_\n'
        ;

        const chat = await findGroupByName(GRUPO);
        if (chat) {
            listaAberta = true;
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
            listaAberta = false;
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
        "/sortear",
        "/pg"
    ];

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


    if(comando === "/sortear") {
        const resultadoTimes = gerenciador.sortearTimes();
        msg.reply(resultadoTimes);
        return;
    }

    if(comando === "/pg") {
        if (!args[0] || !args[1]) {
            msg.reply("Posição ou tipo de pagamento não informada. *Exemplo: /pg 1 pix*");
            return;
        }
        const respostaPagamento = gerenciador.informarPagamento(parseInt(args[0]), args[1]);
        msg.reply(respostaPagamento);
        return;
    }
});

async function findGroupByName(name) {
    const chats = await client.getChats();
    return chats.find(chat => chat.name === name);
}

client.initialize();

// Rota principal
app.get('/', (req, res) => {
    res.send('Bot do WhatsApp está ativo!');
});

// Iniciar o servidor Express
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});