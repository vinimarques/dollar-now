#!/usr/bin/env node
/**
 * Servidor HTTP simples para servir o Dollar Now
 * Roda na porta 3000 por padrão
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3900;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'application/font-woff',
    '.woff2': 'application/font-woff2',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Parse URL
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    // Ler arquivo
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                // 404
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - Arquivo não encontrado</h1>', 'utf-8');
            } else {
                // 500
                res.writeHead(500);
                res.end(`Erro do servidor: ${error.code}`, 'utf-8');
            }
        } else {
            // 200
            const headers = {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            };

            // Headers específicos para service worker
            if (filePath.endsWith('service-worker.js')) {
                headers['Service-Worker-Allowed'] = '/';
                headers['Content-Type'] = 'application/javascript';
            }

            res.writeHead(200, headers);
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    const serverUrl = `http://localhost:${PORT}`;

    console.log('='.repeat(60));
    console.log('🚀 Servidor Dollar Now rodando!');
    console.log(`📍 URL: ${serverUrl}`);
    console.log(`📁 Diretório: ${process.cwd()}`);
    console.log('='.repeat(60));
    console.log('\nPressione Ctrl+C para parar o servidor\n');

    // Abrir no navegador automaticamente
    const platform = process.platform;
    let command;

    if (platform === 'darwin') {
        command = 'open';
    } else if (platform === 'win32') {
        command = 'start';
    } else {
        command = 'xdg-open';
    }

    exec(`${command} ${serverUrl}`, (error) => {
        if (error) {
            console.log(`⚠️  Não foi possível abrir o navegador automaticamente`);
            console.log(`   Acesse manualmente: ${serverUrl}\n`);
        } else {
            console.log(`✅ Navegador aberto automaticamente em ${serverUrl}\n`);
        }
    });
});

// Tratamento de erros
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Erro: Porta ${PORT} já está em uso!`);
        console.error(`   Feche o processo que está usando a porta ${PORT} ou`);
        console.error(`   modifique a variável PORT no arquivo server.js`);
        process.exit(1);
    } else {
        throw error;
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Servidor encerrado. Até logo!');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    server.close(() => {
        process.exit(0);
    });
});
