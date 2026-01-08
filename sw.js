// ======== SERVICE WORKER: GERENCIADOR DE APLICAÇÃO PROGRESSIVA ========
// Implementação de PWA com estratégias de cache, offline-first e background sync

// Biblioteca IDB
importScripts('https://cdn.jsdelivr.net/npm/idb@8/build/umd.js');

// Nomenclatura de cache versionada para controle de atualizações
const CACHE_NAME = 'formulario-cache-v0051';

// Assets críticos para instalação mínima (Core Web Vitals)
const CORE_ASSETS = [
    './',				// Root path (resolve para index.html)
    './index.html',		// Ponto de entrada da aplicação
    './manifest.json',	// Configuração PWA
    './sw.js'			// Self-referência para atualização
];

// ======== EVENTO DE INSTALAÇÃO ========
// Bootstrap do Service Worker com caching estratégico
self.addEventListener('install', event => {
    console.log('🟢 SW: Instalando...');


	// Extensão do ciclo de vida da instalação
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .catch(err => console.warn('⚠️ Falha ao cachear assets essenciais:', err))
            .then(() => self.skipWaiting())
    );
});

// ======== EVENTO DE ATIVAÇÃO ========
// Cleanup e transição entre versões de cache
self.addEventListener('activate', event => {
    console.log('🔵 SW: Ativando...');

    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names.map(name => {
					// Estratégia de versionamento: remove caches legados
                    if (name !== CACHE_NAME) {
                        console.log('🗑️ Removendo cache antigo:', name);
                        return caches.delete(name);	// Garbage collection de caches obsoletos
                    }
                })
            )
        ).then(() => self.clients.claim())	// Assume controle imediato de todos os clients
    );
});

// ======== INTERCEPTAÇÃO DE REQUISIÇÕES (FETCH) ========
// Proxy HTTP com estratégias de cache diferenciadas por origem
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Filtro por método HTTP: apenas intercepta GET
    if (event.request.method !== 'GET') return;

    // ======== 1. REQUISIÇÕES PARA BACKEND (API) ========
    // Estratégia: Network-only (não cache)
    if (url.hostname === 'vps.pesoexato.com') {
        event.respondWith(fetch(event.request));	// Bypass de cache para dados dinâmicos
        return;
    }

    // ======== 2. CDNS EXTERNAS ========
    // Estratégia: Cache-first com fallback para network
    const isCDN =
        url.hostname.includes('cdnjs') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdn.tailwindcss.com');

    if (isCDN) {
        event.respondWith(
            caches.match(event.request).then(cached => cached || fetch(event.request)) // Cache hit -> retorna cache, miss -> network
        );
        return;
    }

    // ======== 3. ASSETS DA APLICAÇÃO LOCAL ========
    // Estratégia: Network-first com fallback para cache (Stale-While-Revalidate)
    if (url.hostname === location.hostname) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Atualiza o cache com a nova versão
                    const clone = response.clone();	// Clone para evitar consumption
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));	// Cache update pattern
                    return response;
                })
                .catch(() => {
                    // Se falhou, tenta o cache
                    return caches.match(event.request).then(cached => {
                        if (cached) return cached;

                        // Navigation requests: fallback para HTML offline
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }

						// API responses: retorna 503 Service Unavailable
                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }
});

// ======== PÁGINA OFFLINE (FALLBACK) ========
// Static response generator para navegações offline
function offlinePage() {
    return new Response(`
        <html>
        <body style="font-family:sans-serif;padding:30px;text-align:center;">
            <h2>Você está offline</h2>
            <p>Continue usando o app normalmente. A sincronização será feita quando a conexão voltar.</p>
        </body>
        </html>
    `, { headers: { 'Content-Type': 'text/html' }});
}

// ======== BACKGROUND SYNC ========
// Handler para sincronização em background (registrada via syncManager)
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync-formularios') {
        console.log('📱 Background Sync disparado!');
        event.waitUntil(sincronizarPendentes());	// Extende ciclo de vida do evento
    }
});

// ======== ENGINE DE SINCRONIZAÇÃO OFFLINE ========
// Processa pendências do IndexedDB quando a conexão é restaurada
async function sincronizarPendentes() {
    try {
		// Abertura de conexão com IndexedDB (versão compatível com cliente)
        const db = await idb.openDB('FormulariosDB', 4);
        const forms = await db.getAll('formularios');

        // Strategy: Processamento FIFO (First-In-First-Out)
        // Apenas um formulário por evento de sync para evitar timeout
        const form = forms.find(f => !f.sincronizado);

        if (!form) {
            console.log('✅ Nenhum formulário pendente');
            return;
        }

        console.log(`🔄 Sincronizando formulário ${form.id}`);

		// Estrutura de payload otimizada para endpoint específico
        const payload = {
            json_dados: {
                id: form.id,
                cliente: form.cliente,
                cidade: form.cidade,
                equipamento: form.equipamento,
                tecnico: form.tecnico,
                servico: form.servico,
        
                dataInicial: form.dataInicial,
                horaInicial: form.horaInicial,
                dataFinal: form.dataFinal,
                horaFinal: form.horaFinal,
        
                veiculo: form.veiculo,
                estoque: form.estoque,
                numeroSerie: form.numeroSerie,
        
                relatorioMaquina: form.relatorioMaquina,
        
                fotos: form.fotos,
                assinaturas: form.assinaturas,
        
                clienteNome: form.clienteNome,
                tecnicoNome: form.tecnicoNome,
        
                materiais: form.materiais,
        
                chaveUnica: form.chaveUnica
            },
            chave: form.chaveUnica	// Chave única para idempotência
        };

		// HTTP POST com timeout implícito do fetch API
        const response = await fetch('https://vps.pesoexato.com/servico_set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json(); // Parse da resposta JSON
        
			// Atomic update do registro no IndexedDB
            form.sincronizado = true;
            form.syncedAt = new Date().toISOString();
        
            // Persistência do ID gerado pelo servidor (foreign key)
            form.serverId = data.insertId;
			console.log(`💾 SW: serverId ${data.insertId} salvo para formulário ${form.id}`);
        
            await db.put('formularios', form);
        
            console.log(
                `✅ Formulário ${form.id} sincronizado (serverId: ${data.insertId})`
            );
        } else {
            console.warn(`⚠️ Falha ao sincronizar ${form.id}`);
        }

    } catch (err) {
        console.error('❌ Erro ao sincronizar:', err);
		// Fail silently - o navegador retentará automaticamente
    }
}
