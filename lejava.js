document.addEventListener('DOMContentLoaded', () => {

    const dropbox    = document.getElementById('dropbox');
    const fileInput  = document.getElementById('file-input');
    const coteGauche = document.querySelector('.cote-gauche');
    const conteneur  = document.querySelector('.mon-conteneur');
    const btnOeil    = document.getElementById('conteneur-oeil');
    const oeilOuvert = btnOeil.querySelector('.oeil-ouvert');
    const oeilFerme  = btnOeil.querySelector('.oeil-ferme');

    // ── ŒIL ── effet éthéré : estompe le canevas ────────────────────────────
    btnOeil.addEventListener('click', () => {
        const masque = conteneur.classList.toggle('contenu-masque');
        oeilOuvert.style.display = masque ? 'none' : '';
        oeilFerme.style.display  = masque ? '' : 'none';
        btnOeil.classList.toggle('actif', masque);
    });
    // ── AMPOULE ───────────────────────────────────────────────────────────────
    const btnLumiere = document.getElementById('conteneur-lumiere');
    btnLumiere.addEventListener('click', () => {
        btnLumiere.classList.toggle('allume');
        document.body.classList.toggle('mode-sombre');
    });

    // ── ÉTAT GLOBAL ──────────────────────────────────────────────────────────
    const paintState = { color: '#000000', thicknessPercent: 50, opacity: 1 };
    window.etatForme    = { type: 'rectangle', color: '#000000', thickness: 50, mode: 'fill', opacity: 1 };
    window.etatTableau  = { cols: 3, rows: 3, color: 'hsl(220,60%,25%)', thickness: 1.5 };
    window.activeToolMode  = null;
    window.tableEditMode   = false;
    const panelItemsActifs = new Set();

    // ── CANVAS ───────────────────────────────────────────────────────────────
    function initCanvas() {
        const planDeTravail = document.createElement('div');
        const CANVAS_SIZE = 2500;
        planDeTravail.style.cssText = `position:absolute; top:0; left:0; width:${CANVAS_SIZE}px; height:${CANVAS_SIZE}px; transform-origin: 0 0; z-index:3;`;
        conteneur.style.overflow = 'hidden';
        conteneur.appendChild(planDeTravail);

        const mainCanvas = document.createElement('canvas');
        mainCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:1.5mm;z-index:4;';
        planDeTravail.appendChild(mainCanvas);
        const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
        window.mainCanvas = mainCanvas; // Exposé pour l'export

        const draftCanvas = document.createElement('canvas');
        draftCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:1.5mm;cursor:default;z-index:5;';
        planDeTravail.appendChild(draftCanvas);
        const draftCtx = draftCanvas.getContext('2d');
        window.draftCanvas = draftCanvas; // Exposé pour l'export

        // Couche images (z:3 — sous le dessin, au-dessus du fond)
        const imageCanvas = document.createElement('canvas');
        imageCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border-radius:1.5mm;pointer-events:none;z-index:3;';
        planDeTravail.insertBefore(imageCanvas, mainCanvas);
        const imageCtx = imageCanvas.getContext('2d');

        let history = [], historyStep = -1;
        let placedObjects = []; // déclaré tôt — saveState() le sérialise dès initSize()

        function serializePlacedObjects() {
            return placedObjects.map(o => {
                const s = { type: o.type, src: o.el.src, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation || 0 };
                // Propriétés texte (pour re-rendu sans déformation)
                if (o._text)  { s._text = o._text; s._fontFamily = o._fontFamily; s._fontSize = o._fontSize; s._fontWeight = o._fontWeight; s._color = o._color; }
                // Métadonnées tableau (pour l'édition des cellules après switch de board)
                if (o.type === 'table') { s._cols = o._cols; s._rows = o._rows; s._innerPad = o._innerPad; }
                return s;
            });
        }
        // ── Fenêtre de projection (BroadcastChannel) ────────────────────────
        const projChannel = new BroadcastChannel('mory_projection');
        let projLastDraftBroadcast = 0;

        function broadcastState(draftDataUrl) {
            projChannel.postMessage({
                type: 'proj',
                bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#eee7e7',
                objs: serializePlacedObjects(),
                draft: draftDataUrl || null
            });
        }

        function saveState() {
            historyStep++;
            history.length = historyStep;
            history.push({
                imageData: mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height),
                objs: serializePlacedObjects()
            });
            broadcastState();
        }
        function restoreState(step) {
            const { imageData, objs } = history[step];
            mainCtx.putImageData(imageData, 0, 0);
            placedObjects.forEach(o => o.el.remove());
            placedObjects.length = 0;
            masquerSelection();
            objs.forEach(s => {
                const el = document.createElement('img');
                el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const obj = { type: s.type, el, x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation };
                if (s._text)  { obj._text = s._text; obj._fontFamily = s._fontFamily; obj._fontSize = s._fontSize; obj._fontWeight = s._fontWeight; obj._color = s._color; }
                if (s.type === 'table') { obj._cols = s._cols; obj._rows = s._rows; obj._innerPad = s._innerPad; }
                mettreAJourElement(obj);
                planDeTravail.appendChild(el);
                placedObjects.push(obj);
                el.src = s.src;
            });
        }
        function undo() { if (historyStep > 0) { historyStep--; restoreState(historyStep); } }
        function redo() { if (historyStep < history.length - 1) { historyStep++; restoreState(historyStep); } }
        function clearCanvas() {
            mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
            placedObjects.forEach(o => o.el.remove());
            placedObjects.length = 0;
            masquerSelection();
            saveState();
        }

        // Convertit le contenu de draftCanvas en objet placé sélectionnable
        function commitDraftToObject(type) {
            const CW = draftCanvas.width, CH = draftCanvas.height;
            let bbox = strokeBBox;
            if (!bbox) {
                const data = draftCtx.getImageData(0, 0, CW, CH).data;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let py = 0; py < CH; py++) {
                    for (let px = 0; px < CW; px++) {
                        if (data[(py * CW + px) * 4 + 3] > 0) {
                            if (px < minX) minX = px; if (px > maxX) maxX = px;
                            if (py < minY) minY = py; if (py > maxY) maxY = py;
                        }
                    }
                }
                if (minX === Infinity) { draftCtx.clearRect(0, 0, CW, CH); return; }
                bbox = { minX, minY, maxX, maxY };
            }
            const pad = 6;
            const x0 = Math.max(0, Math.floor(bbox.minX - pad));
            const y0 = Math.max(0, Math.floor(bbox.minY - pad));
            const x1 = Math.min(CW - 1, Math.ceil(bbox.maxX + pad));
            const y1 = Math.min(CH - 1, Math.ceil(bbox.maxY + pad));
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            if (bw <= 2 || bh <= 2) { draftCtx.clearRect(0, 0, CW, CH); strokeBBox = null; return; }
            const tmp = document.createElement('canvas');
            tmp.width = bw; tmp.height = bh;
            const tctx = tmp.getContext('2d');
            tctx.globalAlpha = (type === 'shape') ? (window.etatForme && window.etatForme.opacity !== undefined ? window.etatForme.opacity : 1)
                             : (type === 'table')  ? 1
                             : paintState.opacity;
            tctx.drawImage(draftCanvas, x0, y0, bw, bh, 0, 0, bw, bh);
            const dataURL = tmp.toDataURL('image/png');
            draftCtx.save(); draftCtx.setTransform(1,0,0,1,0,0);
            draftCtx.clearRect(0, 0, CW, CH); draftCtx.restore();
            draftCanvas.style.opacity = 1;
            strokeBBox = null;
            const el = document.createElement('img');
            el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
            const obj = { type, el, x: x0, y: y0, w: bw, h: bh, rotation: 0 };
            if (type === 'table') {
                const et = window.etatTableau || {};
                obj._cols     = et.cols || 3;
                obj._rows     = et.rows || 3;
                obj._innerPad = pad; // 6px — padding utilisé pour le bbox
            }
            mettreAJourElement(obj);
            planDeTravail.appendChild(el);
            placedObjects.push(obj);
            el.src = dataURL;
            saveState();
        }

        /** Dessine une grille de tableau sur le contexte canvas donné */
        function drawTableGrid(ctx, x0, y0, w, h, cols, rows) {
            ctx.beginPath();
            ctx.rect(x0, y0, w, h);
            for (let c = 1; c < cols; c++) {
                const lx = x0 + (w * c) / cols;
                ctx.moveTo(lx, y0); ctx.lineTo(lx, y0 + h);
            }
            for (let r = 1; r < rows; r++) {
                const ly = y0 + (h * r) / rows;
                ctx.moveTo(x0, ly); ctx.lineTo(x0 + w, ly);
            }
            ctx.stroke();
        }

        document.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); redo(); }
            if (mod && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); clearCanvas(); }
        });

        function initSize() {
            const dpr = 1;
            mainCanvas.width = CANVAS_SIZE * dpr; mainCanvas.height = CANVAS_SIZE * dpr; mainCtx.scale(dpr, dpr);
            draftCanvas.width = CANVAS_SIZE * dpr; draftCanvas.height = CANVAS_SIZE * dpr; draftCtx.scale(dpr, dpr);
            imageCanvas.width = CANVAS_SIZE * dpr; imageCanvas.height = CANVAS_SIZE * dpr;
            saveState();
        }
        initSize();
        window.setCanvasCursor = (cursor) => { draftCanvas.style.cursor = cursor; };

        const rectConteneur = conteneur.getBoundingClientRect();
        const fitScale = Math.min(rectConteneur.width / CANVAS_SIZE, rectConteneur.height / CANVAS_SIZE) * 0.96;
        let currentScale = fitScale;
        let currentTx = (rectConteneur.width  - CANVAS_SIZE * currentScale) / 2;
        let currentTy = (rectConteneur.height - CANVAS_SIZE * currentScale) / 2;
        planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;

        let isPanning = false, panStartX = 0, panStartY = 0;
        let isDrawing = false, lastX = 0, lastY = 0;

        // ── Helpers pan mobile (utilisés par initMobileTouch) ─────────────────
        window.mobileStartPan = (cx, cy) => {
            if (window.activeToolMode) return;
            isPanning  = true;
            panStartX  = cx - currentTx;
            panStartY  = cy - currentTy;
        };
        window.mobileUpdatePan = (cx, cy) => {
            if (!isPanning) return;
            currentTx = cx - panStartX;
            currentTy = cy - panStartY;
            planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;
        };
        window.mobileStopPan = () => { isPanning = false; };

        // Tap mobile → sélectionner l'objet sous le doigt
        window.mobileTap = (clientX, clientY) => {
            if (window.activeToolMode) return;
            const rect = draftCanvas.getBoundingClientRect();
            const cx = (clientX - rect.left) / currentScale;
            const cy = (clientY - rect.top)  / currentScale;
            const hit = hitTestAny(cx, cy);
            if (hit) {
                afficherSelection([hit]);
                majActionPanel();
            } else {
                if (selectedObjects.length > 0) masquerSelection();
            }
        };
        let shapeStartX = 0, shapeStartY = 0;
        let isSelecting = false, selectStartX = 0, selectStartY = 0, selectCurX = 0, selectCurY = 0;
        let lastPinchCenter = {x: 0, y: 0};
        let lastPinchDist = 0;
        let strokeBBox = null; // bounding box du trait en cours pour commitDraftToObject
        /* CONNECTEURS_START — décommenter pour réactiver
        let isConnecting = false;
        let connectStartX = 0, connectStartY = 0, connectEndX = 0, connectEndY = 0;
        let hoverEdge = null; // { x, y } point d'accroche le plus proche
        let selectedConnector = null; // objet stroke _isConnector sélectionné
        CONNECTEURS_END */

        function getPos(e) {
            const rect = draftCanvas.getBoundingClientRect();
            let clientX = e.touches ? e.touches[0].clientX : e.clientX;
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return [(clientX - rect.left) / currentScale, (clientY - rect.top) / currentScale];
        }

        draftCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

        draftCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.1;
            const delta = e.deltaY < 0 ? 1 : -1;
            let newScale = currentScale * (1 + delta * zoomSpeed);
            newScale = Math.max(0.2, Math.min(newScale, 10));
            const rect = conteneur.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            currentTx = mouseX - (mouseX - currentTx) * (newScale / currentScale);
            currentTy = mouseY - (mouseY - currentTy) * (newScale / currentScale);
            currentScale = newScale;
            planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;
            if (selectedObjects.length > 0) majActionPanel();
        }, {passive: false});

        function startInteraction(e) {
            // ── Blocage pendant l'édition de tableau ─────────────────────
            if (window.tableEditMode) return;

            // ── Clic DROIT → pan (quel que soit l'outil actif) ──────────────
            if (e.type === 'mousedown' && e.button === 2) {
                e.preventDefault();
                isPanning = true;
                draftCanvas.style.cursor = 'grabbing';
                const cx = e.clientX, cy = e.clientY;
                panStartX = cx - currentTx; panStartY = cy - currentTy;
                return;
            }

            // ── Clic GAUCHE ───────────────────────────────────────────────
            if (e.type === 'mousedown' && e.button !== 0) return;

            if (window.activeToolMode === 'hand') {
                // Outil main → pan au clic gauche ou tactile
                e.preventDefault(); isPanning = true; draftCanvas.style.cursor = 'grabbing';
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                panStartX = cx - currentTx; panStartY = cy - currentTy;
            } else if (window.activeToolMode === 'text') {
                // Outil texte → rectangle de saisie
                if (e.type === 'touchstart') e.preventDefault();
                isDrawing = true;
                [lastX, lastY] = getPos(e);
                shapeStartX = lastX; shapeStartY = lastY;
                strokeBBox = { minX: lastX, minY: lastY, maxX: lastX, maxY: lastY };
            } else if (window.activeToolMode === 'draw' || window.activeToolMode === 'shape' || window.activeToolMode === 'table') {
                // Outil dessin / formes / tableau → dessin
                if (e.type === 'touchstart') e.preventDefault();
                isDrawing = true;
                [lastX, lastY] = getPos(e);
                shapeStartX = lastX; shapeStartY = lastY;
                strokeBBox = { minX: lastX, minY: lastY, maxX: lastX, maxY: lastY };
                draftCtx.lineCap = draftCtx.lineJoin = 'round';
                if (window.activeToolMode === 'shape') {
                    draftCanvas.style.opacity = (window.etatForme && window.etatForme.opacity !== undefined)
                        ? window.etatForme.opacity : 1;
                    draftCtx.lineWidth = Math.max(1, window.etatForme.thickness * 0.4);
                    const _m = window.etatForme.mode || 'fill';
                    if (_m === 'fill') {
                        draftCtx.fillStyle = window.etatForme.color; draftCtx.strokeStyle = 'transparent';
                    } else if (_m === 'stroke') {
                        draftCtx.strokeStyle = window.etatForme.color; draftCtx.fillStyle = 'transparent';
                    } else { // 'both'
                        draftCtx.fillStyle = window.etatForme.color; draftCtx.strokeStyle = window.etatForme.color;
                    }
                } else if (window.activeToolMode === 'table') {
                    const et = window.etatTableau || {};
                    draftCanvas.style.opacity = 1;
                    draftCtx.strokeStyle = et.color || 'hsl(220,60%,25%)';
                    draftCtx.fillStyle   = 'transparent';
                    draftCtx.lineWidth   = Math.max(0.5, et.thickness || 1.5);
                } else {
                    draftCanvas.style.opacity = paintState.opacity;
                    draftCtx.strokeStyle = draftCtx.fillStyle = paintState.color;
                    draftCtx.lineWidth = Math.max(1, paintState.thicknessPercent * 0.4);
                    draftCtx.beginPath(); draftCtx.moveTo(lastX, lastY); draftCtx.lineTo(lastX + 0.01, lastY + 0.01); draftCtx.stroke();
                }
            } else if (e.type !== 'touchstart' && !pdfPlacementActif) {
                // Aucun outil actif → tenter de sélectionner un objet ou tracer un rectangle
                const [cx, cy] = getPos(e);
                const hit = hitTestAny(cx, cy);
                if (hit) {
                    // Clic gauche sur un objet → sélectionner + préparer déplacement
                    afficherSelection([hit]);
                    isDraggingImage = true;
                    imgDragStartX = cx; imgDragStartY = cy;
                    imgOrigX = hit.x; imgOrigY = hit.y;
                } else {
                    // Clic gauche sur zone vide → désélectionner + rectangle de sélection
                    if (selectedObjects.length > 0) masquerSelection();
                    isSelecting = true;
                    selectStartX = cx; selectStartY = cy;
                    selectCurX = cx; selectCurY = cy;
                }
                /* CONNECTEURS_START — décommenter pour réactiver
                if (hoverEdge && selectedObjects.length === 0) {
                    isConnecting = true;
                    connectStartX = hoverEdge.x; connectStartY = hoverEdge.y;
                    connectEndX   = hoverEdge.x; connectEndY   = hoverEdge.y;
                    draftCanvas.style.cursor = 'crosshair';
                } else {
                    const hit = hitTestAny(cx, cy);
                    if (hit && hit._isConnector) {
                        paintState.color             = hit._color     || paintState.color;
                        paintState.thicknessPercent  = hit._thickness !== undefined ? hit._thickness : paintState.thicknessPercent;
                        paintState.opacity           = hit._opacity   !== undefined ? hit._opacity   : paintState.opacity;
                        roueConteneur.classList.add('ouvert');
                        ouvrirPanel(6);
                        selectedConnector = hit;
                    } else if (hit) {
                        selectedConnector = null;
                        afficherSelection([hit]);
                        isDraggingImage = true;
                        imgDragStartX = cx; imgDragStartY = cy;
                        imgOrigX = hit.x; imgOrigY = hit.y;
                    } else {
                        if (selectedObjects.length > 0) masquerSelection();
                        isSelecting = true;
                        selectStartX = cx; selectStartY = cy;
                        selectCurX = cx; selectCurY = cy;
                    }
                }
                CONNECTEURS_END */
            }
        }

        function handleMove(e) {
            if (isPanning) {
                e.preventDefault();
                let clientX = e.touches ? e.touches[0].clientX : e.clientX;
                let clientY = e.touches ? e.touches[0].clientY : e.clientY;
                currentTx = clientX - panStartX; currentTy = clientY - panStartY;
                planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;
                if (selectedObjects.length > 0) majActionPanel();
            } else if (isDrawing) {
                e.preventDefault();
                const [x, y] = getPos(e);
                if (window.activeToolMode === 'text') {
                    // Contour pointillé orange du futur rectangle de texte
                    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                    draftCtx.save();
                    draftCtx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--flamme').trim() || '#ff4000';
                    draftCtx.lineWidth   = 2 / currentScale;
                    draftCtx.setLineDash([8 / currentScale, 4 / currentScale]);
                    draftCtx.beginPath();
                    draftCtx.rect(shapeStartX, shapeStartY, x - shapeStartX, y - shapeStartY);
                    draftCtx.stroke();
                    draftCtx.restore();
                    strokeBBox = {
                        minX: Math.min(shapeStartX, x), minY: Math.min(shapeStartY, y),
                        maxX: Math.max(shapeStartX, x), maxY: Math.max(shapeStartY, y)
                    };
                } else if (window.activeToolMode === 'shape') {
                    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                    draftCtx.beginPath();
                    // Shift = ratio 1:1
                    let w = x - shapeStartX, h = y - shapeStartY;
                    if (e.shiftKey) { const s = Math.min(Math.abs(w), Math.abs(h)); w = Math.sign(w) * s; h = Math.sign(h) * s; }
                    const cx = shapeStartX + w / 2, cy = shapeStartY + h / 2;
                    const rx = Math.abs(w / 2), ry = Math.abs(h / 2);
                    if (window.etatForme.type === 'rectangle') { draftCtx.rect(shapeStartX, shapeStartY, w, h); }
                    else if (window.etatForme.type === 'cercle') { draftCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }
                    else if (window.etatForme.type === 'triangle') { draftCtx.moveTo(cx, shapeStartY); draftCtx.lineTo(shapeStartX + w, shapeStartY + h); draftCtx.lineTo(shapeStartX, shapeStartY + h); draftCtx.closePath(); }
                    else if (window.etatForme.type === 'losange') { draftCtx.moveTo(cx, shapeStartY); draftCtx.lineTo(shapeStartX + w, cy); draftCtx.lineTo(cx, shapeStartY + h); draftCtx.lineTo(shapeStartX, cy); draftCtx.closePath(); }
                    else if (window.etatForme.type === 'etoile') {
                        const spikes = 5, innerRatio = 0.5;
                        let rot = Math.PI / 2 * 3, step = Math.PI / spikes;
                        draftCtx.moveTo(cx, shapeStartY);
                        for (let i = 0; i < spikes; i++) { draftCtx.lineTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * ry); rot += step; draftCtx.lineTo(cx + Math.cos(rot) * rx * innerRatio, cy + Math.sin(rot) * ry * innerRatio); rot += step; }
                        draftCtx.closePath();
                    }
                    // mode: 'fill' = rempli, 'stroke' = contour transparent, 'both' = rempli + contour
                    const _md = window.etatForme.mode || 'fill';
                    if (_md === 'fill') { draftCtx.fill(); }
                    else if (_md === 'stroke') { draftCtx.stroke(); }
                    else { draftCtx.fill(); draftCtx.stroke(); }
                    const _halfSW = (_md !== 'fill') ? Math.ceil(Math.max(1, window.etatForme.thickness * 0.4) / 2) : 0;
                    strokeBBox = {
                        minX: Math.min(shapeStartX, shapeStartX + w) - _halfSW,
                        minY: Math.min(shapeStartY, shapeStartY + h) - _halfSW,
                        maxX: Math.max(shapeStartX, shapeStartX + w) + _halfSW,
                        maxY: Math.max(shapeStartY, shapeStartY + h) + _halfSW,
                    };
                } else if (window.activeToolMode === 'table') {
                    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                    let tw = x - shapeStartX, th = y - shapeStartY;
                    if (e.shiftKey) { const s = Math.min(Math.abs(tw), Math.abs(th)); tw = Math.sign(tw) * s; th = Math.sign(th) * s; }
                    const et = window.etatTableau || {};
                    drawTableGrid(draftCtx, shapeStartX, shapeStartY, tw, th, et.cols || 3, et.rows || 3);
                    strokeBBox = { minX: Math.min(shapeStartX, shapeStartX + tw), minY: Math.min(shapeStartY, shapeStartY + th), maxX: Math.max(shapeStartX, shapeStartX + tw), maxY: Math.max(shapeStartY, shapeStartY + th) };
                } else {
                    draftCtx.lineTo(x, y); draftCtx.stroke(); [lastX, lastY] = [x, y];
                    const halfLine = Math.max(1, paintState.thicknessPercent * 0.4) / 2 + 2;
                    if (!strokeBBox) strokeBBox = { minX: x, minY: y, maxX: x, maxY: y };
                    strokeBBox.minX = Math.min(strokeBBox.minX, x - halfLine);
                    strokeBBox.minY = Math.min(strokeBBox.minY, y - halfLine);
                    strokeBBox.maxX = Math.max(strokeBBox.maxX, x + halfLine);
                    strokeBBox.maxY = Math.max(strokeBBox.maxY, y + halfLine);
                    // Diffuser en direct vers la fenêtre de projection (~15 fps)
                    const _now = Date.now();
                    if (_now - projLastDraftBroadcast > 66) {
                        projLastDraftBroadcast = _now;
                        broadcastState(draftCanvas.toDataURL('image/png'));
                    }
                }
            } else if (isSelecting) {
                e.preventDefault();
                const [x, y] = getPos(e);
                selectCurX = x; selectCurY = y;
                draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                draftCtx.save();
                draftCtx.strokeStyle = 'rgb(30, 100, 255)';
                draftCtx.lineWidth = 2 / currentScale;          // épaisseur constante écran
                draftCtx.setLineDash([10 / currentScale, 6 / currentScale]); // pointillés constants écran
                draftCtx.fillStyle = 'rgba(30, 100, 255, 0.07)';
                draftCtx.beginPath();
                draftCtx.rect(selectStartX, selectStartY, x - selectStartX, y - selectStartY);
                draftCtx.fill();
                draftCtx.stroke();
                draftCtx.restore();
            }
            /* CONNECTEURS_START — décommenter pour réactiver (ajouter "} else if" devant chaque bloc)
            else if (isConnecting) {
                e.preventDefault();
                const [x, y] = getPos(e);
                const snap = findNearestEdge(x, y);
                connectEndX = snap ? snap.x : x;
                connectEndY = snap ? snap.y : y;
                draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                draftCtx.save();
                draftCtx.strokeStyle = paintState.color;
                draftCtx.lineWidth = Math.max(1.5, paintState.thicknessPercent * 0.4) / currentScale;
                draftCtx.lineCap = 'round';
                draftCtx.setLineDash(snap ? [] : [6 / currentScale, 4 / currentScale]);
                draftCtx.globalAlpha = snap ? paintState.opacity : paintState.opacity * 0.7;
                draftCtx.beginPath();
                draftCtx.moveTo(connectStartX, connectStartY);
                draftCtx.lineTo(connectEndX, connectEndY);
                draftCtx.stroke();
                if (snap) {
                    draftCtx.setLineDash([]); draftCtx.globalAlpha = 1;
                    draftCtx.fillStyle = paintState.color;
                    draftCtx.beginPath(); draftCtx.arc(snap.x, snap.y, 5 / currentScale, 0, Math.PI * 2); draftCtx.fill();
                }
                if (snap) {
                    const target = placedObjects.find(o =>
                        o.x - 1 <= snap.x && snap.x <= o.x + o.w + 1 &&
                        o.y - 1 <= snap.y && snap.y <= o.y + o.h + 1
                    );
                    if (target) {
                        draftCtx.strokeStyle = '#ff4000';
                        draftCtx.lineWidth = 2.5 / currentScale;
                        draftCtx.setLineDash([]);
                        draftCtx.globalAlpha = 0.7;
                        draftCtx.beginPath();
                        draftCtx.rect(target.x, target.y, target.w, target.h);
                        draftCtx.stroke();
                    }
                }
                draftCtx.restore();
            } else if (!window.activeToolMode && !window.tableEditMode) {
                if (selectedObjects.length > 0) {
                    if (hoverEdge) {
                        hoverEdge = null;
                        draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                        draftCanvas.style.cursor = 'default';
                    }
                } else {
                    const [cx, cy] = getPos(e);
                    const edge = findNearestEdge(cx, cy);
                    if (edge) {
                        hoverEdge = edge;
                        drawEdgeIndicator(edge.x, edge.y);
                        draftCanvas.style.cursor = 'crosshair';
                    } else if (hoverEdge) {
                        hoverEdge = null;
                        draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                        draftCanvas.style.cursor = 'default';
                    }
                }
            }
            CONNECTEURS_END */
        }

        function stopInteraction(e) {
            if (isPanning) {
                isPanning = false;
                if (window.activeToolMode === 'hand') draftCanvas.style.cursor = 'grab';
                else if (window.activeToolMode === 'draw' || window.activeToolMode === 'shape') draftCanvas.style.cursor = 'crosshair';
                else draftCanvas.style.cursor = 'default';
            }
            else if (isDrawing) {
                isDrawing = false;
                if (window.activeToolMode === 'text') {
                    draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                    if (strokeBBox &&
                        (strokeBBox.maxX - strokeBBox.minX) > 20 &&
                        (strokeBBox.maxY - strokeBBox.minY) > 10) {
                        creerZoneTexte(
                            strokeBBox.minX, strokeBBox.minY,
                            strokeBBox.maxX - strokeBBox.minX,
                            strokeBBox.maxY - strokeBBox.minY
                        );
                    }
                    strokeBBox = null;
                    if (window.desactiverOutil) window.desactiverOutil();
                } else {
                    const wasDrawing = window.activeToolMode === 'draw';
                    const wasShape   = window.activeToolMode === 'shape';
                    const _type = window.activeToolMode === 'shape' ? 'shape'
                                : window.activeToolMode === 'table'  ? 'table'
                                : 'stroke';
                    commitDraftToObject(_type);
                    if (_type === 'table') {
                        // Auto-sélectionner le tableau tracé et revenir en mode sélection
                        const last = placedObjects.length > 0 ? placedObjects[placedObjects.length - 1] : null;
                        if (last && last.type === 'table') afficherSelection([last]);
                        if (window.desactiverOutil) window.desactiverOutil();
                    } else if ((wasDrawing || wasShape) && window.desactiverOutil) {
                        window.desactiverOutil();
                    }
                }
            }
            else if (isSelecting) {
                isSelecting = false;
                draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                // Sélectionner les objets dans le rectangle (comme le clic droit)
                const rMinX = Math.min(selectStartX, selectCurX);
                const rMinY = Math.min(selectStartY, selectCurY);
                const rMaxX = Math.max(selectStartX, selectCurX);
                const rMaxY = Math.max(selectStartY, selectCurY);
                if (rMaxX - rMinX > 4 && rMaxY - rMinY > 4) {
                    const hits = placedObjects.filter(o =>
                        o.x < rMaxX && o.x + o.w > rMinX &&
                        o.y < rMaxY && o.y + o.h > rMinY
                    );
                    if (hits.length > 0) afficherSelection(hits);
                }
            }
            /* CONNECTEURS_START — décommenter pour réactiver
            else if (isConnecting) {
                isConnecting = false;
                hoverEdge = null;
                draftCanvas.style.cursor = 'default';
                const dist = Math.hypot(connectEndX - connectStartX, connectEndY - connectStartY);
                draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
                if (dist > 10) {
                    draftCtx.save();
                    draftCtx.strokeStyle = paintState.color;
                    draftCtx.lineWidth = Math.max(1.5, paintState.thicknessPercent * 0.4);
                    draftCtx.lineCap = 'round';
                    draftCtx.setLineDash([]);
                    draftCtx.globalAlpha = paintState.opacity;
                    draftCtx.beginPath();
                    draftCtx.moveTo(connectStartX, connectStartY);
                    draftCtx.lineTo(connectEndX, connectEndY);
                    draftCtx.stroke();
                    draftCtx.restore();
                    strokeBBox = {
                        minX: Math.min(connectStartX, connectEndX) - 4,
                        minY: Math.min(connectStartY, connectEndY) - 4,
                        maxX: Math.max(connectStartX, connectEndX) + 4,
                        maxY: Math.max(connectStartY, connectEndY) + 4,
                    };
                    commitDraftToObject('stroke');
                    const connObj = placedObjects[placedObjects.length - 1];
                    if (connObj) {
                        connObj._isConnector = true;
                        connObj._p1 = { x: connectStartX, y: connectStartY };
                        connObj._p2 = { x: connectEndX,   y: connectEndY   };
                        connObj._color     = paintState.color;
                        connObj._thickness = paintState.thicknessPercent;
                        connObj._opacity   = paintState.opacity;
                        const a1 = findObjectForEdgePoint(connectStartX, connectStartY);
                        const a2 = findObjectForEdgePoint(connectEndX,   connectEndY);
                        if (a1) { connObj._obj1 = a1; connObj._rel1 = { rx: (connectStartX - a1.x) / a1.w, ry: (connectStartY - a1.y) / a1.h }; }
                        if (a2) { connObj._obj2 = a2; connObj._rel2 = { rx: (connectEndX   - a2.x) / a2.w, ry: (connectEndY   - a2.y) / a2.h }; }
                    }
                    roueConteneur.classList.add('ouvert');
                    ouvrirPanel(6);
                    if (connObj) selectedConnector = connObj;
                }
            }
            CONNECTEURS_END */
        }

        // ── Zone de saisie texte ─────────────────────────────────────────────
        function creerZoneTexte(x, y, w, h, onCommit = null, onDone = null) {
            const et = window.etatTexte || { fontFamily: 'DM Sans', fontSize: 52, fontWeight: 500, color: 'hsl(0, 100%, 50%)' };
            const couleur = et.color || paintState.color || '#262623';

            const div = document.createElement('div');
            div.contentEditable = 'true';
            div.spellcheck      = false;
            div.style.cssText   = [
                'position:absolute',
                `left:${x}px`, `top:${y}px`,
                `width:${w}px`, `min-height:${h}px`,
                `font-family:'${et.fontFamily}',sans-serif`,
                `font-size:${et.fontSize}px`,
                `font-weight:${et.fontWeight}`,
                `color:${couleur}`,
                'outline:none',
                'border:2px dashed var(--flamme)',
                'border-radius:3px',
                'padding:4px 6px',
                'word-wrap:break-word',
                'white-space:pre-wrap',
                'cursor:text',
                'z-index:10',
                'line-height:1.4',
                'box-sizing:border-box',
                'background:transparent',
            ].join(';');

            planDeTravail.appendChild(div);
            div.focus();

            // Place le curseur au début
            const range = document.createRange();
            range.selectNodeContents(div);
            range.collapse(true);
            const sel = window.getSelection();
            if (sel) { sel.removeAllRanges(); sel.addRange(range); }

            const commit = () => {
                const text = div.innerText || '';
                div.remove();
                if (!text.trim()) return;

                // Rendu texte → canvas temporaire (DPR pour netteté)
                const dpr        = window.devicePixelRatio || 1;
                const lineHeight = et.fontSize * 1.4;
                const pad        = 6;
                const tmp  = document.createElement('canvas');
                const tctx = tmp.getContext('2d');
                tctx.font  = `${et.fontWeight} ${et.fontSize}px '${et.fontFamily}',sans-serif`;

                // Découpe des lignes avec word-wrap
                const rawLines = text.split('\n');
                const wrappedLines = [];
                for (const raw of rawLines) {
                    const words = raw.split(' ');
                    let cur = '';
                    for (const word of words) {
                        const test = cur ? cur + ' ' + word : word;
                        if (tctx.measureText(test).width > w - pad * 2 && cur) {
                            wrappedLines.push(cur); cur = word;
                        } else { cur = test; }
                    }
                    wrappedLines.push(cur);
                }

                const renderH  = Math.max(h, wrappedLines.length * lineHeight + pad * 2);
                tmp.width      = Math.round(w       * dpr);
                tmp.height     = Math.round(renderH * dpr);
                tctx.scale(dpr, dpr);
                tctx.font         = `${et.fontWeight} ${et.fontSize}px '${et.fontFamily}',sans-serif`;
                tctx.fillStyle    = couleur;
                tctx.textBaseline = 'top';
                wrappedLines.forEach((line, i) => tctx.fillText(line, pad, pad + i * lineHeight));

                const dataURL = tmp.toDataURL('image/png');
                const el = document.createElement('img');
                el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const obj = {
                    type: 'text', el, x, y, w, h: renderH, rotation: 0,
                    // Propriétés stockées pour re-rendu sans déformation
                    _text: text, _fontFamily: et.fontFamily,
                    _fontSize: et.fontSize, _fontWeight: et.fontWeight, _color: couleur,
                };
                mettreAJourElement(obj);
                planDeTravail.appendChild(el);
                placedObjects.push(obj);
                el.src = dataURL;
                saveState();
                // Retour automatique à l'outil sélection après validation du texte
                if (!window.tableEditMode && window.desactiverOutil) window.desactiverOutil();
                if (!window.tableEditMode && onCommit) onCommit();
                if (onDone) onDone();
            };

            let committed = false;
            const commitOnce = () => { if (!committed) { committed = true; commit(); } };

            div.addEventListener('blur', commitOnce);
            div.addEventListener('keydown', e => {
                if (e.key === 'Escape') { committed = true; div.remove(); if (onDone) onDone(); }
                // Cmd/Ctrl+Entrée → valider
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault(); commitOnce();
                }
            });
        }

        draftCanvas.addEventListener('mousedown', startInteraction);
        draftCanvas.addEventListener('mousemove', handleMove);
        draftCanvas.addEventListener('mouseup',   stopInteraction);
        draftCanvas.addEventListener('mouseout',  stopInteraction);

        draftCanvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault(); isPanning = true;
                lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                lastPinchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
            } else if (e.touches.length === 1 && !isPanning) { startInteraction(e); }
        }, {passive: false});

        draftCanvas.addEventListener('touchmove', (e) => {
            if (isPanning && e.touches.length === 2) {
                e.preventDefault();
                const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                const currentCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
                const scaleDelta = currentDist / lastPinchDist;
                let newScale = Math.max(0.2, Math.min(currentScale * scaleDelta, 10));
                const rect = conteneur.getBoundingClientRect();
                const mouseX = currentCenter.x - rect.left, mouseY = currentCenter.y - rect.top;
                currentTx = mouseX - (mouseX - currentTx) * (newScale / currentScale);
                currentTy = mouseY - (mouseY - currentTy) * (newScale / currentScale);
                currentScale = newScale;
                currentTx += (currentCenter.x - lastPinchCenter.x);
                currentTy += (currentCenter.y - lastPinchCenter.y);
                planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;
                lastPinchDist = currentDist; lastPinchCenter = currentCenter;
            } else if (!isPanning) { handleMove(e); }
        }, {passive: false});

        draftCanvas.addEventListener('touchend', (e) => {
            if (isPanning) { if (e.touches.length === 0) isPanning = false; } else { stopInteraction(e); }
        });
        draftCanvas.addEventListener('touchcancel', stopInteraction);

        // ── OBJETS PLACÉS : images statiques, GIFs, pages PDF, traits, formes ──
        // Tous les objets sont des éléments <img> dans planDeTravail
        // → z-order garanti par l'ordre DOM, premier plan = appendChild
        // Note : placedObjects est déclaré plus haut (L58) pour que saveState() l'inclue dès initSize()
        let selectedObjects = [];
        let clipboard = []; // Presse-papiers interne (Ctrl+C / Ctrl+V / Dupliquer)
        let isDraggingImage  = false, isResizingImage = false;
        let imgDragStartX = 0, imgDragStartY = 0;
        let imgOrigX = 0, imgOrigY = 0, imgOrigW = 0, imgOrigH = 0;
        let activeCorner = null;
        let pdfPlacementActif = false; // bloque la sélection pendant le mode placement PDF
        // Rotation
        let isRotatingImage  = false;
        let rotStartAngle    = 0, rotOrigRotation = 0;
        let rotCenterX       = 0, rotCenterY = 0;

        // Met à jour la position/taille/rotation CSS d'un objet
        function mettreAJourElement(obj) {
            obj.el.style.left      = obj.x + 'px';
            obj.el.style.top       = obj.y + 'px';
            obj.el.style.width     = obj.w + 'px';
            obj.el.style.height    = obj.h + 'px';
            obj.el.style.transformOrigin = '50% 50%';
            obj.el.style.transform = `rotate(${obj.rotation || 0}deg)`;
        }

        // Re-rendu d'un objet texte à la largeur actuelle (évite la déformation)
        function reRenderText(obj) {
            if (!obj._text) return;
            const dpr        = window.devicePixelRatio || 1;
            const fontFamily = obj._fontFamily || 'DM Sans';
            const fontSize   = obj._fontSize   || 24;
            const fontWeight = obj._fontWeight || 400;
            const color      = obj._color      || '#262623';
            const w          = obj.w;
            const lineHeight = fontSize * 1.4;
            const pad        = 6;

            const tmp  = document.createElement('canvas');
            const tctx = tmp.getContext('2d');
            tctx.font  = `${fontWeight} ${fontSize}px '${fontFamily}',sans-serif`;

            // Recalcul des lignes avec word-wrap pour la nouvelle largeur
            const rawLines     = obj._text.split('\n');
            const wrappedLines = [];
            for (const raw of rawLines) {
                const words = raw.split(' ');
                let cur = '';
                for (const word of words) {
                    const test = cur ? cur + ' ' + word : word;
                    if (tctx.measureText(test).width > w - pad * 2 && cur) {
                        wrappedLines.push(cur); cur = word;
                    } else { cur = test; }
                }
                wrappedLines.push(cur);
            }

            const renderH  = Math.max(40, wrappedLines.length * lineHeight + pad * 2);
            tmp.width      = Math.round(w      * dpr);
            tmp.height     = Math.round(renderH * dpr);
            tctx.scale(dpr, dpr);
            tctx.font         = `${fontWeight} ${fontSize}px '${fontFamily}',sans-serif`;
            tctx.fillStyle    = color;
            tctx.textBaseline = 'top';
            wrappedLines.forEach((line, i) => tctx.fillText(line, pad, pad + i * lineHeight));

            obj.el.src = tmp.toDataURL('image/png');
            obj.h = renderH; // hauteur mise à jour
        }

        /* CONNECTEURS_START — décommenter pour réactiver
        function reRenderConnector(obj) {
            if (!obj || !obj._isConnector) return;
            const p1 = obj._p1, p2 = obj._p2;
            const lw = Math.max(1.5, (obj._thickness || 30) * 0.4);
            const pad = lw + 4;
            const minX = Math.min(p1.x, p2.x) - pad;
            const minY = Math.min(p1.y, p2.y) - pad;
            const maxX = Math.max(p1.x, p2.x) + pad;
            const maxY = Math.max(p1.y, p2.y) + pad;
            const w = maxX - minX, h = maxY - minY;
            const dpr = window.devicePixelRatio || 1;
            const tmp = document.createElement('canvas');
            tmp.width  = Math.round(w * dpr);
            tmp.height = Math.round(h * dpr);
            const tctx = tmp.getContext('2d');
            tctx.scale(dpr, dpr);
            tctx.strokeStyle = obj._color || '#262623';
            tctx.lineWidth   = lw;
            tctx.lineCap     = 'round';
            tctx.globalAlpha = obj._opacity !== undefined ? obj._opacity : 1;
            tctx.beginPath();
            tctx.moveTo(p1.x - minX, p1.y - minY);
            tctx.lineTo(p2.x - minX, p2.y - minY);
            tctx.stroke();
            obj.x = minX; obj.y = minY; obj.w = w; obj.h = h;
            obj.el.src = tmp.toDataURL('image/png');
            mettreAJourElement(obj);
        }
        CONNECTEURS_END */

        // ── Dupliquer un ensemble d'objets (utilisé par btnDup + Ctrl+V) ──────
        function dupliquerObjets(sources, offsetX = 20, offsetY = 20) {
            const copies = [];
            sources.forEach(src => {
                const newEl = document.createElement('img');
                newEl.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const copy = {
                    type: src.type || 'image',
                    el: newEl,
                    x: src.x + offsetX,
                    y: src.y + offsetY,
                    w: src.w,
                    h: src.h,
                    rotation: src.rotation || 0,
                };
                if (src._text) {
                    copy._text       = src._text;
                    copy._fontFamily = src._fontFamily;
                    copy._fontSize   = src._fontSize;
                    copy._fontWeight = src._fontWeight;
                    copy._color      = src._color;
                }
                mettreAJourElement(copy);
                planDeTravail.appendChild(newEl);
                placedObjects.push(copy);
                copies.push(copy);
                if (src._text) {
                    reRenderText(copy);
                } else {
                    newEl.src = src.el.src;
                }
            });
            if (copies.length > 0) {
                afficherSelection(copies);
                saveState();
            }
            return copies;
        }

        // Boîte englobante d'un tableau d'objets
        function computeBB(objects) {
            let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
            objects.forEach(o => {
                x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y);
                x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + o.h);
            });
            return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }

        // Hit-test : du dernier placé (dessus) au premier
        function hitTestAny(cx, cy) {
            for (let i = placedObjects.length - 1; i >= 0; i--) {
                const o = placedObjects[i];
                if (cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h) return o;
            }
            return null;
        }

        /* CONNECTEURS_START — décommenter pour réactiver
        function findNearestEdge(cx, cy) {
            const thresh = 28 / currentScale;
            let best = null, bestDist = Infinity;
            placedObjects.forEach(o => {
                if (o._isConnector) return;
                [
                    { x: o.x,         y: Math.max(o.y, Math.min(o.y + o.h, cy)) },
                    { x: o.x + o.w,   y: Math.max(o.y, Math.min(o.y + o.h, cy)) },
                    { x: Math.max(o.x, Math.min(o.x + o.w, cx)), y: o.y           },
                    { x: Math.max(o.x, Math.min(o.x + o.w, cx)), y: o.y + o.h     },
                ].forEach(pt => {
                    const d = Math.hypot(cx - pt.x, cy - pt.y);
                    if (d < thresh && d < bestDist) { bestDist = d; best = pt; }
                });
            });
            return best;
        }

        function findObjectForEdgePoint(px, py) {
            const thresh = 35;
            let best = null, bestDist = Infinity;
            placedObjects.forEach(o => {
                if (o._isConnector) return;
                const dx = Math.max(0, Math.max(o.x - px, px - (o.x + o.w)));
                const dy = Math.max(0, Math.max(o.y - py, py - (o.y + o.h)));
                const d  = Math.sqrt(dx * dx + dy * dy);
                if (d < thresh && d < bestDist) { bestDist = d; best = o; }
            });
            return best;
        }

        function updateConnectorAnchors(conn) {
            if (conn._obj1 && conn._rel1) {
                conn._p1 = { x: conn._obj1.x + conn._rel1.rx * conn._obj1.w,
                             y: conn._obj1.y + conn._rel1.ry * conn._obj1.h };
            }
            if (conn._obj2 && conn._rel2) {
                conn._p2 = { x: conn._obj2.x + conn._rel2.rx * conn._obj2.w,
                             y: conn._obj2.y + conn._rel2.ry * conn._obj2.h };
            }
        }

        function updateConnectorsOf(obj) {
            placedObjects.forEach(conn => {
                if (!conn._isConnector) return;
                if (conn._obj1 === obj || conn._obj2 === obj) {
                    updateConnectorAnchors(conn);
                    reRenderConnector(conn);
                }
            });
        }

        function drawEdgeIndicator(x, y) {
            draftCtx.clearRect(0, 0, draftCanvas.width, draftCanvas.height);
            const r = 7 / currentScale;
            const c = 4 / currentScale;
            draftCtx.save();
            draftCtx.strokeStyle = '#ff4000';
            draftCtx.fillStyle = 'rgba(255,64,0,0.15)';
            draftCtx.lineWidth = 2 / currentScale;
            draftCtx.beginPath(); draftCtx.arc(x, y, r, 0, Math.PI * 2); draftCtx.fill(); draftCtx.stroke();
            draftCtx.beginPath();
            draftCtx.moveTo(x - c, y); draftCtx.lineTo(x + c, y);
            draftCtx.moveTo(x, y - c); draftCtx.lineTo(x, y + c);
            draftCtx.stroke();
            draftCtx.restore();
        }
        CONNECTEURS_END */

        // ── Overlay de sélection ─────────────────────────────────────────────
        // Le padding est en pixels ÉCRAN (constant quelle que soit le zoom)
        // → on recalcule à chaque fois en px canvas : SEL_PAD_PX / currentScale
        const SEL_PAD_PX = 30; // pixels écran constants

        const imgOverlay = document.createElement('div');
        imgOverlay.style.cssText = 'position:absolute;display:none;z-index:6;box-sizing:border-box;cursor:move;overflow:visible;';
        planDeTravail.appendChild(imgOverlay);

        // SVG de sélection style viseur/caméra (redrawn dynamiquement)
        const svgBorder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgBorder.style.cssText = 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none;';
        imgOverlay.appendChild(svgBorder);

        // Poignées invisibles aux coins (zones cliquables pour resize — sélection simple uniquement)
        const handleEls = {};
        ['nw','ne','sw','se'].forEach(c => {
            const h = document.createElement('div');
            h.dataset.corner = c;
            h.style.cssText = `position:absolute;width:24px;height:24px;background:transparent;transform:translate(-50%,-50%);z-index:7;cursor:${c}-resize;`;
            imgOverlay.appendChild(h);
            handleEls[c] = h;
        });

        // Curseur SVG rotation (flèche courbe)
        const rotCursorSVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'%3E%3Cpath d='M11 3 A8 8 0 0 1 19 11' fill='none' stroke='%231e64ff' stroke-width='2.2' stroke-linecap='round'/%3E%3Cpolygon points='19,7 19,11 15,11' fill='%231e64ff'/%3E%3C/svg%3E") 11 11, grab`;

        // Poignées de rotation — positionnées légèrement en dehors de chaque coin
        const rotateHandleEls = {};
        ['nw','ne','sw','se'].forEach(c => {
            const h = document.createElement('div');
            h.dataset.rotate = c;
            h.style.cssText = `position:absolute;width:20px;height:20px;background:transparent;transform:translate(-50%,-50%);z-index:8;cursor:${rotCursorSVG};`;
            imgOverlay.appendChild(h);
            rotateHandleEls[c] = h;
        });

        // Redessine le SVG de sélection style viseur/caméra
        // ow, oh = dimensions de l'overlay en px canvas
        // simpleSelection = true si 1 seul objet sélectionné (→ afficher les coins resize)
        function majSVGSelection(ow, oh, simpleSelection) {
            const col = '#ff4000';
            const sw = 1.5 / currentScale; // épaisseur trait

            svgBorder.setAttribute('width', ow);
            svgBorder.setAttribute('height', oh);
            svgBorder.setAttribute('viewBox', `0 0 ${ow} ${oh}`);

            // Pointillés constants en px écran
            const dashOn  = 10 / currentScale;
            const dashOff = 6  / currentScale;

            // Rectangle en pointillés, de coin à coin (sans interruption aux angles)
            const lines = [
                `<line x1="0" y1="0" x2="${ow}" y2="0" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dashOn} ${dashOff}"/>`,
                `<line x1="${ow}" y1="0" x2="${ow}" y2="${oh}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dashOn} ${dashOff}"/>`,
                `<line x1="${ow}" y1="${oh}" x2="0" y2="${oh}" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dashOn} ${dashOff}"/>`,
                `<line x1="0" y1="${oh}" x2="0" y2="0" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dashOn} ${dashOff}"/>`,
            ].join('');

            // Petits cercles aux 4 angles (taille constante en px écran)
            const r = 4 / currentScale;
            const dots = [
                `<circle cx="0" cy="0" r="${r}" fill="${col}"/>`,
                `<circle cx="${ow}" cy="0" r="${r}" fill="${col}"/>`,
                `<circle cx="${ow}" cy="${oh}" r="${r}" fill="${col}"/>`,
                `<circle cx="0" cy="${oh}" r="${r}" fill="${col}"/>`,
            ].join('');
            svgBorder.innerHTML = lines + dots;
        }

        // ── Panneau d'actions (fixed dans le body, coordonnées écran) ─────────
        const actionPanel = document.createElement('div');
        actionPanel.style.cssText = 'position:fixed;z-index:9999;display:none;gap:5px;align-items:center;padding:5px;background:var(--bg,#e8edf2);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,0.18);';
        document.body.appendChild(actionPanel);

        // Bouton 1 : Reculer d'un rang
        // Même disposition : rect arrière (en bas à droite) + rect avant (en haut à gauche)
        // Le rect vers lequel l'objet se déplace est en bleu
        const btnBack = document.createElement('button');
        btnBack.title = 'Reculer d\'un rang';
        btnBack.style.cssText = 'width:34px;height:34px;border:none;border-radius:7px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;';
        btnBack.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="13" height="13" rx="2" fill="#ff4000" stroke="#ff4000" stroke-width="2"/>
            <rect x="2" y="2" width="13" height="13" rx="2" fill="var(--bg,#e8edf2)" stroke="currentColor" stroke-width="2"/>
        </svg>`;
        btnBack.addEventListener('mouseenter', () => btnBack.style.background = 'rgba(255,64,0,0.12)');
        btnBack.addEventListener('mouseleave', () => btnBack.style.background = 'transparent');

        // Bouton 2 : Avancer d'un rang
        const btnFront = document.createElement('button');
        btnFront.title = 'Avancer d\'un rang';
        btnFront.style.cssText = 'width:34px;height:34px;border:none;border-radius:7px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;';
        btnFront.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
            <rect x="2" y="2" width="13" height="13" rx="2" fill="#ff4000" stroke="#ff4000" stroke-width="2"/>
        </svg>`;
        btnFront.addEventListener('mouseenter', () => btnFront.style.background = 'rgba(255,64,0,0.12)');
        btnFront.addEventListener('mouseleave', () => btnFront.style.background = 'transparent');

        // Bouton 3 : Supprimer la sélection
        const btnDelete = document.createElement('button');
        btnDelete.title = 'Supprimer la sélection';
        btnDelete.style.cssText = 'width:34px;height:34px;border:none;border-radius:7px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;color:#e03;';
        btnDelete.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2"/>
        </svg>`;
        btnDelete.addEventListener('mouseenter', () => btnDelete.style.background = 'rgba(220,0,30,0.1)');
        btnDelete.addEventListener('mouseleave', () => btnDelete.style.background = 'transparent');

        // Bouton 4 : Dupliquer la sélection
        const btnDup = document.createElement('button');
        btnDup.title = 'Dupliquer';
        btnDup.style.cssText = 'width:34px;height:34px;border:none;border-radius:7px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;';
        btnDup.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="8" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M3 16V5a2 2 0 0 1 2-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
        btnDup.addEventListener('mouseenter', () => btnDup.style.background = 'rgba(0,100,255,0.10)');
        btnDup.addEventListener('mouseleave', () => btnDup.style.background = 'transparent');

        const btnPdf = document.createElement('button');
        btnPdf.title = 'Ouvrir le PDF dans le Finder';
        btnPdf.style.cssText = 'width:34px;height:34px;border:none;border-radius:7px;background:transparent;cursor:pointer;display:none;align-items:center;justify-content:center;transition:background 0.15s;';
        btnPdf.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`;
        btnPdf.addEventListener('mouseenter', () => btnPdf.style.background = 'rgba(255,64,0,0.12)');
        btnPdf.addEventListener('mouseleave', () => btnPdf.style.background = 'transparent');
        btnPdf.addEventListener('click', () => {
            const obj = selectedObjects.find(o => o._pdfPath);
            if (obj?._pdfPath) fetch('/open?p=' + encodeURIComponent(obj._pdfPath)).catch(() => {});
        });

        actionPanel.appendChild(btnBack);
        actionPanel.appendChild(btnFront);
        actionPanel.appendChild(btnDelete);
        actionPanel.appendChild(btnDup);
        actionPanel.appendChild(btnPdf);

        // Positionne le panneau d'actions en bas-à-droite de l'overlay (coordonnées écran)
        function majActionPanel() {
            if (selectedObjects.length === 0) { actionPanel.style.display = 'none'; return; }
            actionPanel.style.display = 'flex';
            btnPdf.style.display = selectedObjects.some(o => o._pdfPath) ? 'flex' : 'none';
            const or = imgOverlay.getBoundingClientRect();
            // Après le rendu, lire les dimensions et placer
            requestAnimationFrame(() => {
                const pw = actionPanel.offsetWidth, ph = actionPanel.offsetHeight;
                actionPanel.style.left = (or.right - pw) + 'px';
                actionPanel.style.top  = (or.bottom + 6) + 'px';
            });
        }

        function positionnerOverlay(bb) {
            // Padding constant en pixels écran → convertir en px canvas
            const pad = SEL_PAD_PX / currentScale;
            const ox = bb.x - pad;
            const oy = bb.y - pad;
            const ow = bb.w + pad * 2;
            const oh = bb.h + pad * 2;
            imgOverlay.style.left   = ox + 'px';
            imgOverlay.style.top    = oy + 'px';
            imgOverlay.style.width  = ow + 'px';
            imgOverlay.style.height = oh + 'px';
            // Poignées resize aux coins de l'overlay
            handleEls['nw'].style.left = '0px';        handleEls['nw'].style.top = '0px';
            handleEls['ne'].style.left = ow + 'px';    handleEls['ne'].style.top = '0px';
            handleEls['sw'].style.left = '0px';        handleEls['sw'].style.top = oh + 'px';
            handleEls['se'].style.left = ow + 'px';    handleEls['se'].style.top = oh + 'px';
            // Poignées rotation : légèrement en dehors de chaque coin (diagonale)
            const rotOff = 22 / currentScale; // 22px écran
            rotateHandleEls['nw'].style.left = (-rotOff) + 'px';  rotateHandleEls['nw'].style.top = (-rotOff) + 'px';
            rotateHandleEls['ne'].style.left = (ow + rotOff) + 'px'; rotateHandleEls['ne'].style.top = (-rotOff) + 'px';
            rotateHandleEls['sw'].style.left = (-rotOff) + 'px';  rotateHandleEls['sw'].style.top = (oh + rotOff) + 'px';
            rotateHandleEls['se'].style.left = (ow + rotOff) + 'px'; rotateHandleEls['se'].style.top = (oh + rotOff) + 'px';
            // Handles visibles (zones cliquables) seulement pour sélection simple
            const simple = selectedObjects.length === 1;
            Object.values(handleEls).forEach(h => h.style.display = simple ? '' : 'none');
            Object.values(rotateHandleEls).forEach(h => h.style.display = simple ? '' : 'none');
            // Redessiner le SVG style viseur
            majSVGSelection(ow, oh, simple);
            majActionPanel();
        }

        function afficherSelection(objects) {
            selectedObjects = objects;
            positionnerOverlay(computeBB(objects));
            imgOverlay.style.display = 'block';
        }

        function masquerSelection() {
            selectedObjects = [];
            // selectedConnector = null; // CONNECTEURS
            isDraggingImage  = false;
            isResizingImage  = false;
            isRotatingImage  = false;
            imgOverlay.style.display = 'none';
            actionPanel.style.display = 'none';
        }
        window.masquerSelection = masquerSelection;

        // ── Actions du panneau ────────────────────────────────────────────────
        // Reculer d'un rang : échanger avec l'élément précédent dans placedObjects
        btnBack.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btnBack.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const indices = selectedObjects
                .map(o => placedObjects.indexOf(o))
                .filter(i => i > 0)
                .sort((a, b) => a - b);
            indices.forEach(i => {
                if (!selectedObjects.includes(placedObjects[i - 1])) {
                    const tmp = placedObjects[i]; placedObjects[i] = placedObjects[i - 1]; placedObjects[i - 1] = tmp;
                    planDeTravail.insertBefore(placedObjects[i - 1].el, placedObjects[i].el);
                }
            });
            if (selectedObjects.length > 0) positionnerOverlay(computeBB(selectedObjects));
            saveState();
        });

        // Avancer d'un rang : échanger avec l'élément suivant dans placedObjects
        btnFront.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btnFront.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const indices = selectedObjects
                .map(o => placedObjects.indexOf(o))
                .filter(i => i < placedObjects.length - 1)
                .sort((a, b) => b - a);
            indices.forEach(i => {
                if (!selectedObjects.includes(placedObjects[i + 1])) {
                    const tmp = placedObjects[i]; placedObjects[i] = placedObjects[i + 1]; placedObjects[i + 1] = tmp;
                    planDeTravail.insertBefore(placedObjects[i].el, placedObjects[i + 1].el);
                }
            });
            if (selectedObjects.length > 0) positionnerOverlay(computeBB(selectedObjects));
            saveState();
        });

        btnDelete.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btnDelete.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            selectedObjects.forEach(obj => {
                const idx = placedObjects.indexOf(obj);
                if (idx !== -1) placedObjects.splice(idx, 1);
                obj.el.remove();
            });
            masquerSelection();
            saveState();
        });

        btnDup.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        btnDup.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (selectedObjects.length === 0) return;
            dupliquerObjets(selectedObjects);
        });

        // ── Déplacement et pan via l'overlay ─────────────────────────────────
        imgOverlay.addEventListener('contextmenu', (e) => e.preventDefault());
        imgOverlay.addEventListener('mousedown', (e) => {
            // Clic droit sur l'overlay → pan (comme partout ailleurs)
            if (e.button === 2) {
                e.preventDefault(); e.stopPropagation();
                isPanning = true;
                draftCanvas.style.cursor = 'grabbing';
                panStartX = e.clientX - currentTx; panStartY = e.clientY - currentTy;
                return;
            }
            // Clic gauche sur l'overlay (hors poignée) → déplacer l'objet sélectionné
            if (e.button !== 0 || e.target.dataset.corner) return;
            e.preventDefault(); e.stopPropagation();
            if (selectedObjects.length === 0) return;
            isDraggingImage = true;
            [imgDragStartX, imgDragStartY] = getPos(e);
            // Pour multi-sélection, mémoriser la position de chaque objet
            selectedObjects.forEach(o => { o._origX = o.x; o._origY = o.y; });
            if (selectedObjects.length === 1) {
                imgOrigX = selectedObjects[0].x;
                imgOrigY = selectedObjects[0].y;
            }
        });

        // ── Déplacement via touch mobile ──────────────────────────────────────
        imgOverlay.addEventListener('touchstart', (e) => {
            if (e.target.dataset.corner || e.target.dataset.rotate) return;
            if (e.touches.length !== 1 || selectedObjects.length === 0) return;
            e.stopPropagation(); // empêche initMobileTouch de démarrer le pan
            window.mobileObjectDragging = true;
            isDraggingImage = true;
            [imgDragStartX, imgDragStartY] = getPos(e);
            selectedObjects.forEach(o => { o._origX = o.x; o._origY = o.y; });
            if (selectedObjects.length === 1) {
                imgOrigX = selectedObjects[0].x;
                imgOrigY = selectedObjects[0].y;
            }
        }, { passive: true });

        imgOverlay.addEventListener('touchmove', (e) => {
            if (!isDraggingImage || selectedObjects.length === 0) return;
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            const rect = draftCanvas.getBoundingClientRect();
            const cx = (touch.clientX - rect.left) / currentScale;
            const cy = (touch.clientY - rect.top)  / currentScale;
            const ddx = cx - imgDragStartX, ddy = cy - imgDragStartY;
            if (selectedObjects.length === 1) {
                const obj = selectedObjects[0];
                obj.x = imgOrigX + ddx;
                obj.y = imgOrigY + ddy;
                appliquerMouvement(obj);
            } else {
                selectedObjects.forEach(obj => {
                    if (obj._origX !== undefined) {
                        obj.x = obj._origX + ddx;
                        obj.y = obj._origY + ddy;
                        mettreAJourElement(obj);
                    }
                });
                positionnerOverlay(computeBB(selectedObjects));
            }
        }, { passive: true });

        imgOverlay.addEventListener('touchend', () => {
            if (isDraggingImage) {
                isDraggingImage = false;
                window.mobileObjectDragging = false;
                saveState();
            }
        });

        imgOverlay.addEventListener('touchcancel', () => {
            if (isDraggingImage) { isDraggingImage = false; window.mobileObjectDragging = false; }
        });

        // ── Double-clic sur un tableau → session d'édition des cellules ─────
        imgOverlay.addEventListener('dblclick', (e) => {
            if (selectedObjects.length !== 1) return;
            const obj = selectedObjects[0];
            if (obj.type !== 'table') return;
            e.preventDefault(); e.stopPropagation();

            const [cx, cy] = getPos(e);
            const pad  = obj._innerPad || 6;
            const cols = obj._cols || 3;
            const rows = obj._rows || 3;
            const innerX = obj.x + pad, innerY = obj.y + pad;
            const innerW = obj.w - pad * 2, innerH = obj.h - pad * 2;
            const cellW  = innerW / cols, cellH  = innerH / rows;
            const col = Math.max(0, Math.min(cols - 1, Math.floor((cx - innerX) / cellW)));
            const row = Math.max(0, Math.min(rows - 1, Math.floor((cy - innerY) / cellH)));

            masquerSelection();
            _fanOpen();
            animerVers(angleVersTete(4), () => {
                selectionnerOutil(7, 4, false);
                entrerModeEditionTableau(obj, col, row);
            });
        });

        // ── Session d'édition de tableau (clic sur n'importe quelle cellule) ──
        function entrerModeEditionTableau(tableObj, startCol, startRow) {
            window.tableEditMode = true;
            let textZoneActif = false;

            function ouvrirCellule(c, r) {
                if (textZoneActif) return;
                textZoneActif = true;
                const pad  = tableObj._innerPad || 6;
                const cols = tableObj._cols || 3;
                const rows = tableObj._rows || 3;
                const innerX = tableObj.x + pad, innerY = tableObj.y + pad;
                const innerW = tableObj.w - pad * 2, innerH = tableObj.h - pad * 2;
                const cellW  = innerW / cols, cellH = innerH / rows;
                const cellX  = innerX + c * cellW;
                const cellY  = innerY + r * cellH;
                creerZoneTexte(cellX, cellY, cellW, cellH, null, () => {
                    textZoneActif = false;
                });
            }

            const onCanvasClick = (e) => {
                if (e.button !== 0 || textZoneActif) return;
                const [cx, cy] = getPos(e);
                const pad  = tableObj._innerPad || 6;
                const cols = tableObj._cols || 3, rows = tableObj._rows || 3;
                const innerX = tableObj.x + pad, innerY = tableObj.y + pad;
                const innerW = tableObj.w - pad * 2, innerH = tableObj.h - pad * 2;
                // Clic hors du tableau → on sort de la session
                if (cx < innerX || cx > innerX + innerW || cy < innerY || cy > innerY + innerH) {
                    sortir(); return;
                }
                const col = Math.max(0, Math.min(cols - 1, Math.floor((cx - innerX) / (innerW / cols))));
                const row = Math.max(0, Math.min(rows - 1, Math.floor((cy - innerY) / (innerH / rows))));
                ouvrirCellule(col, row);
            };

            const onEsc = (e) => {
                if (e.key === 'Escape' && !textZoneActif) sortir();
            };

            // Écouter les clics sur le canvas (pas sur imgOverlay, qui est masqué)
            draftCanvas.addEventListener('mousedown', onCanvasClick);
            document.addEventListener('keydown', onEsc);

            function sortir() {
                window.tableEditMode = false;
                draftCanvas.removeEventListener('mousedown', onCanvasClick);
                document.removeEventListener('keydown', onEsc);
                if (window.desactiverOutil) window.desactiverOutil();
                if (roueConteneur.classList.contains('ouvert')) _fanClose();
            }

            // Ouvrir la première cellule immédiatement
            ouvrirCellule(startCol, startRow);
        }

        // ── Redimensionnement via les poignées de coin ────────────────────────
        ['nw','ne','sw','se'].forEach(c => {
            handleEls[c].addEventListener('mousedown', (e) => {
                if (e.button !== 0 || selectedObjects.length !== 1) return;
                e.preventDefault(); e.stopPropagation();
                isResizingImage = true;
                activeCorner = c;
                [imgDragStartX, imgDragStartY] = getPos(e);
                const obj = selectedObjects[0];
                imgOrigX = obj.x; imgOrigY = obj.y; imgOrigW = obj.w; imgOrigH = obj.h;
            });
        });

        // ── Redimensionnement via touch mobile ────────────────────────────────
        ['nw','ne','sw','se'].forEach(c => {
            handleEls[c].addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1 || selectedObjects.length !== 1) return;
                e.stopPropagation();
                const obj = selectedObjects[0];
                isResizingImage = true;
                activeCorner = c;
                window.mobileObjectDragging = true;
                const touch = e.touches[0];
                const rect = draftCanvas.getBoundingClientRect();
                imgDragStartX = (touch.clientX - rect.left) / currentScale;
                imgDragStartY = (touch.clientY - rect.top)  / currentScale;
                imgOrigX = obj.x; imgOrigY = obj.y;
                imgOrigW = obj.w; imgOrigH = obj.h;
            }, { passive: true });

            handleEls[c].addEventListener('touchmove', (e) => {
                if (!isResizingImage || selectedObjects.length !== 1 || !activeCorner) return;
                if (e.touches.length !== 1) return;
                const obj = selectedObjects[0];
                const touch = e.touches[0];
                const rect = draftCanvas.getBoundingClientRect();
                const cx = (touch.clientX - rect.left) / currentScale;
                const cy = (touch.clientY - rect.top)  / currentScale;
                const dx = cx - imgDragStartX, dy = cy - imgDragStartY;

                let rawW = imgOrigW, rawH = imgOrigH;
                if (activeCorner.includes('e')) rawW = imgOrigW + dx;
                if (activeCorner.includes('w')) rawW = imgOrigW - dx;
                if (activeCorner.includes('s')) rawH = imgOrigH + dy;
                if (activeCorner.includes('n')) rawH = imgOrigH - dy;

                const nw = Math.max(20, rawW);
                const nh = Math.max(20, rawH);
                const nx = activeCorner.includes('w') ? imgOrigX + imgOrigW - nw : imgOrigX;
                const ny = activeCorner.includes('n') ? imgOrigY + imgOrigH - nh : imgOrigY;
                obj.x = nx; obj.y = ny; obj.w = nw; obj.h = nh;
                if (obj.type === 'text' && obj._text) reRenderText(obj);
                appliquerMouvement(obj);
            }, { passive: true });

            handleEls[c].addEventListener('touchend', () => {
                if (isResizingImage) {
                    isResizingImage = false; activeCorner = null;
                    window.mobileObjectDragging = false;
                    saveState();
                }
            });

            handleEls[c].addEventListener('touchcancel', () => {
                if (isResizingImage) {
                    isResizingImage = false; activeCorner = null;
                    window.mobileObjectDragging = false;
                }
            });
        });

        // ── Rotation via les poignées diagonales ─────────────────────────────
        Object.values(rotateHandleEls).forEach(h => {
            h.addEventListener('mousedown', (e) => {
                if (e.button !== 0 || selectedObjects.length !== 1) return;
                e.preventDefault(); e.stopPropagation();
                const obj = selectedObjects[0];
                // Centre de l'objet en coordonnées canvas
                rotCenterX = obj.x + obj.w / 2;
                rotCenterY = obj.y + obj.h / 2;
                const [cx, cy] = getPos(e);
                rotStartAngle   = Math.atan2(cy - rotCenterY, cx - rotCenterX);
                rotOrigRotation = obj.rotation || 0;
                isRotatingImage = true;
            });
        });

        function appliquerMouvement(obj) {
            mettreAJourElement(obj);
            // updateConnectorsOf(obj); // CONNECTEURS
            positionnerOverlay(computeBB(selectedObjects));
        }

        document.addEventListener('mousemove', (e) => {
            // Pan déclenché depuis l'overlay (clic droit sur overlay, mousemove capturé ici)
            // Quand isPanning est actif et que le canvas ne reçoit pas les events (overlay au-dessus)
            if (isPanning) {
                e.preventDefault();
                currentTx = e.clientX - panStartX; currentTy = e.clientY - panStartY;
                planDeTravail.style.transform = `translate(${currentTx}px, ${currentTy}px) scale(${currentScale})`;
                if (selectedObjects.length > 0) majActionPanel();
                return;
            }
            if (isDraggingImage && selectedObjects.length > 0) {
                const [cx, cy] = getPos(e);
                const ddx = cx - imgDragStartX, ddy = cy - imgDragStartY;
                if (selectedObjects.length === 1) {
                    const obj = selectedObjects[0];
                    obj.x = imgOrigX + ddx;
                    obj.y = imgOrigY + ddy;
                    appliquerMouvement(obj);
                } else {
                    // Multi-sélection : déplacer tous les objets
                    selectedObjects.forEach(obj => {
                        if (obj._origX !== undefined) {
                            obj.x = obj._origX + ddx;
                            obj.y = obj._origY + ddy;
                            mettreAJourElement(obj);
                            // updateConnectorsOf(obj); // CONNECTEURS
                        }
                    });
                    positionnerOverlay(computeBB(selectedObjects));
                }
            } else if (isRotatingImage && selectedObjects.length === 1) {
                const obj = selectedObjects[0];
                const [cx, cy] = getPos(e);
                const angle = Math.atan2(cy - rotCenterY, cx - rotCenterX);
                obj.rotation = rotOrigRotation + (angle - rotStartAngle) * (180 / Math.PI);
                mettreAJourElement(obj);
                positionnerOverlay(computeBB(selectedObjects));
            } else if (isResizingImage && selectedObjects.length === 1 && activeCorner) {
                const obj = selectedObjects[0];
                const [cx, cy] = getPos(e);
                const dx = cx - imgDragStartX, dy = cy - imgDragStartY;

                // Calcul brut (sans contrainte)
                let rawW = imgOrigW, rawH = imgOrigH;
                if (activeCorner.includes('e')) rawW = imgOrigW + dx;
                if (activeCorner.includes('w')) rawW = imgOrigW - dx;
                if (activeCorner.includes('s')) rawH = imgOrigH + dy;
                if (activeCorner.includes('n')) rawH = imgOrigH - dy;

                // Shift → verrouiller le ratio d'origine
                if (e.shiftKey && imgOrigW > 0 && imgOrigH > 0) {
                    const ratio = imgOrigW / imgOrigH;
                    if (Math.abs(rawW / imgOrigW) >= Math.abs(rawH / imgOrigH)) {
                        rawH = rawW / ratio;
                    } else {
                        rawW = rawH * ratio;
                    }
                }

                const nw = Math.max(20, rawW);
                const nh = Math.max(20, rawH);
                const nx = activeCorner.includes('w') ? imgOrigX + imgOrigW - nw : imgOrigX;
                const ny = activeCorner.includes('n') ? imgOrigY + imgOrigH - nh : imgOrigY;
                obj.x = nx; obj.y = ny; obj.w = nw; obj.h = nh;
                if (obj.type === 'text' && obj._text) reRenderText(obj);
                appliquerMouvement(obj);
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (isDraggingImage) { isDraggingImage = false; saveState(); }
            if (isResizingImage) { isResizingImage = false; activeCorner = null; saveState(); }
            if (isRotatingImage) { isRotatingImage = false; saveState(); }
            // Relâchement du pan (clic droit) depuis n'importe où
            if (isPanning && e.button === 2) {
                isPanning = false;
                draftCanvas.style.cursor = window.activeToolMode === 'hand' ? 'grab'
                    : (window.activeToolMode === 'draw' || window.activeToolMode === 'shape') ? 'crosshair'
                    : 'default';
            }
        });

        // Suppr → supprimer | Échap → désélect | Ctrl+C/V → copier/coller
        document.addEventListener('keydown', (e) => {
            // Ignorer si focus dans un champ texte
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

            // Échap ou P → quitter le mode présentation
            if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && document.body.classList.contains('mode-presentation')) {
                btnOeil.click(); e.preventDefault(); return;
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObjects.length > 0 && !e.ctrlKey && !e.metaKey) {
                btnDelete.click();
                e.preventDefault();
            }
            if (e.key === 'Escape' && selectedObjects.length > 0) masquerSelection();

            // Ctrl+C / Cmd+C → copier la sélection dans le presse-papiers interne
            if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey) && selectedObjects.length > 0) {
                clipboard = selectedObjects.map(obj => ({ ...obj })); // snapshot
                e.preventDefault();
            }
            // Ctrl+V / Cmd+V → coller avec décalage
            if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey) && clipboard.length > 0) {
                dupliquerObjets(clipboard, 20, 20);
                e.preventDefault();
            }
        });

        // ── DROP d'image ou de PDF depuis la dropbox ou le Finder ───────────
        conteneur.addEventListener('dragover', (e) => {
            const ft = fichierEnCoursDeDeplacement?._file?.type;
            // Accepter aussi les fichiers glissés directement depuis le Finder
            const extFt = !fichierEnCoursDeDeplacement && e.dataTransfer?.items?.[0]?.type;
            if (ft?.startsWith('image/') || ft === 'application/pdf' ||
                extFt?.startsWith('image/') || extFt === 'application/pdf') {
                e.preventDefault();
                conteneur.classList.add('drag-over-fichier');
            }
        });
        conteneur.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget || !conteneur.contains(e.relatedTarget)) {
                conteneur.classList.remove('drag-over-fichier');
            }
        });
        conteneur.addEventListener('drop', (e) => {
            conteneur.classList.remove('drag-over-fichier');

            // ── Glisser depuis le Finder (vrai File → blob URL → compatible Chrome file://) ──
            if (!fichierEnCoursDeDeplacement && e.dataTransfer?.files?.length > 0) {
                const realFile = e.dataTransfer.files[0];
                const ft = realFile.type || (realFile.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
                if (!ft.startsWith('image/') && ft !== 'application/pdf') return;
                e.preventDefault();
                const rect = draftCanvas.getBoundingClientRect();
                const dropX = (e.clientX - rect.left) / currentScale;
                const dropY = (e.clientY - rect.top) / currentScale;
                if (ft === 'application/pdf') {
                    placerPDF(realFile); // vrai File → URL.createObjectURL → blob:// → fonctionne en Chrome
                    return;
                }
                if (ft === 'image/gif') {
                    // GIFs : lire comme data URL pour préserver l'animation (canvas tuerait l'animation)
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const dataUrl = ev.target.result;
                        const tmpImg = new Image();
                        tmpImg.onload = () => {
                            const maxSize = 800;
                            let w = tmpImg.naturalWidth, h = tmpImg.naturalHeight;
                            if (w > maxSize || h > maxSize) { const ratio = Math.min(maxSize/w, maxSize/h); w=Math.round(w*ratio); h=Math.round(h*ratio); }
                            const el = document.createElement('img');
                            el.src = dataUrl;
                            el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                            el.style.width = w + 'px'; el.style.height = h + 'px';
                            const obj = { type: 'gif', el, x: dropX-w/2, y: dropY-h/2, w, h, rotation: 0 };
                            mettreAJourElement(obj); planDeTravail.appendChild(el); placedObjects.push(obj);
                            saveState();
                        };
                        tmpImg.src = dataUrl;
                    };
                    reader.readAsDataURL(realFile);
                    return;
                }
                const blobSrc = URL.createObjectURL(realFile);
                const loader = new Image();
                loader.onload = () => {
                    URL.revokeObjectURL(blobSrc);
                    const maxSize = 800;
                    let w = loader.naturalWidth, h = loader.naturalHeight;
                    if (w > maxSize || h > maxSize) { const ratio = Math.min(maxSize/w, maxSize/h); w=Math.round(w*ratio); h=Math.round(h*ratio); }
                    const rast = document.createElement('canvas');
                    rast.width = w; rast.height = h;
                    rast.getContext('2d').drawImage(loader, 0, 0, w, h);
                    const el = document.createElement('img');
                    el.src = rast.toDataURL('image/png');
                    el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                    const obj = { type: 'img', el, x: dropX-w/2, y: dropY-h/2, w, h, rotation: 0 };
                    mettreAJourElement(obj); planDeTravail.appendChild(el); placedObjects.push(obj);
                    saveState();
                };
                loader.onerror = () => URL.revokeObjectURL(blobSrc);
                loader.src = blobSrc;
                return;
            }

            // ── Fichier depuis la dropbox interne ──────────────────────────────
            const file = fichierEnCoursDeDeplacement?._file;
            if (!file) return;
            const ft = file.type;
            if (!ft.startsWith('image/') && ft !== 'application/pdf') return;
            e.preventDefault();
            const rect = draftCanvas.getBoundingClientRect();
            const dropX = (e.clientX - rect.left) / currentScale;
            const dropY = (e.clientY - rect.top) / currentScale;

            if (ft === 'application/pdf') {
                // Accepte un vrai File ou un objet-chemin {_pdfPath} ou {_pdfData}
                placerPDF(file);
                return;
            }

            // Charger l'image puis rasteriser → dataURL stable (survit aux changements de board)
            // Exception GIF : ne pas passer par canvas (tuerait l'animation)
            if (ft === 'image/gif' || file._gifSrc) {
                const doPlaceGif = src => {
                    const tmpImg = new Image();
                    tmpImg.onload = () => {
                        const maxSize = 800;
                        let w = tmpImg.naturalWidth, h = tmpImg.naturalHeight;
                        if (w > maxSize || h > maxSize) { const ratio = Math.min(maxSize/w, maxSize/h); w=Math.round(w*ratio); h=Math.round(h*ratio); }
                        const el = document.createElement('img');
                        el.src = src;
                        el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                        el.style.width = w + 'px'; el.style.height = h + 'px';
                        const obj = { type: 'gif', el, x: dropX-w/2, y: dropY-h/2, w, h, rotation: 0 };
                        mettreAJourElement(obj); planDeTravail.appendChild(el); placedObjects.push(obj);
                        saveState();
                    };
                    tmpImg.src = src;
                };
                if (file._gifSrc) {
                    doPlaceGif(file._gifSrc);
                } else {
                    const reader = new FileReader();
                    reader.onload = ev => doPlaceGif(ev.target.result);
                    reader.readAsDataURL(file);
                }
                return;
            }

            const blobSrc2 = (file instanceof File || file.size !== undefined)
                ? URL.createObjectURL(file) : null;
            if (!blobSrc2) return;

            const loader2 = new Image();
            loader2.onload = () => {
                URL.revokeObjectURL(blobSrc2);
                const maxSize = 800;
                let w = loader2.naturalWidth, h = loader2.naturalHeight;
                if (w > maxSize || h > maxSize) {
                    const ratio = Math.min(maxSize / w, maxSize / h);
                    w = Math.round(w * ratio); h = Math.round(h * ratio);
                }
                const rast2 = document.createElement('canvas');
                rast2.width = w; rast2.height = h;
                rast2.getContext('2d').drawImage(loader2, 0, 0, w, h);
                const el = document.createElement('img');
                el.src = rast2.toDataURL('image/png');
                el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const obj = { type: 'img', el, x: dropX - w / 2, y: dropY - h / 2, w, h, rotation: 0 };
                mettreAJourElement(obj);
                planDeTravail.appendChild(el);
                placedObjects.push(obj);
                saveState();
            };
            loader2.onerror = () => URL.revokeObjectURL(blobSrc2);
            loader2.src = blobSrc2;
        });

        // ── MODE PLACEMENT PDF (style InDesign) ──────────────────────────────
        // Affiche un toast d'erreur temporaire
        function toastErreur(msg) {
            const t = document.createElement('div');
            t.textContent = msg;
            t.style.cssText = 'position:fixed;bottom:30px;right:30px;background:#ff4000;color:#fff;padding:12px 20px;border-radius:10px;font-family:"DM Sans",sans-serif;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);';
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 4000);
        }

        // Accepte un vrai File, {_pdfPath}, ou {_pdfData: Uint8Array}
        async function placerPDF(file) {
            if (!window.pdfjsLib) { toastErreur('PDF.js non disponible — connexion internet requise.'); return; }
            let pdfSource;
            if (file._pdfData) {
                pdfSource = { data: file._pdfData };
            } else {
                // URL absolue pour éviter les problèmes d'encodage des espaces
                const raw = file._pdfPath ? file._pdfPath : null;
                const url = raw ? new URL(raw, window.location.href).href : URL.createObjectURL(file);
                pdfSource = { url };
                // Tentative de chargement binaire via XHR (fonctionne en file:// sur Safari/Firefox)
                const data = await new Promise(resolve => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', url, true);
                    xhr.responseType = 'arraybuffer';
                    xhr.onload  = () => (xhr.status === 0 || xhr.status === 200) && xhr.response?.byteLength > 0
                        ? resolve(new Uint8Array(xhr.response)) : resolve(null);
                    xhr.onerror = () => resolve(null);
                    xhr.send();
                });
                if (data) pdfSource = { data };
            }
            let pdf;
            try {
                pdf = await window.pdfjsLib.getDocument({ ...pdfSource, cMapPacked: true }).promise;
            } catch (err) {
                console.error('Impossible de lire le PDF :', err);
                if (pdfSource.url && !file._pdfData) URL.revokeObjectURL(pdfSource.url);
                toastErreur('PDF : impossible de lire ce fichier en mode file://. Utilisez un serveur local ou Firefox.');
                return;
            }

            const totalPages = pdf.numPages;
            let pageActuelle = 0;
            let actif = true;
            const cache = new Map(); // index → { img, w, h }

            // Rendu d'une page PDF dans un canvas offscreen → Image
            async function rendrePage(idx) {
                if (cache.has(idx)) return cache.get(idx);
                const page = await pdf.getPage(idx + 1); // PDF.js est 1-indexé
                const vp0 = page.getViewport({ scale: 1 });
                const maxDim = 1200;
                const scale = Math.min(maxDim / vp0.width, maxDim / vp0.height, 2);
                const vp = page.getViewport({ scale });
                const offscreen = document.createElement('canvas');
                offscreen.width  = Math.round(vp.width);
                offscreen.height = Math.round(vp.height);
                const ctx2d = offscreen.getContext('2d');
                // Fond blanc (les PDF ont souvent un fond transparent sur canvas)
                ctx2d.fillStyle = '#ffffff';
                ctx2d.fillRect(0, 0, offscreen.width, offscreen.height);
                await page.render({ canvasContext: ctx2d, viewport: vp }).promise;
                const img = new Image();
                img.src = offscreen.toDataURL('image/png');
                await new Promise(r => { img.onload = r; });
                const entry = { img, w: offscreen.width, h: offscreen.height };
                cache.set(idx, entry);
                return entry;
            }

            // Précharger page 0 (bloquant) puis page 1 (en avance)
            await rendrePage(0);
            if (totalPages > 1) rendrePage(1);

            // Bloquer le rectangle de sélection pendant le placement
            pdfPlacementActif = true;

            // ── Curseur : angle supérieur gauche + aperçu à droite ──────────
            const curseurDiv = document.createElement('div');
            curseurDiv.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:flex;align-items:flex-start;gap:10px;';

            // Indicateur d'angle supérieur gauche (exactement au hotspot du curseur)
            const coinIndicateur = document.createElement('div');
            coinIndicateur.style.cssText = 'width:18px;height:18px;border-left:3px solid #ff4000;border-top:3px solid #ff4000;flex-shrink:0;';

            // Colonne droite : miniature + badge
            const colonneDroite = document.createElement('div');
            colonneDroite.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:5px;';

            const previewImg = document.createElement('img');
            previewImg.style.cssText = 'width:130px;height:auto;border:2px solid rgba(255,64,0,0.85);box-shadow:0 4px 16px rgba(0,0,0,0.35);background:#fff;display:block;opacity:0.85;';

            const badge = document.createElement('div');
            badge.style.cssText = 'background:#ff4000;color:#fff;font-family:"DM Sans",sans-serif;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap;';

            colonneDroite.appendChild(previewImg);
            colonneDroite.appendChild(badge);
            curseurDiv.appendChild(coinIndicateur);
            curseurDiv.appendChild(colonneDroite);
            document.body.appendChild(curseurDiv);

            function majApercu() {
                const p = cache.get(pageActuelle);
                if (p) previewImg.src = p.img.src;
                const restantes = totalPages - pageActuelle - 1;
                badge.textContent = restantes > 0
                    ? `Page ${pageActuelle + 1} sur ${totalPages}  (${restantes} restante${restantes > 1 ? 's' : ''})`
                    : `Page ${pageActuelle + 1} sur ${totalPages}  — dernière page`;
            }
            majApercu();

            function suivreSouris(e) {
                // Positionner le curseurDiv exactement au point du curseur
                // → l'angle L correspond à l'angle supérieur gauche de la page
                curseurDiv.style.left = e.clientX + 'px';
                curseurDiv.style.top  = e.clientY + 'px';
            }
            document.addEventListener('mousemove', suivreSouris);
            draftCanvas.style.cursor = 'none';

            // ── Placement au clic — ancré à l'angle supérieur gauche ────────
            function placerPage(e) {
                if (!actif) return;
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();

                const p = cache.get(pageActuelle);
                if (!p) return;

                // Le coin supérieur gauche est exactement là où le curseur pointe
                const [cx, cy] = getPos(e);
                const el = document.createElement('img');
                el.src = p.img.src; // dataURL
                el.style.cssText = `position:absolute;z-index:3;pointer-events:none;left:${cx}px;top:${cy}px;width:${p.w}px;height:${p.h}px;`;
                planDeTravail.appendChild(el);
                const pdfObj = { type: 'img', el, x: cx, y: cy, w: p.w, h: p.h, rotation: 0 };
                if (file._pdfPath) pdfObj._pdfPath = file._pdfPath;
                placedObjects.push(pdfObj);
                saveState();

                pageActuelle++;
                if (pageActuelle < totalPages) {
                    if (pageActuelle + 1 < totalPages) rendrePage(pageActuelle + 1);
                    majApercu();
                } else {
                    terminer();
                }
            }

            function terminer() {
                actif = false;
                pdfPlacementActif = false;
                document.removeEventListener('mousemove', suivreSouris);
                draftCanvas.removeEventListener('mousedown', placerPage);
                document.removeEventListener('keydown', gererEscape);
                curseurDiv.remove();
                draftCanvas.style.cursor = 'default';
                URL.revokeObjectURL(url);
            }

            function gererEscape(e) {
                if (e.key === 'Escape') terminer();
            }

            draftCanvas.addEventListener('mousedown', placerPage);
            document.addEventListener('keydown', gererEscape);
        }

        // ── MODE PLACEMENT MULTI-IMAGES (bouton importer) ────────────────────
        async function entrerModePlacementImages(files) {
            if (!files || files.length === 0) return;

            // Ne garder que les images (PDF → mode placerPDF séparé)
            const imageFiles = Array.from(files).filter(f =>
                (f.type && f.type.startsWith('image/')) || f._gifSrc || f._imgSrc
            );
            if (imageFiles.length === 0) return;

            // Préchargement de toutes les images en parallèle
            const items = imageFiles.map(file => {
                const src = (file._gifSrc || file._imgSrc)
                    ? (file._gifSrc || file._imgSrc)
                    : (file instanceof File || file.size !== undefined)
                        ? URL.createObjectURL(file) : null;
                if (!src) return null;
                const img = new Image();
                img.src = src;
                return { img, src, file };
            }).filter(Boolean);
            if (items.length === 0) return;

            // Attendre la 1re image
            await new Promise(r => {
                if (items[0].img.complete && items[0].img.naturalWidth > 0) { r(); return; }
                items[0].img.onload = r; items[0].img.onerror = r;
            });

            let idx = 0, actif = true;
            pdfPlacementActif = true;

            // ── UI curseur (même style que PDF) ──────────────────────────────
            const curseurDiv = document.createElement('div');
            curseurDiv.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:flex;align-items:flex-start;gap:10px;';

            const coin = document.createElement('div');
            coin.style.cssText = 'width:18px;height:18px;border-left:3px solid #ff4000;border-top:3px solid #ff4000;flex-shrink:0;margin-top:2px;';

            const col = document.createElement('div');
            col.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:5px;';

            const prevImg = document.createElement('img');
            prevImg.style.cssText = 'width:130px;height:auto;max-height:160px;object-fit:contain;border:2px solid rgba(255,64,0,0.85);box-shadow:0 4px 16px rgba(0,0,0,0.35);background:#fff;display:block;opacity:0.85;';

            const badge = document.createElement('div');
            badge.style.cssText = 'background:#ff4000;color:#fff;font-family:"DM Sans",sans-serif;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;letter-spacing:0.02em;';

            col.appendChild(prevImg); col.appendChild(badge);
            curseurDiv.appendChild(coin); curseurDiv.appendChild(col);
            document.body.appendChild(curseurDiv);

            function majApercu() {
                const it = items[idx];
                prevImg.src = it.img.src;
                const reste = items.length - idx - 1;
                badge.textContent = reste > 0
                    ? `${idx + 1} / ${items.length}  ·  ${reste} restante${reste > 1 ? 's' : ''}`
                    : `${idx + 1} / ${items.length}  —  dernière`;
            }
            majApercu();

            function suivreSouris(e) {
                curseurDiv.style.left = e.clientX + 'px';
                curseurDiv.style.top  = e.clientY + 'px';
            }
            document.addEventListener('mousemove', suivreSouris);
            draftCanvas.style.cursor = 'none';

            function placerImage(e) {
                if (!actif || e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                const it = items[idx];
                if (!it.img.complete || it.img.naturalWidth === 0) return;

                const maxSize = 800;
                let w = it.img.naturalWidth, h = it.img.naturalHeight;
                if (w > maxSize || h > maxSize) {
                    const ratio = Math.min(maxSize / w, maxSize / h);
                    w = Math.round(w * ratio); h = Math.round(h * ratio);
                }

                const [cx, cy] = getPos(e);
                const el = document.createElement('img');

                // Rasteriser en dataURL stable — les blob: URLs sont révoquées
                // juste après et ne survivent pas à un changement de board
                const rast = document.createElement('canvas');
                rast.width = w; rast.height = h;
                rast.getContext('2d').drawImage(it.img, 0, 0, w, h);
                el.src = rast.toDataURL('image/png');

                el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const type = (it.file && it.file.type === 'image/gif') ? 'gif' : 'img';
                const obj = { type, el, x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0 };
                mettreAJourElement(obj);
                planDeTravail.appendChild(el);
                placedObjects.push(obj);
                saveState();

                idx++;
                if (idx < items.length) { majApercu(); }
                else { terminer(); }
            }

            function terminer() {
                actif = false; pdfPlacementActif = false;
                document.removeEventListener('mousemove', suivreSouris);
                draftCanvas.removeEventListener('mousedown', placerImage);
                document.removeEventListener('keydown', gererEsc);
                curseurDiv.remove();
                draftCanvas.style.cursor = window.activeToolMode === 'draw' || window.activeToolMode === 'shape' || window.activeToolMode === 'table' ? 'crosshair' : 'default';
                items.forEach(it => { if (it.src && it.src.startsWith('blob:')) URL.revokeObjectURL(it.src); });
            }

            function gererEsc(e) { if (e.key === 'Escape') terminer(); }
            draftCanvas.addEventListener('mousedown', placerImage);
            document.addEventListener('keydown', gererEsc);
        }
        window.entrerModePlacementImages = entrerModePlacementImages;

        // ── Exposition pour le carrousel de tableaux ─────────────────────────
        window.getBoardState = () => ({
            imageData: mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height),
            objs: serializePlacedObjects()
        });
        window.setBoardState = (state) => {
            mainCtx.putImageData(state.imageData, 0, 0);
            placedObjects.forEach(o => o.el.remove());
            placedObjects.length = 0;
            masquerSelection();
            (state.objs || []).forEach(s => {
                const el = document.createElement('img');
                el.style.cssText = 'position:absolute;z-index:3;pointer-events:none;';
                const obj = { type: s.type, el, x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation || 0 };
                if (s._text)  { obj._text = s._text; obj._fontFamily = s._fontFamily; obj._fontSize = s._fontSize; obj._fontWeight = s._fontWeight; obj._color = s._color; }
                if (s.type === 'table') { obj._cols = s._cols; obj._rows = s._rows; obj._innerPad = s._innerPad; }
                mettreAJourElement(obj);
                planDeTravail.appendChild(el);
                placedObjects.push(obj);
                el.src = s.src;
            });
            history.length = 0; historyStep = -1;
            saveState();
        };
        window.generateThumbnail = () => {
            const W = mainCanvas.width, H = mainCanvas.height;
            const TW = 220, TH = Math.round(220 * H / W); // ratio réel du canvas
            const tmp  = document.createElement('canvas');
            tmp.width = TW; tmp.height = TH;
            const tctx = tmp.getContext('2d');
            const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#e0e5ec';
            tctx.fillStyle = bg;
            tctx.fillRect(0, 0, TW, TH);
            // fond + traits permanents
            tctx.drawImage(mainCanvas, 0, 0, W, H, 0, 0, TW, TH);
            // objets placés (coups de crayon, formes)
            const sx = TW / W, sy = TH / H;
            placedObjects.forEach(obj => {
                if (!obj.el.complete || !obj.el.naturalWidth) return;
                tctx.save();
                tctx.translate((obj.x + obj.w / 2) * sx, (obj.y + obj.h / 2) * sy);
                if (obj.rotation) tctx.rotate(obj.rotation);
                tctx.drawImage(obj.el, -obj.w * sx / 2, -obj.h * sy / 2, obj.w * sx, obj.h * sy);
                tctx.restore();
            });
            return tmp.toDataURL('image/jpeg', 0.75);
        };
    }
    initCanvas();

    // ── SLIDER GOOEY ─────────────────────────────────────────────────────────
    function creerGooeySlider(parent, idUnique, initialPercent, onChangeCallback) {
        parent.style.cssText += 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:visible;';
        const maxDrag = 296;

        // 11 traits oranges aux dizaines (0%→100%)
        let traitsHTML = '';
        for (let i = 0; i <= 10; i++) {
            const posX = 146 + (i * (maxDrag / 10));
            traitsHTML += `<line x1="${posX}" y1="283" x2="${posX}" y2="316" stroke="#ff4000" stroke-width="4" stroke-linecap="round"/>`;
        }

        // viewBox rectangulaire 316×80, centré sur le track y=299.5 (260+40=300 ≈ 299.5)
        // Piste x=146–442, traits y=283–316, bulle déborde au-dessus (overflow:visible)
        parent.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="130 260 316 80" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;overflow:visible;display:block;">
            <defs>
                <linearGradient id="bubbleGrad_${idUnique}" x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
                    <stop offset="0%" stop-color="#ff4000"/>
                    <stop offset="100%" stop-color="#ffffff"/>
                </linearGradient>
                <filter id="goo_${idUnique}" color-interpolation-filters="sRGB">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur"/>
                    <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -7" result="cm"/>
                </filter>
            </defs>
            <g id="dragGroup_${idUnique}">
                ${traitsHTML}
                <g id="displayGroup_${idUnique}">
                    <g filter="url(#goo_${idUnique})">
                        <circle id="display_${idUnique}" fill="url(#bubbleGrad_${idUnique})" cx="146" cy="299.5" r="22"/>
                        <circle id="dragger_${idUnique}" fill="#ff4000" cx="146" cy="299.5" r="21" style="cursor:pointer;"/>
                    </g>
                    <text id="downText_${idUnique}" x="146" y="305" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="22" fill="white" pointer-events="none">0</text>
                    <text id="upText_${idUnique}" x="146" y="258" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="50" fill="white" pointer-events="none" opacity="0">0</text>
                </g>
            </g>
        </svg>`;
        const dragger  = parent.querySelector(`#dragger_${idUnique}`);
        const display  = parent.querySelector(`#display_${idUnique}`);
        const upText   = parent.querySelector(`#upText_${idUnique}`);
        const downText = parent.querySelector(`#downText_${idUnique}`);
        const tl = gsap.timeline({ paused: true });
        // Bulle monte de 56 unités et grossit à r=55 ; knob rétrécit à r=13
        tl.to(display,  { attr: { cy: '-=56', r: 55 }, duration: 1, ease: "elastic.out(0.4, 0.1)" })
          .to(dragger,  { attr: { r: 13 }, duration: 1, ease: "elastic.out(0.4, 0.1)" }, "-=1")
          .to(downText, { opacity: 0, duration: 1 }, "-=1")
          .to(upText,   { opacity: 1, duration: 1 }, "-=1");
        const initX = (initialPercent / 100) * maxDrag;
        gsap.set(dragger,  { x: initX }); gsap.set(display, { x: initX });
        upText.textContent = downText.textContent = initialPercent;
        gsap.set([upText, downText], { attr: { x: initX + 146 } });
        Draggable.create(dragger, {
            type: 'x', bounds: { minX: 0, maxX: maxDrag },
            liveSnap: { x: (v) => { const step = maxDrag / 10; const c = Math.round(v / step) * step; return Math.abs(v - c) < 10 ? c : v; } },
            onPress() {
                parent.style.zIndex = "10";
                // Permettre à la bulle de déborder au-dessus du panel
                const pi = parent.closest('.roue-panel-inner');
                if (pi) { pi._ovSave = pi.style.overflow; pi.style.overflow = 'visible'; }
                tl.play();
            },
            onRelease() {
                parent.style.zIndex = "1";
                const pi = parent.closest('.roue-panel-inner');
                if (pi) pi.style.overflow = pi._ovSave || '';
                tl.reverse();
            },
            onDrag() {
                let v = Math.max(0, Math.min(100, Math.round((this.x / maxDrag) * 100)));
                upText.textContent = downText.textContent = v;
                gsap.to(display, { x: this.x, duration: 0.4, ease: "power2.out" });
                gsap.to([upText, downText], { attr: { x: this.x + 146 }, duration: 0.5, stagger: 0.015, ease: "elastic.out(1, 0.6)" });
                if (onChangeCallback) onChangeCallback(v);
            }
        });
    }

    // ── DROPBOX ───────────────────────────────────────────────────────────────
    function mettreAJourDropboxMax() {
        // Rien à faire : la dropbox se rétrécit via flex naturellement
    }
    window.addEventListener('resize', mettreAJourDropboxMax);

    const dossiersFixes = [
        { id: 'Tstd2a',       fichiers: ['fichier1', 'fichier2', 'fichier3'] },
        { id: 'Pstd2a',       fichiers: ['fichier1', 'fichier2', 'fichier3'] },
        { id: 'importations', fichiers: [] },
    ];

    const svgDossier = `<svg class="dossier-icone" viewBox="0 0 20 16" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 3 Q1 1 3 1 L7 1 L9 3 L19 3 Q19 3 19 5 L19 14 Q19 15 18 15 L2 15 Q1 15 1 14 Z" fill="var(--bleu-marine)" stroke="none"/>
    </svg>`;

    const svgFleche = (ouvert) =>
        `<svg class="dossier-fleche" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" style="transform:rotate(${ouvert ? 90 : 0}deg);transition:transform 0.2s ease">
            <path d="M3 2 L7 5 L3 8" fill="none" stroke="var(--bleu-marine)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

    const conteneurDossiers = document.createElement('div');
    conteneurDossiers.className = 'dropbox-dossiers';
    if (dropbox) dropbox.appendChild(conteneurDossiers);

    let fichierEnCoursDeDeplacement = null;

    function creerFichierDraggable(nom, file = null) {
    const item = document.createElement('div');
    item.className = 'dropbox-dossier-item';
    item._file = file;
    
    // On crée un conteneur interne pour la ligne (nom + croix)
    const itemContenu = document.createElement('div');
    itemContenu.className = 'item-ligne'; // Nouvelle classe pour le hover précis
    
    const nomSpan = document.createElement('span');
    nomSpan.className = 'nom-fichier-texte'; // Classe pour l'ellipse (...)
    nomSpan.textContent = nom;
    
    const croix = document.createElement('span');
    croix.className = 'fichier-croix';
    croix.innerHTML = '&times;';
    croix.addEventListener('click', (e) => {
        e.stopPropagation();
        item.remove();
    });

    itemContenu.appendChild(nomSpan);
    itemContenu.appendChild(croix);
    item.appendChild(itemContenu);
    
    item.draggable = true;

    // Double-clic pour renommer (appliqué sur le texte)
    nomSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        item.draggable = false; 
        nomSpan.contentEditable = 'true';
        nomSpan.focus();
        nomSpan.style.outline = '1px solid var(--bleu-marine)';
        
        const sauvegarder = () => {
            nomSpan.contentEditable = 'false';
            item.draggable = true;
            nomSpan.style.outline = '';
            if (nomSpan.textContent.trim() === '') nomSpan.textContent = 'Sans nom';
        };

        nomSpan.addEventListener('blur', sauvegarder, {once: true});
        nomSpan.addEventListener('keydown', (ek) => { if(ek.key === 'Enter'){ ek.preventDefault(); nomSpan.blur(); }});
    });

    // Drag & Drop
    item.addEventListener('dragstart', (e) => { e.stopPropagation(); fichierEnCoursDeDeplacement = item; item.style.opacity = '0.4'; });
    item.addEventListener('dragend', () => { fichierEnCoursDeDeplacement = null; item.style.opacity = '1'; });

    item.addEventListener('dragover', (e) => { 
    e.preventDefault(); 
    e.stopPropagation(); 
    // On retire le fond à tous les autres items pour éviter les doublons
    document.querySelectorAll('.item-ligne').forEach(el => el.style.backgroundColor = '');
    itemContenu.style.backgroundColor = 'rgba(0,31,63,0.1)'; 
    });

    item.addEventListener('dragleave', (e) => { 
    e.stopPropagation();
    itemContenu.style.backgroundColor = ''; 
});

    item.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        itemContenu.style.backgroundColor = '';
        if (fichierEnCoursDeDeplacement && fichierEnCoursDeDeplacement !== item && !item.contains(fichierEnCoursDeDeplacement)) {
            let subList = item.querySelector('.dropbox-dossier-liste');
            if (!subList) {
                subList = document.createElement('div');
                subList.className = 'dropbox-dossier-liste';
                subList.style.paddingLeft = '18px';
                // LE TRAIT A ÉTÉ SUPPRIMÉ ICI (plus de border-left)
                item.appendChild(subList);
            }
            subList.appendChild(fichierEnCoursDeDeplacement);
        }
    });

    return item;
}

    dossiersFixes.forEach(({ id, fichiers }) => {
        const bloc = document.createElement('div');
        bloc.className = 'dropbox-dossier-bloc';
        const entete = document.createElement('div');
        entete.className = 'dropbox-dossier-entete';
        entete.innerHTML = `${svgFleche(false)}${svgDossier}<span class="dropbox-dossier-titre">${id}</span>`;
        const liste = document.createElement('div');
        liste.className = 'dropbox-dossier-liste';
        liste.style.display = 'none';
        if (id === 'importations') { liste.id = 'liste-importations'; entete.id = 'entete-importations'; }
        fichiers.forEach(nom => liste.appendChild(creerFichierDraggable(nom)));
        entete.addEventListener('click', (e) => {
            e.stopPropagation();
            const ouvert = liste.style.display !== 'none';
            liste.style.display = ouvert ? 'none' : 'block';
            const fleche = entete.querySelector('.dossier-fleche');
            fleche.style.transform = ouvert ? 'rotate(0deg)' : 'rotate(90deg)';
        });
        bloc.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; entete.style.backgroundColor = 'rgba(0,31,63,0.15)'; });
        bloc.addEventListener('dragleave', () => { entete.style.backgroundColor = ''; });
        bloc.addEventListener('drop', (e) => {
            e.preventDefault(); entete.style.backgroundColor = '';
            if (fichierEnCoursDeDeplacement && fichierEnCoursDeDeplacement.parentNode !== liste) {
                liste.appendChild(fichierEnCoursDeDeplacement);
                if (liste.style.display === 'none') entete.click();
            }
        });
        bloc.appendChild(entete); bloc.appendChild(liste);
        conteneurDossiers.appendChild(bloc);
    });

    // ── BOUTON IMPORTER — ouvre le sélecteur de fichier ────────────────────
    const btnFichier = document.getElementById('conteneur-fichier');
    if (btnFichier) {
        btnFichier.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) { fileInput.value = ''; return; }

        // Ajouter à la liste d'importations (panneau latéral)
        const listeImportations = document.getElementById('liste-importations');
        const enteteImportations = document.getElementById('entete-importations');
        if (listeImportations) {
            files.forEach(file => listeImportations.appendChild(creerFichierDraggable(file.name, file)));
            if (listeImportations.style.display === 'none' && enteteImportations) enteteImportations.click();
        }

        // Déclencher le mode placement interactif pour les images
        const images = files.filter(f => f.type && f.type.startsWith('image/'));
        if (images.length > 0 && window.entrerModePlacementImages) {
            window.entrerModePlacementImages(images);
        }

        fileInput.value = '';
    });
    if (dropbox) {
        dropbox.addEventListener('dragover',  (e) => { e.preventDefault(); dropbox.style.opacity = '0.7'; });
        dropbox.addEventListener('dragleave', ()  => { dropbox.style.opacity = '1'; });
        dropbox.addEventListener('drop',      (e) => { e.preventDefault(); dropbox.style.opacity = '1'; });
    }

    // ── PRÉCHARGEMENT DES FICHIERS DE TEST ──────────────────────────────────
    // Charge les 3 fichiers du dossier "types de docs pour test canva"
    // JPG et GIF : URL directe via _gifSrc (compatible file://, pas de canvas)
    // PDF : XHR arraybuffer pour éviter le fetch interne de PDF.js (bloqué en file://)
    (async () => {
        const listeImp  = document.getElementById('liste-importations');
        const enteteImp = document.getElementById('entete-importations');
        if (!listeImp) return;

        const dossier = './types de docs pour test canva/';

        // ── 1. Image JPG — URL directe (même pattern que GIF, compatible file://) ──
        const nomJpg = '929913aad0bed6a95774452a2bc6f597.jpg';
        const jpgFakeFile = { type: 'image/jpeg', name: nomJpg, _gifSrc: dossier + nomJpg };
        listeImp.appendChild(creerFichierDraggable(nomJpg, jpgFakeFile));

        // ── 2. GIF animé — URL directe pour préserver l'animation ────────────
        const nomGif = 'giphy.gif';
        const gifFakeFile = { type: 'image/gif', name: nomGif, _gifSrc: dossier + nomGif };
        listeImp.appendChild(creerFichierDraggable(nomGif, gifFakeFile));

        // ── 3. PDF — pré-chargement XHR (compatible file://) avec fallback icône ──
        // Chrome bloque XHR file://→file:// : si ça échoue, générer une icône-image
        // draggable, et l'utilisateur peut glisser le vrai PDF depuis le Finder.
        const nomPdf = 'Rapport de stage_Kais.pdf';
        const pdfUrl  = dossier + nomPdf;
        const pdfData = await new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', pdfUrl, true);
            xhr.responseType = 'arraybuffer';
            xhr.onload  = () => xhr.status === 0 || xhr.status === 200
                ? resolve(new Uint8Array(xhr.response))
                : resolve(null);
            xhr.onerror = () => resolve(null);
            xhr.send();
        });
        if (pdfData) {
            // XHR réussi (Firefox / Safari) — utiliser les données binaires directement
            const pdfFakeFile = { type: 'application/pdf', name: nomPdf, _pdfData: pdfData };
            listeImp.appendChild(creerFichierDraggable(nomPdf, pdfFakeFile));
        } else {
            // Chrome file:// — générer une icône-image représentant le PDF
            const c = document.createElement('canvas');
            c.width = 280; c.height = 380;
            const ctx = c.getContext('2d');
            // Fond page
            ctx.fillStyle = '#fffdf8';
            ctx.beginPath(); ctx.roundRect(8, 8, 264, 364, 10); ctx.fill();
            ctx.strokeStyle = '#e0ddd6'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.roundRect(8, 8, 264, 364, 10); ctx.stroke();
            // Coin plié
            ctx.fillStyle = '#f0ece4';
            ctx.beginPath(); ctx.moveTo(220,8); ctx.lineTo(272,60); ctx.lineTo(220,60); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#e0ddd6'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(220,8); ctx.lineTo(272,60); ctx.lineTo(220,60); ctx.closePath(); ctx.stroke();
            // Texte PDF
            ctx.fillStyle = '#ff4000';
            ctx.font = 'bold 72px DM Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('PDF', 140, 210);
            // Nom du fichier
            ctx.fillStyle = '#555';
            ctx.font = '15px DM Sans, sans-serif';
            const label = nomPdf.length > 26 ? nomPdf.slice(0, 24) + '…' : nomPdf;
            ctx.fillText(label, 140, 265);
            // Note Finder
            ctx.fillStyle = '#aaa';
            ctx.font = '13px DM Sans, sans-serif';
            ctx.fillText('Glissez le PDF depuis', 140, 310);
            ctx.fillText('le Finder pour le placer', 140, 330);
            const imgSrc = c.toDataURL('image/png');
            // Item draggable comme une image (png) — pas de toast d'erreur
            const fallback = { type: 'image/png', name: nomPdf.replace('.pdf', '_apercu.png'), _gifSrc: imgSrc };
            const item = creerFichierDraggable(nomPdf, fallback);
            item.title = 'Glissez le PDF directement depuis le Finder pour placer les vraies pages';
            listeImp.appendChild(item);
        }

        if (listeImp.style.display === 'none') enteteImp.click();
    })();

    // ── UTILITAIRES CHRONO ────────────────────────────────────────────────────
    const pad = (n) => String(n).padStart(2, '0');

    function btnsSVG() {
        return {
            play:  `<button class="chrono-btn chrono-play"><svg viewBox="0 0 24 24"><path class="icon-play"  fill="var(--bleu-marine)" d="M6 4l14 8-14 8V4z"/><path class="icon-pause" fill="var(--bleu-marine)" d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" style="display:none"/></svg></button>`,
            tour:  `<button class="chrono-btn chrono-tour"><svg viewBox="0 0 24 24"><path fill="var(--bleu-marine)" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg></button>`,
            reset: `<button class="chrono-btn chrono-reset"><svg viewBox="0 0 24 24"><path fill="var(--bleu-marine)" d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg></button>`
        };
    }

    function ajouterTourLigne(divT, label, compteur) {
        const ligne = document.createElement('div');
        ligne.className = 'chrono-tour-ligne';
        ligne.innerHTML = `<div class="tour-info"><span class="tour-num">T${compteur}</span><span class="tour-temps">${label}</span></div><span class="tour-delete">×</span>`;
        ligne.querySelector('.tour-delete').addEventListener('click', (e) => { e.stopPropagation(); ligne.remove(); });
        divT.appendChild(ligne);
        divT.scrollTop = divT.scrollHeight;
    }

    function editionManuelle(spans, readMs) {
        spans.forEach(span => {
            span.addEventListener('click', (e) => { e.stopPropagation(); span.contentEditable = 'true'; span.focus(); const r = document.createRange(); r.selectNodeContents(span); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); });
            span.addEventListener('blur', () => { span.contentEditable = 'false'; let val = parseInt(span.textContent.replace(/\D/g, '')) || 0; if (span !== spans[0]) val = Math.min(val, 59); span.textContent = pad(val); if (readMs) readMs(); });
            span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } });
        });
    }

    function creerChrono(cont) {
        if (cont.querySelector('.bloc-chrono')) { cont.querySelector('.bloc-chrono').remove(); return false; }
        let ms = 0, ticking = false, intervalId = null, compteurTours = 0, isCountdown = false;
        const b = btnsSVG();
        const bloc = document.createElement('div');
        bloc.className = 'bloc-chrono';
        bloc.innerHTML = `<div class="chrono-tours"></div><div class="chrono-top-row"><div class="chrono-affichage"><span class="chrono-h">00</span><span class="chrono-sep">:</span><span class="chrono-m">00</span><span class="chrono-sep">:</span><span class="chrono-s">00</span><span class="chrono-ms">00</span></div><div class="chrono-controls">${b.play}${b.tour}${b.reset}</div></div>`;
        bloc.addEventListener('click', (e) => e.stopPropagation());
        cont.appendChild(bloc);

        const sH = bloc.querySelector('.chrono-h'), sM = bloc.querySelector('.chrono-m'), sS = bloc.querySelector('.chrono-s'), sMs = bloc.querySelector('.chrono-ms');
        const btnP = bloc.querySelector('.chrono-play'), btnT = bloc.querySelector('.chrono-tour'), btnR = bloc.querySelector('.chrono-reset'), divT = bloc.querySelector('.chrono-tours');
        const iPlay = bloc.querySelector('.icon-play'), iPause = bloc.querySelector('.icon-pause');

        function obtenirMsSaisies() { const h = parseInt(sH.textContent)||0, m = parseInt(sM.textContent)||0, s = parseInt(sS.textContent)||0; return ((h*3600)+(m*60)+s)*1000; }
        function afficher() {
            if (isCountdown && ms < 0) ms = 0;
            const ts = Math.floor(Math.abs(ms)/1000), tm = Math.floor(ts/60);
            sH.textContent = pad(Math.floor(tm/60)); sM.textContent = pad(tm%60); sS.textContent = pad(ts%60); sMs.textContent = pad(Math.floor((Math.abs(ms)%1000)/10));
            if (isCountdown && ms <= 0 && ticking) terminerMinuteur();
        }
        function terminerMinuteur() { clearInterval(intervalId); ticking = false; iPlay.style.display = ''; iPause.style.display = 'none'; bloc.classList.add('minuteur-fini'); setTimeout(() => bloc.classList.remove('minuteur-fini'), 2000); }

        btnP.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!ticking) {
                const msSaisies = obtenirMsSaisies();
                if (ms === 0 && msSaisies > 0) { ms = msSaisies; isCountdown = true; }
                else if (ms === 0) { isCountdown = false; }
                ticking = true;
                const step = isCountdown ? -10 : 10;
                intervalId = setInterval(() => { ms += step; afficher(); }, 10);
                iPlay.style.display = 'none'; iPause.style.display = '';
            } else {
                clearInterval(intervalId); ticking = false; iPlay.style.display = ''; iPause.style.display = 'none';
            }
        });
        btnT.addEventListener('click', (e) => {
            e.stopPropagation();
            const ts = Math.floor(Math.abs(ms)/1000), tm = Math.floor(ts/60);
            const label = `${pad(Math.floor(tm/60))}:${pad(tm%60)}:${pad(ts%60)}.${pad(Math.floor((Math.abs(ms)%1000)/10))}`;
            compteurTours++; ajouterTourLigne(divT, label, compteurTours);
            bloc.classList.toggle('deplie', true);
        });
        btnR.addEventListener('click', (e) => { e.stopPropagation(); clearInterval(intervalId); ms = 0; ticking = false; isCountdown = false; afficher(); iPlay.style.display = ''; iPause.style.display = 'none'; divT.innerHTML = ''; bloc.classList.remove('deplie'); });
        editionManuelle([sH, sM, sS]);
        return true;
    }

    function creerHorloge(cont) {
        if (cont.querySelector('.bloc-horloge')) { const h = cont.querySelector('.bloc-horloge'); if (h._stopHorloge) h._stopHorloge(); h.remove(); return false; }
        const bloc = document.createElement('div');
        bloc.className = 'bloc-horloge';
        bloc.addEventListener('click', (e) => e.stopPropagation());
        cont.appendChild(bloc);
        let intervalId = null;
        function afficher() { const now = new Date(); bloc.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`; }
        afficher(); intervalId = setInterval(afficher, 1000);
        bloc._stopHorloge = () => clearInterval(intervalId);
        return true;
    }

    // =========================================================================
    // ── ROUE DE SÉLECTION ────────────────────────────────────────────────────
    // =========================================================================
    const roueConteneur = document.getElementById('roue-conteneur');
    const roueSvg       = document.getElementById('roue-svg');
    const roueIcones    = document.getElementById('roue-icones');
    const roueCentre    = document.getElementById('roue-centre');
    const centreLabel   = document.getElementById('roue-centre-label');
    const panel         = document.getElementById('roue-panel');
    const panelInner    = document.getElementById('roue-panel-inner');

    // Données des 6 outils
    const OUTILS = [
        {
            num: 1, label: 'Chrono',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 174.26 185.72"><path class="cls-1" d="M60.59,29.69v-8.52c0-6.17,5-11.17,11.17-11.17h18.33c6.17,0,11.17,5,11.17,11.17v8.52"/><path class="cls-1" d="M127.2,42.57l2.18-1.71,4.98-3.92c5.18-4.08,12.48-3.45,16.29,1.4l11.33,14.41c3.81,4.85,2.7,12.09-2.48,16.16l-4.98,3.92-2.18,1.71"/><circle class="cls-1" cx="80.93" cy="104.8" r="70.93"/><path class="cls-2" d="M137.63,106.11c0-.14.01-.28.01-.42,0-31.68-25.68-57.37-57.37-57.37-.17,0-.33.01-.49.01v57.77h57.85Z"/></svg>`
        },
        {
            num: 4, label: 'Tableau',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect class="cls-1" x="10" y="10" width="160" height="160"/><line class="cls-1" x1="10" y1="55" x2="170" y2="55"/><line class="cls-1" x1="63.3" y1="55" x2="63.3" y2="170"/><line class="cls-1" x1="116.7" y1="55" x2="116.7" y2="170"/></svg>`
        },
        {
            num: 5, label: 'Formes',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200.18 168.49"><circle class="cls-1" cx="60.26" cy="71.36" r="50.26"/><rect class="cls-1" x="83.99" y="20.96" width="95.24" height="95.24" transform="translate(-11.6 29.64) rotate(-12.31)"/><polygon class="cls-1" points="147.85 158.49 100.24 64.74 52.62 158.49 147.85 158.49"/></svg>`
        },
        {
            num: 6, label: 'Dessin',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 171.68 171.68"><rect class="cls-1" x="18.25" y="73.17" width="132.58" height="27.96" transform="translate(-36.86 85.3) rotate(-45)"/><path class="cls-2" d="M136.5,8.61h26c.15,0,.27.12.27.27v27.4c0,.16-.13.29-.29.29h-25.98c-.16,0-.29-.13-.29-.29V8.9c0-.16.13-.29.29-.29Z" transform="translate(27.69 112.04) rotate(-45)"/><polygon class="cls-3" points="27.72 124.07 47.61 143.97 9 162.68 27.72 124.07"/></svg>`
        },
        {
            num: 7, label: 'Texte',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140.77 173.51"><line class="cls-1" x1="0" y1="10" x2="46.42" y2="10"/><line class="cls-1" x1="23.21" y1="10" x2="23.21" y2="163.51"/><line class="cls-1" x1="0" y1="163.51" x2="46.42" y2="163.51"/><path class="cls-3" d="M121,45.77h19.77v93.08h-19.77v-13.3c-6.35,10.3-16.83,15.45-31.45,15.45-13.3,0-23.81-4.64-31.54-13.93-7.73-9.28-11.59-20.87-11.59-34.77s3.86-25.49,11.59-34.77c7.73-9.28,18.24-13.93,31.54-13.93,14.61,0,25.1,5.15,31.45,15.45v-13.3ZM75,71.01c-4.79,5.69-7.19,12.79-7.19,21.29s2.39,15.61,7.19,21.29c4.79,5.69,11.14,8.54,19.05,8.54s14.4-2.81,19.14-8.45c4.73-5.63,7.1-12.76,7.1-21.38s-2.37-15.75-7.1-21.38c-4.73-5.63-11.11-8.45-19.14-8.45s-14.26,2.85-19.05,8.54Z"/></svg>`
        },
        {
            num: 8, label: 'Collaboration',
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200.21 133.59"><path class="cls-2" d="M144.6,127.59c0-56.99-19.92-103.19-44.5-103.19s-44.5,46.2-44.5,103.19h88.99Z"/><path class="cls-2" d="M3,130.59v-3c0-26.19,21.31-47.5,47.5-47.5s47.5,21.31,47.5,47.5v3H3Z"/><path class="cls-1" d="M50.5,83.09c24.57,0,44.5,19.92,44.5,44.5H6c0-24.57,19.92-44.5,44.5-44.5M50.5,77.09C22.65,77.09,0,99.74,0,127.59v6h100.99v-6c0-27.84-22.65-50.5-50.5-50.5h0Z"/><path class="cls-2" d="M100.1,71.69c-18.94,0-34.35-15.41-34.35-34.35S81.17,3,100.1,3s34.35,15.41,34.35,34.35-15.41,34.35-34.35,34.35Z"/><path class="cls-1" d="M100.1,6c17.31,0,31.35,14.03,31.35,31.35s-14.03,31.35-31.35,31.35-31.35-14.03-31.35-31.35,14.03-31.35,31.35-31.35M100.1,0c-20.59,0-37.35,16.75-37.35,37.35s16.75,37.35,37.35,37.35,37.35-16.75,37.35-37.35S120.7,0,100.1,0h0Z"/><path class="cls-2" d="M50.5,96.46c-18.94,0-34.35-15.41-34.35-34.35S31.56,27.77,50.5,27.77s34.35,15.41,34.35,34.35-15.41,34.35-34.35,34.35Z"/><path class="cls-1" d="M50.5,30.77c17.31,0,31.35,14.03,31.35,31.35s-14.03,31.35-31.35,31.35-31.35-14.03-31.35-31.35,14.03-31.35,31.35-31.35M50.5,24.77c-20.59,0-37.35,16.75-37.35,37.35s16.75,37.35,37.35,37.35,37.35-16.75,37.35-37.35-16.75-37.35-37.35-37.35h0Z"/><path class="cls-2" d="M102.22,130.59v-3c0-26.19,21.31-47.5,47.5-47.5s47.5,21.31,47.5,47.5v3h-94.99Z"/><path class="cls-1" d="M149.71,83.09c24.57,0,44.5,19.92,44.5,44.5h-88.99c0-24.57,19.92-44.5,44.5-44.5M149.71,77.09c-27.84,0-50.5,22.65-50.5,50.5v6h100.99v-6c0-27.84-22.65-50.5-50.5-50.5h0Z"/><path class="cls-2" d="M149.71,96.46c-18.94,0-34.35-15.41-34.35-34.35s15.41-34.35,34.35-34.35,34.35,15.41,34.35,34.35-15.41,34.35-34.35,34.35Z"/><path class="cls-1" d="M149.71,30.77c17.31,0,31.35,14.03,31.35,31.35s-14.03,31.35-31.35,31.35-31.35-14.03-31.35-31.35,14.03-31.35,31.35-31.35M149.71,24.77c-20.59,0-37.35,16.75-37.35,37.35s16.75,37.35,37.35,37.35,37.35-16.75,37.35-37.35-16.75-37.35-37.35-37.35h0Z"/></svg>`
        },
    ];

    // Sous-options
    const SOUS_OPTIONS = {
        1: ["Chrono/Minuteur", "Horloge", "Exporter", "Archive"],
        7: ["Texte", "Police", "Paragraphe"],
        8: ["Question", "Sondage", "Collaborer"]
    };

    const N = OUTILS.length; // 6
    const angleStep = (2 * Math.PI) / N;
    const outerR = 1;
    const innerR = 0.28;

    // ── ROTATION DE LA ROUE ──────────────────────────────────────────────────
    // rotationOffset = angle en radians dont on a tourné le SVG
    // L'outil "actif" est celui dont le segment pointe vers le HAUT (angle = -π/2)
    let rotationOffset = 0;
    let rotationAnimation = null;

    /**
     * Retourne l'index de l'outil actuellement en haut
     * (le segment dont le milieu est le plus proche de -π/2)
     */
    function indexEnHaut() {
        // angle du milieu du segment i sans offset = i * angleStep - π/2
        // avec offset = i * angleStep - π/2 + rotationOffset
        // on cherche celui le plus proche de -π/2 (mod 2π)
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < N; i++) {
            const midAngle = i * angleStep - Math.PI / 2 + rotationOffset;
            // distance angulaire à -π/2
            let d = midAngle - (-Math.PI / 2);
            // normaliser dans [-π, π]
            d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
            if (Math.abs(d) < bestDist) { bestDist = Math.abs(d); best = i; }
        }
        return best;
    }

    /**
     * Calcule l'angle de rotation à appliquer pour amener l'outil à l'index
     * `targetIndex` en position "haut" (-π/2), en prenant le chemin le plus court.
     */
    function angleVersTete(targetIndex) {
        const targetOffset = -targetIndex * angleStep;
        let delta = targetOffset - rotationOffset;
        // Chemin le plus court, normalisé dans [-π, π]
        delta = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        return rotationOffset + delta;
    }

    /** Met à jour l'offset de rotation : fait tourner le SVG et repositionne les icônes */
    function appliquerRotation(angle) {
        rotationOffset = angle;
        const deg = angle * (180 / Math.PI);
        roueSvg.style.transform = `rotate(${deg}deg)`;
        iconesEls.forEach((iconDiv, i) => {
            const mid = segmentMid(i);
            iconDiv.style.left = ((mid.x + 1) / 2 * 100) + '%';
            iconDiv.style.top  = ((mid.y + 1) / 2 * 100) + '%';
        });
    }

    /** Anime la rotation vers un offset cible */
    function animerVers(targetOffset, onDone) {
        if (rotationAnimation) cancelAnimationFrame(rotationAnimation);
        const startOffset = rotationOffset;
        const delta = targetOffset - startOffset;
        const duration = Math.min(600, Math.max(200, Math.abs(delta) * 300));
        const startTime = performance.now();

        function step(now) {
            const t = Math.min(1, (now - startTime) / duration);
            // Easing cubic out
            const ease = 1 - Math.pow(1 - t, 3);
            appliquerRotation(startOffset + delta * ease);
            if (t < 1) {
                rotationAnimation = requestAnimationFrame(step);
            } else {
                rotationAnimation = null;
                if (onDone) onDone();
            }
        }
        rotationAnimation = requestAnimationFrame(step);
    }

    /** Tourne d'un cran (direction : +1 ou -1) */
    function tournerDUnCran(direction) {
        const targetOffset = rotationOffset + direction * angleStep;
        animerVers(targetOffset, () => {
            // Après rotation, mettre à jour l'outil actif
            const idx = indexEnHaut();
            selectionnerOutil(OUTILS[idx].num, idx, false);
        });
    }

    /** Tourne pour amener l'outil `targetIndex` en haut */
    function tournerVersIndex(targetIndex) {
        const target = angleVersTete(targetIndex);
        animerVers(target, () => {
            selectionnerOutil(OUTILS[targetIndex].num, targetIndex, false);
        });
    }

    // Génère un chemin SVG en coordonnées [-1,1]
    function segmentPath(index) {
        const startAngle = index * angleStep - Math.PI / 2 - angleStep / 2;
        const endAngle   = startAngle + angleStep;
        const x1 = Math.cos(startAngle) * outerR, y1 = Math.sin(startAngle) * outerR;
        const x2 = Math.cos(endAngle)   * outerR, y2 = Math.sin(endAngle)   * outerR;
        const x3 = Math.cos(endAngle)   * innerR, y3 = Math.sin(endAngle)   * innerR;
        const x4 = Math.cos(startAngle) * innerR, y4 = Math.sin(startAngle) * innerR;
        return `M ${x1} ${y1} A ${outerR} ${outerR} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 0 0 ${x4} ${y4} Z`;
    }

    // Midpoint d'un segment pour placer l'icône (tient compte de l'offset de rotation)
    function segmentMid(index) {
        const midAngle = index * angleStep - Math.PI / 2 + rotationOffset;
        const r = (outerR + innerR) / 2;
        return { x: Math.cos(midAngle) * r, y: Math.sin(midAngle) * r };
    }

    let outilActifNum  = null;
    let panelCleanup   = null;
    const segmentsEls  = [];
    const iconesEls    = [];

    // ── CONSTRUIRE LA ROUE ────────────────────────────────────────────────────
    OUTILS.forEach((outil, i) => {
        // Segment SVG (visible quand ouvert)
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', segmentPath(i));
        path.classList.add('roue-segment');
        path.dataset.num = outil.num;
        roueSvg.appendChild(path);
        segmentsEls.push(path);

        // Icône HTML — positionnée au milieu du segment
        const iconDiv = document.createElement('div');
        iconDiv.className = `roue-icone-item outil-${outil.num}`;
        const mid0 = segmentMid(i);
        iconDiv.style.left = ((mid0.x + 1) / 2 * 100) + '%';
        iconDiv.style.top  = ((mid0.y + 1) / 2 * 100) + '%';
        iconDiv.innerHTML  = outil.svg;
        roueIcones.appendChild(iconDiv);
        iconesEls.push(iconDiv);

        // Survol du segment SVG → label + highlight icône
        path.addEventListener('mouseenter', () => {
            centreLabel.textContent = outil.label;
            iconDiv.classList.add('survol-actif');
            path.classList.add('survol');
        });
        path.addEventListener('mouseleave', () => {
            centreLabel.textContent = ''; // icône réapparaît dès que le survol cesse
            iconDiv.classList.remove('survol-actif');
            path.classList.remove('survol');
        });

        // Clic sur segment → tourner vers cet outil
        path.addEventListener('click', (e) => {
            e.stopPropagation();
            tournerVersIndex(i);
        });
        path.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tournerVersIndex(i);
        });
    });

    // Initialiser l'étiquette du centre
    centreLabel.textContent = '';

    // ── OUVERTURE / FERMETURE DE LA ROUE ─────────────────────────────────────
    let _fanTimeout = null;
    let fanPinned   = false;
    const _fanOpen  = () => { clearTimeout(_fanTimeout); roueConteneur.classList.add('ouvert'); };
    const _fanClose = () => {
        if (fanPinned) return; // ne pas fermer si épinglé
        _fanTimeout = setTimeout(() => {
            roueConteneur.classList.remove('ouvert');
            animerVers(angleVersTete(0), () => {}); // retour à la position initiale
        }, 150);
    };

    // ── Helpers exposés à initMobileTouch ────────────────────────────────────
    window._roueEpingle = (on) => {
        fanPinned = on;
        roueConteneur.classList.toggle('epingle', on);
        if (on) { clearTimeout(_fanTimeout); roueConteneur.classList.add('ouvert'); }
    };
    window._roueFermerPanel = () => fermerPanel();

    // Ouvrir quand la souris entre sur le centre (toujours visible) ou sur le disque (quand ouvert)
    roueCentre.addEventListener('mouseenter', _fanOpen);
    roueConteneur.addEventListener('mouseenter', _fanOpen);
    // Fermer quand la souris quitte le disque entier
    roueConteneur.addEventListener('mouseleave', _fanClose);

    // ── MOLETTE SUR LE CENTRE ─────────────────────────────────────────────────
    roueCentre.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.deltaY > 0 ? 1 : -1;
        tournerDUnCran(direction);
    }, { passive: false });

    // ── SÉLECTION D'OUTIL ─────────────────────────────────────────────────────
    function selectionnerOutil(num, index, avecRotation = true) {
        if (avecRotation) {
            tournerVersIndex(index);
            return; // la sélection s'effectuera dans le callback de l'animation
        }

        if (outilActifNum === num) {
            // Désélectionner
            outilActifNum = null;
            window.activeToolMode = null;
            if (window.setCanvasCursor) window.setCanvasCursor('default');
            segmentsEls.forEach(s => s.classList.remove('actif'));
            iconesEls.forEach(ic => ic.classList.remove('actif'));
            centreLabel.textContent = '';
            fermerPanel();
            return;
        }

        outilActifNum = num;
        segmentsEls.forEach((s, i2) => { s.classList.toggle('actif', i2 === index); s.classList.remove('survol'); });
        iconesEls.forEach((ic, i2) => ic.classList.toggle('actif', i2 === index));
        centreLabel.textContent = ''; // icône toujours visible hors survol
        ouvrirPanel(num);
    }

    // Accessible depuis les autres modules (ex : fin de saisie texte → retour sélection)
    window.desactiverOutil = () => {
        outilActifNum = null;
        window.activeToolMode = null;
        if (window.setCanvasCursor) window.setCanvasCursor('default');
        segmentsEls.forEach(s => s.classList.remove('actif'));
        iconesEls.forEach(ic => ic.classList.remove('actif'));
        centreLabel.textContent = '';
        fermerPanel();
    };

    // ── PANEL INLINE ─────────────────────────────────────────────────────────
    function ouvrirPanel(num) {
        fermerPanel();
        // Réinitialiser le mode actif avant d'appliquer celui de l'outil sélectionné
        window.activeToolMode = null;
        if (window.setCanvasCursor) window.setCanvasCursor('default');

        if (num === 6) {
            window.activeToolMode = 'draw';
            if (window.masquerSelection) window.masquerSelection();
            if (window.setCanvasCursor) window.setCanvasCursor('crosshair');
            construirePanelDessin();          // ouvre le panel latéral (colorpicker)
            roueConteneur.classList.add('mode-dessin'); // bascule la roue en mode dial
            construireDialDessin();           // construit le dial opacité/graisse
            return;
        }
        if (num === 5) {
            window.activeToolMode = 'shape';
            if (window.setCanvasCursor) window.setCanvasCursor('crosshair');
            construirePanelFormes();               // panel latéral : couleur + options
            roueConteneur.classList.add('mode-formes');
            construireDialFormes();                // dial roue : formes + sliders
            return;
        }
        if (num === 1) {
            roueConteneur.classList.add('mode-chrono');
            construireDialChrono();
            return;
        }
        if (num === 4) {
            window.activeToolMode = 'table';
            if (window.setCanvasCursor) window.setCanvasCursor('crosshair');
            construirePanelTableau();
            roueConteneur.classList.add('mode-tableau');
            construireDialTableau();
            return;
        }
        if (num === 7) {
            window.activeToolMode = 'text';
            if (window.setCanvasCursor) window.setCanvasCursor('text');
            roueConteneur.classList.add('mode-texte');
            construireDialTexte();
            return;
        }
        if (num === 8) {
            roueConteneur.classList.add('mode-collaboration');
            construireDialCollaboration();
            return;
        }

        const options = SOUS_OPTIONS[num];
        if (!options) return;

        // 1. On vide le contenu
        panelInner.innerHTML = '';

        // 2. On crée le titre (qui sera caché par défaut grâce au CSS)
        const titre = document.createElement('div');
        titre.className = 'roue-panel-titre';
        titre.textContent = 'Option — ' + (OUTILS.find(o => o.num === num)?.label || '');
        panelInner.appendChild(titre);

        options.forEach(nom => {
    const item = document.createElement('div');
    item.className = 'roue-panel-item';
    item.textContent = nom;

    // Restaurer l'état actif depuis le Set
    if (panelItemsActifs.has(nom)) item.classList.add('active');

    item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panelItemsActifs.has(nom)) {
            panelItemsActifs.delete(nom);
        } else {
            panelItemsActifs.add(nom);
        }
        item.classList.toggle('active', panelItemsActifs.has(nom));

        if (nom === 'Chrono/Minuteur') {
            creerChrono(document.getElementById('barre-outils-droite'));
        } else if (nom === 'Horloge') {
            const barreD = document.getElementById('barre-outils-droite');
            const h = barreD.querySelector('.bloc-horloge');
            if (h && h._stopHorloge) h._stopHorloge();
            creerHorloge(barreD);
        } else if (nom === 'Exporter') {
            exporterSessionPNG();
            panelItemsActifs.delete(nom);
            item.classList.remove('active');
        } else if (nom === 'Archive') {
            ouvrirArchives();
            panelItemsActifs.delete(nom);
            item.classList.remove('active');
        }
    });

    panelInner.appendChild(item);
});

        requestAnimationFrame(() => panel.classList.add('visible'));
    }

    function fermerPanel() {
        panel.classList.remove('visible');
        if (panelCleanup) { panelCleanup(); panelCleanup = null; }
    }

    // ── PANEL DESSIN ──────────────────────────────────────────────────────────
    function construirePanelDessin() {
    panelInner.innerHTML = '';

    const blocColor = document.createElement('div');
    blocColor.style.cssText = 'flex:0 0 55px;border-radius:10px;position:relative;overflow:hidden;cursor:crosshair;margin:6px 8px 0 8px;border:3px solid var(--flamme);box-shadow:none;';
    blocColor.style.background = `linear-gradient(to right, hsl(0,100%,50%) 0%, hsl(60,100%,50%) 13.3%, hsl(120,100%,50%) 26.6%, hsl(180,100%,50%) 40%, hsl(240,100%,50%) 53.3%, hsl(300,100%,50%) 66.6%, hsl(360,100%,50%) 80%, #000000 100%)`;

    const sel = document.createElement('div');
    sel.style.cssText = 'position:absolute;width:26px;height:26px;border:3px solid white;border-radius:50%;box-shadow:none;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;';
    sel.style.backgroundColor = paintState.color;
    blocColor.appendChild(sel);

    let dragging = false;
    const moveSel = (e) => {
        const r = blocColor.getBoundingClientRect();
        let x = Math.max(0, Math.min(e.clientX - r.left, r.width));
        gsap.to(sel, { left: x, top: '50%', duration: 0.1 });
        const ratio = x / r.width;
        let hue, lightness;
        if (ratio <= 0.8) { hue = (ratio / 0.8) * 360; lightness = 50; }
        else { hue = 360; lightness = 50 - ((ratio - 0.8) / 0.2) * 50; }
        const color = `hsl(${hue}, 100%, ${lightness}%)`;
        sel.style.backgroundColor = color; paintState.color = color;
    };
    blocColor.addEventListener('mousedown', (e) => { e.stopPropagation(); dragging = true; moveSel(e); });
    const onMove = (e) => { if (dragging) moveSel(e); };
    const onUp = () => { dragging = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    const blocEp = document.createElement('div');
    blocEp.style.cssText = 'flex:0 0 auto;overflow:visible;background-color:var(--bg);border-radius:10px;margin:0 8px;box-shadow:var(--neu-inset);box-sizing:border-box;height:55px;';
    const blocOp = document.createElement('div');
    blocOp.style.cssText = 'flex:0 0 auto;overflow:visible;background-color:var(--bg);border-radius:10px;margin:0 8px 6px 8px;box-shadow:var(--neu-inset);box-sizing:border-box;height:55px;';

    panelInner.appendChild(blocColor);
    panelInner.appendChild(blocEp);
    panelInner.appendChild(blocOp);

    requestAnimationFrame(() => {
        creerGooeySlider(blocEp, 'draw_ep', paintState.thicknessPercent, (v) => { paintState.thicknessPercent = v; });
        creerGooeySlider(blocOp, 'draw_op', Math.round(paintState.opacity * 100), (v) => { paintState.opacity = v / 100; });
    });

    panelCleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
    };

    requestAnimationFrame(() => panel.classList.add('visible'));
}

    // ── Snap avec zone morte + hystérésis ───────────────────────────────────────────────
    // Retourne une fonction d'état indépendante par slider.
    // Comportement : accroche au trait (CATCH) et ne lâche qu'au-delà (DEAD).
    // → Le pouce colle vraiment à chaque graduation ; il faut "forcer" pour passer.
    // steps = nombre d'intervalles (10 → 11 crans tous les 10 %, 8 → 9 crans tous les 100 de graisse)
    function makeSnapFn(steps = 10) {
        let lock = -1;
        return function(raw) {
            const idx  = Math.round(raw * steps);
            const snap = idx / steps;
            const dist = Math.abs(raw - snap);
            const CATCH = 0.026 * (10 / steps);
            const DEAD  = 0.042 * (10 / steps);
            if (lock === idx) {
                if (dist > DEAD) { lock = -1; return raw; }
                return snap;
            }
            if (dist < CATCH) { lock = idx; return snap; }
            lock = -1;
            return raw;
        };
    }

    // ── DIAL DESSIN — slider ARC haut (graisse) + slider ARC bas (opacité) + chromo 2D ─
    function construireDialDessin() {
        const dialSvg = document.getElementById('roue-dial-svg');
        if (!dialSvg) return;
        dialSvg.innerHTML = '';

        const Ro = 0.90, Ri = 0.38, Rm = (Ro + Ri) / 2;  // Rm ≈ 0.64
        const ns    = 'http://www.w3.org/2000/svg';
        const COLOR = 'var(--flamme)'; // orange — même couleur pour les deux sliders

        const mk = (tag, attrs) => {
            const el = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
            return el;
        };
        const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

        // Demi-donut (haut sw=0 CCW, bas sw=1 CW)
        const halfPath = sw =>
            `M ${-Ro} 0 A ${Ro} ${Ro} 0 1 ${sw} ${Ro} 0 L ${Ri} 0 A ${Ri} ${Ri} 0 1 ${sw} ${-Ri} 0 Z`;

        // Arc haut : t=0 → gauche (−π), t=1 → droite (0), via 12h
        const aT = t => -Math.PI + t * Math.PI;
        // Arc bas  : t=0 → gauche (+π), t=1 → droite (0), via 6h
        const aB = t =>  Math.PI - t * Math.PI;

        // ── Fonds demi-donut ─────────────────────────────────────────────────
        const bkA = { fill: 'var(--bg)', stroke: 'var(--shadow-dark)', 'stroke-width': '0.010', 'fill-rule': 'evenodd' };
        dialSvg.appendChild(mk('path', { d: halfPath(0), ...bkA }));
        dialSvg.appendChild(mk('path', { d: halfPath(1), ...bkA }));

        // ── Séparateurs gauche/droite ────────────────────────────────────────
        const divA = { stroke: 'var(--shadow-dark)', 'stroke-width': '0.018', 'stroke-linecap': 'round' };
        dialSvg.appendChild(mk('line', { x1: -Ro, y1: 0, x2: -Ri, y2: 0, ...divA }));
        dialSvg.appendChild(mk('line', { x1:  Ri, y1: 0, x2:  Ro, y2: 0, ...divA }));

        // ── Fabrique un slider sur arc (stroke-dasharray) ───────────────────
        // Le pouce n'est PAS appendé ici : il sera ajouté après les ticks
        // pour apparaître au-dessus d'eux dans l'ordre SVG.
        function makeArcSlider(sw, aFunc, initT) {
            const [lx, ly] = P(aFunc(0), Rm);
            const [rx, ry] = P(aFunc(1), Rm);
            const TRK = '0.028';
            const fullArc = `M ${lx} ${ly} A ${Rm} ${Rm} 0 1 ${sw} ${rx} ${ry}`;

            // Piste de fond
            dialSvg.appendChild(mk('path', {
                d: fullArc, fill: 'none',
                stroke: 'var(--shadow-dark)', 'stroke-width': TRK,
                'stroke-linecap': 'round', 'stroke-opacity': '0.38',
                'pointer-events': 'none'
            }));

            // Arc de progression
            const progEl = mk('path', {
                d: fullArc, fill: 'none',
                stroke: COLOR, 'stroke-width': TRK,
                'stroke-linecap': 'round', 'pointer-events': 'none'
            });
            dialSvg.appendChild(progEl);

            // Pouce — créé mais pas encore appendé
            const [itx, ity] = P(aFunc(initT), Rm);
            const thumbEl = mk('circle', {
                cx: String(itx), cy: String(ity), r: '0.072',
                fill: COLOR, stroke: 'var(--bg)', 'stroke-width': '0.024',
                'pointer-events': 'none'
            });

            let totalLen = null;
            const setT = t => {
                if (totalLen === null) totalLen = progEl.getTotalLength();
                progEl.setAttribute('stroke-dasharray', `${t * totalLen} ${totalLen}`);
                const [nx, ny] = P(aFunc(t), Rm);
                thumbEl.setAttribute('cx', String(nx));
                thumbEl.setAttribute('cy', String(ny));
            };
            requestAnimationFrame(() => setT(initT));
            return { setT, thumbEl };
        }

        const tEp0 = Math.max(0, Math.min(1, paintState.thicknessPercent / 100));
        const tOp0 = Math.max(0, Math.min(1, paintState.opacity));
        const snapT = makeSnapFn();   // état snap indépendant pour chaque slider
        const snapB = makeSnapFn();
        // sw=1 (CW) → haut ✓  sw=0 (CCW) → bas ✓
        const arcT  = makeArcSlider(1, aT, tEp0);   // crée piste + progression
        const arcB  = makeArcSlider(0, aB, tOp0);

        // ── Graduations SUR l'arc (entre pistes et pouces) ──────────────────
        // Ticks radiaux qui straddlent Rm : visibles sur fond ET sur progression
        const rTick1 = Rm - 0.030, rTick2 = Rm + 0.030;
        for (let i = 0; i <= 10; i++) {
            const t   = i / 10;
            const sw2 = (i % 5 === 0) ? '0.016' : '0.009';
            [aT(t), aB(t)].forEach(angle => {
                const [x1, y1] = P(angle, rTick1);
                const [x2, y2] = P(angle, rTick2);
                dialSvg.appendChild(mk('line', {
                    x1, y1, x2, y2,
                    stroke: 'var(--bg)', 'stroke-width': sw2,
                    'stroke-linecap': 'round', opacity: '0.90',
                    'pointer-events': 'none'
                }));
            });
        }

        // Pouces appendés après les ticks → dessinés au-dessus
        dialSvg.appendChild(arcT.thumbEl);
        dialSvg.appendChild(arcB.thumbEl);

        // ── Zones de clic (demi-donuts transparents) ─────────────────────────
        const hitT = mk('path', { d: halfPath(1), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
        const hitB = mk('path', { d: halfPath(0), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
        dialSvg.appendChild(hitT);
        dialSvg.appendChild(hitB);

        // ── Auto-fermeture 1.2 s après la dernière interaction ───────────────
        // ── Fermeture : quand la souris quitte la roue ──────────────────────
        // (plus de timer — l'outil reste ouvert tant qu'on survole la roue)
        let mouseOverRoue = true;  // vrai à l'ouverture (le clic était dedans)

        const doClose = () => {
            // Retirer les listeners de survol pour éviter les doublons si le dial est rouvert
            roueConteneur.removeEventListener('mouseenter', onRoueEnter);
            roueConteneur.removeEventListener('mouseleave', onRoueLeave);
            hideVal();   // closure : hideVal est défini plus bas mais sera résolu à l'appel
            // selectedConnector = null; // CONNECTEURS
            roueConteneur.classList.remove('mode-dessin');
            dialSvg.innerHTML = '';
            segmentsEls.forEach(s  => s.classList.remove('actif'));
            iconesEls.forEach(ic   => ic.classList.remove('actif'));
            outilActifNum = null;
            if (fanPinned) { fanPinned = false; roueConteneur.classList.remove('epingle'); }
            _fanClose();
        };

        const onRoueEnter = () => { mouseOverRoue = true; };
        const onRoueLeave = () => {
            mouseOverRoue = false;
            if (!activeHalf && !chromoDrag) doClose();  // ferme si pas de drag en cours
        };
        roueConteneur.addEventListener('mouseenter', onRoueEnter);
        roueConteneur.addEventListener('mouseleave', onRoueLeave);

        // ── Interaction par angle (projeté sur l'arc) ────────────────────────
        // Technique : forcer dy dans le bon hémicycle avant atan2
        // → le pouce reste sur l'arc même si la souris dépasse la ligne médiane
        let activeHalf = null;
        const evtRel = e => {
            const r = dialSvg.getBoundingClientRect();
            return {
                dx: e.clientX - r.left  - r.width  / 2,
                dy: e.clientY - r.top   - r.height / 2
            };
        };

        hitT.addEventListener('mousedown', e => { e.stopPropagation(); activeHalf = 'T'; });
        hitB.addEventListener('mousedown', e => { e.stopPropagation(); activeHalf = 'B'; });

        const onMove = e => {
            if (!activeHalf) return;
            const { dx, dy } = evtRel(e);
            if (activeHalf === 'T') {
                // Arc haut : dy forcé ≤ 0 (au-dessus du centre)
                const a   = Math.atan2(-Math.abs(dy), dx);
                const raw = Math.max(0, Math.min(1, (a + Math.PI) / Math.PI));
                const t   = snapT(raw);
                paintState.thicknessPercent = t * 100;
                arcT.setT(t);
                showVal(t * 100, 'épaisseur');
                // if (selectedConnector) { selectedConnector._thickness = t * 100; reRenderConnector(selectedConnector); } // CONNECTEURS
            } else {
                // Arc bas : dy forcé ≥ 0 (en-dessous du centre)
                const a   = Math.atan2( Math.abs(dy), dx);
                const raw = Math.max(0, Math.min(1, (Math.PI - a) / Math.PI));
                const t   = snapB(raw);
                paintState.opacity = t;
                arcB.setT(t);
                showVal(t * 100, 'opacité');
                // if (selectedConnector) { selectedConnector._opacity = t; reRenderConnector(selectedConnector); } // CONNECTEURS
            }
        };
        const onUp = () => {
            if (!activeHalf) return;
            activeHalf = null;
            hideVal();
            if (!mouseOverRoue) doClose(); // si la souris avait quitté la roue pendant le drag
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);

        // ── Roue chromatique 2D (teinte = angle, saturation = distance) ───────
        const chromo    = document.getElementById('roue-centre-chromo');
        const chromoInd = chromo ? chromo.querySelector('.chromo-ind') : null;
        let chromoDrag  = false;

        // ── Overlay : label + chiffre au centre pendant le glisser ──────────
        const centreEl = document.getElementById('roue-centre');
        const valDiv   = document.createElement('div');
        valDiv.style.cssText = [
            'position:absolute', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)',
            'pointer-events:none', 'z-index:25',
            'opacity:0', 'transition:opacity 0.10s',
            'display:flex', 'flex-direction:column', 'align-items:center', 'gap:1px',
            'text-align:center',
            'width:calc(var(--roue-size)*0.27)',
        ].join(';');
        const valLblD = document.createElement('div');
        valLblD.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.042)',
            'font-weight:700', 'color:white',
            'letter-spacing:0.03em', 'text-transform:uppercase', 'line-height:1',
            'white-space:nowrap', 'overflow:hidden',
        ].join(';');
        const valNumD = document.createElement('div');
        valNumD.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.115)',
            'font-weight:900', 'color:white',
            'letter-spacing:-0.04em', 'line-height:1',
        ].join(';');
        valDiv.appendChild(valLblD);
        valDiv.appendChild(valNumD);
        if (centreEl) centreEl.appendChild(valDiv);
        const showVal = (v, lbl) => { valLblD.textContent = lbl || ''; valNumD.textContent = Math.round(v); valDiv.style.opacity = '1'; };
        const hideVal = () => { valDiv.style.opacity = '0'; };

        function updateChromoInd(hue, sat) {
            if (!chromoInd) return;
            const a    = (hue - 90) * Math.PI / 180;
            const dist = (sat / 100) * 40;
            chromoInd.style.left = `calc(50% + ${(Math.cos(a) * dist).toFixed(2)}%)`;
            chromoInd.style.top  = `calc(50% + ${(Math.sin(a) * dist).toFixed(2)}%)`;
        }
        function pickColor(e) {
            if (!chromo) return;
            const r  = chromo.getBoundingClientRect();
            const cx = r.left + r.width  / 2, cy = r.top + r.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const angle = Math.atan2(dy, dx);
            const hue   = Math.round(((angle * 180 / Math.PI) + 90 + 360) % 360);
            const sat   = Math.round(Math.min(100, Math.sqrt(dx*dx + dy*dy) / (r.width / 2) * 100));
            paintState.color = `hsl(${hue}, ${sat}%, 50%)`;
            updateChromoInd(hue, sat);
            // if (selectedConnector) { selectedConnector._color = paintState.color; reRenderConnector(selectedConnector); } // CONNECTEURS
        }
        const onChromoMouseDownDessin = e => { e.stopPropagation(); chromoDrag = true; pickColor(e); };
        if (chromo) {
            const m = paintState.color.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%/);
            updateChromoInd(m ? parseFloat(m[1]) : 60, m ? parseFloat(m[2]) : 100);
            chromo.addEventListener('mousedown', onChromoMouseDownDessin);
        }
        const onChromoMove = e => { if (chromoDrag) pickColor(e); };
        const onChromoUp = e => {
            if (!chromoDrag) return;
            chromoDrag = false;
            if (!mouseOverRoue) doClose();
        };
        document.addEventListener('mousemove', onChromoMove);
        document.addEventListener('mouseup',   onChromoUp);

        // ── Nettoyage (chaîné) ────────────────────────────────────────────────
        const prevCleanup = panelCleanup;
        panelCleanup = () => {
            if (prevCleanup) prevCleanup();
            roueConteneur.removeEventListener('mouseenter', onRoueEnter);
            roueConteneur.removeEventListener('mouseleave', onRoueLeave);
            if (chromo) chromo.removeEventListener('mousedown', onChromoMouseDownDessin);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            document.removeEventListener('mousemove', onChromoMove);
            document.removeEventListener('mouseup',   onChromoUp);
            if (valDiv.parentNode) valDiv.parentNode.removeChild(valDiv);
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-dessin');
        };
    }

    // ── DIAL FORMES — 5 formes + sliders horizontaux + toggle rempli/contour ──
    function construireDialFormes() {
        const dialSvg  = document.getElementById('roue-dial-svg');
        const fillCtrl = document.getElementById('roue-centre-fillctrl');
        if (!dialSvg) return;

        const Ro = 0.90, Ri = 0.38, Rm = (Ro + Ri) / 2;
        const ns    = 'http://www.w3.org/2000/svg';
        const COLOR = 'var(--flamme)'; // orange

        const mk = (tag, attrs) => {
            const el = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
            return el;
        };
        const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

        // Demi-donut pour le mode sliders
        const halfPath = sw =>
            `M ${-Ro} 0 A ${Ro} ${Ro} 0 1 ${sw} ${Ro} 0 L ${Ri} 0 A ${Ri} ${Ri} 0 1 ${sw} ${-Ri} 0 Z`;

        // Secteur de donut (sweep CW)
        const secPath = (a0, a1) => {
            const [ox0, oy0] = P(a0, Ro), [ox1, oy1] = P(a1, Ro);
            const [ix0, iy0] = P(a0, Ri), [ix1, iy1] = P(a1, Ri);
            return `M ${ox0} ${oy0} A ${Ro} ${Ro} 0 0 1 ${ox1} ${oy1}` +
                   ` L ${ix1} ${iy1} A ${Ri} ${Ri} 0 0 0 ${ix0} ${iy0} Z`;
        };

        // 5 formes à 72° chacune, départ à 12h (-π/2)
        const aStep = 2 * Math.PI / 5;
        const SHAPES = ['rectangle', 'cercle', 'triangle', 'losange', 'etoile'].map((key, i) => ({
            key,
            center: -Math.PI / 2 + i * aStep,
            a0:     -Math.PI / 2 + i * aStep - aStep / 2,
            a1:     -Math.PI / 2 + i * aStep + aStep / 2,
        }));

        // Icône SVG miniature pour chaque forme
        function shapeIcon(key, color) {
            const g = mk('g', {
                fill: 'none', stroke: color, 'stroke-width': '0.032',
                'stroke-linecap': 'round', 'stroke-linejoin': 'round',
                'pointer-events': 'none'
            });
            const s = 0.095;
            if (key === 'rectangle') {
                g.appendChild(mk('rect', { x: -s, y: -s*0.72, width: s*2, height: s*1.44, rx: '0.013' }));
            } else if (key === 'cercle') {
                g.appendChild(mk('circle', { cx: 0, cy: 0, r: s }));
            } else if (key === 'triangle') {
                g.appendChild(mk('polygon', { points: `0,${-s} ${s*0.87},${s*0.5} ${-s*0.87},${s*0.5}` }));
            } else if (key === 'losange') {
                g.appendChild(mk('polygon', { points: `0,${-s} ${s},0 0,${s} ${-s},0` }));
            } else if (key === 'etoile') {
                const pts = [];
                for (let i = 0; i < 5; i++) {
                    const ao = -Math.PI/2 + i * 2*Math.PI/5;
                    const ai = -Math.PI/2 + (i + 0.5) * 2*Math.PI/5;
                    pts.push(`${(Math.cos(ao)*s).toFixed(4)},${(Math.sin(ao)*s).toFixed(4)}`);
                    pts.push(`${(Math.cos(ai)*s*0.42).toFixed(4)},${(Math.sin(ai)*s*0.42).toFixed(4)}`);
                }
                g.appendChild(mk('polygon', { points: pts.join(' ') }));
            }
            return g;
        }

        // Listeners document accumulés pour cleanup propre
        const docListeners = [];
        const addDoc = (ev, fn) => { document.addEventListener(ev, fn); docListeners.push([ev, fn]); };

        // Flag drag en cours (Phase B) — empêche la fermeture pendant un glisser
        let shapeDragging = false;

        // ── Chromo couleur formes ──────────────────────────────────────────────
        const chromoF    = document.getElementById('roue-centre-chromo');
        const chromoFInd = chromoF ? chromoF.querySelector('.chromo-ind') : null;
        let   chromoFDrag = false;

        function updateChromoFInd(hue, sat) {
            if (!chromoFInd) return;
            const a    = (hue - 90) * Math.PI / 180;
            const dist = (sat / 100) * 40;
            chromoFInd.style.left = `calc(50% + ${(Math.cos(a) * dist).toFixed(2)}%)`;
            chromoFInd.style.top  = `calc(50% + ${(Math.sin(a) * dist).toFixed(2)}%)`;
        }
        function pickColorFormes(e) {
            if (!chromoF) return;
            const r  = chromoF.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const angle = Math.atan2(dy, dx);
            const hue   = Math.round(((angle * 180 / Math.PI) + 90 + 360) % 360);
            const sat   = Math.round(Math.min(100, Math.sqrt(dx*dx + dy*dy) / (r.width / 2) * 100));
            const lum   = sat < 10 ? Math.round(100 - sat * 4) : 50;
            window.etatForme.color = `hsl(${hue}, ${sat}%, ${lum}%)`;
            updateChromoFInd(hue, sat);
        }
        const onChromoFDown = (e) => { e.stopPropagation(); chromoFDrag = true; pickColorFormes(e); };
        const onChromoFMove = (e) => { if (chromoFDrag) pickColorFormes(e); };
        const onChromoFUp   = () => { chromoFDrag = false; };
        if (chromoF) {
            chromoF.addEventListener('mousedown', onChromoFDown);
            document.addEventListener('mousemove', onChromoFMove);
            document.addEventListener('mouseup',   onChromoFUp);
        }

        // ── Fermeture au mouseleave de la roue (phases A et B) ────────────────
        const onRoueLeaveFormes = () => { if (!shapeDragging) schedClose(); };
        roueConteneur.addEventListener('mouseleave', onRoueLeaveFormes);

        // ── Auto-fermeture ────────────────────────────────────────────────────
        let closeTimer = null;
        const schedClose = () => {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => {
                if (chromoF) chromoF.removeEventListener('mousedown', onChromoFDown);
                document.removeEventListener('mousemove', onChromoFMove);
                document.removeEventListener('mouseup',   onChromoFUp);
                roueConteneur.classList.remove('mode-formes');
                roueConteneur.classList.remove('mode-formes-sliders');
                dialSvg.innerHTML = '';
                if (fillCtrl) fillCtrl.innerHTML = '';
                segmentsEls.forEach(s  => s.classList.remove('actif'));
                iconesEls.forEach(ic   => ic.classList.remove('actif'));
                outilActifNum = null;
                if (fanPinned) { fanPinned = false; roueConteneur.classList.remove('epingle'); }
                _fanClose();
            }, 1200);
        };

        // ── Overlay : chiffre affiché au centre pendant le glisser ───────────
        const centreEl2 = document.getElementById('roue-centre');
        const valDiv2 = document.createElement('div');
        valDiv2.style.cssText = [
            'position:absolute', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)',
            'display:flex', 'flex-direction:column', 'align-items:center',
            'width:calc(var(--roue-size)*0.27)',
            'text-align:center',
            'pointer-events:none', 'z-index:25',
            'opacity:0', 'transition:opacity 0.10s', 'gap:1px',
        ].join(';');
        const valLbl2 = document.createElement('div');
        valLbl2.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.042)',
            'font-weight:700', 'color:var(--bleu-marine)',
            'letter-spacing:0.03em', 'text-transform:uppercase',
            'line-height:1', 'white-space:nowrap',
            'overflow:hidden',
        ].join(';');
        const valNum2 = document.createElement('div');
        valNum2.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.115)',
            'font-weight:900', 'color:var(--bleu-marine)',
            'letter-spacing:-0.04em', 'line-height:1',
        ].join(';');
        valDiv2.appendChild(valLbl2);
        valDiv2.appendChild(valNum2);
        if (centreEl2) centreEl2.appendChild(valDiv2);
        if (fillCtrl) fillCtrl.style.transition = 'opacity 0.10s';
        const showVal2 = (v, lbl) => {
            valLbl2.textContent = lbl || '';
            valNum2.textContent = Math.round(v);
            valDiv2.style.opacity = '1';
            if (fillCtrl) { fillCtrl.style.opacity = '0'; fillCtrl.style.pointerEvents = 'none'; }
        };
        const hideVal2 = () => {
            valDiv2.style.opacity = '0';
            if (fillCtrl) { fillCtrl.style.opacity = '1'; fillCtrl.style.pointerEvents = ''; }
        };

        // ── ÉTAT A — sélecteur de forme ───────────────────────────────────────
        function buildShapePicker() {
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-formes-sliders');
            if (fillCtrl) fillCtrl.innerHTML = '';

            SHAPES.forEach(sh => {
                const isActif = window.etatForme.type === sh.key;
                const seg = mk('path', {
                    d:      secPath(sh.a0, sh.a1),
                    fill:   isActif ? 'var(--flamme)' : 'var(--bg)',
                    stroke: 'var(--shadow-dark)', 'stroke-width': '0.010',
                    cursor: 'pointer',
                });
                dialSvg.appendChild(seg);

                const [cx, cy] = P(sh.center, Rm);
                const icon = shapeIcon(sh.key, isActif ? 'white' : 'var(--bleu-mid)');
                icon.setAttribute('transform', `translate(${cx},${cy})`);
                dialSvg.appendChild(icon);

                seg.addEventListener('mouseenter', () => {
                    if (window.etatForme.type !== sh.key) seg.setAttribute('fill', 'var(--shadow-light)');
                });
                seg.addEventListener('mouseleave', () => {
                    seg.setAttribute('fill', window.etatForme.type === sh.key ? 'var(--flamme)' : 'var(--bg)');
                });
                seg.addEventListener('click', e => {
                    e.stopPropagation();
                    window.etatForme.type = sh.key;
                    buildSliders();
                });
            });
        }

        // ── ÉTAT B — sliders ARC + toggle rempli/contour ─────────────────────
        function buildSliders() {
            dialSvg.innerHTML = '';
            roueConteneur.classList.add('mode-formes-sliders');

            // Arc haut : t=0→gauche (−π), t=1→droite (0), via 12h
            const aT = t => -Math.PI + t * Math.PI;
            // Arc bas  : t=0→gauche (+π), t=1→droite (0), via 6h
            const aB = t =>  Math.PI - t * Math.PI;

            // Fonds demi-donut
            const bkA = { fill: 'var(--bg)', stroke: 'var(--shadow-dark)', 'stroke-width': '0.010', 'fill-rule': 'evenodd' };
            dialSvg.appendChild(mk('path', { d: halfPath(0), ...bkA }));
            dialSvg.appendChild(mk('path', { d: halfPath(1), ...bkA }));

            // Séparateurs
            const divA = { stroke: 'var(--shadow-dark)', 'stroke-width': '0.018', 'stroke-linecap': 'round' };
            dialSvg.appendChild(mk('line', { x1: -Ro, y1: 0, x2: -Ri, y2: 0, ...divA }));
            dialSvg.appendChild(mk('line', { x1:  Ri, y1: 0, x2:  Ro, y2: 0, ...divA }));

            // Fabrique un slider (pouce non appendé — ajouté après les ticks)
            function makeArcSlider2(sw, aFunc, initT) {
                const [lx, ly] = P(aFunc(0), Rm);
                const [rx, ry] = P(aFunc(1), Rm);
                const TRK = '0.028';
                const fullArc = `M ${lx} ${ly} A ${Rm} ${Rm} 0 1 ${sw} ${rx} ${ry}`;

                dialSvg.appendChild(mk('path', {
                    d: fullArc, fill: 'none',
                    stroke: 'var(--shadow-dark)', 'stroke-width': TRK,
                    'stroke-linecap': 'round', 'stroke-opacity': '0.38',
                    'pointer-events': 'none'
                }));

                const progEl = mk('path', {
                    d: fullArc, fill: 'none',
                    stroke: COLOR, 'stroke-width': TRK,
                    'stroke-linecap': 'round', 'pointer-events': 'none'
                });
                dialSvg.appendChild(progEl);

                const [itx, ity] = P(aFunc(initT), Rm);
                const thumbEl = mk('circle', {
                    cx: String(itx), cy: String(ity), r: '0.072',
                    fill: COLOR, stroke: 'var(--bg)', 'stroke-width': '0.024',
                    'pointer-events': 'none'
                });

                let totalLen = null;
                const setT = t => {
                    if (totalLen === null) totalLen = progEl.getTotalLength();
                    progEl.setAttribute('stroke-dasharray', `${t * totalLen} ${totalLen}`);
                    const [nx, ny] = P(aFunc(t), Rm);
                    thumbEl.setAttribute('cx', String(nx));
                    thumbEl.setAttribute('cy', String(ny));
                };
                requestAnimationFrame(() => setT(initT));
                return { setT, thumbEl };
            }

            const tEp0  = Math.max(0, Math.min(1, window.etatForme.thickness / 100));
            const tOp0  = Math.max(0, Math.min(1, window.etatForme.opacity));
            const snapT2 = makeSnapFn();
            const snapB2 = makeSnapFn();
            const arcT2  = makeArcSlider2(1, aT, tEp0);
            const arcB2  = makeArcSlider2(0, aB, tOp0);

            // ── Graduations SUR l'arc ────────────────────────────────────────
            const rTick1 = Rm - 0.030, rTick2 = Rm + 0.030;
            for (let i = 0; i <= 10; i++) {
                const t   = i / 10;
                const sw2 = (i % 5 === 0) ? '0.016' : '0.009';
                [aT(t), aB(t)].forEach(angle => {
                    const [x1, y1] = P(angle, rTick1);
                    const [x2, y2] = P(angle, rTick2);
                    dialSvg.appendChild(mk('line', {
                        x1, y1, x2, y2,
                        stroke: 'var(--bg)', 'stroke-width': sw2,
                        'stroke-linecap': 'round', opacity: '0.90',
                        'pointer-events': 'none'
                    }));
                });
            }

            // Pouces appendés après les ticks
            dialSvg.appendChild(arcT2.thumbEl);
            dialSvg.appendChild(arcB2.thumbEl);

            // Zones de clic
            const hitT2 = mk('path', { d: halfPath(1), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
            const hitB2 = mk('path', { d: halfPath(0), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
            dialSvg.appendChild(hitT2);
            dialSvg.appendChild(hitB2);

            let activeHalf2 = null;
            const evtRel2 = e => {
                const r = dialSvg.getBoundingClientRect();
                return {
                    dx: e.clientX - r.left  - r.width  / 2,
                    dy: e.clientY - r.top   - r.height / 2
                };
            };

            hitT2.addEventListener('mousedown', e => { e.stopPropagation(); activeHalf2 = 'T'; shapeDragging = true; clearTimeout(closeTimer); });
            hitB2.addEventListener('mousedown', e => { e.stopPropagation(); activeHalf2 = 'B'; shapeDragging = true; clearTimeout(closeTimer); });

            const onSM = e => {
                if (!activeHalf2) return;
                const { dx, dy } = evtRel2(e);
                if (activeHalf2 === 'T') {
                    const a   = Math.atan2(-Math.abs(dy), dx);
                    const raw = Math.max(0, Math.min(1, (a + Math.PI) / Math.PI));
                    const t   = snapT2(raw);
                    window.etatForme.thickness = t * 100;
                    arcT2.setT(t);
                    showVal2(t * 100, 'épaisseur');
                } else {
                    const a   = Math.atan2( Math.abs(dy), dx);
                    const raw = Math.max(0, Math.min(1, (Math.PI - a) / Math.PI));
                    const t   = snapB2(raw);
                    window.etatForme.opacity = t;
                    arcB2.setT(t);
                    showVal2(t * 100, 'opacité');
                }
            };
            const onSU = () => { if (activeHalf2) { activeHalf2 = null; shapeDragging = false; hideVal2(); schedClose(); } };
            addDoc('mousemove', onSM);
            addDoc('mouseup',   onSU);

            // Toggle rempli / contour — style néomorphique inline
            updateFillCtrl();
        }

        function updateFillCtrl() {
            if (!fillCtrl) return;
            fillCtrl.innerHTML = '';
            const mode = window.etatForme.mode || 'fill';
            const sz   = 'calc(var(--roue-size) * 0.100)';
            const CYCLE = ['fill', 'stroke', 'both'];
            const titles = { fill: 'Rempli', stroke: 'Contour', both: 'Rempli + Contour' };
            const icons  = {
                fill:   `<rect x="2" y="2" width="12" height="12" rx="2" fill="var(--bleu-mid)"/>`,
                stroke: `<rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="var(--bleu-mid)" stroke-width="2.5"/>`,
                both:   `<rect x="2" y="2" width="12" height="12" rx="2" fill="var(--bleu-mid)" fill-opacity="0.40" stroke="var(--bleu-mid)" stroke-width="2"/>`,
            };

            const btn = document.createElement('div');
            btn.title = titles[mode];
            btn.style.cssText = `width:${sz};height:${sz};display:flex;align-items:center;justify-content:center;border-radius:7px;cursor:pointer;background:var(--bg);box-shadow:var(--neu-inset);transition:box-shadow 0.12s;`;
            btn.innerHTML = `<svg width="62%" height="62%" viewBox="0 0 16 16">${icons[mode]}</svg>`;

            btn.addEventListener('click', e => {
                e.stopPropagation();
                window.etatForme.mode = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
                updateFillCtrl();
            });

            fillCtrl.appendChild(btn);
        }

        // Démarrer avec le sélecteur de forme
        buildShapePicker();

        const prevCleanup = panelCleanup;
        panelCleanup = () => {
            if (prevCleanup) prevCleanup();
            clearTimeout(closeTimer);
            roueConteneur.removeEventListener('mouseleave', onRoueLeaveFormes);
            docListeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn));
            if (chromoF) chromoF.removeEventListener('mousedown', onChromoFDown);
            document.removeEventListener('mousemove', onChromoFMove);
            document.removeEventListener('mouseup',   onChromoFUp);
            if (valDiv2.parentNode) valDiv2.parentNode.removeChild(valDiv2);
            dialSvg.innerHTML = '';
            if (fillCtrl) fillCtrl.innerHTML = '';
            roueConteneur.classList.remove('mode-formes');
            roueConteneur.classList.remove('mode-formes-sliders');
        };
    }

    // ── DIAL CHRONO — deux secteurs : Chrono/Minuteur (haut) + Horloge (bas) ──
    function construireDialChrono() {
        const dialSvg = document.getElementById('roue-dial-svg');
        if (!dialSvg) return;

        const Ro = 0.90, Ri = 0.38, Rm = (Ro + Ri) / 2;
        const ns = 'http://www.w3.org/2000/svg';

        const mk = (tag, attrs) => {
            const el = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
            return el;
        };

        const halfPath = sw =>
            `M ${-Ro} 0 A ${Ro} ${Ro} 0 1 ${sw} ${Ro} 0 L ${Ri} 0 A ${Ri} ${Ri} 0 1 ${sw} ${-Ri} 0 Z`;

        let mouseOverRoue = true;

        const centreElChrono = document.getElementById('roue-centre');
        const onCentreClick = (e) => { e.stopPropagation(); doClose(); };

        const doClose = () => {
            if (centreElChrono) {
                centreElChrono.style.cursor = '';
                centreElChrono.removeEventListener('click', onCentreClick);
            }
            roueConteneur.removeEventListener('mouseenter', onRoueEnter);
            roueConteneur.removeEventListener('mouseleave', onRoueLeave);
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-chrono');
            segmentsEls.forEach(s  => s.classList.remove('actif'));
            iconesEls.forEach(ic   => ic.classList.remove('actif'));
            outilActifNum = null;
            if (fanPinned) { fanPinned = false; roueConteneur.classList.remove('epingle'); }
            _fanClose();
        };

        if (centreElChrono) {
            centreElChrono.style.cursor = 'pointer';
            centreElChrono.addEventListener('click', onCentreClick);
        }

        const onRoueEnter = () => { mouseOverRoue = true; };
        const onRoueLeave = () => { mouseOverRoue = false; doClose(); };
        roueConteneur.addEventListener('mouseenter', onRoueEnter);
        roueConteneur.addEventListener('mouseleave', onRoueLeave);

        // ── Defs : chemins pour texte en arc ─────────────────────────────────
        const uid = Date.now();
        const idTop = `chrono-arc-top-${uid}`;
        const idBot = `chrono-arc-bot-${uid}`;

        const defs = mk('defs', {});
        // Arc haut (sw=1) : de gauche à droite via le sommet (y négatif)
        defs.appendChild(mk('path', { id: idTop, d: `M ${-Rm} 0 A ${Rm} ${Rm} 0 1 1 ${Rm} 0`, fill: 'none' }));
        // Arc bas  (sw=0) : de gauche à droite via le bas (y positif)
        defs.appendChild(mk('path', { id: idBot, d: `M ${-Rm} 0 A ${Rm} ${Rm} 0 1 0 ${Rm} 0`, fill: 'none' }));
        dialSvg.appendChild(defs);

        // ── Lignes séparatrices gauche/droite ─────────────────────────────────
        [[-Ro, -Ri], [Ri, Ro]].forEach(([x1, x2]) => {
            dialSvg.appendChild(mk('line', {
                x1: String(x1), y1: '0', x2: String(x2), y2: '0',
                stroke: 'var(--shadow-dark)', 'stroke-width': '0.014', opacity: '0.5',
            }));
        });

        // ── Deux secteurs avec texte en arc ───────────────────────────────────
        const barreD = document.getElementById('barre-outils-droite');
        const chronoActif  = !!barreD.querySelector('.bloc-chrono');
        const horlogeActif = !!barreD.querySelector('.bloc-horloge');

        const ITEMS = [
            {
                sw: 1, arcId: idTop, label: 'CHRONO', actif: chronoActif,
                action: () => { creerChrono(barreD); },
            },
            {
                sw: 0, arcId: idBot, label: 'HORLOGE', actif: horlogeActif,
                action: () => {
                    const h = barreD.querySelector('.bloc-horloge');
                    if (h && h._stopHorloge) h._stopHorloge();
                    creerHorloge(barreD);
                },
            },
        ];

        ITEMS.forEach(({ sw, arcId, label, action, actif }) => {
            // Couleurs selon état actif : orange plein/blanc ↔ blanc/orange
            const fillBase  = actif ? 'var(--flamme)'            : 'var(--bg)';
            const fillHover = actif ? 'rgba(255,64,0,0.82)'      : 'rgba(255,64,0,0.09)';
            const textColor = actif ? 'white'                    : 'var(--flamme)';

            const path = mk('path', {
                d: halfPath(sw),
                fill: fillBase,
                stroke: 'var(--shadow-dark)', 'stroke-width': '0.010',
                cursor: 'pointer', 'fill-rule': 'evenodd',
            });
            dialSvg.appendChild(path);

            // Texte en arc sur la ligne médiane du demi-donut
            const textEl = mk('text', {
                'font-family': "'DM Sans',Helvetica,Arial,sans-serif",
                'font-size': '0.118',
                'font-weight': '700',
                fill: textColor,
                'pointer-events': 'none',
                'letter-spacing': '0.018',
            });
            const tp = mk('textPath', {
                href: `#${arcId}`,
                startOffset: '50%',
                'text-anchor': 'middle',
            });
            tp.textContent = label;
            textEl.appendChild(tp);
            dialSvg.appendChild(textEl);

            path.addEventListener('mouseenter', () => path.setAttribute('fill', fillHover));
            path.addEventListener('mouseleave', () => path.setAttribute('fill', fillBase));
            path.addEventListener('click', (e) => { e.stopPropagation(); action(); });
        });

        const prevCleanup = panelCleanup;
        panelCleanup = () => {
            if (prevCleanup) prevCleanup();
            roueConteneur.removeEventListener('mouseenter', onRoueEnter);
            roueConteneur.removeEventListener('mouseleave', onRoueLeave);
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-chrono');
        };
    }

    // ── PANEL TABLEAU ─────────────────────────────────────────────────────────
    function construirePanelTableau() {
        panelInner.innerHTML = '';
        const et = window.etatTableau;

        const ligne = document.createElement('div');
        ligne.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px 4px;';

        const label = document.createElement('span');
        label.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:11px;font-weight:700;color:var(--bleu-mid);flex:1;letter-spacing:0.04em;';
        label.textContent = 'TABLEAU';
        ligne.appendChild(label);

        // Swatch couleur + mini chromo inline
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:22px;height:22px;border-radius:50%;background:${et.color};cursor:pointer;box-shadow:var(--neu-flat);flex-shrink:0;transition:box-shadow 0.12s;`;
        swatch.title = 'Couleur des traits';
        swatch.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'color';
            input.value = et.color.startsWith('hsl') ? '#1b3060' : et.color;
            input.style.cssText = 'position:absolute;opacity:0;pointer-events:none;';
            document.body.appendChild(input);
            input.addEventListener('input', () => { et.color = input.value; swatch.style.background = et.color; });
            input.addEventListener('change', () => { document.body.removeChild(input); });
            input.click();
        });
        ligne.appendChild(swatch);
        panelInner.appendChild(ligne);

        // Slider épaisseur
        const ligne2 = document.createElement('div');
        ligne2.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 10px 8px;';
        const ep = document.createElement('span');
        ep.style.cssText = 'font-family:"DM Sans",sans-serif;font-size:10px;color:var(--bleu-mid);min-width:62px;';
        ep.textContent = 'Épaisseur';
        const range = document.createElement('input');
        range.type = 'range'; range.min = '0.5'; range.max = '6'; range.step = '0.5';
        range.value = et.thickness;
        range.style.cssText = 'flex:1;accent-color:var(--flamme);';
        range.addEventListener('input', () => { et.thickness = parseFloat(range.value); });
        ligne2.appendChild(ep); ligne2.appendChild(range);
        panelInner.appendChild(ligne2);
    }

    // ── DIAL TABLEAU — sliders colonnes / lignes ──────────────────────────────
    function construireDialTableau() {
        const dialSvg = document.getElementById('roue-dial-svg');
        if (!dialSvg) return;

        const Ro=0.90,Ri=0.38,Rm=(Ro+Ri)/2,ns='http://www.w3.org/2000/svg',COLOR='var(--flamme)';
        const mk=(tag,attrs)=>{const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,String(v)));return el;};
        const P=(a,r)=>[Math.cos(a)*r,Math.sin(a)*r];
        const halfPath=sw=>`M ${-Ro} 0 A ${Ro} ${Ro} 0 1 ${sw} ${Ro} 0 L ${Ri} 0 A ${Ri} ${Ri} 0 1 ${sw} ${-Ri} 0 Z`;

        const docListeners=[];
        const addDoc=(ev,fn)=>{document.addEventListener(ev,fn);docListeners.push([ev,fn]);};
        let tblDragging=false;

        let closeTimer=null;
        const doClose=()=>{
            clearTimeout(closeTimer);
            roueConteneur.removeEventListener('mouseleave',onLeave);
            docListeners.forEach(([ev,fn])=>document.removeEventListener(ev,fn));
            if(centreEl&&valDiv.parentNode)valDiv.parentNode.removeChild(valDiv);
            dialSvg.innerHTML='';
            roueConteneur.classList.remove('mode-tableau');
            segmentsEls.forEach(s=>s.classList.remove('actif'));
            iconesEls.forEach(ic=>ic.classList.remove('actif'));
            outilActifNum=null;
            if(fanPinned){fanPinned=false;roueConteneur.classList.remove('epingle');}
            _fanClose();
        };
        const schedClose=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!tblDragging)doClose();},1200);};
        const onLeave=()=>{if(!tblDragging)schedClose();};
        roueConteneur.addEventListener('mouseleave',onLeave);

        // Affichage central "N×M"
        const centreEl=document.getElementById('roue-centre');
        const valDiv=document.createElement('div');
        valDiv.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:calc(var(--roue-size)*0.09);font-weight:900;color:var(--flamme);pointer-events:none;z-index:25;line-height:1;text-align:center;white-space:nowrap;';
        const updVal=()=>{valDiv.textContent=`${window.etatTableau.cols}×${window.etatTableau.rows}`;};
        updVal();
        if(centreEl)centreEl.appendChild(valDiv);

        // Construction du dial
        dialSvg.innerHTML='';
        const aT=t=>-Math.PI+t*Math.PI;
        const aB=t=>Math.PI-t*Math.PI;

        const bkA={fill:'var(--bg)',stroke:'var(--shadow-dark)','stroke-width':'0.010','fill-rule':'evenodd'};
        dialSvg.appendChild(mk('path',{d:halfPath(0),...bkA}));
        dialSvg.appendChild(mk('path',{d:halfPath(1),...bkA}));
        const divA={stroke:'var(--shadow-dark)','stroke-width':'0.018','stroke-linecap':'round'};
        dialSvg.appendChild(mk('line',{x1:-Ro,y1:0,x2:-Ri,y2:0,...divA}));
        dialSvg.appendChild(mk('line',{x1:Ri,y1:0,x2:Ro,y2:0,...divA}));

        function makeArcSlider(sw,aFunc,initT){
            const[lx,ly]=P(aFunc(0),Rm);const[rx,ry]=P(aFunc(1),Rm);
            const TRK='0.028';
            const fullArc=`M ${lx} ${ly} A ${Rm} ${Rm} 0 1 ${sw} ${rx} ${ry}`;
            dialSvg.appendChild(mk('path',{d:fullArc,fill:'none',stroke:'var(--shadow-dark)','stroke-width':TRK,'stroke-linecap':'round','stroke-opacity':'0.38','pointer-events':'none'}));
            const prog=mk('path',{d:fullArc,fill:'none',stroke:COLOR,'stroke-width':TRK,'stroke-linecap':'round','pointer-events':'none'});
            dialSvg.appendChild(prog);
            const[itx,ity]=P(aFunc(initT),Rm);
            const thumb=mk('circle',{cx:String(itx),cy:String(ity),r:'0.072',fill:COLOR,stroke:'var(--bg)','stroke-width':'0.024','pointer-events':'none'});
            let len=null;
            const setT=t=>{if(len===null)len=prog.getTotalLength();prog.setAttribute('stroke-dasharray',`${t*len} ${len}`);const[nx,ny]=P(aFunc(t),Rm);thumb.setAttribute('cx',String(nx));thumb.setAttribute('cy',String(ny));};
            requestAnimationFrame(()=>setT(initT));
            return{setT,thumb};
        }

        const MAXV=8; // 1 à 8
        const tC0=Math.max(0,Math.min(1,(window.etatTableau.cols-1)/(MAXV-1)));
        const tR0=Math.max(0,Math.min(1,(window.etatTableau.rows-1)/(MAXV-1)));
        const snapC=makeSnapFn(MAXV-1);
        const snapR=makeSnapFn(MAXV-1);
        const arcT=makeArcSlider(1,aT,tC0);
        const arcB=makeArcSlider(0,aB,tR0);

        // Graduations (8 positions)
        const rT1=Rm-0.030,rT2=Rm+0.030;
        for(let i=0;i<=MAXV-1;i++){
            const t=i/(MAXV-1);
            const sw2=(i===0||i===MAXV-1||i===Math.round((MAXV-1)/2))?'0.016':'0.009';
            [aT(t),aB(t)].forEach(angle=>{
                const[x1,y1]=P(angle,rT1);const[x2,y2]=P(angle,rT2);
                dialSvg.appendChild(mk('line',{x1,y1,x2,y2,stroke:'var(--bg)','stroke-width':sw2,'stroke-linecap':'round',opacity:'0.90','pointer-events':'none'}));
            });
        }
        dialSvg.appendChild(arcT.thumb);
        dialSvg.appendChild(arcB.thumb);

        // Zones de clic
        const hitT=mk('path',{d:halfPath(1),fill:'transparent',stroke:'none',cursor:'pointer','fill-rule':'evenodd'});
        const hitB=mk('path',{d:halfPath(0),fill:'transparent',stroke:'none',cursor:'pointer','fill-rule':'evenodd'});
        dialSvg.appendChild(hitT);
        dialSvg.appendChild(hitB);

        let activeH=null;
        const evtRel=e=>{const r=dialSvg.getBoundingClientRect();return{dx:e.clientX-r.left-r.width/2,dy:e.clientY-r.top-r.height/2};};
        hitT.addEventListener('mousedown',e=>{e.stopPropagation();activeH='T';tblDragging=true;clearTimeout(closeTimer);});
        hitB.addEventListener('mousedown',e=>{e.stopPropagation();activeH='B';tblDragging=true;clearTimeout(closeTimer);});

        const onM=e=>{
            if(!activeH)return;
            const{dx,dy}=evtRel(e);
            if(activeH==='T'){
                const a=Math.atan2(-Math.abs(dy),dx);
                const raw=Math.max(0,Math.min(1,(a+Math.PI)/Math.PI));
                const t=snapC(raw);
                window.etatTableau.cols=Math.round(1+t*(MAXV-1));
                arcT.setT(t); updVal();
            }else{
                const a=Math.atan2(Math.abs(dy),dx);
                const raw=Math.max(0,Math.min(1,(Math.PI-a)/Math.PI));
                const t=snapR(raw);
                window.etatTableau.rows=Math.round(1+t*(MAXV-1));
                arcB.setT(t); updVal();
            }
        };
        const onU=()=>{if(activeH){activeH=null;tblDragging=false;schedClose();}};
        addDoc('mousemove',onM);
        addDoc('mouseup',onU);

        const prevCleanup=panelCleanup;
        panelCleanup=()=>{
            if(prevCleanup)prevCleanup();
            clearTimeout(closeTimer);
            roueConteneur.removeEventListener('mouseleave',onLeave);
            docListeners.forEach(([ev,fn])=>document.removeEventListener(ev,fn));
            if(centreEl&&valDiv.parentNode)valDiv.parentNode.removeChild(valDiv);
            dialSvg.innerHTML='';
            roueConteneur.classList.remove('mode-tableau');
        };
    }

    // ── DIAL TEXTE — sélecteur de fonte (6 secteurs) + sliders taille/graisse ──
    function construireDialTexte() {
        const dialSvg = document.getElementById('roue-dial-svg');
        if (!dialSvg) return;

        window.etatTexte = window.etatTexte || {
            fontFamily : 'DM Sans',
            fontSize   : 52,   // px — plage 8–96, milieu = 52
            fontWeight : 500,  // 100–900, milieu = 500
            color      : '#000000',
        };
        if (!window.etatTexte.color) window.etatTexte.color = '#000000';

        const Ro = 0.90, Ri = 0.38, Rm = (Ro + Ri) / 2;
        const ns    = 'http://www.w3.org/2000/svg';
        const COLOR = 'var(--flamme)';

        const mk = (tag, attrs) => {
            const el = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
            return el;
        };
        const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

        const halfPath = sw =>
            `M ${-Ro} 0 A ${Ro} ${Ro} 0 1 ${sw} ${Ro} 0 L ${Ri} 0 A ${Ri} ${Ri} 0 1 ${sw} ${-Ri} 0 Z`;

        const secPath = (a0, a1) => {
            const [ox0, oy0] = P(a0, Ro), [ox1, oy1] = P(a1, Ro);
            const [ix0, iy0] = P(a0, Ri), [ix1, iy1] = P(a1, Ri);
            return `M ${ox0} ${oy0} A ${Ro} ${Ro} 0 0 1 ${ox1} ${oy1}` +
                   ` L ${ix1} ${iy1} A ${Ri} ${Ri} 0 0 0 ${ix0} ${iy0} Z`;
        };

        // 6 fontes représentant les grandes familles typographiques
        const FONTS = [
            { family: 'DM Sans',           label: 'Sans'      },
            { family: 'Playfair Display',  label: 'Playfair'  },
            { family: 'Bebas Neue',        label: 'BEBAS'     },
            { family: 'Space Mono',        label: 'Mono'      },
            { family: 'Cormorant Garamond',label: 'Cormorant' },
            { family: 'Raleway',           label: 'Raleway'   },
        ];
        const N     = FONTS.length;
        const aStep = 2 * Math.PI / N;

        const docListeners = [];
        const addDoc = (ev, fn) => { document.addEventListener(ev, fn); docListeners.push([ev, fn]); };

        // ── Fermeture au survol ────────────────────────────────────────────────
        let mouseOverRoue = true;
        let activeArc     = null;
        let chromoDrag    = false;

        // ── Roue chromatique : couleur du texte ───────────────────────────────
        const chromo    = document.getElementById('roue-centre-chromo');
        const chromoInd = chromo ? chromo.querySelector('.chromo-ind') : null;

        function updateChromoInd(hue, sat) {
            if (!chromoInd) return;
            const a    = (hue - 90) * Math.PI / 180;
            const dist = (sat / 100) * 40;
            chromoInd.style.left = `calc(50% + ${(Math.cos(a) * dist).toFixed(2)}%)`;
            chromoInd.style.top  = `calc(50% + ${(Math.sin(a) * dist).toFixed(2)}%)`;
        }
        function pickTextColor(e) {
            if (!chromo) return;
            const r  = chromo.getBoundingClientRect();
            const cx = r.left + r.width  / 2, cy = r.top + r.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const angle = Math.atan2(dy, dx);
            const hue   = Math.round(((angle * 180 / Math.PI) + 90 + 360) % 360);
            const sat   = Math.round(Math.min(100, Math.sqrt(dx*dx + dy*dy) / (r.width / 2) * 100));
            window.etatTexte.color = `hsl(${hue}, ${sat}%, 50%)`;
            updateChromoInd(hue, sat);
        }
        const onChromoMouseDown = e => { e.stopPropagation(); chromoDrag = true; pickTextColor(e); };
        if (chromo) {
            const m = window.etatTexte.color.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%/);
            updateChromoInd(m ? parseFloat(m[1]) : 60, m ? parseFloat(m[2]) : 100);
            chromo.addEventListener('mousedown', onChromoMouseDown);
        }
        const onDocMouseMove = e => {
            if (chromoDrag) pickTextColor(e);
            const r = roueConteneur.getBoundingClientRect();
            const nowOver = (e.clientX >= r.left && e.clientX <= r.right &&
                             e.clientY >= r.top  && e.clientY <= r.bottom);
            if (mouseOverRoue && !nowOver) {
                mouseOverRoue = false;
                if (!activeArc && !chromoDrag) scheduleClose();
            } else if (!mouseOverRoue && nowOver) {
                mouseOverRoue = true;
                clearTimeout(leaveTimer);
            }
        };
        const onChromoUp   = () => {
            if (!chromoDrag) return;
            chromoDrag = false;
            if (!mouseOverRoue) scheduleClose();
        };
        addDoc('mousemove', onDocMouseMove);
        addDoc('mouseup',   onChromoUp);

        let leaveTimer = null;
        const scheduleClose = () => {
            if (window.tableEditMode) return;
            clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => {
                if (!mouseOverRoue && !activeArc && !chromoDrag) doClose();
            }, 120);
        };

        const doClose = () => {
            clearTimeout(leaveTimer);
            if (chromo) chromo.removeEventListener('mousedown', onChromoMouseDown);
            docListeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn));
            dialSvg.innerHTML = '';
            const textCtrl = document.getElementById('roue-centre-textctrl');
            if (textCtrl) textCtrl.innerHTML = '';
            roueConteneur.classList.remove('mode-texte');
            roueConteneur.classList.remove('mode-texte-sliders');
            segmentsEls.forEach(s  => s.classList.remove('actif'));
            iconesEls.forEach(ic   => ic.classList.remove('actif'));
            outilActifNum = null;
            if (fanPinned) { fanPinned = false; roueConteneur.classList.remove('epingle'); }
            _fanClose();
        };

        // ── Overlay chiffre central ────────────────────────────────────────────
        const centreEl = document.getElementById('roue-centre');
        const valDiv   = document.createElement('div');
        valDiv.style.cssText = [
            'position:absolute', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)',
            'display:flex', 'flex-direction:column', 'align-items:center',
            'pointer-events:none', 'z-index:25',
            'opacity:0', 'transition:opacity 0.10s',
            'gap:1px',
            'width:calc(var(--roue-size)*0.27)',
            'text-align:center',
        ].join(';');
        const valLblT = document.createElement('div');
        valLblT.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.042)',
            'font-weight:700', 'letter-spacing:0.03em',
            'text-transform:uppercase', 'color:white',
            'white-space:nowrap', 'overflow:hidden',
        ].join(';');
        const valNumT = document.createElement('div');
        valNumT.style.cssText = [
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif',
            'font-size:calc(var(--roue-size)*0.115)',
            'font-weight:900', 'letter-spacing:-0.04em',
            'color:white', 'line-height:1',
        ].join(';');
        valDiv.appendChild(valLblT);
        valDiv.appendChild(valNumT);
        if (centreEl) centreEl.appendChild(valDiv);
        const showVal = (v, lbl) => { valLblT.textContent = lbl || ''; valNumT.textContent = Math.round(v); valDiv.style.opacity = '1'; };
        const hideVal = () => { valDiv.style.opacity = '0'; };

        // ── PHASE A : sélecteur de fonte ──────────────────────────────────────
        function buildFontPicker() {
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-texte-sliders');

            FONTS.forEach((font, i) => {
                const center  = -Math.PI / 2 + i * aStep;
                const a0      = center - aStep / 2;
                const a1      = center + aStep / 2;
                const isActif = window.etatTexte.fontFamily === font.family;

                const seg = mk('path', {
                    d:      secPath(a0, a1),
                    fill:   isActif ? 'var(--flamme)' : 'var(--bg)',
                    stroke: 'var(--shadow-dark)', 'stroke-width': '0.010',
                    cursor: 'pointer',
                });
                dialSvg.appendChild(seg);

                // Label de la fonte dans la bague
                const [tx, ty] = P(center, Rm);
                const txt = mk('text', {
                    x: tx, y: ty,
                    'text-anchor': 'middle',
                    'dominant-baseline': 'central',
                    'font-family': `'${font.family}',sans-serif`,
                    'font-size': '0.080',
                    fill: isActif ? 'white' : 'var(--bleu-mid)',
                    'pointer-events': 'none',
                });
                txt.textContent = font.label;
                dialSvg.appendChild(txt);

                seg.addEventListener('mouseenter', () => {
                    if (window.etatTexte.fontFamily !== font.family) seg.setAttribute('fill', 'var(--shadow-light)');
                });
                seg.addEventListener('mouseleave', () => {
                    seg.setAttribute('fill', window.etatTexte.fontFamily === font.family ? 'var(--flamme)' : 'var(--bg)');
                });
                seg.addEventListener('click', e => {
                    e.stopPropagation();
                    window.etatTexte.fontFamily = font.family;
                    buildSliders();
                });
            });
        }

        // ── PHASE B : sliders arc taille (haut) + graisse (bas) ──────────────
        function buildSliders() {
            dialSvg.innerHTML = '';
            roueConteneur.classList.add('mode-texte-sliders');

            // Aperçu de la fonte sélectionnée dans le centre
            const textCtrl = document.getElementById('roue-centre-textctrl');
            if (textCtrl) {
                textCtrl.innerHTML = '';
                const prev = document.createElement('span');
                prev.textContent = window.etatTexte.fontFamily.split(' ')[0];
                prev.style.cssText = [
                    `font-family:'${window.etatTexte.fontFamily}',sans-serif`,
                    'font-size:calc(var(--roue-size)*0.092)',
                    'color:var(--flamme)',
                    'line-height:1',
                    'text-align:center',
                    'pointer-events:none',
                    'user-select:none',
                    'overflow:hidden',
                    'max-width:100%',
                ].join(';');
                textCtrl.appendChild(prev);
            }

            const aT = t => -Math.PI + t * Math.PI;
            const aB = t =>  Math.PI - t * Math.PI;

            const bkA = { fill: 'var(--bg)', stroke: 'var(--shadow-dark)', 'stroke-width': '0.010', 'fill-rule': 'evenodd' };
            dialSvg.appendChild(mk('path', { d: halfPath(0), ...bkA }));
            dialSvg.appendChild(mk('path', { d: halfPath(1), ...bkA }));

            const divA = { stroke: 'var(--shadow-dark)', 'stroke-width': '0.018', 'stroke-linecap': 'round' };
            dialSvg.appendChild(mk('line', { x1: -Ro, y1: 0, x2: -Ri, y2: 0, ...divA }));
            dialSvg.appendChild(mk('line', { x1:  Ri, y1: 0, x2:  Ro, y2: 0, ...divA }));

            function makeArcSlider(sw, aFunc, initT) {
                const [lx, ly] = P(aFunc(0), Rm);
                const [rx, ry] = P(aFunc(1), Rm);
                const TRK = '0.028';
                const fullArc = `M ${lx} ${ly} A ${Rm} ${Rm} 0 1 ${sw} ${rx} ${ry}`;

                dialSvg.appendChild(mk('path', {
                    d: fullArc, fill: 'none',
                    stroke: 'var(--shadow-dark)', 'stroke-width': TRK,
                    'stroke-linecap': 'round', 'stroke-opacity': '0.38',
                    'pointer-events': 'none'
                }));

                const progEl = mk('path', {
                    d: fullArc, fill: 'none',
                    stroke: COLOR, 'stroke-width': TRK,
                    'stroke-linecap': 'round', 'pointer-events': 'none'
                });
                dialSvg.appendChild(progEl);

                const [itx, ity] = P(aFunc(initT), Rm);
                const thumbEl = mk('circle', {
                    cx: String(itx), cy: String(ity), r: '0.072',
                    fill: COLOR, stroke: 'var(--bg)', 'stroke-width': '0.024',
                    'pointer-events': 'none'
                });

                let totalLen = null;
                const setT = t => {
                    if (totalLen === null) totalLen = progEl.getTotalLength();
                    progEl.setAttribute('stroke-dasharray', `${t * totalLen} ${totalLen}`);
                    const [nx, ny] = P(aFunc(t), Rm);
                    thumbEl.setAttribute('cx', String(nx));
                    thumbEl.setAttribute('cy', String(ny));
                };
                requestAnimationFrame(() => setT(initT));
                return { setT, thumbEl };
            }

            // Taille : 8–96 px → t ∈ [0,1]  (10 steps)
            const tSz0 = Math.max(0, Math.min(1, (window.etatTexte.fontSize - 8) / 88));
            // Graisse : 100–900 → t ∈ [0,1]  (8 steps de 100)
            const tWt0 = Math.max(0, Math.min(1, (window.etatTexte.fontWeight - 100) / 800));

            const snapSz = makeSnapFn(10);
            const snapWt = makeSnapFn(8);
            const arcT   = makeArcSlider(1, aT, tSz0);
            const arcB   = makeArcSlider(0, aB, tWt0);

            // Ticks blancs sur chaque arc
            const rTick1 = Rm - 0.030, rTick2 = Rm + 0.030;
            for (let i = 0; i <= 10; i++) {
                const t   = i / 10;
                const sw2 = (i % 5 === 0) ? '0.016' : '0.009';
                [aT(t), aB(t)].forEach(angle => {
                    const [x1, y1] = P(angle, rTick1);
                    const [x2, y2] = P(angle, rTick2);
                    dialSvg.appendChild(mk('line', {
                        x1, y1, x2, y2,
                        stroke: 'var(--bg)', 'stroke-width': sw2,
                        'stroke-linecap': 'round', opacity: '0.90',
                        'pointer-events': 'none'
                    }));
                });
            }

            dialSvg.appendChild(arcT.thumbEl);
            dialSvg.appendChild(arcB.thumbEl);

            const hitT = mk('path', { d: halfPath(1), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
            const hitB = mk('path', { d: halfPath(0), fill: 'transparent', stroke: 'none', cursor: 'pointer', 'fill-rule': 'evenodd' });
            dialSvg.appendChild(hitT);
            dialSvg.appendChild(hitB);

            const evtRel = e => {
                const r = dialSvg.getBoundingClientRect();
                return { dx: e.clientX - r.left - r.width / 2, dy: e.clientY - r.top - r.height / 2 };
            };

            hitT.addEventListener('mousedown', e => { e.stopPropagation(); activeArc = 'T'; });
            hitB.addEventListener('mousedown', e => { e.stopPropagation(); activeArc = 'B'; });

            const onMove = e => {
                if (!activeArc) return;
                const { dx, dy } = evtRel(e);
                if (activeArc === 'T') {
                    const a   = Math.atan2(-Math.abs(dy), dx);
                    const raw = Math.max(0, Math.min(1, (a + Math.PI) / Math.PI));
                    const t   = snapSz(raw);
                    window.etatTexte.fontSize = Math.round(8 + t * 88);
                    arcT.setT(t);
                    showVal(window.etatTexte.fontSize, 'taille');
                } else {
                    const a   = Math.atan2( Math.abs(dy), dx);
                    const raw = Math.max(0, Math.min(1, (Math.PI - a) / Math.PI));
                    const t   = snapWt(raw);
                    window.etatTexte.fontWeight = Math.round(100 + t * 800);
                    arcB.setT(t);
                    showVal(window.etatTexte.fontWeight, 'graisse');
                }
            };
            const onUp = () => {
                if (!activeArc) return;
                activeArc = null;
                hideVal();
                if (!mouseOverRoue && !chromoDrag) scheduleClose();
            };
            addDoc('mousemove', onMove);
            addDoc('mouseup',   onUp);
        }

        // Démarrer avec le sélecteur de fonte
        buildFontPicker();

        const prevCleanup = panelCleanup;
        panelCleanup = () => {
            if (prevCleanup) prevCleanup();
            clearTimeout(leaveTimer);
            if (chromo) chromo.removeEventListener('mousedown', onChromoMouseDown);
            docListeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn));
            if (centreEl && valDiv.parentNode) valDiv.parentNode.removeChild(valDiv);
            const textCtrl = document.getElementById('roue-centre-textctrl');
            if (textCtrl) textCtrl.innerHTML = '';
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-texte');
            roueConteneur.classList.remove('mode-texte-sliders');
        };
    }

    // ── DIAL COLLABORATION ────────────────────────────────────────────────────
    function construireDialCollaboration() {
        const dialSvg = document.getElementById('roue-dial-svg');
        if (!dialSvg) return;

        window.etatCollaboration = window.etatCollaboration || { mode: 'question' };

        const Ro = 0.90, Ri = 0.38, Rm = (Ro + Ri) / 2;
        const ns = 'http://www.w3.org/2000/svg';

        const mk = (tag, attrs) => {
            const el = document.createElementNS(ns, tag);
            Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
            return el;
        };
        const P = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

        const secPath = (a0, a1) => {
            const [ox0, oy0] = P(a0, Ro), [ox1, oy1] = P(a1, Ro);
            const [ix0, iy0] = P(a0, Ri), [ix1, iy1] = P(a1, Ri);
            return `M ${ox0} ${oy0} A ${Ro} ${Ro} 0 0 1 ${ox1} ${oy1}` +
                   ` L ${ix1} ${iy1} A ${Ri} ${Ri} 0 0 0 ${ix0} ${iy0} Z`;
        };

        const OPTIONS = [
            { key: 'question',   label: 'Question'   },
            { key: 'sondage',    label: 'Sondage'    },
            { key: 'collaborer', label: 'Collaborer' },
        ];
        const aStep = 2 * Math.PI / OPTIONS.length;

        // ── Fermeture au survol ───────────────────────────────────────────────
        let mouseOverRoue = true;
        let leaveTimer = null;
        const scheduleClose = () => {
            clearTimeout(leaveTimer);
            leaveTimer = setTimeout(() => { if (!mouseOverRoue) doClose(); }, 120);
        };
        const onDocMouseMove = e => {
            const r = roueConteneur.getBoundingClientRect();
            const nowOver = e.clientX >= r.left && e.clientX <= r.right &&
                            e.clientY >= r.top  && e.clientY <= r.bottom;
            if (mouseOverRoue && !nowOver) { mouseOverRoue = false; scheduleClose(); }
            else if (!mouseOverRoue && nowOver) { mouseOverRoue = true; clearTimeout(leaveTimer); }
        };
        document.addEventListener('mousemove', onDocMouseMove);

        const doClose = () => {
            clearTimeout(leaveTimer);
            document.removeEventListener('mousemove', onDocMouseMove);
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-collaboration');
            segmentsEls.forEach(s  => s.classList.remove('actif'));
            iconesEls.forEach(ic   => ic.classList.remove('actif'));
            outilActifNum = null;
            if (fanPinned) { fanPinned = false; roueConteneur.classList.remove('epingle'); }
            _fanClose();
        };

        // ── Construction des secteurs ─────────────────────────────────────────
        function buildPicker() {
            dialSvg.innerHTML = '';
            OPTIONS.forEach((opt, i) => {
                const center  = -Math.PI / 2 + i * aStep;
                const a0      = center - aStep / 2;
                const a1      = center + aStep / 2;
                const isActif = window.etatCollaboration.mode === opt.key;
                const fg      = isActif ? 'white' : 'var(--bleu-mid)';

                const seg = mk('path', {
                    d: secPath(a0, a1),
                    fill: isActif ? 'var(--flamme)' : 'var(--bg)',
                    stroke: 'var(--shadow-dark)', 'stroke-width': '0.010',
                    cursor: 'pointer',
                });
                dialSvg.appendChild(seg);

                // Icône miniature
                const [tx, ty] = P(center, Rm);
                const iconG = mk('g', { transform: `translate(${tx},${ty - 0.065})`, 'pointer-events': 'none' });

                if (opt.key === 'question') {
                    // Bulle avec ?
                    iconG.appendChild(mk('circle', { cx: 0, cy: 0, r: '0.042', fill: 'none', stroke: fg, 'stroke-width': '0.015' }));
                    const q = mk('text', { x: 0, y: '0.014', 'text-anchor': 'middle', 'dominant-baseline': 'central',
                        'font-family': "'DM Sans',sans-serif", 'font-size': '0.050', fill: fg, 'font-weight': '700' });
                    q.textContent = '?';
                    iconG.appendChild(q);
                } else if (opt.key === 'sondage') {
                    // Histogramme 3 barres
                    [[-0.036, 0.018, 0.022], [0, -0.010, 0.050], [0.036, 0.006, 0.034]].forEach(([x, y, h]) => {
                        iconG.appendChild(mk('rect', { x: x - 0.012, y, width: '0.024', height: h,
                            fill: fg, rx: '0.006' }));
                    });
                } else {
                    // Deux cercles = collaborer
                    iconG.appendChild(mk('circle', { cx: '-0.024', cy: 0, r: '0.030', fill: 'none', stroke: fg, 'stroke-width': '0.015' }));
                    iconG.appendChild(mk('circle', { cx:  '0.024', cy: 0, r: '0.030', fill: 'none', stroke: fg, 'stroke-width': '0.015' }));
                }
                dialSvg.appendChild(iconG);

                // Label
                const txt = mk('text', {
                    x: tx, y: ty + 0.042,
                    'text-anchor': 'middle', 'dominant-baseline': 'central',
                    'font-family': "'DM Sans',sans-serif", 'font-size': '0.074',
                    fill: fg, 'pointer-events': 'none',
                });
                txt.textContent = opt.label;
                dialSvg.appendChild(txt);

                seg.addEventListener('mouseenter', () => {
                    if (window.etatCollaboration.mode !== opt.key) seg.setAttribute('fill', 'var(--shadow-light)');
                });
                seg.addEventListener('mouseleave', () => {
                    seg.setAttribute('fill', window.etatCollaboration.mode === opt.key ? 'var(--flamme)' : 'var(--bg)');
                });
                seg.addEventListener('click', e => {
                    e.stopPropagation();
                    window.etatCollaboration.mode = opt.key;
                    buildPicker();
                });
            });
        }

        buildPicker();

        const prevCleanup = panelCleanup;
        panelCleanup = () => {
            if (prevCleanup) prevCleanup();
            clearTimeout(leaveTimer);
            document.removeEventListener('mousemove', onDocMouseMove);
            dialSvg.innerHTML = '';
            roueConteneur.classList.remove('mode-collaboration');
        };
    }

    // ── PANEL FORMES ──────────────────────────────────────────────────────────
    function construirePanelFormes() {
    panelInner.innerHTML = '';

    const ligneFormes = document.createElement('div');
    // Hauteur fixe pour les boutons de forme : flex-shrink:0 empêche la compression
    // height:0 + flex:0 0 auto avec padding assure que les boutons carrés ont une hauteur = largeur
    // align-items:flex-start : la hauteur est déterminée par aspect-ratio (pas par stretch)
    ligneFormes.style.cssText = 'display:flex;gap:5px;flex:0 0 auto;align-items:flex-start;justify-content:space-between;padding:6px 8px 4px 8px;';
    const iconesFormes = {
        'rectangle': '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" fill="none" stroke-width="2"/>',
        'cercle':    '<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-width="2"/>',
        'triangle':  '<polygon points="12,4 20,18 4,18" stroke="currentColor" fill="none" stroke-width="2"/>',
        'losange':   '<polygon points="12,3 21,12 12,21 3,12" stroke="currentColor" fill="none" stroke-width="2"/>',
        'etoile':    '<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke="currentColor" fill="none" stroke-width="2"/>'
    };
    Object.keys(iconesFormes).forEach(forme => {
        const btn = document.createElement('button');
        const estActif = window.etatForme.type === forme;
        // flex:1 + aspect-ratio:1 = carré adaptatif (rétrécit si le panel est étroit)
        btn.style.cssText = `flex:1 1 0;min-width:0;aspect-ratio:1;border:none;border-radius:10px;background:var(--bg);color:var(--bleu-marine);cursor:pointer;display:flex;justify-content:center;align-items:center;transition:all 0.18s;box-shadow:${estActif ? 'var(--neu-inset)' : 'var(--neu-flat)'};`;
        btn.innerHTML = `<svg width="70%" height="70%" viewBox="0 0 24 24">${iconesFormes[forme]}</svg>`;
        btn.onclick = (e) => {
            e.stopPropagation();
            window.etatForme.type = forme;
            Array.from(ligneFormes.children).forEach(b => { b.style.boxShadow = 'var(--neu-flat)'; });
            btn.style.boxShadow = 'var(--neu-inset)';
        };
        ligneFormes.appendChild(btn);
    });

    const blocColor2 = document.createElement('div');
    blocColor2.style.cssText = 'flex:0 0 55px;border-radius:10px;position:relative;overflow:hidden;cursor:crosshair;margin:0 8px;border:3px solid var(--flamme);box-shadow:none;';
    blocColor2.style.background = `linear-gradient(to right, hsl(0,100%,50%) 0%, hsl(60,100%,50%) 13.3%, hsl(120,100%,50%) 26.6%, hsl(180,100%,50%) 40%, hsl(240,100%,50%) 53.3%, hsl(300,100%,50%) 66.6%, hsl(360,100%,50%) 80%, #000000 100%)`;

    const sel2 = document.createElement('div');
    sel2.style.cssText = 'position:absolute;width:26px;height:26px;border:3px solid white;border-radius:50%;box-shadow:none;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;';
    sel2.style.backgroundColor = window.etatForme.color;
    blocColor2.appendChild(sel2);

    let dragging2 = false;
    const moveSel2 = (e) => {
        const r = blocColor2.getBoundingClientRect();
        let x = Math.max(0, Math.min(e.clientX - r.left, r.width));
        gsap.to(sel2, { left: x, top: '50%', duration: 0.1 });
        const ratio = x / r.width;
        let hue, lightness;
        if (ratio <= 0.8) { hue = (ratio / 0.8) * 360; lightness = 50; }
        else { hue = 360; lightness = 50 - ((ratio - 0.8) / 0.2) * 50; }
        const color = `hsl(${hue}, 100%, ${lightness}%)`;
        sel2.style.backgroundColor = color; window.etatForme.color = color;
    };
    blocColor2.addEventListener('mousedown', (e) => { e.stopPropagation(); dragging2 = true; moveSel2(e); });
    const onMove2 = (e) => { if (dragging2) moveSel2(e); };
    const onUp2 = () => { dragging2 = false; };
    document.addEventListener('mousemove', onMove2);
    document.addEventListener('mouseup', onUp2);

    const ligneBas = document.createElement('div');
    ligneBas.style.cssText = 'display:flex;gap:8px;flex:0 0 auto;margin:0 8px 6px 8px;align-items:center;overflow:visible;';
    const blocEp2 = document.createElement('div');
    blocEp2.style.cssText = 'flex:1 1 0;min-width:0;overflow:visible;height:55px;background:var(--bg);border-radius:10px;box-shadow:var(--neu-inset);box-sizing:border-box;';
    const btnInvert = document.createElement('button');
    // Bouton in/outfill carré adaptatif
    btnInvert.style.cssText = 'flex:0 0 55px;width:55px;height:55px;background:var(--bg);border:none;border-radius:10px;cursor:pointer;display:flex;justify-content:center;align-items:center;transition:all 0.18s;box-shadow:var(--neu-flat);';
    const CYCLE_MODE = ['fill', 'stroke', 'both'];
    const MODE_ICONS = {
        fill:   `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="var(--bleu-marine)"/></svg>`,
        stroke: `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke="var(--bleu-marine)" fill="none" stroke-width="3"/></svg>`,
        both:   `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="var(--bleu-marine)" fill-opacity="0.40" stroke="var(--bleu-marine)" stroke-width="3"/></svg>`,
    };
    const majIconeInvert = () => {
        const m = window.etatForme.mode || 'fill';
        btnInvert.innerHTML = MODE_ICONS[m];
        btnInvert.style.boxShadow = m !== 'fill' ? 'var(--neu-inset)' : 'var(--neu-flat)';
    };
    majIconeInvert();
    btnInvert.onclick = (e) => {
        e.stopPropagation();
        const m = window.etatForme.mode || 'fill';
        window.etatForme.mode = CYCLE_MODE[(CYCLE_MODE.indexOf(m) + 1) % CYCLE_MODE.length];
        majIconeInvert();
    };
    ligneBas.appendChild(blocEp2);
    ligneBas.appendChild(btnInvert);

    panelInner.appendChild(ligneFormes);
    panelInner.appendChild(blocColor2);
    panelInner.appendChild(ligneBas);

    requestAnimationFrame(() => {
        creerGooeySlider(blocEp2, 'shape_ep', window.etatForme.thickness, (v) => { window.etatForme.thickness = v; });
    });

    panelCleanup = () => {
        document.removeEventListener('mousemove', onMove2);
        document.removeEventListener('mouseup', onUp2);
    };

    requestAnimationFrame(() => panel.classList.add('visible'));
}

    // ── GESTION ROUE : FERMETURE ──────────────────────────────────────────────
    function fermerRoue() {
        fermerPanel();
        centreLabel.textContent = '';
    }

    roueCentre.addEventListener('click', (e) => {
        e.stopPropagation();
        fanPinned = !fanPinned;
        roueConteneur.classList.toggle('epingle', fanPinned);
        if (fanPinned) {
            roueConteneur.classList.add('ouvert');
        } else {
            roueConteneur.classList.remove('ouvert');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') fermerRoue();
        // Flèches gauche/droite pour tourner la roue
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); tournerDUnCran(1); }
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); tournerDUnCran(-1); }
    });

    // ── ADAPTER L'ARRONDI DU CONTENEUR À LA ROUE ─────────────────────────────
function mettreAJourArrondi() {
    const roueSize = roueConteneur.offsetWidth;
    // On ajoute 5px pour compenser exactement l'épaisseur de la bordure
    const radius = (roueSize / 2) + 5; 
    document.documentElement.style.setProperty('--conteneur-bas-radius', radius + 'px');
}
    // Observer les changements de taille de la roue
    const resizeObserver = new ResizeObserver(() => mettreAJourArrondi());
    resizeObserver.observe(roueConteneur);
    window.addEventListener('resize', mettreAJourArrondi);
    mettreAJourArrondi();

    // ── INITIALISATION ────────────────────────────────────────────────────────
    centreLabel.textContent = ''; // roue en état neutre au chargement

    // ── DÉTECTER L'ÉCRASEMENT DU PANNEAU POUR AFFICHER LE TITRE ──
    const panelObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            // Si la hauteur de la zone devient trop petite (35px ou moins)
            if (entry.contentRect.height <= 35) {
                panelInner.classList.add('est-reduit');
            } else {
                panelInner.classList.remove('est-reduit');
            }
        }
    });
    
    // On demande à l'observateur de surveiller notre panneau d'outils
    panelObserver.observe(panelInner);

    // ── ROUE DRAGGABLE + SNAP AUX BORDS ─────────────────────────────────────
    (function () {
        const roueSC   = document.getElementById('roue-conteneur');
        const centreEl = document.getElementById('roue-centre');
        const parent   = roueSC.parentElement;          // main-wrapper (drag bounds)
        const canvas   = document.querySelector('.mon-conteneur');
        const SNAP_DIST   = 56;
        const SNAP_MARGIN = 16;
        // Le rayon visible est la moitié du disque complet
        const BIG_RADIUS  = 'calc(var(--roue-size) / 2 + 20px)';

        let ptrDown = false, dragStarted = false;
        let offX = 0, offY = 0, startX = 0, startY = 0;

        function setCornerRadius() { /* désactivé — l'utilisateur ne veut pas l'adaptation du coin */ }

        // État initial : roue en bas à gauche
        const iW = roueSC.offsetWidth, iH = roueSC.offsetHeight;
        const iMaxX = parent.offsetWidth - iW, iMaxY = parent.offsetHeight - iH;
        setCornerRadius(SNAP_MARGIN, iMaxY - SNAP_MARGIN, iMaxX, iMaxY);

        // Fonction commune de démarrage du drag
        function startDrag(e) {
            if (e.button !== 0) return;
            ptrDown = true; dragStarted = false;
            startX = e.clientX; startY = e.clientY;
            const rect = roueSC.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
        }

        // Drag depuis le centre (roue fermée ou ouverte)
        centreEl.addEventListener('mousedown', (e) => {
            startDrag(e);
            e.stopPropagation(); // empêche le bubbling vers roueSC
        });

        // Drag depuis n'importe où sur le disque quand ouvert
        roueSC.addEventListener('mousedown', (e) => {
            if (!roueSC.classList.contains('ouvert')) return;
            startDrag(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (!ptrDown) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            if (!dragStarted && dx * dx + dy * dy > 25) {
                dragStarted = true;
                const parentRect = parent.getBoundingClientRect();
                const rect = roueSC.getBoundingClientRect();
                roueSC.style.transition = 'none';
                canvas.style.transition = 'none';
                canvas.style.borderTopLeftRadius = '';
                canvas.style.borderTopRightRadius = '';
                canvas.style.borderBottomRightRadius = '';
                canvas.style.borderBottomLeftRadius = '';
                roueSC.style.bottom = 'auto';
                roueSC.style.right  = 'auto';
                roueSC.style.left   = (rect.left - parentRect.left) + 'px';
                roueSC.style.top    = (rect.top  - parentRect.top)  + 'px';
                document.body.style.cursor = 'grabbing';
            }
            if (!dragStarted) return;
            const parentRect = parent.getBoundingClientRect();
            const w = roueSC.offsetWidth, h = roueSC.offsetHeight;
            let x = e.clientX - parentRect.left - offX;
            let y = e.clientY - parentRect.top  - offY;
            x = Math.max(0, Math.min(parentRect.width  - w, x));
            y = Math.max(0, Math.min(parentRect.height - h, y));
            roueSC.style.left = x + 'px';
            roueSC.style.top  = y + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!ptrDown) return;
            ptrDown = false;
            document.body.style.cursor = '';
            if (!dragStarted) return;
            dragStarted = false;

            // Annuler le clic sur segment qui suit le mouseup après un drag
            document.addEventListener('click', (e) => { e.stopPropagation(); }, { capture: true, once: true });

            const parentRect = parent.getBoundingClientRect();
            const w = roueSC.offsetWidth, h = roueSC.offsetHeight;
            const maxX = parentRect.width  - w;
            const maxY = parentRect.height - h;
            let x = parseFloat(roueSC.style.left) || 0;
            let y = parseFloat(roueSC.style.top)  || 0;

            if (x < SNAP_DIST)        x = SNAP_MARGIN;
            if (x > maxX - SNAP_DIST) x = maxX - SNAP_MARGIN;
            if (y < SNAP_DIST)        y = SNAP_MARGIN;
            if (y > maxY - SNAP_DIST) y = maxY - SNAP_MARGIN;

            canvas.style.transition = '';
            roueSC.style.transition = 'left 0.25s cubic-bezier(0.34,1.56,0.64,1), top 0.25s cubic-bezier(0.34,1.56,0.64,1), transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
            roueSC.style.left = x + 'px';
            roueSC.style.top  = y + 'px';
            setCornerRadius(x, y, maxX, maxY);
            setTimeout(() => { roueSC.style.transition = ''; }, 350);
        });
    })();

    // ══════════════════════════════════════════════════════════════
    // SYSTÈME D'ARCHIVES — 4 NIVEAUX × MATIÈRES × SESSIONS
    // ══════════════════════════════════════════════════════════════

    const ARCHIVE_NIVEAUX = [
        { id: 'terminale', label: 'Terminale', matieres: [
            { id: 'daa',   nom: 'Design & Arts Appliqués', color: '#FF2D55' },
            { id: 'si',    nom: 'Sciences de l\'ingénieur', color: '#007AFF' },
            { id: 'maths', nom: 'Mathématiques',            color: '#FF9F0A' },
            { id: 'philo', nom: 'Philosophie',              color: '#BF5AF2' },
            { id: 'hda',   nom: 'Histoire des Arts',        color: '#30D158' },
            { id: 'go',    nom: 'Grand Oral',               color: '#FF453A' },
        ]},
        { id: 'premiere', label: 'Première', matieres: [
            { id: 'daa',   nom: 'Design & Arts Appliqués', color: '#FF2D55' },
            { id: 'pc',    nom: 'Physique-Chimie',          color: '#007AFF' },
            { id: 'maths', nom: 'Mathématiques',            color: '#FF9F0A' },
            { id: 'hda',   nom: 'Histoire des Arts',        color: '#30D158' },
            { id: 'si',    nom: 'Sciences de l\'ingénieur', color: '#BF5AF2' },
            { id: 'ang',   nom: 'Anglais',                  color: '#FFD60A' },
        ]},
        { id: 'seconde', label: 'Seconde', matieres: [
            { id: 'ap',    nom: 'Arts Plastiques',          color: '#FF2D55' },
            { id: 'pc',    nom: 'Physique-Chimie',          color: '#007AFF' },
            { id: 'maths', nom: 'Mathématiques',            color: '#FF9F0A' },
            { id: 'st',    nom: 'Sciences & Techno',        color: '#30D158' },
            { id: 'fr',    nom: 'Français',                 color: '#BF5AF2' },
            { id: 'hg',    nom: 'Histoire-Géographie',      color: '#64D2FF' },
        ]},
        { id: 'commun', label: 'Commun', matieres: [
            { id: 'eps',   nom: 'EPS',                      color: '#FF2D55' },
            { id: 'ang',   nom: 'Anglais',                  color: '#007AFF' },
            { id: 'esp',   nom: 'Espagnol',                 color: '#FF9F0A' },
            { id: 'emc',   nom: 'EMC',                      color: '#30D158' },
            { id: 'vie',   nom: 'Vie scolaire',             color: '#BF5AF2' },
            { id: 'doc',   nom: 'Documentation',            color: '#FFD60A' },
        ]},
    ];

    let archivesSessions = JSON.parse(localStorage.getItem('mory_archives') || '[]');
    function sauvegarderArchives() { localStorage.setItem('mory_archives', JSON.stringify(archivesSessions)); }

    // ── Export PNG ──────────────────────────────────────────────
    function exporterSessionPNG() {
        const mc = window.mainCanvas, dc = window.draftCanvas;
        if (!mc) return;
        const tmp = document.createElement('canvas');
        tmp.width = mc.width; tmp.height = mc.height;
        const ctx = tmp.getContext('2d');
        ctx.fillStyle = document.body.classList.contains('mode-sombre') ? '#1a2030' : '#dde3ec';
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(mc, 0, 0);
        if (dc) ctx.drawImage(dc, 0, 0);
        if (window.placedObjects) {
            window.placedObjects.forEach(obj => {
                if (!obj.el) return;
                ctx.save();
                ctx.translate(obj.x + obj.w/2, obj.y + obj.h/2);
                ctx.rotate((obj.rotation||0) * Math.PI / 180);
                ctx.drawImage(obj.el, -obj.w/2, -obj.h/2, obj.w, obj.h);
                ctx.restore();
            });
        }
        const d = new Date();
        const lien = document.createElement('a');
        lien.download = `tableau_du${d.toISOString().slice(0,10)}_${d.getHours()}h${String(d.getMinutes()).padStart(2,'0')}.png`;
        lien.href = tmp.toDataURL('image/png');
        lien.click();
    }

    // ── Auto-archiver si le canvas n'est pas vide ────────────────
    function estCanvasVide() {
        const mc = window.mainCanvas;
        if (!mc) return true;
        const data = mc.getContext('2d').getImageData(0, 0, Math.min(mc.width,400), Math.min(mc.height,300)).data;
        for (let i = 3; i < data.length; i += 16) { if (data[i] > 8) return false; }
        return true;
    }
    function autoArchiverSiNonVide() {
        if (estCanvasVide()) return;
        const last = archivesSessions[0];
        if (last && (Date.now() - last.id) < 5 * 60 * 1000) return; // éviter les doublons < 5 min
        const mc = window.mainCanvas;
        const tmp = document.createElement('canvas');
        tmp.width = mc.width; tmp.height = mc.height;
        const ctx = tmp.getContext('2d');
        ctx.fillStyle = document.body.classList.contains('mode-sombre') ? '#1a2030' : '#dde3ec';
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(mc, 0, 0);
        const mini = document.createElement('canvas');
        mini.width = 400; mini.height = 225;
        mini.getContext('2d').drawImage(tmp, 0, 0, 400, 225);
        const now = new Date();
        archivesSessions.unshift({
            id: Date.now(),
            date: now.toISOString(),
            label: `Cours du ${now.toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'})}`,
            vignette: mini.toDataURL('image/jpeg', 0.7),
            niveauId: null, matiereId: null,
        });
        sauvegarderArchives();
    }

    // ══════════════════════════════════════════════════════════════
    // INTERFACE ARCHIVES — machine à états 3 phases
    // ══════════════════════════════════════════════════════════════
    const archivesOverlay  = document.getElementById('archives-overlay');
    const archivesFermerBtn = document.getElementById('archives-fermer');
    const arcNav           = document.getElementById('arc-nav');
    const arcNavBack       = document.getElementById('arc-nav-back');
    const arcBreadcrumb    = document.getElementById('arc-nav-breadcrumb');
    const arcContenu       = document.getElementById('arc-contenu');

    let arcState   = 'home';
    let arcNiveau  = null;
    let arcMatiere = null;
    // ── Utilitaire : path SVG d'une tranche (donut) ─────────────
    function arcSlicePath(cx, cy, R, ri, a1, a2) {
        const [c1, s1, c2, s2] = [Math.cos(a1), Math.sin(a1), Math.cos(a2), Math.sin(a2)];
        const laf = (a2 - a1 > Math.PI) ? 1 : 0;
        return `M${cx+ri*c1} ${cy+ri*s1} L${cx+R*c1} ${cy+R*s1} A${R} ${R} 0 ${laf} 1 ${cx+R*c2} ${cy+R*s2} L${cx+ri*c2} ${cy+ri*s2} A${ri} ${ri} 0 ${laf} 0 ${cx+ri*c1} ${cy+ri*s1}Z`;
    }

    // ── Phase 1 : accueil 4 disques ──────────────────────────────
    function arcRenderHome() {
        arcState = 'home'; arcNiveau = null; arcMatiere = null;
        if (arcNav) arcNav.classList.remove('visible');

        const home = document.createElement('div');
        home.className = 'arc-home';
        home.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;width:100%;height:100%;align-items:center;justify-items:center;padding:20px 40px;box-sizing:border-box;';

        ARCHIVE_NIVEAUX.forEach((niveau, idx) => {
            const item = document.createElement('div');
            item.className = 'arc-disc-item';
            // SVG disque face-on (cercle), la 3D est portée par le CSS
            const uid = `disc-arc-${idx}`;
            item.innerHTML = `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" class="arc-disc-svg">
                <circle cx="150" cy="150" r="145" class="arc-disc-face" fill="var(--bg,#dde3ec)" stroke="var(--shadow-dark,#9aa6be)" stroke-width="2.5"/>
                <circle cx="150" cy="150" r="96" fill="none" stroke="var(--shadow-dark,#9aa6be)" stroke-width="0.8" opacity="0.18"/>
                <circle cx="150" cy="150" r="54" fill="none" stroke="var(--shadow-dark,#9aa6be)" stroke-width="0.8" opacity="0.18"/>
                <circle cx="150" cy="150" r="22" fill="none" stroke="var(--shadow-dark,#9aa6be)" stroke-width="2" opacity="0.35"/>
                <circle cx="150" cy="150" r="10" fill="var(--bg-site,var(--bg))"/>
                <!-- Texte en arc sur la courbe basse du disque -->
                <path id="${uid}" d="M 28,150 A 122,122 0 0,0 272,150" fill="none"/>
                <text fill="var(--text-color,#3d4a5c)" opacity="0.5" font-size="17"
                      font-family="'DM Serif Display',serif" letter-spacing="4">
                    <textPath href="#${uid}" startOffset="50%" text-anchor="middle">${niveau.label.toUpperCase()}</textPath>
                </text>
            </svg>`;
            item.addEventListener('click', () => arcTransitionToDisc(niveau));
            home.appendChild(item);
        });

        if (arcContenu) { arcContenu.innerHTML = ''; arcContenu.style.cssText = 'flex:1;position:relative;display:flex;align-items:stretch;justify-content:stretch;'; arcContenu.appendChild(home); }
        gsap.fromTo(home, { opacity:0 }, { opacity:1, duration:0.5, ease:'power2.out' });
    }

    // ── Phase 2 : disque sectionné (matières STD2A artistiques) ──
    // Proportions basées sur les heures du programme STD2A (sur 100h artistiques)
    const MATIERES_STD2A = {
        terminale: [
            { id:'daa',  nom:'Design & Arts Appliqués', color:'#FF2D55', pct:46 },
            { id:'proj', nom:'Projet en Design',        color:'#FF9F0A', pct:26 },
            { id:'atc',  nom:'Arts, Tech. & Civ.',      color:'#BF5AF2', pct:12 },
            { id:'rep',  nom:'Représentation',          color:'#007AFF', pct:10 },
            { id:'hda',  nom:'Histoire des Arts',       color:'#30D158', pct:6  },
        ],
        premiere: [
            { id:'daa',  nom:'Design & Arts Appliqués', color:'#FF2D55', pct:44 },
            { id:'crea', nom:'Création en design',      color:'#FF9F0A', pct:28 },
            { id:'atc',  nom:'Arts, Tech. & Civ.',      color:'#BF5AF2', pct:12 },
            { id:'rep',  nom:'Représentation',          color:'#007AFF', pct:10 },
            { id:'hda',  nom:'Histoire des Arts',       color:'#30D158', pct:6  },
        ],
        seconde: [
            { id:'ap',   nom:'Arts Plastiques',         color:'#FF2D55', pct:40 },
            { id:'daa',  nom:'Initiation au Design',    color:'#FF9F0A', pct:30 },
            { id:'atc',  nom:'Arts, Tech. & Civ.',      color:'#BF5AF2', pct:15 },
            { id:'atl',  nom:'Atelier créatif',         color:'#007AFF', pct:15 },
        ],
        commun: [
            { id:'ap',   nom:'Arts Plastiques',         color:'#FF2D55', pct:55 },
            { id:'hda',  nom:'Histoire des Arts',       color:'#30D158', pct:25 },
            { id:'atc',  nom:'Arts, Tech. & Civ.',      color:'#BF5AF2', pct:20 },
        ],
    };

    function arcTransitionToDisc(niveau) {
        arcState = 'disc'; arcNiveau = niveau;
        if (arcNav) arcNav.classList.add('visible');
        if (arcBreadcrumb) arcBreadcrumb.textContent = niveau.label;

        const matieres = MATIERES_STD2A[niveau.id] || [];
        const total = matieres.reduce((s, m) => s + m.pct, 0);
        const cx = 230, cy = 230, R = 210, ri = 55, S = 460;
        let angle = -Math.PI / 2; // démarre à midi

        let svg = `<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" style="width:min(460px,72vmin);height:min(460px,72vmin);">`;
        matieres.forEach((m) => {
            const sweep = (m.pct / total) * 2 * Math.PI;
            const a1 = angle, a2 = angle + sweep;
            const aMid = (a1 + a2) / 2;
            const lR = (R + ri) / 2 + 8;
            const lx = cx + lR * Math.cos(aMid);
            const ly = cy + lR * Math.sin(aMid);
            const d = arcSlicePath(cx, cy, R, ri, a1, a2);

            const mots = m.nom.split(' ');
            let lignes = [], cur = '';
            mots.forEach(mot => { if ((cur+mot).length > 13 && cur) { lignes.push(cur.trim()); cur=mot+' '; } else cur+=mot+' '; });
            if (cur.trim()) lignes.push(cur.trim());
            const tspans = lignes.map((l, j) => `<tspan x="${lx}" dy="${j===0 ? -(lignes.length-1)*7 : 15}">${l}</tspan>`).join('');

            svg += `<g class="arc-slice" data-matiere="${m.id}" style="cursor:pointer">
                <path d="${d}" fill="${m.color}" stroke="var(--bg,#dde3ec)" stroke-width="3"/>
                <text text-anchor="middle" dominant-baseline="middle" font-family="'DM Sans',sans-serif" font-size="11" font-weight="700" fill="white" pointer-events="none">
                    <tspan x="${lx}" y="${ly}">${tspans}</tspan>
                </text>
            </g>`;
            angle = a2;
        });
        svg += `<circle cx="${cx}" cy="${cy}" r="${ri}" fill="var(--bg,#dde3ec)" stroke="var(--bg,#dde3ec)" stroke-width="6"/>
                <circle cx="${cx}" cy="${cy}" r="${ri-8}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
            </svg>`;

        const view = document.createElement('div');
        view.className = 'arc-disc-view';
        view.innerHTML = svg;
        view.querySelectorAll('.arc-slice').forEach((el, i) => {
            el.querySelector('path').addEventListener('mouseenter', () => { el.querySelector('path').style.opacity='0.8'; });
            el.querySelector('path').addEventListener('mouseleave', () => { el.querySelector('path').style.opacity='1'; });
            el.addEventListener('click', () => arcTransitionToSemiCircle(niveau, matieres[i]));
        });

        if (arcContenu) { arcContenu.innerHTML = ''; arcContenu.style.cssText = 'flex:1;position:relative;display:flex;align-items:center;justify-content:center;'; arcContenu.appendChild(view); }
        gsap.fromTo(view, { opacity:0, scale:0.82 }, { opacity:1, scale:1, duration:0.45, ease:'back.out(1.5)' });
    }

    // ── Phase 3 : hémicycle + grille en quinconce ─────────────────
    function arcTransitionToSemiCircle(niveau, matiere) {
        arcState = 'semi'; arcNiveau = niveau; arcMatiere = matiere;
        if (arcBreadcrumb) arcBreadcrumb.textContent = `${niveau.label} · ${matiere.nom}`;

        let sessions = archivesSessions.filter(s => s.matiereId===matiere.id && s.niveauId===niveau.id);
        if (sessions.length === 0) sessions = archivesSessions.filter(s => !s.matiereId);

        // ── Wrapper avec clip-path hémicycle ──────────────────────
        const outer = document.createElement('div');
        outer.className = 'arc-semi-outer';

        const grid = document.createElement('div');
        grid.className = 'arc-semi-grid';

        const cardW = 224, cardH = 144, gap = 12;
        const rows = Math.ceil(window.innerHeight / (cardH + gap));
        const fullCols = Math.ceil(window.innerWidth / (cardW + gap)) + 1;

        // Panel gauche (tableau au clic) — hors du clip-path
        const panel = document.createElement('div');
        panel.className = 'arc-tableau-panel';
        const panelClose = document.createElement('button');
        panelClose.className = 'arc-tableau-panel-close';
        panelClose.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        panelClose.addEventListener('click', () => panel.classList.remove('ouvert'));
        panel.appendChild(panelClose);
        const panelImg = document.createElement('img');
        panelImg.alt = '';
        const panelMeta = document.createElement('div');
        panelMeta.className = 'arc-tableau-panel-meta';
        panel.appendChild(panelImg);
        panel.appendChild(panelMeta);

        // Génère les cartes session (quinconce)
        let sIdx = 0;
        for (let r = 0; r < rows; r++) {
            const row = document.createElement('div');
            row.className = 'arc-semi-row';
            const cols = fullCols - (r % 2);
            for (let c = 0; c < cols; c++) {
                const session = sessions.length > 0 ? sessions[sIdx % sessions.length] : null;
                sIdx++;

                const card = document.createElement('div');
                card.className = 'arc-session-card';
                card.style.setProperty('--session-color', matiere.color);

                // Vignette
                const thumb = document.createElement('div');
                thumb.className = 'arc-session-thumb';
                thumb.style.background = matiere.color + (session ? 'CC' : '33');
                if (session?.vignette) {
                    const img = document.createElement('img');
                    img.src = session.vignette; img.alt = '';
                    thumb.appendChild(img);
                }

                // Info hover : date + heure
                const info = document.createElement('div');
                info.className = 'arc-session-info';
                info.style.background = matiere.color + 'EE';
                if (session) {
                    const d = new Date(session.date);
                    const jour = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
                    const heure = `${d.getHours()}h${String(d.getMinutes()).padStart(2,'0')}`;
                    info.innerHTML = `<span class="arc-session-date-big" style="color:white">${jour}</span>
                                      <span class="arc-session-time-big" style="color:rgba(255,255,255,0.8)">${heure}</span>`;
                }

                card.appendChild(thumb);
                card.appendChild(info);

                // Clic : afficher dans le panel gauche
                if (session) {
                    card.addEventListener('click', () => {
                        panelImg.src = session.vignette || '';
                        panelImg.style.display = session.vignette ? '' : 'none';
                        const d = new Date(session.date);
                        panelMeta.innerHTML = `
                            <span class="arc-tableau-panel-date">${d.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})} · ${d.getHours()}h${String(d.getMinutes()).padStart(2,'0')}</span>
                            <span class="arc-tableau-panel-label">${session.label}</span>`;
                        panel.classList.add('ouvert');
                    });
                }

                row.appendChild(card);
            }
            grid.appendChild(row);
        }

        outer.appendChild(grid);
        if (arcContenu) {
            arcContenu.innerHTML = '';
            arcContenu.style.cssText = 'flex:1;position:relative;overflow:hidden;';
            arcContenu.appendChild(outer);
            arcContenu.appendChild(panel);
        }
        gsap.fromTo(outer, { opacity:0 }, { opacity:1, duration:0.5, ease:'power2.out' });
    }

    // ── Navigation retour ────────────────────────────────────────
    function arcRetour() {
        if (arcState === 'semi') { arcTransitionToDisc(arcNiveau); }
        else if (arcState === 'disc') { arcRenderHome(); }
    }
    if (arcNavBack) arcNavBack.addEventListener('click', arcRetour);

    // ── Ouvrir / fermer archives ─────────────────────────────────
    function ouvrirArchives() {
        autoArchiverSiNonVide();
        arcRenderHome();
        if (archivesOverlay) archivesOverlay.classList.add('visible');
    }
    function fermerArchives() {
        if (archivesOverlay) archivesOverlay.classList.remove('visible');
    }

    if (archivesFermerBtn) archivesFermerBtn.addEventListener('click', fermerArchives);
    if (archivesOverlay) archivesOverlay.addEventListener('click', e => { if (e.target === archivesOverlay) fermerArchives(); });

    // ── Carrousel de tableaux ─────────────────────────────────────────────
    function initCarrousel() {
        const carrousel     = document.getElementById('tableau-carrousel');
        const liste         = document.getElementById('tableau-liste');
        const btnNew        = document.getElementById('tableau-nouveau-btn');
        const btnArchive    = document.getElementById('btn-archive');
        const headerWrapper = document.querySelector('.header-wrapper');
        if (!carrousel || !liste || !btnArchive) return;


        // ── Largeur = largeur du header-wrapper ───────────────────────────────
        function syncWidth() {
            if (!headerWrapper) return;
            const rect = headerWrapper.getBoundingClientRect();
            // Carrousel aligné sur le bord gauche du logo (left: 28px = header left 12px + top-bar padding 16px)
            // → largeur = largeur du header - 16px pour garder le bord droit aligné
            if (rect.width > 0) carrousel.style.width = Math.max(0, rect.width - 16) + 'px';
        }
        window.addEventListener('resize', syncWidth);

        // ── IndexedDB ─────────────────────────────────────────────────────────
        const DB_NAME = 'mory_boards_db', DB_STORE = 'boards';
        let _db = null;
        const dbReady = new Promise(resolve => {
            // v2 : migration vers PNG (efface les anciennes données JPEG cassées)
            const req = indexedDB.open(DB_NAME, 2);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                // Supprimer l'ancien store (données JPEG invalides) puis recréer
                if (d.objectStoreNames.contains(DB_STORE)) d.deleteObjectStore(DB_STORE);
                d.createObjectStore(DB_STORE, { keyPath: 'id' });
            };
            req.onsuccess = e => { _db = e.target.result; resolve(_db); };
            req.onerror   = ()  => resolve(null);
        });
        async function dbGet(id) {
            const d = await dbReady; if (!d) return null;
            return new Promise(r => {
                const req = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
                req.onsuccess = () => r(req.result || null);
                req.onerror   = () => r(null);
            });
        }
        async function dbPut(rec) {
            const d = await dbReady; if (!d) return;
            return new Promise(r => {
                const tx = d.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(rec);
                tx.oncomplete = r; tx.onerror = r;
            });
        }
        async function dbGetAll() {
            const d = await dbReady; if (!d) return [];
            return new Promise(r => {
                const req = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
                req.onsuccess = () => r(req.result || []);
                req.onerror   = () => r([]);
            });
        }

        // ── LocalStorage — persistance de la liste et du compteur ───────────
        const LS_BOARD_LIST = 'mory_board_list';
        const LS_NEXT_ID    = 'mory_next_id';
        const LS_ACTIVE_ID  = 'mory_active_id';

        function _loadBoardList() {
            try {
                const raw = localStorage.getItem(LS_BOARD_LIST);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        // Garder uniquement les 5 plus récents
                        return parsed.slice(-5).map(b => ({ id: b.id, label: b.label, thumbnail: null }));
                    }
                }
            } catch (e) {}
            return Array.from({ length: 5 }, (_, i) => ({ id: i + 1, label: `Tableau ${i + 1}`, thumbnail: null }));
        }
        function saveBoardList() {
            localStorage.setItem(LS_BOARD_LIST, JSON.stringify(boards.map(b => ({ id: b.id, label: b.label }))));
            localStorage.setItem(LS_NEXT_ID, String(nextBoardId));
        }

        const boards      = _loadBoardList();
        let nextBoardId   = parseInt(localStorage.getItem(LS_NEXT_ID) || String(Math.max(...boards.map(b => b.id)) + 1));
        const _savedAct   = parseInt(localStorage.getItem(LS_ACTIVE_ID) || String(boards[boards.length - 1].id));
        let activeBoardId = boards.some(b => b.id === _savedAct) ? _savedAct : boards[boards.length - 1].id;
        let visualBoardId = activeBoardId; // board centré visuellement dans le carrousel
        let isSwitching   = false;

        // (la carte "Archives" a été supprimée — scroll vers le haut = ouverture archive)

        // ── Cache mémoire — fidelité parfaite, durée de la session ────────────
        // Clé : board id. Valeur : { imageData (ImageData brut), objs (array) }
        // Avantage : zéro conversion, zéro perte, instantané.
        const boardCache = {};

        // ── Canvas vierge — transparent (le fond CSS reste visible) ───────────
        function makeBlankState() {
            if (!window.getBoardState) return null;
            const cur = window.getBoardState();
            const w = cur?.imageData?.width || 2500, h = cur?.imageData?.height || 2500;
            // new ImageData(w, h) = tous pixels à (0,0,0,0) = transparent
            return { imageData: new ImageData(w, h), objs: [] };
        }

        // ── ImageData → PNG data URL (transparence préservée, pas de JPEG) ────
        function imageDataToPNG(imageData) {
            const c = document.createElement('canvas');
            c.width = imageData.width; c.height = imageData.height;
            c.getContext('2d').putImageData(imageData, 0, 0);
            return c.toDataURL('image/png');
        }

        // ── PNG data URL → ImageData (aux dimensions du canvas courant) ────────
        async function pngToImageData(dataURL) {
            const img = new Image(); img.src = dataURL;
            await new Promise(r => { img.onload = r; img.onerror = r; });
            const cur = window.getBoardState?.();
            const w = cur?.imageData?.width  || img.naturalWidth;
            const h = cur?.imageData?.height || img.naturalHeight;
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, w, h);         // garantir la transparence
            ctx.drawImage(img, 0, 0, w, h);    // mettre à l'échelle si besoin
            return ctx.getImageData(0, 0, w, h); // alpha intact
        }

        // ── Sauvegarder le tableau actif ──────────────────────────────────────
        async function captureActive() {
            if (!window.getBoardState || !window.generateThumbnail) return;
            const state = window.getBoardState();
            if (!state?.imageData) return;

            // 1. Cache mémoire : instantané, fidelité parfaite (ImageData brut)
            boardCache[activeBoardId] = { imageData: state.imageData, objs: state.objs };

            // 2. Thumbnail pour le carrousel
            const thumbnail = window.generateThumbnail();
            const b = boards.find(b => b.id === activeBoardId);
            if (b) b.thumbnail = thumbnail;

            // 3. IndexedDB en arrière-plan (PNG, non-bloquant)
            //    PNG = transparence préservée → les objets placés (z-index 3)
            //    restent visibles à travers le canvas à la restauration
            const canvasPNG = imageDataToPNG(state.imageData);
            dbPut({ id: activeBoardId, thumbnail, canvasPNG, objs: state.objs })
                .catch(() => {});
        }

        // ── Charger un tableau → canvas ───────────────────────────────────────
        async function openBoard(id) {
            if (!window.setBoardState) return;

            // 1. Cache mémoire d'abord (même session → instantané et parfait)
            if (boardCache[id]) {
                window.setBoardState(boardCache[id]);
                return;
            }

            // 2. IndexedDB (cross-session, après un rechargement de page)
            const data = await dbGet(id);
            if (!data?.canvasPNG && !data?.canvasDataURL) {
                // Jamais visité → tableau vierge transparent
                const bl = makeBlankState();
                if (bl) window.setBoardState(bl);
                return;
            }

            // canvasPNG = nouveau format (PNG, transparent)
            // canvasDataURL = ancien format (JPEG, opaque) — rétro-compatibilité
            const srcURL = data.canvasPNG || data.canvasDataURL;
            const imageData = await pngToImageData(srcURL);
            window.setBoardState({ imageData, objs: data.objs || [] });
        }

        // ── Charger les vignettes depuis IndexedDB ────────────────────────────
        async function loadThumbnails() {
            const all = await dbGetAll();
            all.forEach(r => {
                const b = boards.find(b => b.id === r.id);
                if (b && r.thumbnail) b.thumbnail = r.thumbnail;
            });
        }

        // ── Fermer ────────────────────────────────────────────────────────────
        let closeTimer = null;
        function fermer() {
            clearTimeout(closeTimer);
            carrousel.classList.remove('visible');
            btnArchive.classList.remove('actif');
        }

        // ── Position 3D ───────────────────────────────────────────────────────
        function positionCard(card, d) {
            const absD = Math.abs(d);
            if (absD === 0) {
                card.style.transform = 'none'; card.style.opacity = '1';
                card.style.zIndex = '50'; card.style.pointerEvents = 'auto';
                return;
            }
            const step    = Math.max(68, Math.round((liste.offsetHeight || 540) * 0.135));
            const scale   = Math.pow(0.88, absD);
            const ty      = d * step;
            const rx      = d * 7;
            const opacity = Math.max(0.70, 1 - absD * 0.08);
            card.style.transform     = `translateY(${ty}px) rotateX(${rx}deg) scale(${scale})`;
            card.style.opacity       = String(opacity);
            card.style.zIndex        = String(Math.max(1, 50 - Math.round(absD * 9)));
            card.style.pointerEvents = absD > 5 ? 'none' : 'auto';
        }

        // ── Rendu ─────────────────────────────────────────────────────────────
        function render() {
            liste.innerHTML = '';
            const centerIdx = boards.findIndex(b => b.id === visualBoardId);
            boards.forEach((board, i) => {
                const d    = i - centerIdx;
                const card = document.createElement('div');

                card.className  = 'tableau-carte' + (board.id === visualBoardId ? ' actif' : '');
                card.dataset.id = String(board.id);

                const thumb = document.createElement('div');
                thumb.className = 'tableau-thumb';
                if (board.thumbnail) {
                    thumb.style.backgroundImage    = `url(${board.thumbnail})`;
                    thumb.style.backgroundSize     = 'cover';
                    thumb.style.backgroundPosition = 'center';
                }
                card.appendChild(thumb);

                const meta = document.createElement('div');
                meta.className = 'tableau-meta';
                const nom = document.createElement('span');
                nom.className = 'tableau-nom'; nom.textContent = board.label;
                meta.appendChild(nom);

                if (board.id === activeBoardId) {
                    const badge = document.createElement('span');
                    badge.className = 'tableau-badge-actuel';
                    badge.textContent = 'en cours';
                    meta.appendChild(badge);
                }
                card.appendChild(meta);

                // Clic — charge ce tableau sur le canvas (async)
                card.addEventListener('click', async () => {
                    if (isSwitching) return;
                    isSwitching = true;
                    fermer();
                    await captureActive();
                    activeBoardId = board.id;
                    visualBoardId = board.id;
                    localStorage.setItem(LS_ACTIVE_ID, String(board.id));
                    await openBoard(board.id);
                    isSwitching = false;
                    render();
                });

                positionCard(card, d);
                liste.appendChild(card);
            });
        }

        // ── Ouverture ─────────────────────────────────────────────────────────
        async function open() {
            clearTimeout(closeTimer);
            syncWidth();
            visualBoardId = activeBoardId; // centrer sur le tableau actif
            carrousel.classList.add('visible');
            btnArchive.classList.add('actif');
            render(); // rendu immédiat avec vignettes en cache
            await loadThumbnails();
            captureActive().then(() => render()); // màj vignette courante en arrière-plan
        }
        function schedClose() { closeTimer = setTimeout(fermer, 280); }

        btnArchive.addEventListener('click', () => {
            if (carrousel.classList.contains('visible')) fermer();
            else open();
        });

        // ── Zone de hover ─────────────────────────────────────────────────────
        function isInZone(cx) { return cx <= Math.round(window.innerWidth / 3); }
        let zoneCloseTimer = null;
        document.addEventListener('mousemove', function(e) {
            if (!carrousel.classList.contains('visible')) return;
            if (e.movementX === 0 && e.movementY === 0) return;
            if (isInZone(e.clientX)) {
                clearTimeout(zoneCloseTimer);
            } else {
                clearTimeout(zoneCloseTimer);
                zoneCloseTimer = setTimeout(() => { if (!isInZone(e.clientX)) schedClose(); }, 80);
            }
        });
        document.addEventListener('wheel', () => {
            if (!carrousel.classList.contains('visible')) return;
            clearTimeout(zoneCloseTimer); clearTimeout(closeTimer);
        }, { passive: true });

        // ── Molette — défilement visuel uniquement (canvas inchangé) ─────────
        let scrollThrottle = false;
        function openArchiveOverlay() {
            fermer();
            const ov = document.getElementById('archive-overlay');
            if (ov) {
                ov.classList.add('ouvert');
                ov.setAttribute('aria-hidden', 'false');
                if (typeof window._arcLoadAndRender === 'function') window._arcLoadAndRender();
            }
        }
        carrousel.addEventListener('wheel', e => {
            e.preventDefault();
            if (scrollThrottle) return;
            const idx = boards.findIndex(b => b.id === visualBoardId);
            // Scroll vers le haut au premier tableau → déclenche l'archive
            if (e.deltaY < 0 && idx <= 0) {
                openArchiveOverlay();
                return;
            }
            const newIdx = Math.max(0, Math.min(boards.length - 1, idx + (e.deltaY > 0 ? 1 : -1)));
            if (newIdx !== idx) {
                visualBoardId = boards[newIdx].id;
                render();
                scrollThrottle = true;
                setTimeout(() => { scrollThrottle = false; }, 340);
            }
        }, { passive: false });

        // ── Swipe mobile dans le carrousel (plein-écran) ──────────────────────
        // Sur mobile le carrousel est fullscreen (z-index 900).
        // Glisser vers le bas → tableau précédent, vers le haut → suivant.
        // stopPropagation empêche initMobileTouch de démarrer le holdTimer / pan.
        {
            let swipeStartY  = 0;
            const SWIPE_SEUIL = 40; // px minimum pour valider le swipe

            carrousel.addEventListener('touchstart', (e) => {
                swipeStartY = e.touches[0].clientY;
                e.stopPropagation();
            }, { passive: true });

            carrousel.addEventListener('touchmove', (e) => {
                e.stopPropagation();
                if (!carrousel.classList.contains('visible')) return;
                if (scrollThrottle) return;
                const dy = e.touches[0].clientY - swipeStartY;
                if (Math.abs(dy) < SWIPE_SEUIL) return;

                // Réinitialiser l'origine pour permettre un swipe continu
                swipeStartY = e.touches[0].clientY;

                const idx    = boards.findIndex(b => b.id === visualBoardId);
                // dy < 0 = doigt monte → tableau suivant (vers le bas de la pile)
                // dy > 0 = doigt descend → tableau précédent (vers le haut de la pile)
                const newIdx = Math.max(0, Math.min(boards.length - 1, idx + (dy < 0 ? 1 : -1)));
                if (newIdx !== idx) {
                    visualBoardId = boards[newIdx].id;
                    render();
                    scrollThrottle = true;
                    setTimeout(() => { scrollThrottle = false; }, 340);
                }
            }, { passive: true });

            carrousel.addEventListener('touchend',   (e) => e.stopPropagation());
            carrousel.addEventListener('touchcancel',(e) => e.stopPropagation());
        }

        // ── Bouton + — nouveau tableau (fenêtre glissante de 10) ─────────────
        if (btnNew) {
            btnNew.addEventListener('click', async () => {
                if (isSwitching) return;
                isSwitching = true;
                fermer();
                await captureActive();              // sauvegarder le tableau actuel

                const newId    = nextBoardId++;
                const newBoard = { id: newId, label: `Tableau ${newId}`, thumbnail: null };
                if (boards.length >= 5) boards.shift(); // retirer le plus ancien de l'accès rapide
                boards.push(newBoard);              // toujours présent en IndexedDB (archive)
                saveBoardList();

                activeBoardId = newId;
                visualBoardId = newId;
                localStorage.setItem(LS_ACTIVE_ID, String(newId));
                const blank = makeBlankState();
                if (blank) window.setBoardState(blank);

                isSwitching = false;
                render();
            });
        }

        // ── Exposition : ouvrir un tableau depuis l'extérieur (archive) ──────────
        window._openBoardFromArchive = async function(id) {
            if (isSwitching) return;
            isSwitching = true;
            activeBoardId = id;
            visualBoardId = id;
            localStorage.setItem(LS_ACTIVE_ID, String(id));
            await openBoard(id);
            isSwitching = false;
            render();
        };

        // ── Init — charger les vignettes puis rendre ───────────────────────────
        loadThumbnails().then(render);
        setTimeout(() => captureActive(), 800); // sauvegarder l'état initial
    }
    initCarrousel();

    /* ══════════════════════════════════════════════════════════════════
       OVERLAY ARCHIVES — intégré dans le canvas
       ══════════════════════════════════════════════════════════════════ */
    (function initArchiveOverlay() {

        const overlay      = document.getElementById('archive-overlay');
        const closeBtn   = document.getElementById('arc-close-btn');
        const logoTopBar = document.getElementById('logo-top-bar');

        if (!overlay) return;

        // ── Ouvrir / fermer ──────────────────────────────────────────────
        function openArchive() {
            overlay.classList.add('ouvert');
            overlay.setAttribute('aria-hidden', 'false');
            arcLoadAndRender();
        }
        function closeArchive() {
            overlay.classList.remove('ouvert');
            overlay.setAttribute('aria-hidden', 'true');
        }

        // Logo (canvas) → archive complète  |  btn-archive → archive rapide (géré ailleurs)
        if (logoTopBar) logoTopBar.addEventListener('click', openArchive);
        // Bouton retour dans l'overlay → ferme
        if (closeBtn)   closeBtn.addEventListener('click', closeArchive);
        // Echap → ferme
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeArchive(); });


        // ── IndexedDB ────────────────────────────────────────────────────
        function arcOpenDB() {
            return new Promise((res, rej) => {
                const r = indexedDB.open('mory_boards_db', 2);
                r.onsuccess = () => res(r.result);
                r.onerror   = () => rej(r.error);
                r.onupgradeneeded = e => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('boards'))
                        db.createObjectStore('boards', { keyPath: 'id' });
                };
            });
        }
        async function arcLoadFromDB() {
            try {
                const db = await arcOpenDB();
                const tx = db.transaction('boards', 'readonly');
                const st = tx.objectStore('boards');
                return new Promise(res => {
                    const r = st.getAll();
                    r.onsuccess = () => res(r.result || []);
                    r.onerror   = () => res([]);
                });
            } catch(e) { return []; }
        }
        function arcLabelMap() {
            try {
                const list = JSON.parse(localStorage.getItem('mory_board_list') || '[]');
                const m = {};
                list.forEach(b => { m[b.id] = b.label || `Tableau ${b.id}`; });
                return m;
            } catch(e) { return {}; }
        }

        // ── État ─────────────────────────────────────────────────────────
        let arcAllBoards    = [];
        let arcDisplay      = [];
        let arcGroupBy      = null;   // null | 'classe' | 'matiere'
        let arcFilterClasse = null;   // null | classeId
        let arcFilterMat    = null;   // null | matiereId
        let arcSortDir      = 'recent'; // 'recent' | 'oldest'
        let arcSearchQ      = '';
        let arcLoaded       = false;
        let arcViewMode     = 'grid'; // 'grid' | 'cal'

        // ── Helpers date ─────────────────────────────────────────────────
        function arcNowStr() {
            const n = new Date();
            const M = ['jan.','fév.','mars','avr.','mai','juin',
                       'juil.','août','sept.','oct.','nov.','déc.'];
            return `${n.getDate()} ${M[n.getMonth()]} ${n.getFullYear()} · ${n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
        }

        // ── Rendu de la grille ────────────────────────────────────────────
        function arcRenderStrip() {
            const strip   = document.getElementById('arc-strip');
            const wrapper = document.getElementById('arc-strip-wrapper');
            if (!strip || !wrapper) return;

            // Nettoyage : ancien listener de scroll infini
            if (wrapper._arcLoopFn) {
                wrapper.removeEventListener('scroll', wrapper._arcLoopFn);
                wrapper._arcLoopFn = null;
            }
            strip.innerHTML = '';

            const n = arcDisplay.length;
            const emptyEl = document.getElementById('arc-empty');
            if (n === 0) { if (emptyEl) emptyEl.classList.add('show'); return; }
            if (emptyEl) emptyEl.classList.remove('show');
            if (n === 0) return;

            // ── Dimensions de la grille — ratio 3:2 fixe ──────────────────
            const GAP    = 6;
            const PAD    = 6;
            const vw     = wrapper.clientWidth  || window.innerWidth;
            const vh     = wrapper.clientHeight || window.innerHeight;
            const RATIO  = 3 / 2;               // largeur / hauteur — immuable
            const ROWS_VISIBLE = 3.8;           // ~4 rangées visibles à l'écran
            // Hauteur de carte déduite du viewport, puis largeur du ratio
            const CARD_H = Math.round((vh - PAD*2) / ROWS_VISIBLE);
            const CARD_W = Math.round(CARD_H * RATIO);
            // Colonnes : combien de CARD_W rentrent sur la largeur disponible ?
            const COLS   = Math.max(2, Math.floor((vw - PAD*2 + GAP) / (CARD_W + GAP)));

            strip.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
            strip.style.gridTemplateRows    = 'auto';
            strip.style.width = '100%';

            // ── Boucle infinie : 5 répétitions ────────────────────────────
            const REPS        = 5;
            const ROWS_PER_SET = Math.ceil(n / COLS);
            const SET_H        = ROWS_PER_SET * (CARD_H + GAP);
            const bothSpecific = arcFilterClasse && arcFilterMat;

            function makeCard(board) {
                const card = document.createElement('div');
                card.className = 'arc-card';
                card.style.height = CARD_H + 'px';
                card.style.background = 'var(--bg)';

                // Miniature en dessous (si disponible)
                const src = board.canvasPNG || board.thumbnail || null;
                if (src) {
                    const img = document.createElement('img');
                    img.className = 'arc-card-thumb';
                    img.alt = ''; img.decoding = 'async';
                    img.src = (typeof src === 'string') ? src : URL.createObjectURL(src);
                    card.appendChild(img);
                }

                // Couche couleur + date (disparaît au hover)
                const layer = document.createElement('div');
                layer.className = 'arc-card-color-layer';

                let color = null;
                if (!bothSpecific) {
                    if (arcGroupBy === 'classe') {
                        const cls = arcClasses?.find(c => c.id === board.classeId);
                        color = cls ? cls.color : null;
                    } else if (arcGroupBy === 'matiere') {
                        const mat = arcMatieres?.find(m => m.id === board.matiereId);
                        color = mat ? mat.color : null;
                    }
                }
                if (color) {
                    layer.style.background = color;
                } else {
                    layer.style.background = 'rgba(255,255,255,0.88)';
                    layer.classList.add('light');
                }

                // Date : heure en grand au centre, jour+mois en dessous, année bas-gauche
                const d = board.date ? new Date(board.date) : new Date();
                const MOIS_C = ['jan','fév','mars','avr','mai','juin',
                                'juil','août','sept','oct','nov','déc'];
                const hh  = String(d.getHours()).padStart(2,'0');
                const mm  = String(d.getMinutes()).padStart(2,'0');

                const dateMain = document.createElement('div');
                dateMain.className = 'arc-card-date-main';

                const hourEl = document.createElement('div');
                hourEl.className = 'arc-card-date-hour';
                hourEl.textContent = `${hh}h${mm}`;
                hourEl.style.fontSize = Math.max(10, Math.round(CARD_H * 0.22)) + 'px';

                const dayEl = document.createElement('div');
                dayEl.className = 'arc-card-date-day';
                dayEl.textContent = `${d.getDate()} ${MOIS_C[d.getMonth()]}`;
                dayEl.style.fontSize = Math.max(7, Math.round(CARD_H * 0.11)) + 'px';

                dateMain.appendChild(hourEl);
                dateMain.appendChild(dayEl);
                layer.appendChild(dateMain);

                const yearEl = document.createElement('div');
                yearEl.className = 'arc-card-date-year';
                yearEl.textContent = d.getFullYear();
                yearEl.style.fontSize = Math.max(6, Math.round(CARD_H * 0.075)) + 'px';
                layer.appendChild(yearEl);

                card.appendChild(layer);

                return card;
            }

            // Remplir le strip : REPS copies
            for (let r = 0; r < REPS; r++) {
                arcDisplay.forEach(board => strip.appendChild(makeCard(board)));
            }

            // Position initiale : 2e copie (laisse 1 copie au-dessus et 2 en dessous)
            requestAnimationFrame(() => {
                wrapper.scrollTop = SET_H * 2;
            });

            // Téléportation seamless quand on approche des bords
            const onLoop = () => {
                const st = wrapper.scrollTop;
                if (st < SET_H)           wrapper.scrollTop = st + SET_H * 2;
                else if (st > SET_H * 3)  wrapper.scrollTop = st - SET_H * 2;
            };
            wrapper.addEventListener('scroll', onLoop, { passive: true });
            wrapper._arcLoopFn = onLoop;
        }

        // ── Filtrage + tri ────────────────────────────────────────────────
        function arcApplySort() {
            let boards = [...arcAllBoards];

            // Recherche texte
            if (arcSearchQ) {
                const q = arcSearchQ.toLowerCase();
                boards = boards.filter(b => b.label.toLowerCase().includes(q));
            }
            // Filtre classe spécifique
            if (arcFilterClasse)  boards = boards.filter(b => b.classeId === arcFilterClasse);
            // Filtre matière spécifique
            if (arcFilterMat)     boards = boards.filter(b => b.matiereId === arcFilterMat);

            // Tri par date — timestamps explicites, ordre garanti
            const toTs = d => {
                if (!d)                 return 0;
                if (d instanceof Date)  return d.getTime();
                if (typeof d === 'number') return d;
                const t = new Date(d).getTime();
                return isNaN(t) ? 0 : t;
            };
            boards.sort((a, b) => {
                const da = toTs(a.date) || (a.id * 1000);
                const db = toTs(b.date) || (b.id * 1000);
                return arcSortDir === 'oldest' ? da - db : db - da;
            });

            arcDisplay = boards;
            if (arcViewMode === 'cal') arcRenderCal();
            else arcRenderStrip();
        }


        // ── Données classes / matières (persistées en localStorage) ──────────
        let arcClasses  = null;
        let arcMatieres = null;
        function arcLoadGroups() {
            arcClasses  = JSON.parse(localStorage.getItem('mory_arc_classes')  || 'null') || [
                { id:'terminale', label:'Terminale', color:'#a8c5da' },
                { id:'premiere',  label:'Première',  color:'#c5a8da' },
                { id:'seconde',   label:'Seconde',   color:'#dac5a8' },
            ];
            arcMatieres = JSON.parse(localStorage.getItem('mory_arc_matieres') || 'null') || [
                { id:'atc',  label:'Art techniques et civilisations',                    color:'#e8a87c' },
                { id:'daa',  label:'Design et arts appliqués',                           color:'#87c5a8' },
                { id:'amd',  label:'Analyse et méthodes en design',                      color:'#a8a8e8' },
                { id:'ccda', label:'Conception et création en design et arts appliqués', color:'#e8c87c' },
            ];
        }
        function arcSaveGroups() {
            localStorage.setItem('mory_arc_classes',  JSON.stringify(arcClasses));
            localStorage.setItem('mory_arc_matieres', JSON.stringify(arcMatieres));
        }

        // ── Mini roue chromatique ─────────────────────────────────────────────
        let arcChromoTarget = null; // { group, id, swatchEl }
        function arcDrawChromo(canvas) {
            const ctx = canvas.getContext('2d');
            const cx  = canvas.width / 2, cy = canvas.height / 2, r = cx - 2;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Cercle de couleurs (hue ring)
            for (let a = 0; a < 360; a++) {
                const rad0 = (a - 1) * Math.PI / 180;
                const rad1 = (a + 1) * Math.PI / 180;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.arc(cx, cy, r, rad0, rad1);
                ctx.closePath();
                const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                grad.addColorStop(0, `hsl(${a},0%,100%)`);
                grad.addColorStop(1, `hsl(${a},100%,50%)`);
                ctx.fillStyle = grad;
                ctx.fill();
            }
            // Cercle blanc central pour le picker
            ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
        }
        function arcChromoOpen(swatchEl, group, id) {
            const popup  = document.getElementById('arc-chromo-popup');
            const canvas = document.getElementById('arc-chromo-canvas');
            if (!popup || !canvas) return;
            arcChromoTarget = { group, id, swatchEl };
            arcDrawChromo(canvas);
            const r = swatchEl.getBoundingClientRect();
            popup.style.left = (r.left - 50) + 'px';
            popup.style.top  = (r.top  - 145) + 'px';
            popup.classList.add('open');
        }
        function arcChromoClose() {
            const popup = document.getElementById('arc-chromo-popup');
            if (popup) popup.classList.remove('open');
            arcChromoTarget = null;
        }
        function arcChromoPick(e) {
            if (!arcChromoTarget) return;
            const canvas = document.getElementById('arc-chromo-canvas');
            if (!canvas) return;
            const r  = canvas.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
            const dist  = Math.sqrt(dx*dx + dy*dy) / (r.width / 2);
            const sat   = Math.round(Math.min(100, dist * 100));
            const color = `hsl(${Math.round(angle)},${sat}%,55%)`;
            const { group, id, swatchEl } = arcChromoTarget;
            swatchEl.style.background = color;
            const arr = group === 'classe' ? arcClasses : arcMatieres;
            const item = arr.find(x => x.id === id);
            if (item) { item.color = color; arcSaveGroups(); }
        }

        // ── Helper : met à jour visuellement les sous-lignes actives ──────
        function arcSyncSubRows() {
            document.querySelectorAll('.arc-sub-row[data-arc-id]').forEach(row => {
                const grp = row.closest('.arc-ssub')?.id?.replace('arc-ssub-','');
                const id  = row.dataset.arcId;
                const isActive = (grp === 'classe'  && arcFilterClasse === id)
                              || (grp === 'matiere' && arcFilterMat     === id);
                row.classList.toggle('active', isActive);
            });
        }

        // ── Construction des sous-listes ──────────────────────────────────
        function arcBuildSubList(groupName) {
            const container = document.getElementById(`arc-ssub-${groupName}`);
            if (!container) return;
            container.innerHTML = '';
            const arr = groupName === 'classe' ? arcClasses : arcMatieres;
            arr.forEach(item => {
                const row = document.createElement('div');
                row.className = 'arc-sub-row'; row.dataset.arcId = item.id;

                const swatch = document.createElement('div');
                swatch.className = 'arc-swatch';
                swatch.style.background = item.color;
                swatch.title = 'Double-clic pour changer la couleur';

                const lbl = document.createElement('span');
                lbl.className = 'arc-sub-lbl';
                lbl.textContent = item.label;
                lbl.title = 'Double-clic pour renommer';

                // Clic → filtre spécifique (toggle)
                row.addEventListener('click', e => {
                    if (e.target === swatch) return;
                    if (groupName === 'classe') {
                        arcFilterClasse = arcFilterClasse === item.id ? null : item.id;
                    } else {
                        arcFilterMat = arcFilterMat === item.id ? null : item.id;
                    }
                    arcSyncSubRows();
                    arcApplySort();
                });

                // Couleur au double-clic sur le swatch
                swatch.addEventListener('dblclick', e => {
                    e.stopPropagation();
                    arcChromoOpen(swatch, groupName, item.id);
                });
                // Renommage au double-clic sur le label
                lbl.addEventListener('dblclick', e => {
                    e.stopPropagation();
                    lbl.contentEditable = 'true'; lbl.focus();
                    const sel = window.getSelection(), rng = document.createRange();
                    rng.selectNodeContents(lbl); sel.removeAllRanges(); sel.addRange(rng);
                });
                lbl.addEventListener('blur', () => {
                    lbl.contentEditable = 'false';
                    item.label = lbl.textContent.trim() || item.label;
                    lbl.textContent = item.label;
                    arcSaveGroups();
                });
                lbl.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); lbl.blur(); } });

                row.appendChild(swatch); row.appendChild(lbl);
                container.appendChild(row);
            });

            // Bouton "+" en bas de la sous-liste
            const addInline = document.createElement('button');
            addInline.className = 'arc-add-inline';
            addInline.textContent = '+';
            addInline.title = `Ajouter ${groupName === 'classe' ? 'une classe' : 'une matière'}`;
            addInline.addEventListener('click', e => {
                e.stopPropagation();
                const newItem = { id:'item_'+Date.now(), label: groupName==='classe'?'Nouvelle classe':'Nouvelle matière', color:'#b0c4d8' };
                (groupName==='classe' ? arcClasses : arcMatieres).push(newItem);
                arcSaveGroups();
                const sub = container;
                const hdrLabel = document.querySelector(`[data-arc-expand="${groupName}"]`);
                if (sub && !sub.classList.contains('open')) {
                    sub.classList.add('open');
                    if (hdrLabel) hdrLabel.classList.add('open');
                }
                arcBuildSubList(groupName);
                const rows = sub?.querySelectorAll('.arc-sub-row');
                const lastLbl = rows?.[rows.length-1]?.querySelector('.arc-sub-lbl');
                if (lastLbl) {
                    lastLbl.contentEditable = 'true'; lastLbl.focus();
                    const s = window.getSelection(), r = document.createRange();
                    r.selectNodeContents(lastLbl); s.removeAllRanges(); s.addRange(r);
                }
            });
            container.appendChild(addInline);
        }

        // ── Panneau de tri ─────────────────────────────────────────────────
        function arcInitSortPanel() {
            arcLoadGroups();

            // Recherche
            const searchBtn = document.getElementById('arc-search-btn');
            const searchInp = document.getElementById('arc-search-inp');
            if (searchBtn && searchInp) {
                searchBtn.addEventListener('click', () => {
                    searchInp.classList.toggle('open');
                    if (searchInp.classList.contains('open')) searchInp.focus();
                    else { searchInp.value=''; arcSearchQ=''; arcApplySort(); }
                });
                searchInp.addEventListener('input', e => { arcSearchQ=e.target.value.trim(); arcApplySort(); });
            }

            // Boutons de direction de tri (date)
            document.querySelectorAll('.arc-sitem[data-arc-sort]').forEach(el => {
                el.addEventListener('click', () => {
                    document.querySelectorAll('.arc-sitem[data-arc-sort]').forEach(x=>x.classList.remove('active'));
                    el.classList.add('active');
                    arcSortDir = el.dataset.arcSort === 'oldest' ? 'oldest' : 'recent';
                    // "Tout" : réinitialise les filtres et groupements
                    if (el.dataset.arcSort === 'all') {
                        arcGroupBy = null;
                        arcFilterClasse = null;
                        arcFilterMat = null;
                        ['classe','matiere'].forEach(g => {
                            document.getElementById(`arc-ssub-${g}`)?.classList.remove('open');
                            document.querySelector(`[data-arc-expand="${g}"]`)?.classList.remove('open');
                        });
                        arcSyncSubRows();
                    }
                    arcApplySort();
                });
            });

            // Têtes de groupe classe / matière (mutuellement exclusives)
            ['classe','matiere'].forEach(grp => {
                const hdrLabel = document.querySelector(`[data-arc-expand="${grp}"]`);
                const sub      = document.getElementById(`arc-ssub-${grp}`);
                const other    = grp === 'classe' ? 'matiere' : 'classe';
                const otherHdr = document.querySelector(`[data-arc-expand="${other}"]`);
                const otherSub = document.getElementById(`arc-ssub-${other}`);

                if (hdrLabel && sub) {
                    hdrLabel.addEventListener('click', () => {
                        const wasActive = arcGroupBy === grp;
                        // Toggle group : si on ré-active le même → désactiver
                        arcGroupBy = wasActive ? null : grp;
                        // Si on active ce groupe → fermer et réinitialiser l'autre
                        if (!wasActive) {
                            arcFilterClasse = null; arcFilterMat = null;
                            if (otherSub)  { otherSub.classList.remove('open'); }
                            if (otherHdr)  { otherHdr.classList.remove('open'); }
                            sub.classList.add('open');
                            hdrLabel.classList.add('open');
                        } else {
                            sub.classList.remove('open');
                            hdrLabel.classList.remove('open');
                        }
                        arcSyncSubRows();
                        arcApplySort();
                    });
                }
                arcBuildSubList(grp);
            });

            // Roue chromatique : clic extérieur = ferme
            document.addEventListener('click', e => {
                const popup = document.getElementById('arc-chromo-popup');
                if (popup && popup.classList.contains('open') && !popup.contains(e.target)) arcChromoClose();
            });
            const canvas = document.getElementById('arc-chromo-canvas');
            if (canvas) {
                let chromoPicking = false;
                canvas.addEventListener('mousedown', e => { e.stopPropagation(); chromoPicking=true; arcChromoPick(e); });
                canvas.addEventListener('mousemove', e => { if(chromoPicking) arcChromoPick(e); });
                document.addEventListener('mouseup', () => { if(chromoPicking){ chromoPicking=false; arcChromoClose(); } });
            }

            // ── Panel draggable ────────────────────────────────────────────
            const panel  = document.getElementById('arc-sort-panel');
            const handle = document.getElementById('arc-panel-handle');
            if (panel && handle) {
                // Position initiale : bas-droite
                const initPos = () => {
                    const r = panel.getBoundingClientRect();
                    panel.style.left   = (window.innerWidth  - r.width  - 14) + 'px';
                    panel.style.top    = (window.innerHeight - r.height - 24) + 'px';
                    panel.style.bottom = 'auto';
                    panel.style.right  = 'auto';
                };
                requestAnimationFrame(initPos);

                // Recadrer le panel si la fenêtre rétrécit
                const clampPanel = () => {
                    const l = parseFloat(panel.style.left) || 0;
                    const t = parseFloat(panel.style.top)  || 0;
                    panel.style.left = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  l)) + 'px';
                    panel.style.top  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, t)) + 'px';
                };
                window.addEventListener('resize', clampPanel);

                let dragging = false, ox = 0, oy = 0;
                handle.addEventListener('mousedown', e => {
                    dragging = true;
                    const r = panel.getBoundingClientRect();
                    ox = e.clientX - r.left;
                    oy = e.clientY - r.top;
                    handle.style.cursor = 'grabbing';
                    e.preventDefault();
                });
                document.addEventListener('mousemove', e => {
                    if (!dragging) return;
                    panel.style.left = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  e.clientX - ox)) + 'px';
                    panel.style.top  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - oy)) + 'px';
                });
                document.addEventListener('mouseup', () => {
                    dragging = false;
                    handle.style.cursor = 'grab';
                });
            }

            // ── Redimensionnement → recalcule la grille ────────────────────
            const wrapper = document.getElementById('arc-strip-wrapper');
            if (wrapper && typeof ResizeObserver !== 'undefined') {
                const ro = new ResizeObserver(() => {
                    if (overlay.classList.contains('ouvert')) {
                        if (arcViewMode === 'cal') arcRenderCal();
                        else arcRenderStrip();
                    }
                });
                ro.observe(wrapper);
            }
        }

        // ── Chargement + rendu ────────────────────────────────────────────
        async function arcLoadAndRender() {
            if (!arcLoaded) {
                const labels   = arcLabelMap();
                const dbBoards = await arcLoadFromDB();
                arcAllBoards   = dbBoards.map(b => ({
                    ...b, label: labels[b.id] || b.label || `Tableau ${b.id}`
                }));
                // Fallback localStorage
                if (arcAllBoards.length === 0) {
                    try {
                        const list = JSON.parse(localStorage.getItem('mory_board_list')||'[]');
                        arcAllBoards = list.map(b=>({id:b.id,label:b.label||`Tableau ${b.id}`,thumbnail:b.thumbnail||null,canvasPNG:null}));
                    } catch(e) {}
                }
                // Démo : compléter jusqu'à 80 tableaux avec attributs
                { const DEMO_CLS = ['terminale','premiere','seconde'];
                  const DEMO_MAT = ['atc','daa','amd','ccda'];
                  const used = new Set(arcAllBoards.map(b=>b.id));
                  // Heures-types d'une journée scolaire (11 possibilités)
                  // Boards dans la semaine courante (lun=0..ven=4, heures 9-18)
                  const CAL_HOURS = [9,10,11,12,13,14,15,16,17,18];
                  const WEEK_SLOTS = [
                      [0,11],[1,10],[2,9],[3,12],[4,14],
                      [0,13],[2,16],[1,15],[4,18],[3,9],
                      [0,16],[4,11],[2,13],[3,15],[1,18],
                  ];
                  const weekStart = new Date();
                  const _dow = weekStart.getDay();
                  weekStart.setDate(weekStart.getDate() + (_dow===0 ? -6 : 1-_dow));
                  weekStart.setHours(0,0,0,0);
                  let wId = 1000;
                  WEEK_SLOTS.forEach(([di,h], si) => {
                      const d = new Date(weekStart);
                      d.setDate(d.getDate() + di);
                      d.setHours(h, 0, 0, 0);
                      if(!used.has(wId)) {
                          arcAllBoards.push({
                              id: wId, label:`Cours ${wId}`,
                              thumbnail: null, canvasPNG: null,
                              date: d,
                              classeId:  DEMO_CLS[si % 3],
                              matiereId: DEMO_MAT[si % 4],
                          });
                          used.add(wId);
                      }
                      wId++;
                  });
                  // Boards historiques (3 jours d'écart)
                  const DEMO_HOURS = [9,10,14,15,17,11,16,13];
                  const DEMO_MINS  = [0,30,0,30,0,0,0,30];
                  for(let i=1; arcAllBoards.length<80; i++){
                      if(!used.has(i)){
                          const demoDate = new Date(Date.now() - i * 3 * 86400000);
                          const hIdx = (i - 1) % DEMO_HOURS.length;
                          demoDate.setHours(DEMO_HOURS[hIdx], DEMO_MINS[hIdx], 0, 0);
                          arcAllBoards.push({
                              id: i, label:`Tableau ${i}`,
                              thumbnail: null, canvasPNG: null,
                              date: demoDate,
                              classeId:  DEMO_CLS[(i-1) % 3],
                              matiereId: DEMO_MAT[(i-1) % 4],
                          });
                          used.add(i);
                      }
                  }
                  // S'assurer que les tableaux chargés depuis DB ont aussi des attributs par défaut
                  arcAllBoards.forEach((b,idx) => {
                      if(!b.date)      b.date      = new Date(Date.now() - idx * 86400000 * 4);
                      if(!b.classeId)  b.classeId  = DEMO_CLS[idx % 3];
                      if(!b.matiereId) b.matiereId = DEMO_MAT[idx % 4];
                  });
                }
                arcLoaded = true;
            }
            arcApplySort();

            // (hint de scroll supprimé — grille fixe)
        }

        // ── Exposition pour le carrousel ──────────────────────────────────
        window._arcLoadAndRender = arcLoadAndRender;
        window._arcSetViewMode   = arcSetViewMode;

        // ══════════════════════════════════════════════════════════════════
        // MODE CALENDRIER
        // ══════════════════════════════════════════════════════════════════

        // ── Basculement de vue ────────────────────────────────────────────
        function arcSetViewMode(mode) {
            arcViewMode = mode;
            const calView   = document.getElementById('arc-cal-view');
            const stripWrap = document.getElementById('arc-strip-wrapper');
            const sortPanel = document.getElementById('arc-sort-panel');
            const btnGrid   = document.getElementById('arc-btn-grid');
            const btnCal    = document.getElementById('arc-btn-cal');

            if (mode === 'cal') {
                if (calView)   calView.classList.add('active');
                if (stripWrap) stripWrap.style.display = 'none';
                if (sortPanel) sortPanel.style.display = 'none';
                if (btnGrid)   btnGrid.classList.remove('arc-view-active');
                if (btnCal)    btnCal.classList.add('arc-view-active');
                arcRenderCal();
            } else {
                if (calView)   calView.classList.remove('active');
                if (stripWrap) stripWrap.style.display = '';
                if (sortPanel) sortPanel.style.display = '';
                if (btnGrid)   btnGrid.classList.add('arc-view-active');
                if (btnCal)    btnCal.classList.remove('arc-view-active');
                arcRenderStrip();
            }
        }

        // ── RECAPS (20 séances, ~90 mots chacun, backticks) ──────────────
        const RECAPS = [
`Introduction au vocabulaire du design graphique. Exploration des notions fondamentales : composition, typographie, couleur et mise en page. Les étudiants ont analysé des affiches emblématiques du XXe siècle pour identifier les principes directeurs à l'œuvre. Exercice pratique de décomposition visuelle. Discussion collective sur les intentions de l'auteur et la réception du public. Premières tentatives de mise en page sur papier. Bonne participation générale, quelques difficultés avec la notion d'espace négatif qui sera reprise prochainement.`,
`Séance consacrée à la typographie de base. Présentation de la classification des caractères : empattements, linéales, scriptes. Étude des critères de lisibilité et de la notion de corps de texte. Exercice de comparaison entre plusieurs fontes sur un même corpus. Les étudiants ont commencé à construire un lexique personnel. Attention portée à la distinction entre fonte et famille typographique. Difficultés récurrentes sur l'interlignage et le crénage, notions qui seront approfondies lors d'une prochaine séance de mise en pratique.`,
`Atelier couleur : introduction au cercle chromatique et aux systèmes de couleur (RVB, CMJN, Pantone). Exercices de création d'harmonies chromatiques à partir d'une couleur primaire. Travail sur la perception du contraste simultané. Analyse de palettes de marques emblématiques. Discussion sur les codes culturels associés aux couleurs selon les contextes géographiques. Les étudiants ont rendu des planches de recherche couleur. Résultats encourageants même si certains peinent encore à justifier leurs choix de façon rigoureuse.`,
`Cours d'histoire du design : des arts and crafts au Bauhaus. Présentation des figures fondatrices et des manifestes. Analyse de productions emblématiques de chaque mouvement. Discussion sur les liens entre industrie, art et société. Projection d'un documentaire court sur les ateliers du Bauhaus à Dessau. Les étudiants ont été invités à prendre des notes et à formuler une question de recherche personnelle pour le dossier de fin de semestre. Bonne ambiance, curiosité forte autour du mouvement Art déco.`,
`Séance pratique sur la composition : règle des tiers, proportions dorées, grilles de mise en page. Exercices de reconstitution de compositions à partir d'une grille donnée. Travail collectif au tableau pour déconstruire une affiche de référence. Les étudiants ont ensuite produit trois variantes de composition pour un même contenu. Discussion sur l'équilibre entre règle et liberté créative. Retours individuels sur les productions. Certains travaux montrent déjà une vraie maîtrise du rythme visuel.`,
`Introduction aux logiciels de création graphique. Prise en main d'Illustrator et d'InDesign pour les profils débutants. Présentation de l'interface, des outils de base et de la logique vectorielle. Exercice de reproduction d'un pictogramme simple. Pour les plus avancés, approfondissement sur les styles de caractères et les feuilles de styles de paragraphe. Difficultés techniques à prévoir sur les prochaines séances. Les étudiants sont encouragés à pratiquer en autonomie sur les postes de la médiathèque.`,
`Analyse sémiotique de l'image. Introduction aux concepts de dénotation et connotation. Étude d'une série d'affiches publicitaires contemporaines. Les étudiants ont travaillé par groupes pour décoder les signes visuels, les métaphores et les sous-entendus culturels. Restitution en classe très riche. Discussion sur les limites de l'interprétation et la part du contexte dans la lecture d'une image. Travail à poursuivre avec l'analyse d'une campagne visuelle complète pour la prochaine séance.`,
`Séance dédiée au branding : identité visuelle, charte graphique et logotype. Étude de cas de rebranding (Airbnb, Mastercard, Burberry). Analyse des composantes d'une charte graphique : typographie, couleurs, système d'icônes. Exercice de création d'une identité simplifiée pour une enseigne fictive. Les étudiants ont rendu de premières ébauches prometteuses. Discussion sur la cohérence systémique et la déclinaison sur supports. Prochain cours : présentation des projets sous forme de pitch devant la classe.`,
`Cours théorique sur le design éditorial : histoire du livre, mise en page de presse, publication numérique. Étude comparative d'une double page de magazine imprimé et de son équivalent digital. Discussion sur l'adaptation du contenu aux contraintes du support. Exercice de maquettage d'une page de magazine fictif avec contraintes données : nombre de colonnes, hiérarchie de l'information. Bonne compréhension générale, même si la maîtrise des grilles reste inégale selon les profils.`,
`Atelier de lettering à la main. Exploration des bases de la calligraphie latine moderne et du lettering illustré. Outils : feutres brush, stylets, crayons à pointe variable. Exercice d'écriture d'un même mot avec trois styles différents. Discussion sur les usages du lettering dans la communication contemporaine. Les étudiants ont produit des planches de recherche très variées. Quelques talents insoupçonnés se révèlent. Cet atelier vise à renforcer la sensibilité à la forme des lettres, indépendamment du logiciel.`,
`Présentation des projets de branding fictifs. Chaque groupe a pitché son identité visuelle devant la classe. Grille d'évaluation axée sur la cohérence, la lisibilité, l'originalité et la justification des choix. Retours collectifs et individuels. Belle diversité d'approches. Points de vigilance soulevés : certains logos manquent de polyvalence sur fond sombre. Prochaine étape : déclinaison sur supports variés (carte de visite, packaging, signalétique) pour les projets les plus aboutis.`,
`Introduction au design numérique : interfaces, expérience utilisateur, wireframes. Présentation des principes d'ergonomie et d'accessibilité. Exercice de critique d'une interface existante selon une grille heuristique. Premiers prototypes papier d'une application fictive. Discussion sur les enjeux du design centré utilisateur. Les étudiants ont été surpris par la richesse du domaine. Liens établis avec les cours de graphisme : la lisibilité, la hiérarchie et la couleur restent centraux même à l'écran.`,
`Séance image et photographie en design. Critères de sélection et de recadrage. Exercices de composition photographique avec les smartphones. Retouche légère sous Photoshop : niveaux, contraste, recadrage. Utilisation de banques d'images libres de droits. Discussion sur les droits d'auteur et le droit à l'image. Travail sur la cohérence entre image et texte dans une mise en page. Les étudiants ont produit une page de présentation d'un artiste fictif avec portrait et biographie.`,
`Cours sur la chaîne graphique et l'impression. Présentation des procédés principaux : offset, numérique, sérigraphie, risographie. Visite virtuelle d'un atelier d'impression artisanale. Notions de fond perdu, traits de coupe, repères de couleur. Exercice de préparation d'un fichier à l'impression. Discussion sur les spécificités du papier et les grammages. Vif intérêt pour la sérigraphie et la risographie. Projet en cours : réaliser une affiche destinée à l'impression réelle.`,
`Atelier affiche : synthèse des acquis du semestre. Les étudiants travaillent sur une affiche culturelle pour un événement fictif. Contraintes : format A2, typographie lisible à distance, palette restreinte à trois couleurs, hiérarchie de l'information. Accompagnement individualisé. Les premières compositions montrent un beau niveau de maîtrise. Points forts : gestion des espaces blancs et audace typographique. Points à renforcer : justification des choix chromatiques et lisibilité à grande distance.`,
`Retour sur les notions de motion design et d'animation graphique. Présentation de travaux d'agences spécialisées. Introduction à After Effects pour les plus avancés. Exercice d'animation d'un pictogramme : entrée, transformation, sortie. Discussion sur le rythme, le timing et l'easing. Visionnage de génériques de films emblématiques (Saul Bass, Kyle Cooper). Réflexion sur la temporalité comme dimension supplémentaire du design graphique. Prochain atelier : animation d'un logotype.`,
`Présentation des affiches du semestre. Accrochage dans la salle pour une lecture à distance. Chaque étudiant présente son affiche, expose ses intentions et répond aux questions du groupe. Retours entre pairs encouragés. Points forts collectifs : diversité des approches, bonne maîtrise typographique. Points à travailler : hiérarchie et lisibilité à grande distance. Les productions sont photographiées pour le book de fin d'année.`,
`Séance de recherche documentaire et construction du dossier de recherche. Méthodologie : sources fiables, bibliographie, structuration de l'argumentaire. Les étudiants ont travaillé sur leurs sujets individuels autour du design contemporain. Accompagnement personnalisé sur la problématique et le plan. Discussion sur les approches possibles : historique, comparatiste, critique. Échanges très riches. Rendu intermédiaire prévu à la prochaine séance.`,
`Atelier typo expérimentale : dépasser les conventions. Exploration de la typographie comme forme visuelle pure, indépendamment de sa lisibilité. Exercices inspirés de Wolfgang Weingart. Les étudiants ont manipulé du texte en Illustrator pour créer des compositions visuelles abstraites. Discussion sur la frontière entre typographie et image. Travail très libérateur selon les retours des étudiants. Les productions seront exposées dans le couloir de l'établissement.`,
`Séance de bilan et d'évaluation du semestre. Présentations orales des dossiers de recherche. Grille d'évaluation axée sur la rigueur de la démarche, la qualité de l'argumentation et la clarté de l'exposé. Retours individuels positifs et constructifs. Bilan général très satisfaisant : le groupe a montré une vraie progression en culture visuelle, en autonomie créative et en rigueur méthodologique. Perspectives pour le second semestre : approfondissement en design éditorial et en design d'identité.`
        ];

        // ── Couleur de la matière d'un board ─────────────────────────────
        function boardColor(board) {
            if (!board || !board.matiereId || !arcMatieres) return null;
            const m = arcMatieres.find(x => x.id === board.matiereId);
            return (m && m.color) ? m.color : null;
        }

        // ── Rendu complet de la vue calendrier ───────────────────────────
        function arcRenderCal() {
            const calView = document.getElementById('arc-cal-view');
            if (!calView) return;
            calView.innerHTML = '';

            // ── Panneau info (gauche) ─────────────────────────────────
            const infoPanel = document.createElement('div');
            infoPanel.className = 'arc-cal-info-panel';

            // Boîte date + heure
            const hdr = document.createElement('div');
            hdr.className = 'arc-cal-info-hdr';

            const dateBig = document.createElement('div');
            dateBig.className = 'arc-cal-info-date-big';
            dateBig.textContent = '—';

            const timeBox = document.createElement('div');
            timeBox.className = 'arc-cal-info-time-box';
            const timeEl = document.createElement('div');
            timeEl.className = 'arc-cal-info-time';
            timeEl.textContent = '—';
            const yearEl = document.createElement('div');
            yearEl.className = 'arc-cal-info-year';
            yearEl.textContent = '—';
            timeBox.appendChild(timeEl);
            timeBox.appendChild(yearEl);

            hdr.appendChild(dateBig);
            hdr.appendChild(timeBox);
            infoPanel.appendChild(hdr);

            // Récap
            const recap = document.createElement('div');
            recap.className = 'arc-cal-info-recap';
            infoPanel.appendChild(recap);

            // Aperçu 16/9
            const preview = document.createElement('div');
            preview.className = 'arc-cal-info-preview';
            infoPanel.appendChild(preview);

            // Barre bas : matière | classe | +
            const bottom = document.createElement('div');
            bottom.className = 'arc-cal-info-bottom';

            const matTag = document.createElement('div');
            matTag.className = 'arc-cal-info-tag';
            matTag.textContent = '—';

            const clsTag = document.createElement('div');
            clsTag.className = 'arc-cal-info-tag';
            clsTag.textContent = '—';

            const addBtn = document.createElement('div');
            addBtn.className = 'arc-cal-info-add';
            addBtn.textContent = '+';
            addBtn.addEventListener('click', () => {
                if (window._openNewBoard) window._openNewBoard();
            });

            bottom.appendChild(matTag);
            bottom.appendChild(clsTag);
            bottom.appendChild(addBtn);
            infoPanel.appendChild(bottom);

            calView.appendChild(infoPanel);

            // ── Panneau grille (droite) ───────────────────────────────
            const weekPanel = document.createElement('div');
            weekPanel.className = 'arc-cal-week-panel';

            // Bandeau semaine
            const banner = document.createElement('div');
            banner.className = 'arc-cal-banner';
            const now = new Date();
            const MONTHS_SHORT = ['Jan.','Fév.','Mars','Avr.','Mai','Juin',
                                   'Juil.','Août','Sept.','Oct.','Nov.','Déc.'];
            const startOfWeek = new Date(now);
            const dow = startOfWeek.getDay();
            const diff = (dow === 0) ? -6 : 1 - dow;
            startOfWeek.setDate(startOfWeek.getDate() + diff);
            banner.textContent = `Semaine du ${startOfWeek.getDate()} ${MONTHS_SHORT[startOfWeek.getMonth()]} ${startOfWeek.getFullYear()}`;
            weekPanel.appendChild(banner);

            // Grille intérieure
            const grid = document.createElement('div');
            grid.className = 'arc-cal-grid';

            // Coin
            const corner = document.createElement('div');
            corner.className = 'arc-cal-corner';
            grid.appendChild(corner);

            // Entêtes de jours
            const DAY_LABELS = ['lu.','ma.','mer.','jeu.','ven.'];
            DAY_LABELS.forEach(d => {
                const dh = document.createElement('div');
                dh.className = 'arc-cal-day-hdr';
                dh.textContent = d;
                grid.appendChild(dh);
            });

            // Construire cellMap depuis arcDisplay — semaine courante uniquement
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(endOfWeek.getDate() + 4);
            endOfWeek.setHours(23, 59, 59, 999);
            const cellMap = {};
            arcDisplay.forEach(b => {
                if (!b.date) return;
                const d = new Date(b.date);
                if (d < startOfWeek || d > endOfWeek) return;
                const dw = d.getDay();
                if (dw < 1 || dw > 5) return;
                const key = `${dw - 1}-${d.getHours()}`;
                if (!cellMap[key]) cellMap[key] = b;
            });

            // Plages horaires affichées
            const HOURS = [9,10,11,12,13,14,15,16,17,18];
            let recapIdx = 0;

            // Fonction d'affichage dans le panneau info
            function showPreview(board, hour, dayIdx) {
                const slotDate = new Date(startOfWeek);
                slotDate.setDate(slotDate.getDate() + dayIdx);
                const MONTHS_CAL = ['Jan.','Fév.','Mars','Avr.','Mai','Juin',
                                    'Juil.','Août','Sept.','Oct.','Nov.','Déc.'];
                dateBig.textContent = `${slotDate.getDate()} ${MONTHS_CAL[slotDate.getMonth()]}`;
                const pad = n => String(n).padStart(2, '0');
                timeEl.textContent = `${hour}H${pad(0)}`;
                yearEl.textContent = String(slotDate.getFullYear());

                recap.textContent = RECAPS[recapIdx % RECAPS.length];
                recapIdx++;

                // Aperçu
                preview.innerHTML = '';
                if (board && board.img) {
                    const img = document.createElement('img');
                    img.src = board.img;
                    preview.appendChild(img);
                    preview.style.background = '';
                } else {
                    const col = board ? boardColor(board) : null;
                    preview.style.background = col || 'var(--text-dark)';
                }

                // Tags
                if (board && board.matiereId && arcMatieres) {
                    const m = arcMatieres.find(x => x.id === board.matiereId);
                    matTag.textContent = m ? m.label : '—';
                } else { matTag.textContent = '—'; }

                if (board && board.classeId && arcClasses) {
                    const c = arcClasses.find(x => x.id === board.classeId);
                    clsTag.textContent = c ? c.label : '—';
                } else { clsTag.textContent = '—'; }
            }

            // Lignes horaires
            HOURS.forEach(h => {
                const lbl = document.createElement('div');
                lbl.className = 'arc-cal-hour-lbl';
                lbl.textContent = `${h}h`;
                grid.appendChild(lbl);

                [0,1,2,3,4].forEach(di => {
                    const key   = `${di}-${h}`;
                    const board = cellMap[key] || null;
                    const slot  = document.createElement('div');
                    slot.className = 'arc-cal-slot';
                    if (board) {
                        slot.classList.add('arc-cal-has-board');
                        const dot = document.createElement('div');
                        dot.className = 'arc-cal-slot-dot';
                        slot.appendChild(dot);
                    }
                    slot.addEventListener('click', () => {
                        grid.querySelectorAll('.arc-cal-slot.arc-cal-selected')
                            .forEach(s => s.classList.remove('arc-cal-selected'));
                        slot.classList.add('arc-cal-selected');
                        showPreview(board, h, di);
                        if (board && window._openBoardFromArchive) {
                            // Ne pas naviguer immédiatement — juste afficher l'info
                        }
                    });
                    grid.appendChild(slot);
                });
            });

            weekPanel.appendChild(grid);
            calView.appendChild(weekPanel);

            // Auto-sélection : première case occupée, sinon première case
            const firstOccupied = grid.querySelector('.arc-cal-slot.arc-cal-has-board');
            const firstSlot     = grid.querySelector('.arc-cal-slot');
            const target        = firstOccupied || firstSlot;
            if (target) {
                target.classList.add('arc-cal-selected');
                // Lire les attributs de position depuis la position dans la grille
                const allSlots  = Array.from(grid.querySelectorAll('.arc-cal-slot'));
                const idx       = allSlots.indexOf(target);
                const row       = Math.floor(idx / 5);
                const col       = idx % 5;
                const h         = HOURS[row] !== undefined ? HOURS[row] : HOURS[0];
                const board     = cellMap[`${col}-${h}`] || null;
                showPreview(board, h, col);
            }
        }

        // ── Listeners boutons de vue ──────────────────────────────────────
        (function initViewButtons() {
            const btnGrid = document.getElementById('arc-btn-grid');
            const btnCal  = document.getElementById('arc-btn-cal');
            if (btnGrid) btnGrid.addEventListener('click', () => arcSetViewMode('grid'));
            if (btnCal)  btnCal.addEventListener('click',  () => arcSetViewMode('cal'));
        })();

        // ── Initialisation unique ─────────────────────────────────────────
        arcInitSortPanel();

    })();

    // ── Mobile : roue sous le doigt (1 s) + sélection par glissement ───────
    (function initMobileTouch() {
        if (!window.matchMedia('(max-width: 768px)').matches) return;
        const roue = document.getElementById('roue-conteneur');
        let holdTimer  = null;
        let startX = 0, startY = 0;
        let lastPath   = null;   // segment survolé
        let rouePinned = false;  // roue épinglée après sélection d'outil

        function fireMouseOn(el, type) {
            if (el) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
        function pathUnder(x, y) {
            const el = document.elementFromPoint(x, y);
            if (!el) return null;
            return el.tagName === 'path' ? el : (el.closest ? el.closest('path') : null);
        }
        function fermerRoueMobile() {
            // Désépingler d'abord, puis nettoyer le panel avant de masquer
            if (window._roueEpingle) window._roueEpingle(false);
            if (window._roueFermerPanel) window._roueFermerPanel();
            fireMouseOn(lastPath, 'mouseleave');
            lastPath = null;
            clearTimeout(holdTimer);
            holdTimer = null;
            rouePinned = false;
            document.body.classList.remove('mobile-roue-visible');
            roue.classList.remove('ouvert');
        }

        document.addEventListener('touchstart', (e) => {
            // Roue épinglée → tap hors de la roue = fermer
            if (rouePinned) {
                const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
                if (!roue.contains(el)) fermerRoueMobile();
                return;
            }
            // Pinch (2 doigts) → annuler le holdTimer, ne pas déclencher la roue
            if (e.touches.length >= 2) { clearTimeout(holdTimer); holdTimer = null; return; }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            holdTimer = setTimeout(() => {
                const half = (roue.offsetWidth || 180) / 2;
                roue.style.setProperty('left', (startX - half) + 'px', 'important');
                roue.style.setProperty('top',  (startY - half) + 'px', 'important');
                document.body.classList.add('mobile-roue-visible');
                roue.classList.add('ouvert');
            }, 1000); // 1 seconde
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (rouePinned) return; // roue épinglée → ignorer les mouvements
            if (e.touches.length >= 2) return; // pinch géré par le canvas directement
            const x = e.touches[0].clientX;
            const y = e.touches[0].clientY;
            if (!document.body.classList.contains('mobile-roue-visible')) {
                if (holdTimer && Math.hypot(x - startX, y - startY) > 10) {
                    // Mouvement > 10px : annuler le timer de la roue, démarrer le pan
                    clearTimeout(holdTimer); holdTimer = null;
                    if (window.mobileStartPan && !window.activeToolMode) {
                        window.mobileStartPan(startX, startY);
                    }
                }
                // Continuer le pan si actif (sauf si on déplace/redimensionne un objet)
                if (!holdTimer && window.mobileUpdatePan && !window.activeToolMode && !window.mobileObjectDragging) {
                    window.mobileUpdatePan(x, y);
                }
                return;
            }
            // Roue visible → simuler le survol du segment sous le doigt
            const p = pathUnder(x, y);
            if (p !== lastPath) {
                fireMouseOn(lastPath, 'mouseleave');
                fireMouseOn(p, 'mouseenter');
                lastPath = p;
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            // Arrêter le pan mobile si actif
            if (window.mobileStopPan) window.mobileStopPan();
            if (!document.body.classList.contains('mobile-roue-visible')) {
                const wasTap = holdTimer !== null;
                clearTimeout(holdTimer); holdTimer = null;
                // Tap rapide (doigt posé/levé sans bouger) → sélectionner l'objet sous le doigt
                if (wasTap && e.changedTouches[0] && window.mobileTap) {
                    window.mobileTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                }
                return;
            }
            const touch = e.changedTouches[0];
            const p = pathUnder(touch.clientX, touch.clientY);
            if (p) {
                // Épingler AVANT le mouseleave pour que _fanClose soit no-op
                rouePinned = true;
                if (window._roueEpingle) window._roueEpingle(true);
                fireMouseOn(lastPath, 'mouseleave'); lastPath = null;
                fireMouseOn(p, 'click');
                clearTimeout(holdTimer); holdTimer = null;
            } else {
                fermerRoueMobile(); // relâchement dans le vide → fermer
            }
        });

        document.addEventListener('touchcancel', () => {
            if (window.mobileStopPan) window.mobileStopPan();
            fermerRoueMobile();
        });
    })();

}); // Fin du DOMContentLoaded