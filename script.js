// API endpoints para cotação do dólar (com fallback)
const API_URLS = [
    'https://economia.awesomeapi.com.br/json/last/USD-BRL',
    'https://api.exchangerate-api.com/v4/latest/USD'
];

let currentApiIndex = 0;
const API_URL = API_URLS[0];

// Configurações
const UPDATE_INTERVAL = 30000; // 30 segundos (recomendado pela API)
const UPDATE_INTERVAL_BACKGROUND = 60000; // 60 segundos quando em background

// Estado da aplicação
let currentQuote = null;
let previousQuote = null;
let alerts = [];
let updateInterval = null;
let isFetching = false; // Previne requisições sobrepostas
let activeNotifications = new Set(); // Rastreia notificações ativas
let conversionValue = null; // Valor em dólares para conversão
let serviceWorkerRegistration = null;

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    // Mostrar estado de carregamento inicial
    const quoteElement = document.getElementById('quoteValue');
    if (quoteElement) {
        quoteElement.textContent = 'Carregando...';
        quoteElement.style.color = '#666';
    }

    loadAlerts();
    loadConversionValue();
    requestNotificationPermission();
    registerServiceWorker();

    // Aguardar um pouco antes da primeira requisição para garantir que tudo está pronto
    setTimeout(() => {
        fetchQuote();
    }, 500);

    // Atualizar periodicamente
    startUpdateInterval();

    // Configurar botão de adicionar alerta
    document.getElementById('addAlertBtn').addEventListener('click', addAlert);

    // Configurar botão de testar notificação
    document.getElementById('testNotificationBtn').addEventListener('click', testNotification);

    // Configurar botão de salvar valor de conversão
    document.getElementById('saveConversionBtn').addEventListener('click', saveConversionValue);

    // Otimizar quando a aba fica em background
    setupVisibilityHandling();

    // Cleanup quando a página é fechada
    window.addEventListener('beforeunload', cleanup);
});

// Registrar Service Worker
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            serviceWorkerRegistration = registration;
            console.log('[Service Worker] Registrado com sucesso:', registration.scope);

            // Aguardar o service worker estar pronto
            if (registration.installing) {
                console.log('[Service Worker] Instalando...');
            } else if (registration.waiting) {
                console.log('[Service Worker] Aguardando...');
            } else if (registration.active) {
                console.log('[Service Worker] Ativo');
                syncDataWithServiceWorker();
            }

            // Escutar atualizações do service worker
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'activated') {
                        console.log('[Service Worker] Nova versão ativada');
                        syncDataWithServiceWorker();
                    }
                });
            });

            // Escutar mensagens do service worker
            navigator.serviceWorker.addEventListener('message', (event) => {
                const { type, data } = event.data;

                if (type === 'quote-updated') {
                    // Atualizar UI se a página estiver visível
                    if (!document.hidden && data) {
                        currentQuote = {
                            value: data.value,
                            timestamp: new Date(data.timestamp),
                            change: data.change
                        };
                        updateUI();
                    }
                }
            });

        } catch (error) {
            console.error('[Service Worker] Erro ao registrar:', error);
        }
    } else {
        console.log('[Service Worker] Não suportado neste navegador');
    }
}

// Sincronizar dados com o service worker
function syncDataWithServiceWorker() {
    if (!serviceWorkerRegistration || !serviceWorkerRegistration.active) {
        return;
    }

    // Sincronizar alertas
    serviceWorkerRegistration.active.postMessage({
        type: 'sync-alerts',
        data: alerts
    });

    // Sincronizar valor de conversão
    serviceWorkerRegistration.active.postMessage({
        type: 'sync-conversion',
        data: conversionValue
    });
}

// Solicitar permissão para notificações
async function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

// Testar notificação
async function testNotification() {
    if (!('Notification' in window)) {
        alert('Este navegador não suporta notificações');
        return;
    }

    if (Notification.permission === 'denied') {
        alert('Permissão de notificação foi negada. Por favor, permita notificações nas configurações do navegador.');
        return;
    }

    if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert('Permissão de notificação é necessária para receber alertas.');
            return;
        }
    }

    // Criar notificação de teste
    const testValue = currentQuote
        ? currentQuote.value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        })
        : 'R$ 5,000';

    let testMessage = `Esta é uma notificação de teste! A cotação atual é ${testValue}.`;

    // Adicionar valor convertido se existir
    if (conversionValue && currentQuote) {
        // Calcular valor em reais (valor em dólares * cotação)
        const realAmount = conversionValue * (currentQuote.value - 0.02);
        const formattedReal = realAmount.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        testMessage += ` | Valor convertido: ${formattedReal}`;
    }

    const notification = new Notification('💵 Teste de Notificação', {
        body: testMessage,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
        tag: 'test-notification',
        silent: false,
        requireInteraction: false
    });

    activeNotifications.add(notification);

    notification.onclick = () => {
        window.focus();
        notification.close();
        activeNotifications.delete(notification);
    };

    // Fechar automaticamente após 5 segundos
    setTimeout(() => {
        try {
            notification.close();
            activeNotifications.delete(notification);
        } catch (e) {
            // Ignorar erros
        }
    }, 5000);
}

// Buscar cotação do dólar
async function fetchQuote() {
    // Prevenir requisições sobrepostas
    if (isFetching) {
        return;
    }

    isFetching = true;

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
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
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
            changeValue = 0; // Esta API não fornece variação percentual
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
            console.warn('Estrutura da API recebida:', data);
            throw new Error('Valor da cotação não encontrado ou inválido');
        }

        previousQuote = currentQuote;
        currentQuote = {
            value: quoteValue,
            timestamp: new Date(),
            change: changeValue
        };

        updateUI();
        checkAlerts();

        // Resetar índice da API em caso de sucesso
        currentApiIndex = 0;
    } catch (error) {
        console.error('Erro ao buscar cotação:', error);
        console.error('URL tentada:', API_URLS[currentApiIndex]);

        // Tentar API alternativa se disponível
        if (currentApiIndex < API_URLS.length - 1) {
            currentApiIndex++;
            console.log(`Tentando API alternativa: ${API_URLS[currentApiIndex]}`);
            isFetching = false;
            setTimeout(() => fetchQuote(), 1000);
            return;
        }

        const quoteElement = document.getElementById('quoteValue');
        if (quoteElement) {
            quoteElement.textContent = 'Erro ao carregar';
            quoteElement.style.color = '#ef4444';
        }

        // Resetar índice e tentar novamente após 5 segundos
        currentApiIndex = 0;
        setTimeout(() => {
            if (!currentQuote) {
                fetchQuote();
            }
        }, 5000);
    } finally {
        isFetching = false;
    }
}

// Atualizar interface
function updateUI() {
    if (!currentQuote) return;

    const quoteElement = document.getElementById('quoteValue');
    if (!quoteElement) return;

    // Atualizar valor
    const formattedValue = currentQuote.value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
    quoteElement.textContent = formattedValue;
    quoteElement.style.color = '#2d3748'; // Resetar cor em caso de erro anterior

    // Atualizar variação
    const changeElement = document.getElementById('changeValue');
    const changeValue = currentQuote.change || 0;
    changeElement.textContent = `${changeValue >= 0 ? '+' : ''}${changeValue.toFixed(3)}%`;
    changeElement.className = `change-value ${changeValue >= 0 ? 'positive' : 'negative'}`;

    // Atualizar hora
    const timeString = currentQuote.timestamp.toLocaleTimeString('pt-BR');
    document.getElementById('updateTime').textContent = timeString;

    // Atualizar valor convertido
    updateConvertedValue();
}

// Adicionar alerta
function addAlert() {
    const type = document.getElementById('alertType').value;
    const value = parseFloat(document.getElementById('alertValue').value);

    if (!value || value <= 0) {
        alert('Por favor, insira um valor válido');
        return;
    }

    const alert = {
        id: Date.now(),
        type: type,
        value: value,
        triggered: false
    };

    alerts.push(alert);
    saveAlerts();
    renderAlerts();
    syncDataWithServiceWorker(); // Sincronizar com service worker

    // Limpar formulário
    document.getElementById('alertValue').value = '';
}

// Remover alerta
function removeAlert(id) {
    alerts = alerts.filter(alert => alert.id !== id);
    saveAlerts();
    renderAlerts();
    syncDataWithServiceWorker(); // Sincronizar com service worker
}

// Renderizar lista de alertas
function renderAlerts() {
    const alertsList = document.getElementById('alertsList');

    if (alerts.length === 0) {
        alertsList.innerHTML = '<p class="no-alerts">Nenhum alerta configurado</p>';
        return;
    }

    alertsList.innerHTML = alerts.map(alert => `
        <div class="alert-item">
            <div class="alert-info">
                <div class="alert-type ${alert.type}">
                    ${alert.type === 'above' ? 'Acima de' : 'Abaixo de'}
                </div>
                <div class="alert-value">
                    ${alert.value.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    })}
                </div>
            </div>
            <button class="delete-btn" onclick="removeAlert(${alert.id})">Remover</button>
        </div>
    `).join('');
}

// Verificar alertas
function checkAlerts() {
    if (!currentQuote || alerts.length === 0) return;

    const currentValue = currentQuote.value;

    alerts.forEach(alert => {
        // if (alert.triggered) return;

        let shouldTrigger = false;

        if (alert.type === 'above' && currentValue >= alert.value) {
            shouldTrigger = true;
        } else if (alert.type === 'below' && currentValue <= alert.value) {
            shouldTrigger = true;
        }

        if (shouldTrigger) {
            triggerAlert(alert, currentValue);
            // alert.triggered = true;
            saveAlerts();
        }
    });
}

// Salvar alertas no localStorage
function saveAlerts() {
    localStorage.setItem('dollarAlerts', JSON.stringify(alerts));
}

// Carregar alertas do localStorage
function loadAlerts() {
    const saved = localStorage.getItem('dollarAlerts');
    if (saved) {
        alerts = JSON.parse(saved);
        renderAlerts();
    }
    // Sincronizar após carregar
    setTimeout(() => syncDataWithServiceWorker(), 1000);
}

// Salvar valor de conversão no localStorage
function saveConversionValue() {
    const value = parseFloat(document.getElementById('conversionValue').value);

    if (!value || value <= 0) {
        alert('Por favor, insira um valor válido maior que zero');
        return;
    }

    conversionValue = value;
    localStorage.setItem('dollarConversionValue', JSON.stringify(conversionValue));
    syncDataWithServiceWorker(); // Sincronizar com service worker

    // Atualizar exibição do valor convertido
    updateConvertedValue();

    // Limpar campo
    document.getElementById('conversionValue').value = '';
}

// Carregar valor de conversão do localStorage
function loadConversionValue() {
    const saved = localStorage.getItem('dollarConversionValue');
    if (saved) {
        conversionValue = JSON.parse(saved);
        // Preencher campo com o valor salvo
        document.getElementById('conversionValue').value = conversionValue;
    }
    // Sincronizar após carregar
    setTimeout(() => syncDataWithServiceWorker(), 1000);
}

// Atualizar exibição do valor convertido
function updateConvertedValue() {
    const container = document.getElementById('convertedValueContainer');
    const amountElement = document.getElementById('convertedAmount');

    if (!conversionValue || !currentQuote) {
        container.style.display = 'none';
        return;
    }

    // Calcular valor em reais (valor em dólares * cotação)
    const realAmount = conversionValue * (currentQuote.value - 0.02);

    // Formatar valor em reais
    const formattedReal = realAmount.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    amountElement.textContent = formattedReal;
    container.style.display = 'block';
}

// Gerenciar intervalo de atualização
function startUpdateInterval() {
    // Limpar intervalo existente se houver
    if (updateInterval) {
        clearInterval(updateInterval);
    }

    const interval = document.hidden ? UPDATE_INTERVAL_BACKGROUND : UPDATE_INTERVAL;
    updateInterval = setInterval(fetchQuote, interval);
}

// Configurar otimização quando a aba fica em background
function setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Aba em background: aumentar intervalo para economizar recursos
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = setInterval(fetchQuote, UPDATE_INTERVAL_BACKGROUND);
            }
        } else {
            // Aba visível: voltar ao intervalo normal e atualizar imediatamente
            if (updateInterval) {
                clearInterval(updateInterval);
            }
            fetchQuote(); // Atualizar imediatamente ao voltar
            updateInterval = setInterval(fetchQuote, UPDATE_INTERVAL);
        }
    });
}

// Cleanup de recursos
function cleanup() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }

    // Fechar todas as notificações ativas
    activeNotifications.forEach(notification => {
        try {
            notification.close();
        } catch (e) {
            // Ignorar erros ao fechar
        }
    });
    activeNotifications.clear();
}

// Disparar notificação
function triggerAlert(alert, currentValue) {
    if (!('Notification' in window)) {
        console.log('Este navegador não suporta notificações');
        return;
    }

    if (Notification.permission === 'granted') {
        const formattedValue = currentValue.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });

        const alertValueFormatted = alert.value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });

        let message = alert.type === 'above'
            ? `Dólar atingiu ${formattedValue}! (acima de ${alertValueFormatted})`
            : `Dólar atingiu ${formattedValue}! (abaixo de ${alertValueFormatted})`;

        // Adicionar valor convertido se existir
        if (conversionValue) {
            // Calcular valor em reais (valor em dólares * cotação)
            const realAmount = conversionValue * currentValue;
            const formattedReal = realAmount.toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            message += ` | Valor convertido: ${formattedReal}`;
        }

        // Fechar notificação anterior do mesmo alerta se existir
        const notificationTag = `alert-${alert.id}`;
        activeNotifications.forEach(notif => {
            if (notif.tag === notificationTag) {
                try {
                    notif.close();
                    activeNotifications.delete(notif);
                } catch (e) {
                    // Ignorar erros
                }
            }
        });

        const notification = new Notification('💵 Alerta de Cotação', {
            body: message,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
            badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💵</text></svg>',
            tag: notificationTag,
            silent: false,
            requireInteraction: false
        });

        activeNotifications.add(notification);

        notification.onclick = () => {
            window.focus();
            notification.close();
            activeNotifications.delete(notification);
        };

        // Fechar automaticamente após 10 segundos e remover do set
        setTimeout(() => {
            try {
                notification.close();
                activeNotifications.delete(notification);
            } catch (e) {
                // Ignorar erros
            }
        }, 10000);
    } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                triggerAlert(alert, currentValue);
            }
        });
    }
}

// Expor função para o HTML
window.removeAlert = removeAlert;
