// ── Configuration Firebase — comory sync ──────────────────────────────────────
//
// ÉTAPES D'INSTALLATION (5 minutes, 100 % gratuit) :
//
// 1. Aller sur https://console.firebase.google.com/
// 2. "Ajouter un projet" → donner un nom (ex: comory-cours) → continuer
// 3. Dans le projet : Build → Realtime Database → "Créer une base de données"
//    → choisir la région Europe → démarrer en mode "test" (30 jours, modifiable)
// 4. Dans Paramètres du projet (⚙️) → Vos applications → </> (web)
//    → enregistrer l'app → copier la config ci-dessous
// 5. Remplacer les valeurs "VOTRE_..." par les vraies valeurs de votre projet
//
// Les deux appareils doivent charger EXACTEMENT le même sync-config.js.
// Pour changer de salle, modifier uniquement COMORY_ROOM.
// ─────────────────────────────────────────────────────────────────────────────

window.COMORY_FIREBASE = {
    apiKey:            "VOTRE_API_KEY",
    authDomain:        "VOTRE_PROJECT.firebaseapp.com",
    databaseURL:       "https://VOTRE_PROJECT-default-rtdb.firebaseio.com",
    projectId:         "VOTRE_PROJECT_ID",
    storageBucket:     "VOTRE_PROJECT.appspot.com",
    messagingSenderId: "VOTRE_SENDER_ID",
    appId:             "VOTRE_APP_ID"
};

// Identifiant de la salle — les appareils partageant la même valeur
// voient le même canvas en temps réel.
window.COMORY_ROOM = "salle-principale";
