// Service Worker para Dollar Now
// Mantém as notificações funcionando mesmo quando a aba está fechada

const CACHE_NAME = 'dollar-now-v1';
const DB_NAME = 'dollar-now-db';
const DB_VERSION = 1;
const STORE_ALERTS = 'alerts';
const STORE_CONVERSION = 'conversion';

const API_URLS = [
    'https://economia.awesomeapi.com.br/json/last/USD-BRL',
    'https://api.exchangerate-api.com/v4/latest/USD'
];

const UPDATE_INTERVAL = 60000; // 60 segundos para o service worker

let currentApiIndex = 0;
let updateInterval = null;
let currentQuote = null;
let db = null;

// Inicializar IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_ALERTS)) {
                db.createObjectStore(STORE_ALERTS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_CONVERSION)) {
                db.createObjectStore(STORE_CONVERSION);
            }
        };
    });
}

// Salvar alertas no IndexedDB
async function saveAlertsToDB(alerts) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_ALERTS], 'readwrite');
        const store = transaction.objectStore(STORE_ALERTS);
        
        // Limpar alertas existentes
        store.clear();
        
        // Adicionar novos alertas
        alerts.forEach(alert => {
            store.add(alert);
        });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// Obter alertas do IndexedDB
async function getAlertsFromDB() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_ALERTS], 'readonly');
        const store = transaction.objectStore(STORE_ALERTS);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// Salvar valor de conversão no IndexedDB
async function saveConversionToDB(value) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_CONVERSION], 'readwrite');
        const store = transaction.objectStore(STORE_CONVERSION);
        store.put({ value, timestamp: Date.now() });
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}

// Obter valor de conversão do IndexedDB
async function getConversionFromDB() {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_CONVERSION], 'readonly');
        const store = transaction.objectStore(STORE_CONVERSION);
        const request = store.get(1);
        
        request.onsuccess = () => {
            const result = request.result;
            resolve(result ? result.value : null);
        };
        request.onerror = () => reject(request.error);
    });
}

// Instalar service worker
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Instalando...');
    self.skipWaiting(); // Ativar imediatamente
});

// Ativar service worker
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Ativando...');
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            initDB()
        ]).then(() => {
            startBackgroundSync();
        })
    );
});

// Iniciar sincronização em background
function startBackgroundSync() {
    // Limpar intervalo anterior se existir
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Buscar cotação imediatamente
    fetchQuote();

    // Configurar intervalo para buscar cotação periodicamente
    updateInterval = setInterval(() => {
        fetchQuote();
    }, UPDATE_INTERVAL);
}

// Buscar cotação do dólar
async function fetchQuote() {
    try {
        const apiUrl = API_URLS[currentApiIndex];
        const response = await fetch(apiUrl, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-cache',
            headers: {
                'Accept': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (!data) {
            throw new Error('Resposta da API está vazia');
        }

        let quoteValue = null;
        let changeValue = 0;

        // Processar resposta da AwesomeAPI (formato principal)
        if (data.USDBRL) {
            const usdData = data.USDBRL;
            quoteValue = parseFloat(usdData.bid || usdData.ask || usdData.high || usdData.low);
            changeValue = usdData.pctChange ? parseFloat(usdData.pctChange) : 0;
        }
        // Processar resposta do ExchangeRate-API (fallback)
        else if (data.rates && data.rates.BRL) {
            quoteValue = parseFloat(data.rates.BRL);
            changeValue = 0;
        }
        // Tentar outros formatos
        else if (data.USD) {
            const usdData = data.USD;
            quoteValue = parseFloat(usdData.bid || usdData.ask || usdData.value);
            changeValue = usdData.pctChange ? parseFloat(usdData.pctChange) : 0;
        }
        else if (data.value) {
            quoteValue = parseFloat(data.value);
        }

        if (!quoteValue || isNaN(quoteValue)) {
            throw new Error('Valor da cotação não encontrado ou inválido');
        }

        const newQuote = {
            value: quoteValue,
            timestamp: new Date().toISOString(),
            change: changeValue
        };

        // Verificar se houve mudança significativa
        if (!currentQuote || currentQuote.value !== newQuote.value) {
            currentQuote = newQuote;
            await checkAlerts(newQuote);
        }

        // Resetar índice da API em caso de sucesso
        currentApiIndex = 0;

        // Notificar clientes sobre a atualização
        notifyClients('quote-updated', newQuote);

    } catch (error) {
        console.error('[Service Worker] Erro ao buscar cotação:', error);

        // Tentar API alternativa se disponível
        if (currentApiIndex < API_URLS.length - 1) {
            currentApiIndex++;
            setTimeout(() => fetchQuote(), 1000);
            return;
        }

        // Resetar índice e tentar novamente após 5 segundos
        currentApiIndex = 0;
    }
}

// Verificar alertas
async function checkAlerts(quote) {
    try {
        // Obter alertas do IndexedDB
        const alerts = await getAlertsFromDB();
        if (!alerts || alerts.length === 0) return;

        const currentValue = quote.value;

        for (const alert of alerts) {
            let shouldTrigger = false;

            if (alert.type === 'above' && currentValue >= alert.value) {
                shouldTrigger = true;
            } else if (alert.type === 'below' && currentValue <= alert.value) {
                shouldTrigger = true;
            }

            if (shouldTrigger) {
                await triggerAlert(alert, currentValue);
            }
        }
    } catch (error) {
        console.error('[Service Worker] Erro ao verificar alertas:', error);
    }
}

// Disparar notificação
async function triggerAlert(alert, currentValue) {
    if (!('Notification' in self)) {
        return;
    }

    // Verificar permissão
    if (Notification.permission !== 'granted') {
        return;
    }

    const formattedValue = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    }).format(currentValue);

    const alertValueFormatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    }).format(alert.value);

    let message = alert.type === 'above'
        ? `Dólar atingiu ${formattedValue}! (acima de ${alertValueFormatted})`
        : `Dólar atingiu ${formattedValue}! (abaixo de ${alertValueFormatted})`;

    // Obter valor de conversão se existir
    try {
        const conversionValue = await getConversionFromDB();
        if (conversionValue) {
            const realAmount = conversionValue * currentValue;
            const formattedReal = new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(realAmount);
            message += ` | Valor convertido: ${formattedReal}`;
        }
    } catch (error) {
        console.error('[Service Worker] Erro ao obter valor de conversão:', error);
    }

    const notificationTag = `alert-${alert.id}`;

    const notificationOptions = {
        body: message,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
        tag: notificationTag,
        requireInteraction: false,
        renotify: true
    };

    await self.registration.showNotification('💵 Alerta de Cotação', notificationOptions);
}

// Notificar clientes sobre atualizações
function notifyClients(type, data) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({ type, data });
        });
    });
}

// Escutar mensagens do cliente
self.addEventListener('message', async (event) => {
    const { type, data } = event.data;

    switch (type) {
        case 'sync-alerts':
            // Alertas sincronizados pelo cliente - salvar no IndexedDB
            if (data && Array.isArray(data)) {
                try {
                    await saveAlertsToDB(data);
                    console.log('[Service Worker] Alertas sincronizados:', data.length);
                } catch (error) {
                    console.error('[Service Worker] Erro ao salvar alertas:', error);
                }
            }
            break;
        case 'sync-conversion':
            // Valor de conversão sincronizado pelo cliente - salvar no IndexedDB
            if (data !== null && data !== undefined) {
                try {
                    await saveConversionToDB(data);
                    console.log('[Service Worker] Valor de conversão sincronizado:', data);
                } catch (error) {
                    console.error('[Service Worker] Erro ao salvar valor de conversão:', error);
                }
            }
            break;
        case 'force-update':
            // Forçar atualização da cotação
            fetchQuote();
            break;
        case 'start-sync':
            // Iniciar sincronização
            startBackgroundSync();
            break;
        case 'stop-sync':
            // Parar sincronização
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            break;
    }
});

// Escutar cliques em notificações
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            // Se já existe uma janela aberta, focar nela
            for (let client of clients) {
                if ('focus' in client) {
                    return client.focus();
                }
            }
            // Caso contrário, abrir nova janela
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});

// Sincronização em background (quando o navegador permite)
self.addEventListener('sync', (event) => {
    if (event.tag === 'quote-sync') {
        event.waitUntil(fetchQuote());
    }
});

// Escutar push notifications (para futuras implementações)
self.addEventListener('push', (event) => {
    if (event.data) {
        const data = event.data.json();
        self.registration.showNotification(data.title, data.options);
    }
});
