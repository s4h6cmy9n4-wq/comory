/**
 * soutenance-tables-natifs.js
 * Crée 4 vrais tableaux comory (type:'table' + type:'text')
 * éditables en double-cliquant sur les cellules.
 * Usage : coller dans la console DevTools sur la page comory.
 */
(function injectTablesNatifs() {
    'use strict';

    if (!window.getBoardState || !window.setBoardState) {
        console.error('[comory] Fonctionne uniquement sur la page comory.');
        return;
    }

    // ── Constantes ────────────────────────────────────────────────────────────
    const PAD        = 6;    // innerPad comory (identique à commitDraftToObject)
    const T_W        = 1500; // largeur de chaque tableau (px canvas)
    const ROW_H      = 72;   // hauteur par rangée
    const CELL_FS    = 16;   // font-size cellules
    const CELL_LH    = CELL_FS * 1.4;
    const CELL_PAD   = 8;    // padding texte dans la cellule
    const TITLE_FS   = 26;   // font-size titre au-dessus du tableau
    const TITLE_SP   = 54;   // espace vertical réservé au titre
    const MARGIN     = 160;
    const GAP_X      = 180;  // écart horizontal entre les 2 colonnes
    const GAP_Y      = 100;  // écart vertical entre les 2 rangées

    // ── Génération PNG grille ─────────────────────────────────────────────────
    function gridPNG(w, h, cols, rows) {
        const c   = document.createElement('canvas');
        c.width   = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.strokeStyle = '#374151';
        ctx.lineWidth   = 1.5;
        const ix = PAD, iy = PAD, iw = w - PAD * 2, ih = h - PAD * 2;
        ctx.beginPath();
        ctx.rect(ix, iy, iw, ih);
        for (let ci = 1; ci < cols; ci++) {
            const lx = ix + iw * ci / cols;
            ctx.moveTo(lx, iy); ctx.lineTo(lx, iy + ih);
        }
        for (let ri = 1; ri < rows; ri++) {
            const ly = iy + ih * ri / rows;
            ctx.moveTo(ix, ly); ctx.lineTo(ix + iw, ly);
        }
        ctx.stroke();
        return c.toDataURL('image/png');
    }

    // ── Génération PNG texte ──────────────────────────────────────────────────
    function textPNG(text, cellW, cellH, fontWeight, color, fontSize) {
        const dpr = window.devicePixelRatio || 1;
        const lh  = fontSize * 1.4;
        const tmp = document.createElement('canvas');
        const ctx = tmp.getContext('2d');
        ctx.font  = `${fontWeight} ${fontSize}px DM Sans,sans-serif`;

        // Word-wrap
        const words = text.split(' ');
        const lines = []; let cur = '';
        for (const word of words) {
            const t = cur ? cur + ' ' + word : word;
            if (ctx.measureText(t).width > cellW - CELL_PAD * 2 && cur) {
                lines.push(cur); cur = word;
            } else cur = t;
        }
        if (cur) lines.push(cur);

        const renderH  = Math.max(cellH, lines.length * lh + CELL_PAD * 2);
        tmp.width      = Math.round(cellW   * dpr);
        tmp.height     = Math.round(renderH * dpr);
        ctx.scale(dpr, dpr);
        ctx.font         = `${fontWeight} ${fontSize}px DM Sans,sans-serif`;
        ctx.fillStyle    = color;
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => ctx.fillText(line, CELL_PAD, CELL_PAD + i * lh));

        return { src: tmp.toDataURL('image/png'), w: cellW, h: renderH };
    }

    // ── Données ───────────────────────────────────────────────────────────────
    const TITLES = [
        '① Coût de développement',
        "② Coûts d'exploitation annuels",
        '③ Coûts juridiques & légaux',
        '④ Récapitulatif global',
    ];
    const COLORS = ['#ff4000', '#2563eb', '#7c3aed', '#059669'];

    const configs = [
        {
            cols: 4,
            headers: ['Poste', 'Volume', 'Taux / jour', 'Coût'],
            rows: [
                ['UX/UI design — maquettes, tests utilisateur', '12 jours', '550 €/j', '6 600 €'],
                ['Développement frontend — canvas, outils, animations', '45 jours', '600 €/j', '27 000 €'],
                ['Intégration temps réel — Firebase RTDB, sync', '10 jours', '600 €/j', '6 000 €'],
                ['Optimisation mobile, PWA, touch events', '10 jours', '600 €/j', '6 000 €'],
                ["Système d'archive, multi-tableaux", '6 jours', '600 €/j', '3 600 €'],
                ['Tests, QA, corrections', '8 jours', '500 €/j', '4 000 €'],
                ['Chef de projet (15 % overhead)', '—', '—', '8 000 €'],
                ['TOTAL DÉVELOPPEMENT', '', '', '≈ 61 200 €'],
            ],
        },
        {
            cols: 3,
            headers: ['Poste', 'Détail', 'Coût annuel'],
            rows: [
                ['Firebase Blaze (RTDB + Hosting)', "Jusqu'à 500 utilisateurs actifs", '120 – 360 €'],
                ['Nom de domaine (.fr ou .app)', 'Renouvellement annuel', '15 – 30 €'],
                ['Hébergement statique', 'CDN, SSL — Vercel Pro si besoin', '0 – 240 €'],
                ['Maintenance & mises à jour', 'Développeur, ~4 jours/an', '2 000 – 2 400 €'],
                ['Support utilisateur', 'Email, documentation', '500 – 1 000 €'],
                ['TOTAL ANNUEL', '', '≈ 2 700 – 4 000 €'],
            ],
        },
        {
            cols: 3,
            headers: ['Poste', 'Détail', 'Coût'],
            rows: [
                ['Dépôt marque INPI — comory', '1 classe logiciels/services, FR', '250 €'],
                ['Extension UE (EUIPO)', 'Protection sur les 27 pays membres', '850 €'],
                ['Rédaction CGU / Politique de confidentialité', 'Avocat spécialisé numérique', '1 200 – 1 800 €'],
                ['Mise en conformité RGPD', 'Registre des traitements, mentions légales', '800 – 1 500 €'],
                ['Dépôt APP — preuve de création logiciel', 'Horodatage du code source', '70 – 150 €'],
                ['Statut juridique (SAS ou micro)', 'Création + expert-comptable an 1', '300 – 1 500 €'],
                ['TOTAL JURIDIQUE', '', '≈ 3 500 – 6 000 €'],
            ],
        },
        {
            cols: 2,
            headers: ['Catégorie', 'Montant'],
            rows: [
                ['Développement initial (agence France)', '61 200 €'],
                ['Frais juridiques & légaux (estimation médiane)', '4 500 €'],
                ['TOTAL INVESTISSEMENT INITIAL', '≈ 65 700 €'],
                ['Charges récurrentes — année 1', '4 000 €'],
                ['Charges récurrentes — années suivantes', '3 000 €/an'],
            ],
        },
    ];

    // ── Calcul des positions ──────────────────────────────────────────────────
    const nRows   = configs.map(c => 1 + c.rows.length);
    const heights = nRows.map(n => n * ROW_H + PAD * 2);

    const row1H = Math.max(heights[0], heights[1]);

    const positions = [
        { x: MARGIN,               y: MARGIN + TITLE_SP },
        { x: MARGIN + T_W + GAP_X, y: MARGIN + TITLE_SP },
        { x: MARGIN,               y: MARGIN + TITLE_SP + row1H + GAP_Y + TITLE_SP },
        { x: MARGIN + T_W + GAP_X, y: MARGIN + TITLE_SP + row1H + GAP_Y + TITLE_SP },
    ];

    // ── Construction des objets ───────────────────────────────────────────────
    const allObjs = [];

    configs.forEach((cfg, ti) => {
        const pos    = positions[ti];
        const n      = nRows[ti];
        const T_H    = n * ROW_H + PAD * 2;
        const innerW = T_W - PAD * 2;
        const cellW  = innerW / cfg.cols;

        // — Titre au-dessus du tableau —
        const titleT = textPNG(TITLES[ti], T_W, TITLE_SP - 10, 700, COLORS[ti], TITLE_FS);
        allObjs.push({
            type: 'text', src: titleT.src,
            x: pos.x, y: pos.y - TITLE_SP + 5,
            w: titleT.w, h: titleT.h, rotation: 0,
            _text: TITLES[ti], _fontFamily: 'DM Sans',
            _fontSize: TITLE_FS, _fontWeight: 700, _color: COLORS[ti],
        });

        // — Grille du tableau —
        allObjs.push({
            type: 'table', src: gridPNG(T_W, T_H, cfg.cols, n),
            x: pos.x, y: pos.y,
            w: T_W, h: T_H, rotation: 0,
            _cols: cfg.cols, _rows: n, _innerPad: PAD,
        });

        // — Texte dans chaque cellule (empilé par-dessus la grille) —
        [cfg.headers, ...cfg.rows].forEach((rowData, ri) => {
            const isHeader = ri === 0;
            const isTotal  = ri === n - 1;
            rowData.forEach((cell, ci) => {
                if (!cell || cell === '') return;
                const fw    = (isHeader || isTotal) ? 700 : 400;
                const color = isTotal   ? COLORS[ti]
                            : isHeader  ? '#374151'
                            :             '#1e293b';
                const t = textPNG(cell, cellW, ROW_H, fw, color, CELL_FS);
                allObjs.push({
                    type: 'text', src: t.src,
                    x: pos.x + PAD + ci * cellW,
                    y: pos.y + PAD + ri * ROW_H,
                    w: t.w, h: t.h, rotation: 0,
                    _text: cell, _fontFamily: 'DM Sans',
                    _fontSize: CELL_FS, _fontWeight: fw, _color: color,
                });
            });
        });
    });

    // ── Injection dans comory ─────────────────────────────────────────────────
    const state = window.getBoardState();
    const blank = new ImageData(state.imageData.width, state.imageData.height);
    window.setBoardState({ imageData: blank, objs: allObjs, ui: state.ui });

    console.log(
        '%c[comory] ✓ 4 tableaux natifs injectés — ' + allObjs.length + ' objets',
        'color:#059669;font-weight:700'
    );
    console.log('  Double-clic sur une cellule pour éditer.');
})();
