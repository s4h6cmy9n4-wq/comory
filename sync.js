// ── Sync temps réel — comory ──────────────────────────────────────────────────
// Synchronise le canvas et les objets placés entre tous les appareils connectés
// à la même salle Firebase (window.COMORY_ROOM).
//
// Flux :
//   Modification locale → saveState() → _syncSchedule() → debounce 4 s → pushState()
//   → Firebase RTDB → listener distant → applyRemote() → setBoardState()
//
// Le canvas est compressé en JPEG 70 % à 50 % de résolution (~30-80 KB),
// amplement suffisant pour un affichage tableau de classe.
// ─────────────────────────────────────────────────────────────────────────────

(function initSync() {
    'use strict';

    // ── Vérification de la config ─────────────────────────────────────────────
    const cfg = window.COMORY_FIREBASE;
    if (!cfg || !cfg.apiKey || cfg.apiKey === 'VOTRE_API_KEY') {
        console.info('[Sync] Config Firebase manquante → mode local uniquement.');
        _showIndicator('off');
        return;
    }

    // ── Initialisation Firebase ───────────────────────────────────────────────
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    const db   = firebase.database();
    const room = window.COMORY_ROOM || 'salle-principale';

    // ID unique pour cette session (évite de s'appliquer ses propres changements)
    const SID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    let dirty     = false;   // état modifié depuis la dernière sync
    let syncTimer = null;    // timer debounce
    let receiving = false;   // en train d'appliquer un changement distant
    let currentBoardId  = null;
    let boardListener   = null;

    const DEBOUNCE_MS = 4000; // 4 s après la dernière modification locale

    // ── Compression canvas → base64 JPEG ─────────────────────────────────────
    function canvasToSyncData(imageData) {
        // Canvas source (pleine résolution)
        const src = document.createElement('canvas');
        src.width = imageData.width; src.height = imageData.height;
        src.getContext('2d').putImageData(imageData, 0, 0);

        // Canvas destination (50 % — 4× moins de données)
        const dst = document.createElement('canvas');
        dst.width  = Math.round(imageData.width  / 2);
        dst.height = Math.round(imageData.height / 2);
        const ctx  = dst.getContext('2d');
        // Fond opaque blanc pour le JPEG (pas d'alpha)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dst.width, dst.height);
        ctx.drawImage(src, 0, 0, dst.width, dst.height);

        return dst.toDataURL('image/jpeg', 0.70);
    }

    // ── Décompression base64 JPEG → ImageData ─────────────────────────────────
    function syncDataToImageData(dataURL, targetW, targetH) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const c   = document.createElement('canvas');
                c.width   = targetW; c.height = targetH;
                const ctx = c.getContext('2d');
                ctx.clearRect(0, 0, targetW, targetH);
                ctx.drawImage(img, 0, 0, targetW, targetH);
                resolve(ctx.getImageData(0, 0, targetW, targetH));
            };
            img.onerror = reject;
            img.src = dataURL;
        });
    }

    // ── Push : envoyer l'état local vers Firebase ─────────────────────────────
    async function pushState() {
        if (receiving) return;
        if (!window.getBoardState) return;

        const state = window.getBoardState();
        if (!state?.imageData) return;

        const bid        = parseInt(localStorage.getItem('mory_active_id') || '1');
        const canvasData = canvasToSyncData(state.imageData);

        try {
            await db.ref(`rooms/${room}/boards/${bid}`).set({
                canvas:  canvasData,
                cw:      state.imageData.width,
                ch:      state.imageData.height,
                objs:    JSON.stringify(state.objs || []),
                ui:      JSON.stringify(state.ui   || {}),
                sid:     SID,
                ts:      firebase.database.ServerValue.TIMESTAMP
            });
            await db.ref(`rooms/${room}/meta`).set({
                active: bid,
                sid:    SID,
                ts:     firebase.database.ServerValue.TIMESTAMP
            });
            dirty = false;
            _showIndicator('ok');
        } catch (err) {
            console.warn('[Sync] Push échoué :', err.message);
            _showIndicator('err');
        }
    }

    // ── Debounce : schedule un push après la dernière modif ──────────────────
    function schedulePush() {
        if (receiving) return; // ne pas renvoyer un état reçu
        dirty = true;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(pushState, DEBOUNCE_MS);
    }

    // ── Pull : appliquer un état distant ─────────────────────────────────────
    async function applyRemote(data) {
        if (!data || data.sid === SID) return; // ignorer nos propres envois
        if (!window.setBoardState) return;

        receiving = true;
        _showIndicator('rx');
        try {
            const imageData = await syncDataToImageData(
                data.canvas, data.cw || 2500, data.ch || 2500
            );
            const objs = JSON.parse(data.objs || '[]');
            const ui   = JSON.parse(data.ui   || '{}');
            window.setBoardState({ imageData, objs, ui });
        } catch (err) {
            console.warn('[Sync] Pull échoué :', err.message);
        }
        receiving = false;
        _showIndicator('ok');
    }

    // ── Écouter un tableau Firebase ───────────────────────────────────────────
    function listenBoard(boardId) {
        if (boardId === currentBoardId && boardListener) return;

        // Détacher l'ancien listener
        if (boardListener && currentBoardId !== null) {
            db.ref(`rooms/${room}/boards/${currentBoardId}`).off('value', boardListener);
        }

        currentBoardId = boardId;
        boardListener  = snap => applyRemote(snap.val());
        db.ref(`rooms/${room}/boards/${boardId}`).on('value', boardListener);
    }

    // ── Listener changement de tableau (autre appareil) ───────────────────────
    db.ref(`rooms/${room}/meta`).on('value', snap => {
        const meta = snap.val();
        if (!meta || meta.sid === SID) return;
        // Un autre appareil a changé de tableau → écouter le bon tableau
        listenBoard(meta.active);
        // Mettre à jour l'id actif localement (sans recharger depuis IndexedDB)
        if (window._syncActivateBoard) window._syncActivateBoard(meta.active);
    });

    // ── Connexion Firebase ────────────────────────────────────────────────────
    db.ref('.info/connected').on('value', snap => {
        _showIndicator(snap.val() ? 'ok' : 'err');
    });

    // ── Indicateur visuel (petit point en bas à droite) ───────────────────────
    function _showIndicator(state) {
        const el = document.getElementById('sync-dot');
        if (!el) return;
        const colors = { ok: '#22c55e', err: '#ef4444', rx: '#3b82f6', off: '#94a3b8' };
        el.style.background = colors[state] || colors.off;
        el.title = {
            ok:  'Sync connecté',
            err: 'Sync déconnecté',
            rx:  'Réception en cours…',
            off: 'Sync désactivé (config manquante)'
        }[state] || '';
    }

    // ── Points d'entrée exposés à lejava.js ───────────────────────────────────
    window._syncSchedule   = schedulePush;   // appelé par saveState()
    window._syncListenBoard = listenBoard;   // appelé au changement de tableau

    // ── Init : démarrer sur le tableau actif ──────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const bid = parseInt(localStorage.getItem('mory_active_id') || '1');
        listenBoard(bid);

        // Écouter les changements de tableau locaux
        document.addEventListener('comory-board-changed', e => {
            if (e.detail?.boardId) listenBoard(e.detail.boardId);
        });
    });

    console.info('[Sync] Prêt — salle :', room, '| session :', SID);
})();
