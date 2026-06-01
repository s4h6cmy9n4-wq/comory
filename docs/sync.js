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

    let dirty                = false;   // état modifié depuis la dernière sync
    let syncTimer            = null;    // timer debounce
    let receiving            = false;   // en train d'appliquer un changement distant
    let initialSyncDone      = false;   // vrai après le premier contact Firebase (reçu ou null)
    let currentBoardId       = null;
    let boardListener        = null;
    let justSwitchedLocally  = false;   // bloque le premier fire Firebase après un switch local

    const DEBOUNCE_MS = 4000; // 4 s après la dernière modification locale

    // ── Compression canvas → base64 PNG (transparence préservée) ────────────
    // PNG est nécessaire car le canvas a un fond transparent (géré par CSS).
    // JPEG forçait un fond blanc opaque qui apparaissait comme un rectangle blanc.
    // PNG sur un canvas majoritairement transparent reste compact (~20-60 KB).
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
        // Pas de fond blanc — drawImage conserve la transparence
        ctx.drawImage(src, 0, 0, dst.width, dst.height);

        return dst.toDataURL('image/png');
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

    // ── Canvas vide ? transparent (alpha=0) OU entièrement blanc opaque (JPEG blank)
    function isBlankCanvas(imageData) {
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a === 0) continue;               // pixel transparent → ignore
            if (d[i] < 250 || d[i+1] < 250 || d[i+2] < 250) return false; // couleur réelle
        }
        return true; // tout transparent ou tout blanc → vide
    }

    // ── Push : envoyer l'état local vers Firebase ─────────────────────────────
    async function pushState() {
        if (receiving) return;
        if (!window.getBoardState) return;

        const state = window.getBoardState();
        if (!state?.imageData) return;

        // Protection démarrage : ne pas écraser l'état distant avec le canvas vide
        // initial (avant que Firebase ait répondu). Après le premier contact Firebase
        // (initialSyncDone = true), on pousse toujours — y compris canvas vide intentionnel
        // (suppression de tous les objets, effacement du tableau).
        const hasObjs = state.objs && state.objs.length > 0;
        if (!initialSyncDone && isBlankCanvas(state.imageData) && !hasObjs) return;

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
        // Données absentes ou envoyées par nous-mêmes → marquer init terminée et sortir
        if (!data || data.sid === SID) { justSwitchedLocally = false; initialSyncDone = true; return; }
        // Switch local en cours : ignorer le premier fire Firebase (données périmées)
        // Le push _syncForcePush qui suit envoie la version IDB, après quoi le flag
        // est effacé par la branche data.sid === SID ci-dessus.
        if (justSwitchedLocally) { justSwitchedLocally = false; initialSyncDone = true; return; }
        if (!window.setBoardState) return;

        receiving = true;
        _showIndicator('rx');
        try {
            const imageData = await syncDataToImageData(
                data.canvas, data.cw || 3500, data.ch || 3500
            );
            const objs = JSON.parse(data.objs || '[]');
            const ui   = { ...JSON.parse(data.ui || '{}'), _fromSync: true };
            // On applique TOUJOURS l'état reçu, y compris un canvas vide :
            // si l'expéditeur a envoyé un canvas vide c'est intentionnel
            // (suppression de tous les objets). La protection côté push
            // (initialSyncDone) empêche déjà les envois parasites au démarrage.
            window.setBoardState({ imageData, objs, ui });
        } catch (err) {
            console.warn('[Sync] Pull échoué :', err.message);
        }
        receiving = false;
        initialSyncDone = true; // le premier contact Firebase est établi
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
    window._syncSchedule    = schedulePush;  // appelé par saveState()
    window._syncListenBoard = listenBoard;   // appelé au changement de tableau

    // Push immédiat du meta (active board) sans attendre le debounce canvas.
    // Utilisé au changement de tableau : les autres appareils reçoivent l'info
    // instantanément et basculent sur le bon tableau.
    window._syncPushMeta = async function(bid) {
        if (receiving) return;
        try {
            await db.ref(`rooms/${room}/meta`).set({
                active: bid,
                sid:    SID,
                ts:     firebase.database.ServerValue.TIMESTAMP
            });
        } catch(e) { /* silencieux */ }
    };

    // Push immédiat du canvas après un changement de tableau local.
    // Contourne le debounce de 4 s pour que les autres appareils (ex: ordinateur)
    // reçoivent immédiatement le contenu du tableau sélectionné.
    window._syncForcePush = function() {
        initialSyncDone = true; // garantit que le push s'exécute même si le canvas est vide
        return pushState();
    };

    // Marquer qu'un switch de tableau LOCAL est en cours.
    // Bloque le prochain fire Firebase (données périmées) sur le nouveau tableau.
    window._syncMarkLocalSwitch = function() { justSwitchedLocally = true; };

    // Push la liste de tableaux vers Firebase (appelé depuis saveBoardList).
    // Permet au mobile enseignant de connaître tous les tableaux du desktop.
    window._syncPushBoardList = async function(list, nextId) {
        if (receiving) return;
        try {
            await db.ref(`rooms/${room}/boardList`).set({
                list:   JSON.stringify(list || []),
                nextId: nextId || 1,
                sid:    SID,
                ts:     firebase.database.ServerValue.TIMESTAMP
            });
        } catch(e) { /* silencieux */ }
    };

    // Écouter les changements de liste de tableaux (autre appareil → met à jour le carrousel)
    db.ref(`rooms/${room}/boardList`).on('value', snap => {
        const data = snap.val();
        if (!data || data.sid === SID) return;
        try {
            const list = JSON.parse(data.list || '[]');
            window._syncApplyBoardList?.(list, data.nextId);
        } catch(e) { /* silencieux */ }
    });

    // ── Init : démarrer sur le tableau actif ──────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const bid = parseInt(localStorage.getItem('mory_active_id') || '1');

        // Nettoyer les entrées Firebase invalides :
        // - format JPEG (data:image/jpeg…) → fond blanc opaque
        // - PNG entièrement blanc (artefact d'une ancienne sync JPEG)
        db.ref(`rooms/${room}/boards/${bid}`).once('value').then(async snap => {
            initialSyncDone = true; // Firebase a répondu — les pushs vides sont désormais autorisés
            const val = snap.val();
            if (!val?.canvas) return;
            let shouldPurge = val.canvas.startsWith('data:image/jpeg');
            if (!shouldPurge && val.canvas.startsWith('data:image/png')) {
                // Vérifier si c'est un PNG entièrement blanc (sans objets réels)
                const hasObjs = val.objs && JSON.parse(val.objs || '[]').length > 0;
                if (!hasObjs) {
                    const imageData = await syncDataToImageData(val.canvas, val.cw || 3500, val.ch || 3500).catch(() => null);
                    if (imageData && isBlankCanvas(imageData)) shouldPurge = true;
                }
            }
            if (shouldPurge) db.ref(`rooms/${room}/boards/${bid}`).remove();
        }).catch(() => { initialSyncDone = true; });

        listenBoard(bid);

        // Écouter les changements de tableau locaux
        document.addEventListener('comory-board-changed', e => {
            if (e.detail?.boardId) listenBoard(e.detail.boardId);
        });
    });

    console.info('[Sync] Prêt — salle :', room, '| session :', SID);
})();
