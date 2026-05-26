/**
 * soutenance-tables.js
 * Injecte les 4 tableaux financiers sur le tableau 1 de comory.
 * Usage : ouvrir comory dans le navigateur, coller ce script dans la console, Entrée.
 */
(function injectSoutenanceTables() {
    'use strict';

    if (!window.getBoardState || !window.setBoardState) {
        console.error('[comory] Ouvre ce script sur la page comory (https://s4h6cmy9n4-wq.github.io/comory).');
        return;
    }

    // ── Couleurs thématiques ─────────────────────────────────────────────────
    const C = { dev: '#ff4000', ops: '#2563eb', legal: '#7c3aed', recap: '#059669' };
    const FONT = 'DM Sans, system-ui, -apple-system, Segoe UI, Arial, sans-serif';

    // ── Utilitaires ──────────────────────────────────────────────────────────
    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Coupe un texte en lignes selon une largeur max en caractères */
    function wrap(text, maxChars) {
        const t = String(text || '');
        if (t.length <= maxChars) return [t];
        const words = t.split(' ');
        const lines = [];
        let cur = '';
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
            else cur = test;
        }
        if (cur) lines.push(cur);
        return lines;
    }

    // ── Générateur SVG ───────────────────────────────────────────────────────
    function buildSVG(cfg) {
        const W       = 1520;
        const PAD     = 30;
        const TITLE_H = 56;
        const HEAD_H  = 38;
        const LINE_H  = 19;   // hauteur d'une ligne de texte
        const ROW_PAD = 11;   // padding vertical dans une rangée
        const SEP_H   = 22;   // séparateur pointillé
        const FS      = 13;   // font-size données
        const CHAR_W  = FS * 0.56; // largeur approx d'un caractère

        // Largeurs de colonnes
        const colW = cfg.colW.map(r => Math.round(r * (W - 2 * PAD)));
        const colX = [];
        let cx = PAD;
        for (const w of colW) { colX.push(cx); cx += w; }

        // Hauteur de chaque rangée (colonne 0 peut être multi-lignes)
        const maxChars0 = Math.floor(colW[0] / CHAR_W) - 1;
        const rowHeights = cfg.rows.map(row => {
            if (String(row[0]).startsWith('§')) return SEP_H;
            const lines = wrap(row[0], maxChars0);
            return Math.max(38, lines.length * LINE_H + ROW_PAD * 2);
        });

        let H = TITLE_H + HEAD_H;
        for (const rh of rowHeights) H += rh;
        H += 18; // padding bas

        // ── Construction SVG ─────────────────────────────────────────────────
        let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${FONT}">`;

        // Fond blanc arrondi + ombre légère
        s += `<defs>
          <filter id="sh" x="-4%" y="-4%" width="108%" height="108%">
            <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#00000018"/>
          </filter>
        </defs>`;
        s += `<rect width="${W}" height="${H}" fill="#ffffff" rx="14" stroke="#e2e8f0" stroke-width="1.5" filter="url(#sh)"/>`;

        // Barre titre
        s += `<rect width="${W}" height="${TITLE_H}" fill="${cfg.color}" rx="14"/>`;
        s += `<rect y="${TITLE_H - 14}" width="${W}" height="14" fill="${cfg.color}"/>`;
        s += `<text x="${PAD}" y="${TITLE_H * 0.55}" font-size="22" font-weight="700" fill="#fff" dominant-baseline="middle">${esc(cfg.title)}</text>`;

        // Ligne sous-titre (description courte)
        if (cfg.subtitle) {
            s += `<text x="${PAD}" y="${TITLE_H * 0.85}" font-size="12" font-weight="400" fill="#ffffff99" dominant-baseline="middle">${esc(cfg.subtitle)}</text>`;
        }

        // En-tête colonnes
        const headY = TITLE_H;
        s += `<rect x="0" y="${headY}" width="${W}" height="${HEAD_H}" fill="#f1f5f9"/>`;
        s += `<line x1="0" y1="${headY + HEAD_H}" x2="${W}" y2="${headY + HEAD_H}" stroke="#cbd5e1" stroke-width="1"/>`;
        cfg.headers.forEach((h, ci) => {
            const isLast = ci === cfg.headers.length - 1;
            const tx  = isLast ? colX[ci] + colW[ci] - 6 : colX[ci] + 8;
            const anc = isLast ? 'end' : 'start';
            s += `<text x="${tx}" y="${headY + HEAD_H / 2 + 1}" font-size="11" font-weight="700" fill="#64748b" dominant-baseline="middle" text-anchor="${anc}" letter-spacing="0.5">${esc(h.toUpperCase())}</text>`;
        });

        // Séparateurs colonnes (en-tête)
        for (let ci = 1; ci < colX.length; ci++) {
            s += `<line x1="${colX[ci]}" y1="${headY + 8}" x2="${colX[ci]}" y2="${headY + HEAD_H - 8}" stroke="#cbd5e1" stroke-width="0.8"/>`;
        }

        // Rangées de données
        let ry = headY + HEAD_H;
        cfg.rows.forEach((row, ri) => {
            const rh     = rowHeights[ri];
            const isTotal = ri === cfg.totalRow;
            const isSep   = String(row[0]).startsWith('§');

            // Séparateur
            if (isSep) {
                s += `<line x1="${PAD}" y1="${ry + rh / 2}" x2="${W - PAD}" y2="${ry + rh / 2}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="5 4"/>`;
                ry += rh;
                return;
            }

            // Fond de rangée
            if (isTotal) {
                s += `<rect x="0" y="${ry}" width="${W}" height="${rh}" fill="${cfg.color}1a"/>`;
                s += `<line x1="0" y1="${ry}" x2="${W}" y2="${ry}" stroke="${cfg.color}55" stroke-width="1"/>`;
                s += `<line x1="0" y1="${ry + rh}" x2="${W}" y2="${ry + rh}" stroke="${cfg.color}55" stroke-width="1.5"/>`;
            } else {
                if (ri % 2 === 0) s += `<rect x="0" y="${ry}" width="${W}" height="${rh}" fill="#f8fafc"/>`;
                s += `<line x1="0" y1="${ry + rh}" x2="${W}" y2="${ry + rh}" stroke="#e2e8f0" stroke-width="0.5"/>`;
            }

            const fw   = isTotal ? '700' : '400';
            const fill = isTotal ? cfg.color : '#1e293b';

            row.forEach((cell, ci) => {
                const isLastCol = ci === row.length - 1;

                if (ci === 0) {
                    // Colonne 0 : multi-lignes possible
                    const lines  = wrap(cell, maxChars0);
                    const blockH = lines.length * LINE_H;
                    const startY = ry + (rh - blockH) / 2;
                    lines.forEach((line, li) => {
                        s += `<text x="${colX[0] + 8}" y="${startY + li * LINE_H + LINE_H * 0.78}" font-size="${FS}" font-weight="${fw}" fill="${fill}">${esc(line)}</text>`;
                    });
                } else {
                    const tx  = isLastCol ? colX[ci] + colW[ci] - 8 : colX[ci] + 8;
                    const anc = isLastCol ? 'end' : 'start';
                    s += `<text x="${tx}" y="${ry + rh / 2 + 1}" font-size="${FS}" font-weight="${fw}" fill="${fill}" dominant-baseline="middle" text-anchor="${anc}">${esc(cell)}</text>`;
                }
            });

            ry += rh;
        });

        s += '</svg>';
        return { svg: s, w: W, h: H };
    }

    // ── Données des 4 tableaux ───────────────────────────────────────────────
    const configs = [
        {
            title: '① Coût de développement',
            subtitle: 'Estimation agence France — taux journaliers moyens du marché',
            color: C.dev,
            headers: ['Poste', 'Volume', 'Taux / jour', 'Coût'],
            colW: [0.40, 0.165, 0.165, 0.27],
            totalRow: 7,
            rows: [
                ['UX/UI design — maquettes, tests utilisateur', '12 jours', '550 €/j', '6 600 €'],
                ['Développement frontend — canvas, outils, animations', '45 jours', '600 €/j', '27 000 €'],
                ['Intégration temps réel (Firebase RTDB, sync)', '10 jours', '600 €/j', '6 000 €'],
                ['Optimisation mobile, PWA, touch events', '10 jours', '600 €/j', '6 000 €'],
                ['Système d\'archive, multi-tableaux', '6 jours', '600 €/j', '3 600 €'],
                ['Tests, QA, corrections', '8 jours', '500 €/j', '4 000 €'],
                ['Chef de projet (15 % overhead)', '—', '—', '8 000 €'],
                ['TOTAL DÉVELOPPEMENT', '', '', '≈ 61 200 €'],
            ],
        },
        {
            title: '② Coûts d\'exploitation annuels',
            subtitle: 'Charges récurrentes dès la mise en production',
            color: C.ops,
            headers: ['Poste', 'Détail', 'Coût annuel'],
            colW: [0.28, 0.445, 0.275],
            totalRow: 5,
            rows: [
                ['Firebase Blaze (RTDB + Hosting)', 'Jusqu\'à 500 utilisateurs actifs', '120 – 360 €'],
                ['Nom de domaine (.fr ou .app)', 'Renouvellement annuel', '15 – 30 €'],
                ['Hébergement statique', 'CDN, SSL — Vercel Pro si besoin', '0 – 240 €'],
                ['Maintenance & mises à jour', 'Développeur, ~4 jours/an', '2 000 – 2 400 €'],
                ['Support utilisateur', 'Email, documentation', '500 – 1 000 €'],
                ['TOTAL ANNUEL', '', '≈ 2 700 – 4 000 €'],
            ],
        },
        {
            title: '③ Coûts juridiques & légaux',
            subtitle: 'Protection de la propriété intellectuelle + conformité RGPD',
            color: C.legal,
            headers: ['Poste', 'Détail', 'Coût'],
            colW: [0.285, 0.43, 0.285],
            totalRow: 6,
            rows: [
                ['Dépôt marque INPI — "comory"', '1 classe logiciels/services, FR', '250 €'],
                ['Extension UE (EUIPO)', 'Protection sur les 27 pays membres', '850 €'],
                ['Rédaction CGU / Politique de confidentialité', 'Avocat spécialisé numérique', '1 200 – 1 800 €'],
                ['Mise en conformité RGPD', 'Registre des traitements, mentions légales', '800 – 1 500 €'],
                ['Dépôt APP (preuve de création logiciel)', 'Horodatage du code source', '70 – 150 €'],
                ['Statut juridique (SAS ou micro)', 'Création + expert-comptable an 1', '300 – 1 500 €'],
                ['TOTAL JURIDIQUE', '', '≈ 3 500 – 6 000 €'],
            ],
        },
        {
            title: '④ Récapitulatif global',
            subtitle: 'Investissement initial + charges annuelles',
            color: C.recap,
            headers: ['Catégorie', 'Montant'],
            colW: [0.64, 0.36],
            totalRow: 2,
            rows: [
                ['Développement initial (agence France)', '61 200 €'],
                ['Frais juridiques & légaux (estimation médiane)', '4 500 €'],
                ['TOTAL INVESTISSEMENT INITIAL', '≈ 65 700 €'],
                ['§'],
                ['Charges récurrentes — année 1', '4 000 €'],
                ['Charges récurrentes — années suivantes', '3 000 €/an'],
            ],
        },
    ];

    // ── Générer les SVGs et calculer les dimensions ──────────────────────────
    const built = configs.map(cfg => buildSVG(cfg));

    // ── Placement sur le canvas 3500×3500 ───────────────────────────────────
    const MARGIN = 130;
    const GAP_X  = 140;
    const GAP_Y  = 100;

    // Rangée 1 : tableaux 0 et 1
    const row1H = Math.max(built[0].h, built[1].h);
    // Rangée 2 : tableaux 2 et 3
    const row2Y = MARGIN + row1H + GAP_Y;

    const positions = [
        { x: MARGIN,                    y: MARGIN },
        { x: MARGIN + 1520 + GAP_X,     y: MARGIN },
        { x: MARGIN,                    y: row2Y  },
        { x: MARGIN + 1520 + GAP_X,     y: row2Y  },
    ];

    // ── Injecter dans le canvas ──────────────────────────────────────────────
    const objs = built.map(({ svg, w, h }, i) => ({
        type:     'image',
        src:      'data:image/svg+xml,' + encodeURIComponent(svg),
        x:        positions[i].x,
        y:        positions[i].y,
        w,
        h,
        rotation: 0,
    }));

    const state = window.getBoardState();
    // Canvas vierge (transparent) + 4 objets tableaux
    const blank = new ImageData(state.imageData.width, state.imageData.height);
    window.setBoardState({ imageData: blank, objs, ui: state.ui });

    // Zoom pour voir tout d'un coup (optionnel — recentre la vue)
    console.log('%c[comory] ✓ 4 tableaux injectés sur le tableau 1', 'color:#059669;font-weight:700');
    console.log('  Dimensions canvas :', state.imageData.width, '×', state.imageData.height);
    console.log('  Empreinte tableau  :', MARGIN, '→', Math.round(MARGIN + 1520 + GAP_X + 1520), 'px (horizontal)');
    console.log('  Pour voir tout : dézoomez avec la molette ou pincez avec deux doigts.');
})();
