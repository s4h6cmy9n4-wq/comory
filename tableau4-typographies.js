/**
 * tableau4-typographies.js
 * Injecte une fiche typographique sur le tableau 4 de comory.
 * Liste toutes les polices utilisées dans le site avec leur rôle.
 * Usage : naviguer sur le tableau 4, coller dans la console, Entrée.
 */
(function injectTypographies() {
    'use strict';

    if (!window.getBoardState || !window.setBoardState) {
        console.error('[comory] Ouvre ce script sur la page comory.');
        return;
    }

    // ── Constantes ──────────────────────────────────────────────────────────
    const CANVAS   = 3500;
    const MARGIN   = 200;
    const GAP_X    = 200;   // espace entre les 2 colonnes
    const GAP_Y    = 90;    // espace vertical entre deux entrées
    const PAD      = 8;
    const DPR      = window.devicePixelRatio || 1;
    const COL_W    = (CANVAS - MARGIN * 2 - GAP_X) / 2; // ~1450 px par colonne

    // ── Utilitaire : rendu texte → PNG ────────────────────────────────────
    function textPNG(text, w, fontFamily, fontSize, fontWeight, color, italic = false) {
        const lh  = fontSize * 1.35;
        const tmp = document.createElement('canvas');
        const ctx = tmp.getContext('2d');
        const fontStr = `${italic ? 'italic ' : ''}${fontWeight} ${fontSize}px '${fontFamily}',sans-serif`;
        ctx.font = fontStr;

        // Word-wrap
        const words = text.split(' ');
        const lines = []; let cur = '';
        for (const word of words) {
            const t = cur ? cur + ' ' + word : word;
            if (ctx.measureText(t).width > w - PAD * 2 && cur) {
                lines.push(cur); cur = word;
            } else cur = t;
        }
        if (cur) lines.push(cur);

        const h = Math.max(fontSize + PAD * 2, lines.length * lh + PAD * 2);
        tmp.width  = Math.round(w * DPR);
        tmp.height = Math.round(h * DPR);
        ctx.scale(DPR, DPR);
        ctx.font         = fontStr;
        ctx.fillStyle    = color;
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => ctx.fillText(line, PAD, PAD + i * lh));

        return { src: tmp.toDataURL('image/png'), w, h };
    }

    function mkText(t, x, y, family, size, weight, color) {
        return {
            type: 'text', src: t.src,
            x, y, w: t.w, h: t.h, rotation: 0,
            _text: null, _fontFamily: family,
            _fontSize: size, _fontWeight: weight, _color: color,
        };
    }

    // ── Données : polices + rôles ─────────────────────────────────────────
    const FONTS = [
        {
            family:      'DM Sans',
            specimen:    'DM Sans',
            weights:     '300 · 400 · 500 · 600',
            color:       '#ff4000',
            description: 'Police principale de l\'interface. Utilisée pour la totalité des éléments d\'UI : labels, boutons, menus, archives, panneaux, formulaire de connexion et tous les textes système.',
        },
        {
            family:      'DM Serif Display',
            specimen:    'DM Serif Display',
            weights:     '400 · italic',
            color:       '#2563eb',
            description: 'Tagline de la page d\'accueil. Son caractère serif élégant et ses empattements contrastent avec l\'interface sans-serif, ancrant comory dans une esthétique éditoriale.',
        },
        {
            family:      'Helvetica Neue',
            specimen:    'Helvetica Neue',
            weights:     '700 · 900',
            color:       '#7c3aed',
            description: 'Valeurs numériques affichées en temps réel sur le dial de la roue (taille de police et graisse). Très compact et lisible à petite taille, idéal pour les indicateurs HUD.',
        },
        {
            family:      'Playfair Display',
            specimen:    'Playfair Display',
            weights:     '400 · 700',
            color:       '#059669',
            description: 'Option du sélecteur de police dans l\'outil Texte. Serif à forts contrastes de fût, inspiré de la tradition typographique XVIIIe — pour les titres de cours élégants.',
        },
        {
            family:      'Bebas Neue',
            specimen:    'BEBAS NEUE',
            weights:     '400',
            color:       '#dc2626',
            description: 'Option du sélecteur de police dans l\'outil Texte. Display condensée tout-en-majuscules : impact visuel maximal, idéale pour les mots-clés larges projetés au tableau.',
        },
        {
            family:      'Space Mono',
            specimen:    'Space Mono',
            weights:     '400 · 700',
            color:       '#0891b2',
            description: 'Option du sélecteur de police dans l\'outil Texte. Monospace à chasse fixe, connotation technique et numérique — pour les listes, codes, tableaux de données.',
        },
        {
            family:      'Cormorant Garamond',
            specimen:    'Cormorant Garamond',
            weights:     '300 · 400 · 600',
            color:       '#9333ea',
            description: 'Option du sélecteur de police dans l\'outil Texte. Serif classique inspiré de Garamond : finesse et lisibilité pour les citations, blocs de texte et légendes d\'œuvres.',
        },
        {
            family:      'Raleway',
            specimen:    'Raleway',
            weights:     '300 · 400 · 700',
            color:       '#d97706',
            description: 'Option du sélecteur de police dans l\'outil Texte. Sans-serif géométrique à faible contraste : élégance sobre pour les sous-titres, légendes et annotations de cours.',
        },
    ];

    const FS_TITLE   = 70;
    const FS_SUB     = 32;
    const FS_SPEC    = 80;  // nom de la fonte en grande taille
    const FS_WEIGHTS = 22;
    const FS_DESC    = 26;

    const allObjs = [];

    // ── Titre ───────────────────────────────────────────────────────────────
    const tTitle = textPNG('Typographies de comory', CANVAS - MARGIN * 2, 'DM Sans', FS_TITLE, 700, '#262623');
    allObjs.push(mkText(tTitle, MARGIN, MARGIN, 'DM Sans', FS_TITLE, 700, '#262623'));

    const tSub = textPNG('Polices utilisées dans l\'interface et l\'outil texte', CANVAS - MARGIN * 2, 'DM Sans', FS_SUB, 300, '#64748b');
    allObjs.push(mkText(tSub, MARGIN, MARGIN + tTitle.h + 12, 'DM Sans', FS_SUB, 300, '#64748b'));

    const baseY = MARGIN + tTitle.h + tSub.h + 80;

    // ── Disposition 2 colonnes ──────────────────────────────────────────────
    const colX = [MARGIN, MARGIN + COL_W + GAP_X];
    const rowY  = [baseY, baseY]; // avancement Y par colonne

    FONTS.forEach((font, i) => {
        const col = i % 2;
        const x   = colX[col];
        let   y   = rowY[col];

        // 1. Nom de la fonte dans sa propre police (coloré)
        const tSpec = textPNG(font.specimen, COL_W, font.family, FS_SPEC, 700, font.color);
        allObjs.push(mkText(tSpec, x, y, font.family, FS_SPEC, 700, font.color));
        y += tSpec.h + 6;

        // 2. Graisses disponibles (en DM Sans, gris)
        const tW = textPNG(font.family + ' — ' + font.weights, COL_W, 'DM Sans', FS_WEIGHTS, 400, '#94a3b8');
        allObjs.push(mkText(tW, x, y, 'DM Sans', FS_WEIGHTS, 400, '#94a3b8'));
        y += tW.h + 14;

        // 3. Description (en DM Sans, sombre)
        const tDesc = textPNG(font.description, COL_W, 'DM Sans', FS_DESC, 400, '#374151');
        allObjs.push(mkText(tDesc, x, y, 'DM Sans', FS_DESC, 400, '#374151'));
        y += tDesc.h + GAP_Y;

        rowY[col] = y;
    });

    // ── Injection ───────────────────────────────────────────────────────────
    const state = window.getBoardState();
    const blank = new ImageData(state.imageData.width, state.imageData.height);
    window.setBoardState({ imageData: blank, objs: allObjs, ui: state.ui });

    console.log(
        '%c[comory] ✓ Fiche typographies injectée — ' + allObjs.length + ' objets',
        'color:#059669;font-weight:700'
    );
    console.log('  Dézoomez (molette ou pincer) pour voir tout le tableau.');
})();
