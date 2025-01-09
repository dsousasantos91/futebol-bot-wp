const fs = require("fs");
const { Client, Buttons } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const FILE_PATH = "listas-bot.json";
require('dotenv').config();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

        if (this.listaPrincipal.includes(nome) || this.listaEspera.includes(nome)) {
            return `\nO jogador "${nome}" já está registrado em uma das listas.`;
        }

        if (isGoleiro) {
            const posicaoGoleiro = this.listaGoleiros.indexOf(null);
            if (posicaoGoleiro !== -1) {
                this.listaGoleiros[posicaoGoleiro] = nome;
            } else {
                return "\nNão há espaço disponível para novos goleiros.";
            }
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

    removerJogador(nome) {
        const indexPrincipal = this.listaPrincipal.indexOf(nome);
        const indexGoleiros = this.listaGoleiros.indexOf(nome);
        const indexEspera = this.listaEspera.indexOf(nome);

        if (indexGoleiros !== -1) {
            this.listaGoleiros[indexGoleiros] = null;
        } else if (indexPrincipal !== -1) {
            this.listaPrincipal[indexPrincipal] = null;
            if (this.listaEspera.length > 0) {
                this.listaPrincipal[indexPrincipal] = this.listaEspera.shift();
            }
        } else if (indexEspera !== -1) {
            this.listaEspera.splice(indexEspera, 1);
        } else {
            return "\nJogador não encontrado na lista.";
        }

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
}

const gerenciador = new FutebolEventManager();

const client = new Client();
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.on('message', async msg => {
    const comando = msg.body.toLowerCase().split(' ')[0];
    const args = msg.body.split(' ').slice(1);

    // Obter informações do contato
    const contato = await msg.getContact();
    const numero = msg.author ? msg.author.split('@')[0] : msg.from.split('@')[0];
    const nomeUsuario = contato.pushname || contato.name || `@${numero}`;

    if(comando === "/add") {
        const respostaAdd = gerenciador.adicionarJogador(`${nomeUsuario} (${numero})`);
        msg.reply(respostaAdd);
        return;
    }
        

    if(comando === "/remover") {
        const respostaRemover = gerenciador.removerJogador(`${nomeUsuario} (${numero})`);
        msg.reply(respostaRemover);
        return;
    }
        

    if(comando === "/addlista") {
        const senhaAddLista = args.shift();
        if (senhaAddLista !== ADMIN_PASSWORD) {
            msg.reply("Senha incorreta. Ação não autorizada.");
            return;
        }
        const lista = args.join(' ').split(',').map(nome => nome.trim());
        gerenciador.adicionarListaCompleta(lista);
        msg.reply(gerenciador.exibirListas());
        return;
    }


    if(comando === "/limpar") {
        const senhaLimpar = args[0];
        if (senhaLimpar !== ADMIN_PASSWORD) {
            msg.reply("Senha incorreta. Ação não autorizada.");
            return;
        }
        gerenciador.limparListas();
        msg.reply("Limpeza da lista realizada com sucesso!!!");
        return;
    }


    if(comando === "/sortear") {
        const resultadoTimes = gerenciador.sortearTimes();
        msg.reply(resultadoTimes);
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
});

client.initialize();
