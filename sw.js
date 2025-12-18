// ===============================
//  SW — Service Worker Corrigido
// ===============================

// Biblioteca IDB
importScripts('https://cdn.jsdelivr.net/npm/idb@8/build/umd.js');

// Nome do cache — altere ao atualizar
const CACHE_NAME = 'formulario-cache-v020';

// Arquivos ESSENCIAIS (mínimos)
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './sw.js'
];

// ===============================
// INSTALAÇÃO
// ===============================
self.addEventListener('install', event => {
    console.log('🟢 SW: Instalando...');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .catch(err => console.warn('⚠️ Falha ao cachear assets essenciais:', err))
            .then(() => self.skipWaiting())
    );
});

// ===============================
// ATIVAÇÃO
// ===============================
self.addEventListener('activate', event => {
    console.log('🔵 SW: Ativando...');

    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(
                names.map(name => {
                    if (name !== CACHE_NAME) {
                        console.log('🗑️ Removendo cache antigo:', name);
                        return caches.delete(name);
                    }
                })
            )
        ).then(() => self.clients.claim())
    );
});

// ===============================
// FETCH — Interceptação
// ===============================
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Ignorar requests que não são GET
    if (event.request.method !== 'GET') return;

    // ====== 1. REQUISIÇÕES PARA O VPS (sincronização) ======
    if (url.hostname === 'vps.pesoexato.com') {
        event.respondWith(fetch(event.request));
        return;
    }

    // ====== 2. CDNs externas → Cache first ======
    const isCDN =
        url.hostname.includes('cdnjs') ||
        url.hostname.includes('cdn.jsdelivr.net') ||
        url.hostname.includes('cdn.tailwindcss.com');

    if (isCDN) {
        event.respondWith(
            caches.match(event.request).then(cached => cached || fetch(event.request))
        );
        return;
    }

    // ====== 3. Conteúdo do app → Network first + cache ======
    if (url.hostname === location.hostname) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Atualiza o cache com a nova versão
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // Se falhou, tenta o cache
                    return caches.match(event.request).then(cached => {
                        if (cached) return cached;

                        // Fallback para HTML offline
                        if (event.request.mode === 'navigate') {
                            return caches.match('./index.html');
                        }

                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }
});

// ===============================
// PÁGINA OFFLINE OPCIONAL
// ===============================
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

// ===============================
// BACKGROUND SYNC
// ===============================
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync-formularios') {
        console.log('📱 Background Sync disparado!');
        event.waitUntil(sincronizarPendentes());
    }
});

// ===============================
// FUNÇÃO DE SINCRONIZAÇÃO
// ===============================
async function sincronizarPendentes() {
    try {
        const db = await idb.openDB('FormulariosDB', 4);
        const forms = await db.getAll('formularios');

        // 🔴 Pega APENAS UM formulário pendente
        const form = forms.find(f => !f.sincronizado);

        if (!form) {
            console.log('✅ Nenhum formulário pendente');
            return;
        }

        console.log(`🔄 Sincronizando formulário ${form.id}`);

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
            chave: form.chaveUnica
        };

        const response = await fetch('https://vps.pesoexato.com/servico_set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const data = await response.json(); // 👈 AGORA SIM
        
            form.sincronizado = true;
            form.syncedAt = new Date().toISOString();
        
            // ✅ ID REAL GERADO NO BANCO
            form.serverId = data.insertId;
        
            await db.put('formularios', form);
        
            console.log(
                `✅ Formulário ${form.id} sincronizado (serverId: ${data.insertId})`
            );
        } else {
            console.warn(`⚠️ Falha ao sincronizar ${form.id}`);
        }

        // ⛔ IMPORTANTE: NÃO continua loop
        // A próxima sincronização será OUTRA chamada

    } catch (err) {
        console.error('❌ Erro ao sincronizar:', err);
    }
}
