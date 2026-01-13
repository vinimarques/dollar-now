# Dollar Now 💵

Aplicativo web simples para acompanhar a cotação do dólar em tempo real e receber notificações quando a cotação atingir valores configurados.

## Funcionalidades

- ✅ Atualização automática da cotação do dólar a cada 30 segundos
- ✅ Exibição da variação percentual
- ✅ Sistema de alertas personalizados (acima/abaixo de um valor)
- ✅ Notificações push que funcionam mesmo com a aba fechada (via Service Worker)
- ✅ Interface moderna e responsiva
- ✅ Armazenamento local dos alertas
- ✅ Conversão de valores em dólares para reais
- ✅ Service Worker para notificações em background

## Como Usar

1. **Abrir o aplicativo**
   - Abra o arquivo `index.html` no Chrome
   - Ou sirva via um servidor local (recomendado)

2. **Permitir notificações**
   - Quando solicitado, permita as notificações do navegador
   - Isso é necessário para receber os alertas

3. **Criar alertas**
   - Selecione o tipo de alerta (Acima de / Abaixo de)
   - Digite o valor em reais (ex: 5.50)
   - Clique em "Adicionar Alerta"

4. **Acompanhar**
   - Deixe a aba aberta no Chrome
   - Quando a cotação atingir o valor configurado, você receberá uma notificação no Mac

## Executando Localmente

### Opção 1: Servidor Node.js customizado (Recomendado)

```bash
npm start
# ou
node server.js
```

O servidor abrirá automaticamente no navegador em `http://localhost:3000`

### Opção 2: Servidor HTTP simples (Node.js via npx)

```bash
npx http-server -p 3000 -o -c-1
```

### Opção 3: Servidor HTTP simples (Python)

```bash
# Python 3
python3 -m http.server 3000

# Python 2
python -m SimpleHTTPServer 3000
```

Depois acesse: `http://localhost:3000`

## Instalação e Setup

### Instalar dependências

```bash
npm install
```

## Desenvolvimento

### Linting e Formatação

O projeto usa [Biome](https://biomejs.dev/) para linting e formatação de código.

**Verificar código:**
```bash
npm run check
```

**Corrigir problemas automaticamente:**
```bash
npm run check:fix
```

**Apenas lint:**
```bash
npm run lint
npm run lint:fix
```

**Apenas formatação:**
```bash
npm run format
```

## Deploy na Vercel

### Pré-requisitos

- Conta na [Vercel](https://vercel.com)
- Git configurado no projeto

### Opção 1: Via CLI da Vercel (Recomendado)

1. **Instalar a CLI da Vercel:**
   ```bash
   npm i -g vercel
   ```

2. **Fazer login:**
   ```bash
   vercel login
   ```

3. **Fazer deploy:**
   ```bash
   vercel
   ```

4. **Para produção:**
   ```bash
   vercel --prod
   ```

### Opção 2: Via GitHub/GitLab/Bitbucket

1. **Fazer push do código para um repositório:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <seu-repositorio>
   git push -u origin main
   ```

2. **Conectar na Vercel:**
   - Acesse [vercel.com](https://vercel.com)
   - Clique em "Add New Project"
   - Importe seu repositório
   - A Vercel detectará automaticamente a configuração
   - Clique em "Deploy"

### Opção 3: Via Dashboard da Vercel

1. Acesse [vercel.com](https://vercel.com)
2. Clique em "Add New Project"
3. Escolha "Import Git Repository" ou faça upload dos arquivos
4. Configure o projeto (a Vercel detectará automaticamente)
5. Clique em "Deploy"

### Configuração Automática

O projeto já está configurado com `vercel.json` que:
- Configura headers corretos para o Service Worker
- Otimiza cache de arquivos estáticos
- Garante que o Service Worker funcione corretamente

## Notas Importantes

- **Service Worker**: O aplicativo usa Service Worker para funcionar mesmo com a aba fechada
- **Notificações**: As notificações funcionam mesmo quando a aba está em segundo plano ou fechada
- **Permissões**: As notificações só funcionam se você permitir as permissões do navegador
- **Armazenamento**: Os alertas e valores de conversão são salvos localmente no navegador (localStorage e IndexedDB)
- **API**: A API utilizada é a [AwesomeAPI](https://economia.awesomeapi.com.br/) que é gratuita e pública
- **HTTPS**: O Service Worker requer HTTPS (ou localhost) para funcionar. A Vercel fornece HTTPS automaticamente

## Tecnologias Utilizadas

- HTML5
- CSS3 (com gradientes e animações)
- JavaScript (ES6+)
- Service Worker API
- Notification API do navegador
- IndexedDB para armazenamento
- AwesomeAPI para cotação do dólar

## Estrutura de Arquivos

```
dollar-now/
├── index.html          # Estrutura HTML
├── style.css           # Estilos CSS
├── script.js           # Lógica JavaScript
├── service-worker.js   # Service Worker para background sync
├── favicon.svg         # Favicon do aplicativo
├── server.js           # Servidor HTTP Node.js (apenas para desenvolvimento local)
├── package.json        # Configuração Node.js
├── biome.json          # Configuração do Biome (linting e formatação)
├── vercel.json         # Configuração para deploy na Vercel
├── .vercelignore       # Arquivos ignorados no deploy
├── .biomeignore        # Arquivos ignorados pelo Biome
├── .gitignore         # Arquivos ignorados pelo Git
└── README.md           # Documentação
```
