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
let quoteHistory = []; // Histórico de cotações para o gráfico
const MAX_HISTORY_LENGTH = 50; // Máximo de pontos no gráfico
let chartPoints = []; // Armazenar posições dos pontos do gráfico para hover
let hoveredPointIndex = -1; // Índice do ponto sendo hovered

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

    // Inicializar gráfico
    let resizeTimeout;
    function resizeCanvas() {
        const canvas = document.getElementById('quoteChart');
        if (canvas) {
            // Limpar timeout anterior
            clearTimeout(resizeTimeout);

            // Usar timeout para evitar múltiplas chamadas durante o resize
            resizeTimeout = setTimeout(() => {
                // Forçar recalculo do layout
                const container = canvas.parentElement;
                if (container) {
                    // Garantir que o container tenha largura definida
                    const containerWidth = container.clientWidth || container.offsetWidth;
                    const containerHeight = container.clientHeight || 200;

                    // Ajustar tamanho do canvas para alta resolução
                    const dpr = window.devicePixelRatio || 1;
                    const availableWidth = Math.max(containerWidth - 32, 200); // Subtrair padding
                    const availableHeight = Math.max(containerHeight - 100, 180); // Subtrair padding e título

                    canvas.width = availableWidth * dpr;
                    canvas.height = availableHeight * dpr;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(dpr, dpr);
                    canvas.style.width = availableWidth + 'px';
                    canvas.style.height = availableHeight + 'px';

                    // Redesenhar gráfico se houver dados
                    if (quoteHistory.length > 0) {
                        hoveredPointIndex = -1; // Resetar hover ao redimensionar
                        updateChart();
                    }
                }
            }, 100);
        }
    }

    // Aguardar um frame para garantir que o layout está pronto
    requestAnimationFrame(() => {
        resizeCanvas();
    });

    // Também redimensionar quando a página estiver totalmente carregada
    if (document.readyState === 'complete') {
        setTimeout(resizeCanvas, 100);
    } else {
        window.addEventListener('load', () => {
            setTimeout(resizeCanvas, 100);
        });
    }

    window.addEventListener('resize', resizeCanvas);

    // Também escutar mudanças de orientação
    window.addEventListener('orientationchange', () => {
        setTimeout(resizeCanvas, 300);
    });

    // Adicionar interatividade ao gráfico (hover)
    setupChartInteractivity();

    // Aguardar um pouco antes da primeira requisição para garantir que tudo está pronto
    setTimeout(() => {
        fetchQuote();
        // Redimensionar canvas após buscar dados
        setTimeout(resizeCanvas, 200);
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

        // Adicionar à lista de histórico
        quoteHistory.push({
            value: quoteValue,
            timestamp: currentQuote.timestamp
        });

        // Limitar o tamanho do histórico
        if (quoteHistory.length > MAX_HISTORY_LENGTH) {
            quoteHistory.shift(); // Remove o mais antigo
        }

        updateUI();
        updateChart();
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
            quoteElement.style.color = 'var(--error, #ef4444)';
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
    quoteElement.style.color = ''; // Resetar cor em caso de erro anterior

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

// Atualizar gráfico de cotações
function updateChart() {
    const canvas = document.getElementById('quoteChart');
    if (!canvas || quoteHistory.length === 0) return;

    // Garantir que o canvas tenha tamanho correto antes de desenhar
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        // Se o canvas não tem tamanho, tentar redimensionar
        resizeCanvas();
        return;
    }

    // Limpar pontos anteriores
    chartPoints = [];

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    // O canvas já está dimensionado com dpr, então precisamos usar o tamanho CSS
    const width = rect.width || canvas.offsetWidth || 400;
    const height = rect.height || canvas.offsetHeight || 200;

    // Limpar canvas (usar dimensões físicas que já incluem dpr)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (quoteHistory.length < 2) {
        // Se há apenas um ponto, não há linha para desenhar
        return;
    }

    // Calcular valores mínimo e máximo para escala
    const values = quoteHistory.map(q => q.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue || 1; // Evitar divisão por zero

    // Padding para o gráfico (ajustado para mobile)
    const isMobile = window.innerWidth <= 640;
    const padding = {
        top: 20,
        right: isMobile ? 10 : 20,
        bottom: isMobile ? 25 : 30,
        left: isMobile ? 35 : 50
    };

    // Garantir que temos espaço suficiente para o gráfico
    const chartWidth = Math.max(width - padding.left - padding.right, 100);
    const chartHeight = Math.max(height - padding.top - padding.bottom, 80);

    // Desenhar eixos
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;

    // Linha horizontal (eixo X)
    ctx.beginPath();
    ctx.moveTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    // Linha vertical (eixo Y)
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.stroke();

    // Garantir que não desenhamos fora dos limites
    const maxX = Math.min(width - padding.right, canvas.width / dpr);
    const maxY = Math.min(height - padding.bottom, canvas.height / dpr);

    // Desenhar linhas de referência (grid)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 0.5 / dpr; // Ajustar para dpr
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(maxX, y);
        ctx.stroke();
    }

    // Desenhar valores no eixo Y
    ctx.fillStyle = '#475569';
    const fontSize = isMobile ? 9 : 10;
    ctx.font = `${fontSize}px "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Droid Sans Mono", "Source Code Pro", monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const value = maxValue - (range / 4) * i;
        const y = padding.top + (chartHeight / 4) * i;
        const xPosition = padding.left - (isMobile ? 5 : 10);
        ctx.fillText(value.toFixed(3), xPosition, y);
    }

    // Desenhar linha do gráfico
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = (1.5 / dpr); // Ajustar para dpr
    ctx.beginPath();

    quoteHistory.forEach((quote, index) => {
        const x = padding.left + (chartWidth / (quoteHistory.length - 1)) * index;
        const normalizedValue = (quote.value - minValue) / range;
        const y = padding.top + chartHeight - (normalizedValue * chartHeight);

        // Garantir que os pontos estão dentro dos limites
        const clampedX = Math.min(Math.max(x, padding.left), maxX);
        const clampedY = Math.min(Math.max(y, padding.top), maxY);

        if (index === 0) {
            ctx.moveTo(clampedX, clampedY);
        } else {
            ctx.lineTo(clampedX, clampedY);
        }
    });

    ctx.stroke();

    // Armazenar posições dos pontos para hover e desenhar pontos
    chartPoints = [];
    const pointRadius = isMobile ? 4 : 5;
    const hoverRadius = isMobile ? 8 : 10;

    quoteHistory.forEach((quote, index) => {
        const x = padding.left + (chartWidth / (quoteHistory.length - 1)) * index;
        const normalizedValue = (quote.value - minValue) / range;
        const y = padding.top + chartHeight - (normalizedValue * chartHeight);

        // Garantir que os pontos estão dentro dos limites
        const clampedX = Math.min(Math.max(x, padding.left), maxX);
        const clampedY = Math.min(Math.max(y, padding.top), maxY);

        // Armazenar posição do ponto
        chartPoints.push({
            x: clampedX,
            y: clampedY,
            value: quote.value,
            timestamp: quote.timestamp,
            index: index
        });

        // Desenhar ponto com destaque se estiver em hover
        const isHovered = hoveredPointIndex === index;
        const currentRadius = isHovered ? hoverRadius : pointRadius;

        // Círculo externo (branco) para destaque
        if (isHovered) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(clampedX, clampedY, currentRadius / dpr, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ponto principal
        ctx.fillStyle = isHovered ? '#2563eb' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(clampedX, clampedY, pointRadius / dpr, 0, Math.PI * 2);
        ctx.fill();

        // Borda branca para melhor visibilidade
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 / dpr;
        ctx.stroke();
    });

    // Desenhar área preenchida abaixo da linha
    if (quoteHistory.length >= 2) {
        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.15)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(padding.left, height - padding.bottom);

        quoteHistory.forEach((quote, index) => {
            const x = padding.left + (chartWidth / (quoteHistory.length - 1)) * index;
            const normalizedValue = (quote.value - minValue) / range;
            const y = padding.top + chartHeight - (normalizedValue * chartHeight);

            // Garantir que os pontos estão dentro dos limites
            const clampedX = Math.min(Math.max(x, padding.left), maxX);
            const clampedY = Math.min(Math.max(y, padding.top), maxY);

            ctx.lineTo(clampedX, clampedY);
        });

        ctx.lineTo(maxX, height - padding.bottom);
        ctx.closePath();
        ctx.fill();
    }

    // Esconder tooltip se não houver hover ativo
    if (hoveredPointIndex === -1) {
        const tooltip = document.getElementById('chartTooltip');
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }
}

// Configurar interatividade do gráfico (hover)
let chartInteractivitySetup = false;
function setupChartInteractivity() {
    const canvas = document.getElementById('quoteChart');
    const tooltip = document.getElementById('chartTooltip');
    if (!canvas || !tooltip || chartInteractivitySetup) return;

    const chartWrapper = canvas.parentElement;
    if (!chartWrapper) return;

    chartInteractivitySetup = true;
    let currentHoverIndex = -1;

    function getPointAtPosition(mouseX, mouseY) {
        const rect = canvas.getBoundingClientRect();
        const x = mouseX - rect.left;
        const y = mouseY - rect.top;
        const dpr = window.devicePixelRatio || 1;
        const isMobile = window.innerWidth <= 640;
        const hitRadius = isMobile ? 12 : 15;

        // Encontrar o ponto mais próximo
        let closestIndex = -1;
        let minDistance = Infinity;

        chartPoints.forEach((point, index) => {
            const distance = Math.sqrt(
                Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2)
            );
            if (distance < hitRadius && distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });

        return closestIndex;
    }

    function showTooltip(index, mouseX, mouseY) {
        if (index === -1 || !chartPoints[index]) {
            tooltip.style.display = 'none';
            return;
        }

        const point = chartPoints[index];
        const date = new Date(point.timestamp);
        const dateStr = date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const valueStr = point.value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });

        tooltip.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 2px;">${valueStr}</div>
            <div style="font-size: 10px; opacity: 0.9;">${dateStr}</div>
            <div style="font-size: 10px; opacity: 0.9;">${timeStr}</div>
        `;

        const rect = canvas.getBoundingClientRect();
        const wrapperRect = chartWrapper.getBoundingClientRect();

        // Posicionar tooltip acima do ponto
        let left = rect.left + point.x - wrapperRect.left;
        let top = rect.top + point.y - wrapperRect.top - 10;

        // Ajustar para não sair da tela
        const tooltipWidth = tooltip.offsetWidth || 120;
        const tooltipHeight = tooltip.offsetHeight || 60;

        if (left - tooltipWidth / 2 < 0) {
            left = tooltipWidth / 2;
        } else if (left + tooltipWidth / 2 > wrapperRect.width) {
            left = wrapperRect.width - tooltipWidth / 2;
        }

        if (top - tooltipHeight < 0) {
            top = rect.top + point.y - wrapperRect.top + 20;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        tooltip.style.display = 'block';
    }

    function hideTooltip() {
        tooltip.style.display = 'none';
        currentHoverIndex = -1;
        hoveredPointIndex = -1;
        // Redesenhar gráfico para remover destaque do ponto
        if (quoteHistory.length > 0) {
            updateChart();
        }
    }

    // Event listeners
    canvas.addEventListener('mousemove', (e) => {
        const pointIndex = getPointAtPosition(e.clientX, e.clientY);

        if (pointIndex !== currentHoverIndex) {
            currentHoverIndex = pointIndex;
            hoveredPointIndex = pointIndex;

            if (pointIndex !== -1) {
                showTooltip(pointIndex, e.clientX, e.clientY);
                updateChart(); // Redesenhar para destacar o ponto
            } else {
                hideTooltip();
            }
        } else if (pointIndex !== -1) {
            // Atualizar posição do tooltip se o mouse se mover
            showTooltip(pointIndex, e.clientX, e.clientY);
        }
    });

    canvas.addEventListener('mouseleave', () => {
        hideTooltip();
    });

    // Para mobile/touch
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const pointIndex = getPointAtPosition(touch.clientX, touch.clientY);

        if (pointIndex !== -1) {
            hoveredPointIndex = pointIndex;
            showTooltip(pointIndex, touch.clientX, touch.clientY);
            updateChart();
        }
    });

    canvas.addEventListener('touchend', () => {
        setTimeout(() => {
            hideTooltip();
        }, 2000); // Manter tooltip por 2 segundos no touch
    });
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
