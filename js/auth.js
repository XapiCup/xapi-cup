/* ================================================================
   AUTH.JS — Authentification admin (mot de passe + code 2FA)
   ================================================================
   Système 2FA 100% côté client (GitHub Pages = pas de backend).
   - Le mot de passe est hashé SHA-256 + salé, jamais en clair.
   - Un code à 6 chiffres est généré à chaque demande, expire en 10 min.
   - Le code est AFFICHÉ à l'écran (à transmettre manuellement par mail/SMS).
   - Pour un vrai envoi de mail automatique, voir README section "Email".
   - Session persistante 8h, renouvelable, déconnexion manuelle.
   ================================================================ */

const AUTH_KEY = 'xapi-cup-auth-v1';
const SESSION_KEY = 'xapi-cup-session-v1';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 heures
const CODE_DURATION_MS = 10 * 60 * 1000; // 10 minutes
// Email admin (affiché à l'utilisateur, et utilisé pour le contexte 2FA)
export const ADMIN_EMAIL = 'cupxapi@gmail.com';
// Mot de passe initial (à changer depuis l'UI après la 1ère connexion)
// Hash SHA-256("xapi-cup-2026" + SALT) — voir _defaultPasswordHash ci-dessous
const SALT = 'xapi-cup-2026-salt-hasparren';

// ---------- Crypto helpers ----------
async function sha256(text) {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Hash par défaut du mot de passe initial "xapi-cup-2026"
async function defaultPasswordHash() {
  return sha256('xapi-cup-2026' + SALT);
}

// ---------- Stockage sécurisé ----------
function getAuthConfig() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function setAuthConfig(cfg) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(cfg));
  // sync onglet
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel('xapi-cup-auth');
    ch.postMessage({ type: 'auth-update' });
    ch.close();
  }
}

// Vérifie si un hash de mot de passe est défini
export async function isPasswordConfigured() {
  const cfg = getAuthConfig();
  return !!(cfg && cfg.pwdHash);
}

// Vérifie le mot de passe
export async function verifyPassword(input) {
  const cfg = getAuthConfig();
  const storedHash = cfg?.pwdHash || await defaultPasswordHash();
  const inputHash = await sha256((input || '') + SALT);
  return inputHash === storedHash;
}

// Change le mot de passe (admin connecté)
export async function changePassword(currentPwd, newPwd) {
  if (!newPwd || newPwd.length < 6) {
    throw new Error('Le nouveau mot de passe doit faire au moins 6 caractères.');
  }
  const ok = await verifyPassword(currentPwd);
  if (!ok) throw new Error('Mot de passe actuel incorrect.');
  const newHash = await sha256(newPwd + SALT);
  setAuthConfig({ pwdHash: newHash, updatedAt: new Date().toISOString() });
  return true;
}

// ---------- Code 2FA ----------
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getCodeData() {
  try {
    const raw = sessionStorage.getItem('xapi-cup-pending-code');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function setCodeData(code) {
  sessionStorage.setItem('xapi-cup-pending-code', JSON.stringify(code));
}

function clearCodeData() {
  sessionStorage.removeItem('xapi-cup-pending-code');
}

/**
 * Demande un code 2FA.
 * Retourne un objet {code, expiresAt, mailtoHref} :
 *  - code : le code à 6 chiffres (à donner à l'admin)
 *  - expiresAt : timestamp d'expiration
 *  - mailtoHref : lien mailto pré-rempli pour transmettre le code
 *
 * NOTE : GitHub Pages ne permet pas l'envoi réel. Le code est affiché à
 * l'écran et un lien mailto: est fourni pour faciliter le partage manuel.
 * Pour un envoi automatique, déployer le backend (voir README).
 */
export function request2FACode() {
  const code = generateCode();
  const data = {
    code,
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_DURATION_MS,
  };
  setCodeData(data);
  const subject = encodeURIComponent('Xapi Cup — code administrateur');
  const body = encodeURIComponent(
    `Voici le code d'accès à l'espace admin de la Xapi Cup :\n\n` +
    `Code : ${code}\n\n` +
    `Ce code expire dans 10 minutes.\n` +
    `Si tu n'es pas à l'origine de cette demande, ignore ce message.`
  );
  return {
    code,
    expiresAt: data.expiresAt,
    mailtoHref: `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`,
  };
}

/**
 * Vérifie un code 2FA saisi.
 */
export function verify2FACode(input) {
  const data = getCodeData();
  if (!data) return { ok: false, reason: 'Aucun code en attente. Demandez-en un nouveau.' };
  if (Date.now() > data.expiresAt) {
    clearCodeData();
    return { ok: false, reason: 'Code expiré. Demandez-en un nouveau.' };
  }
  if ((input || '').trim() !== data.code) {
    return { ok: false, reason: 'Code incorrect.' };
  }
  return { ok: true };
}

// ---------- Session ----------
function createSessionToken() {
  // Token opaque + aléatoire (pas un JWT, juste un secret côté client)
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isAuthenticated() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.token || !s.expiresAt) return false;
    if (Date.now() > s.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch (e) { return false; }
}

export function createSession() {
  const session = {
    token: createSessionToken(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION_MS,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Efface le code 2FA après usage
  clearCodeData();
  return session;
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  clearCodeData();
}

export function sessionTimeRemaining() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return 0;
    const s = JSON.parse(raw);
    return Math.max(0, s.expiresAt - Date.now());
  } catch (e) { return 0; }
}

// ---------- UI de login ----------
/**
 * Affiche l'écran de login à la place du contenu admin.
 * À appeler depuis admin.js au démarrage.
 */
export function renderLoginScreen(container, onSuccess) {
  // Bloque toute fuite : vide le contenu et n'affiche que le login
  while (container.firstChild) container.removeChild(container.firstChild);

  const wrap = document.createElement('div');
  wrap.className = 'login-screen';

  // ----- Carte de login -----
  const card = document.createElement('div');
  card.className = 'login-card';

  // Header
  const header = document.createElement('div');
  header.className = 'login-header';
  header.innerHTML = `
    <div class="login-icon">🔒</div>
    <h1>Espace administrateur</h1>
    <p class="muted">Accès réservé à l'équipe d'organisation du tournoi.</p>
  `;
  card.appendChild(header);

  // Étape 1 : mot de passe
  const step1 = document.createElement('div');
  step1.className = 'login-step active';
  step1.dataset.step = '1';
  step1.innerHTML = `
    <h3>Étape 1 — Mot de passe</h3>
    <div class="form-group">
      <label for="login-pwd">Mot de passe</label>
      <input type="password" id="login-pwd" class="input" autocomplete="current-password" placeholder="••••••••" />
      <p class="help">Mot de passe initial : <code>xapi-cup-2026</code> (à changer après la 1ère connexion).</p>
    </div>
    <div id="login-step1-error"></div>
    <button class="btn btn-primary" id="login-step1-btn" style="width:100%;">Continuer →</button>
  `;
  card.appendChild(step1);

  // Étape 2 : code 2FA
  const step2 = document.createElement('div');
  step2.className = 'login-step';
  step2.dataset.step = '2';
  step2.innerHTML = `
    <h3>Étape 2 — Code à 6 chiffres</h3>
    <p class="muted" id="login-step2-help">
      Un code vient d'être généré. Transmets-le à l'administrateur
      (par mail, SMS, WhatsApp…) pour qu'il le saisisse ici.
    </p>
    <div class="alert alert-info" id="login-2fa-display" style="display:none;">
      <div>
        <strong>Code 2FA à transmettre :</strong>
        <div class="code-display" id="login-2fa-code">------</div>
        <div class="muted" id="login-2fa-expiry"></div>
        <a href="#" id="login-2fa-mailto" class="btn btn-sm btn-ghost" style="margin-top:8px;">
          ✉️ Envoyer par mail
        </a>
      </div>
    </div>
    <div class="form-group" style="margin-top:16px;">
      <label for="login-2fa-input">Code reçu</label>
      <input type="text" id="login-2fa-input" class="input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" autocomplete="one-time-code" />
    </div>
    <div id="login-step2-error"></div>
    <div class="flex gap-2" style="display:flex; gap:8px;">
      <button class="btn btn-ghost" id="login-back-btn" style="background:var(--color-surface-2); color:var(--color-text);">← Retour</button>
      <button class="btn btn-primary" id="login-step2-btn" style="flex:1;">🔓 Se connecter</button>
    </div>
    <p class="help text-center mt-3" style="margin-top:12px;">
      <a href="#" id="login-2fa-regen">Générer un nouveau code</a>
    </p>
  `;
  card.appendChild(step2);

  wrap.appendChild(card);
  container.appendChild(wrap);

  // ---------- Handlers ----------
  const pwdInput = card.querySelector('#login-pwd');
  const step1Btn = card.querySelector('#login-step1-btn');
  const step1Error = card.querySelector('#login-step1-error');
  const codeInput = card.querySelector('#login-2fa-input');
  const step2Btn = card.querySelector('#login-step2-btn');
  const step2Error = card.querySelector('#login-step2-error');
  const backBtn = card.querySelector('#login-back-btn');
  const regenLink = card.querySelector('#login-2fa-regen');
  const display = card.querySelector('#login-2fa-display');
  const codeSpan = card.querySelector('#login-2fa-code');
  const expirySpan = card.querySelector('#login-2fa-expiry');
  const mailtoLink = card.querySelector('#login-2fa-mailto');

  function showStep(n) {
    card.querySelectorAll('.login-step').forEach((s) => s.classList.remove('active'));
    card.querySelector(`.login-step[data-step="${n}"]`).classList.add('active');
  }

  function showError(slot, msg) {
    slot.innerHTML = `<div class="alert alert-danger" style="margin: 10px 0;">${msg}</div>`;
  }
  function clearError(slot) { slot.innerHTML = ''; }

  // ----- Étape 1 -----
  pwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') step1Btn.click();
  });
  step1Btn.addEventListener('click', async () => {
    clearError(step1Error);
    const pwd = pwdInput.value;
    if (!pwd) { showError(step1Error, 'Saisis ton mot de passe.'); return; }
    step1Btn.disabled = true;
    step1Btn.textContent = 'Vérification…';
    try {
      const ok = await verifyPassword(pwd);
      if (!ok) {
        showError(step1Error, 'Mot de passe incorrect.');
        pwdInput.value = '';
        pwdInput.focus();
        return;
      }
      // Génère le code 2FA
      const { code, expiresAt, mailtoHref } = request2FACode();
      codeSpan.textContent = code;
      const expDate = new Date(expiresAt);
      expirySpan.textContent = `Expire à ${String(expDate.getHours()).padStart(2,'0')}:${String(expDate.getMinutes()).padStart(2,'0')}`;
      mailtoLink.href = mailtoHref;
      display.style.display = '';
      showStep(2);
      setTimeout(() => codeInput.focus(), 100);
    } finally {
      step1Btn.disabled = false;
      step1Btn.textContent = 'Continuer →';
    }
  });

  // ----- Étape 2 -----
  codeInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') step2Btn.click();
  });
  step2Btn.addEventListener('click', () => {
    clearError(step2Error);
    const v = verify2FACode(codeInput.value);
    if (!v.ok) { showError(step2Error, v.reason); codeInput.value = ''; codeInput.focus(); return; }
    // Crée la session
    createSession();
    onSuccess?.();
  });
  backBtn.addEventListener('click', () => {
    showStep(1);
    pwdInput.focus();
  });
  regenLink.addEventListener('click', (e) => {
    e.preventDefault();
    const { code, expiresAt, mailtoHref } = request2FACode();
    codeSpan.textContent = code;
    const expDate = new Date(expiresAt);
    expirySpan.textContent = `Expire à ${String(expDate.getHours()).padStart(2,'0')}:${String(expDate.getMinutes()).padStart(2,'0')}`;
    mailtoLink.href = mailtoHref;
    codeInput.value = '';
    codeInput.focus();
  });

  // Focus initial
  setTimeout(() => pwdInput.focus(), 100);
}

/**
 * Déconnecte l'utilisateur (à brancher sur un bouton dans l'admin).
 */
export function bindLogoutButton() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (confirm('Se déconnecter de l\'espace admin ?')) {
      logout();
      location.reload();
    }
  });
}
