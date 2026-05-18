import { supabase } from './supabase.js';
import {
  getMe,
  startCheckout,
  openBillingPortal,
  identifyJewelry,
} from './api.js';

// ══════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════
const FREE_SCAN_LIMIT = 3;
const LOADING_MSGS = [
  'Examining hallmarks…',
  'Consulting gemological databases…',
  'Analyzing metal composition…',
  'Dating the piece…',
  'Researching assay office marks…',
  'Calculating market value…',
  'Cross-referencing maker\'s marks…',
  'Authenticating design elements…',
];

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
const state = {
  screen: 'home',
  user: null,          // { email, subscriptionStatus, freeScansUsed }
  imageFile: null,
  imageBase64: null,
  imageMimeType: null,
  imagePreviewUrl: null,
  currentResult: null,
  isSaved: false,
  viewingItem: null,
};

// ══════════════════════════════════════════════
//  STORAGE (collection)
// ══════════════════════════════════════════════
const storage = {
  getCollection: () => {
    try { return JSON.parse(localStorage.getItem('hiq_col') || '[]'); }
    catch { return []; }
  },
  saveItem: (item) => {
    const col = storage.getCollection();
    col.unshift(item);
    localStorage.setItem('hiq_col', JSON.stringify(col));
  },
  clearCollection: () => localStorage.removeItem('hiq_col'),
};

// ══════════════════════════════════════════════
//  IMAGE UTILITIES
// ══════════════════════════════════════════════
function resizeAndEncodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1600;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType: 'image/jpeg' });
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.88);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function makeThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const SIZE = 120;
      const ratio = Math.max(SIZE / img.width, SIZE / img.height);
      const w = img.width * ratio, h = img.height * ratio;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      canvas.getContext('2d').drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ══════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════
function navigate(screen, opts = {}) {
  Object.assign(state, opts);
  state.screen = screen;
  render();
}

// ══════════════════════════════════════════════
//  ICONS
// ══════════════════════════════════════════════
const icon = {
  home:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>`,
  collection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><path d="M12 12v4M10 14h4"/></svg>`,
  settings:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  camera:     `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  gallery:    `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  ring:       `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><circle cx="12" cy="14" r="3"/><path d="M9 7l1.5-4h3L15 7"/></svg>`,
  back:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>`,
  upload:     `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>`,
  tag:        `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5" fill="#C9A84C"/></svg>`,
  calendar:   `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  metal:      `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>`,
  dollar:     `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`,
  shield:     `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  note:       `<svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>`,
  check:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
};

// ══════════════════════════════════════════════
//  BOTTOM NAV
// ══════════════════════════════════════════════
function renderBottomNav() {
  const tabs = [
    { id: 'home',       label: 'Home',       svg: icon.home },
    { id: 'collection', label: 'Collection', svg: icon.collection },
    { id: 'settings',   label: 'Settings',   svg: icon.settings },
  ];
  const active = ['home','collection','settings'].includes(state.screen) ? state.screen : 'home';
  return `<nav class="bottom-nav">
    ${tabs.map(t => `
      <div class="nav-item ${t.id === active ? 'active' : ''}" data-nav="${t.id}">
        ${t.svg}<span>${t.label}</span>
      </div>`).join('')}
  </nav>`;
}

// ══════════════════════════════════════════════
//  SCREEN: LOGIN
// ══════════════════════════════════════════════
function screenLogin() {
  return `
    <div class="screen no-nav">
      <div class="login-screen">
        <div class="login-top">
          <div class="logo-mark">
            <div class="logo-ring"></div>
            ${icon.ring}
          </div>
          <div class="logo-text">Hallmark<span>IQ</span></div>
          <div class="logo-sub">Jewelry Intelligence</div>
        </div>

        <div class="login-body">
          <div class="gold-line"></div>
          <h2 class="login-title">Identify your<br><em>jewelry instantly</em></h2>
          <p class="login-desc">Identify hallmarks, metal content, era, and estimated value using AI. Free to start — no credit card required.</p>

          <p class="login-or">Log in or create an account</p>

          <button class="google-btn" id="google-btn">
            <svg width="20" height="20" viewBox="0 0 48 48" style="flex-shrink:0">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.4 30.2 0 24 0 14.7 0 6.7 5.4 2.7 13.3l7.8 6.1C12.4 13.2 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.8 37.1 46.5 31.2 46.5 24.5z"/>
              <path fill="#FBBC05" d="M10.5 28.6A14.6 14.6 0 019.5 24c0-1.6.3-3.2.8-4.6l-7.8-6.1A23.9 23.9 0 000 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/>
              <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.5-5.8c-2.1 1.4-4.7 2.3-7.8 2.3-6.3 0-11.6-3.7-13.6-9l-7.9 6.1C6.7 42.6 14.7 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <p class="login-footer">
          By signing in you agree to our Terms of Service.<br>
          Your scans are private and never shared.
        </p>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  SCREEN: HOME
// ══════════════════════════════════════════════
function screenHome() {
  const user = state.user;
  const isSubscribed = user?.subscriptionStatus === 'active';
  const scansUsed = user?.freeScansUsed || 0;
  const remaining = Math.max(0, FREE_SCAN_LIMIT - scansUsed);

  return `
    <div class="screen">
      <div class="home-screen">
        <div class="home-top">
          <div class="logo-mark">
            <div class="logo-ring"></div>
            ${icon.ring}
          </div>
          <div class="logo-text">Hallmark<span>IQ</span></div>
          <div class="logo-sub">Jewelry Intelligence</div>
        </div>

        <div class="home-hero">
          <div class="gold-line"></div>
          <p class="home-tagline"><em>Instant</em> Jewelry &amp;<br>Hallmark Identification</p>
          <p class="home-desc">Upload or photograph any piece of jewelry to instantly identify hallmarks, metal content, era, and estimated value using AI.</p>
          <div class="gold-line"></div>
        </div>

        <div class="home-cta-area">
          ${isSubscribed
            ? `<p class="scan-count-badge" style="color:var(--gold)">✦ Unlimited scans</p>`
            : `<p class="scan-count-badge"><strong>${remaining}</strong> free scan${remaining !== 1 ? 's' : ''} remaining</p>`
          }
          <button class="btn-primary" id="scan-btn">✦ &nbsp;Scan Jewelry</button>
        </div>
      </div>
    </div>
    ${renderBottomNav()}`;
}

// ══════════════════════════════════════════════
//  SCREEN: UPLOAD
// ══════════════════════════════════════════════
function screenUpload() {
  const hasImage = !!state.imagePreviewUrl;
  return `
    <div class="screen no-nav">
      <div class="upload-screen">
        <div class="screen-header">
          <button class="back-btn" id="back-btn">${icon.back}</button>
          <span class="screen-title">Scan Jewelry</span>
        </div>

        ${!hasImage ? `
          <div class="upload-options">
            <div class="upload-option" id="camera-btn">
              ${icon.camera}
              <div class="upload-option-label"><strong>Take Photo</strong>Use camera</div>
            </div>
            <div class="upload-option" id="gallery-btn">
              ${icon.gallery}
              <div class="upload-option-label"><strong>From Library</strong>Choose image</div>
            </div>
          </div>
          <div class="upload-drop-zone" id="drop-zone">
            ${icon.upload}
            <p class="upload-drop-label"><strong>Drop image here</strong><br>or click to browse</p>
          </div>
        ` : `
          <div class="image-preview-area">
            <img src="${state.imagePreviewUrl}" alt="Preview" />
            <div class="image-preview-overlay">
              <button class="clear-image-btn" id="clear-image-btn">✕</button>
            </div>
          </div>
          <div class="upload-actions">
            <button class="btn-primary" id="identify-btn">✦ &nbsp;Identify Jewelry</button>
            <button class="btn-ghost" id="retake-btn">Choose different image</button>
          </div>
        `}
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  SCREEN: LOADING
// ══════════════════════════════════════════════
function screenLoading() {
  return `
    <div class="screen no-nav">
      <div class="loading-screen">
        <div class="loading-spinner">
          <div class="spinner-ring"></div>
          <div class="spinner-ring-2"></div>
          <div class="spinner-center"></div>
        </div>
        <div class="loading-text">
          <p class="loading-title">Analyzing your piece…</p>
          <p class="loading-msg" id="loading-msg">${LOADING_MSGS[0]}</p>
        </div>
        <div class="loading-progress">
          <div class="loading-progress-bar"></div>
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  SCREEN: RESULTS
// ══════════════════════════════════════════════
function screenResults() {
  const r = state.currentResult;
  if (!r) return screenHome();

  const conf = (r.confidenceLevel || 'low').toLowerCase();
  const confLabel = { high: 'High Confidence', medium: 'Medium Confidence', low: 'Low Confidence' }[conf] || conf;
  const imgSrc = state.viewingItem?.thumbnail || state.imagePreviewUrl;

  const cards = [
    { label: 'Description',       ico: icon.note,     body: `<p>${esc(r.description)}</p>` },
    { label: 'Hallmarks',         ico: icon.tag,      body: `<p>${esc(r.hallmarkMeaning)}</p>` },
    { label: 'Estimated Era',     ico: icon.calendar, body: `<p>${esc(r.estimatedEra)}</p>` },
    { label: 'Metal Content',     ico: icon.metal,    body: `<p>${esc(r.metalContent)}</p>` },
    { label: 'Estimated Value',   ico: icon.dollar,   body: `<p class="value-display">${esc(r.estimatedValueRange)}</p><p class="value-note">Secondary market estimate. Not a professional appraisal.</p>` },
    { label: 'Verify Authenticity', ico: icon.shield, body: `<ul class="authenticity-list">${(r.authenticityTips||[]).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` },
    ...(r.additionalNotes ? [{ label: 'Additional Notes', ico: icon.note, body: `<p>${esc(r.additionalNotes)}</p>` }] : []),
  ];

  return `
    <div class="screen no-nav">
      <div class="results-screen">
        <div class="results-header">
          ${imgSrc ? `<img class="results-image" src="${imgSrc}" alt="Jewelry" />` : `<div class="results-image-placeholder">${icon.ring}</div>`}
          <div class="results-image-overlay"></div>
          <button class="results-back-btn" id="back-btn">${icon.back}</button>
        </div>

        <div class="results-title-area">
          <h1 class="results-jewelry-type">${esc(r.jewelryType)}</h1>
          <p class="results-metal">${esc(r.metalContent)}</p>
          <div class="confidence-badge ${conf}">
            <div class="confidence-dot"></div>${confLabel}
          </div>
        </div>

        <div class="results-cards">
          ${cards.map(c => `
            <div class="result-card">
              <div class="result-card-header">
                <div class="result-card-icon">${c.ico}</div>
                <span class="result-card-label">${c.label}</span>
              </div>
              <div class="result-card-body">${c.body}</div>
            </div>`).join('')}
        </div>

        ${!state.viewingItem ? `
          <div class="results-actions">
            <button class="save-btn ${state.isSaved ? 'saved' : ''}" id="save-btn">
              ${state.isSaved ? `${icon.check} &nbsp;Saved to Collection` : '☆ &nbsp;Save to Collection'}
            </button>
            <button class="btn-ghost" id="scan-again-btn">Scan Another Piece</button>
          </div>
        ` : `
          <div class="results-actions">
            <button class="btn-ghost" id="back-collection-btn">← Back to Collection</button>
          </div>
        `}

        <p class="results-disclaimer">AI identification is for reference only. Always consult a certified gemologist for high-value pieces.</p>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  SCREEN: COLLECTION
// ══════════════════════════════════════════════
function screenCollection() {
  const col = storage.getCollection();
  return `
    <div class="screen">
      <div class="collection-screen">
        <div class="collection-header">
          <h1 class="collection-title">Collection</h1>
          <p class="collection-count">${col.length} saved piece${col.length !== 1 ? 's' : ''}</p>
        </div>
        ${col.length === 0 ? `
          <div class="collection-empty">
            ${icon.ring}
            <div><strong>No saved pieces yet</strong>
            <p>Scan a piece of jewelry and save it to build your personal collection.</p></div>
            <button class="btn-secondary" data-nav="home">Start Scanning</button>
          </div>
        ` : `
          <div class="collection-grid">
            ${col.map(item => `
              <div class="collection-item" data-view-item="${item.id}">
                <div class="collection-thumb">
                  ${item.thumbnail ? `<img src="${item.thumbnail}" alt="" />` : icon.ring}
                </div>
                <div class="collection-item-info">
                  <div class="collection-item-type">${esc(item.result?.jewelryType || 'Unknown Piece')}</div>
                  <div class="collection-item-metal">${esc(item.result?.metalContent || '')}</div>
                  <div class="collection-item-date">${formatDate(item.date)}</div>
                </div>
                <div class="collection-item-confidence ${(item.result?.confidenceLevel||'low').toLowerCase()}">
                  ${item.result?.confidenceLevel || 'Low'}
                </div>
              </div>`).join('')}
          </div>
        `}
      </div>
    </div>
    ${renderBottomNav()}`;
}

// ══════════════════════════════════════════════
//  SCREEN: SETTINGS
// ══════════════════════════════════════════════
function screenSettings() {
  const user = state.user;
  const isSubscribed = user?.subscriptionStatus === 'active';
  const isPastDue = user?.subscriptionStatus === 'past_due';
  const scansUsed = user?.freeScansUsed || 0;
  const remaining = Math.max(0, FREE_SCAN_LIMIT - scansUsed);

  return `
    <div class="screen">
      <div class="settings-screen">
        <div class="settings-header">
          <h1 class="settings-title">Settings</h1>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">Account</div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-label">Signed in as</div>
              <div class="settings-row-desc" style="color:var(--gold)">${esc(user?.email || '')}</div>
            </div>
            <div class="settings-row" style="border-bottom:none">
              <button class="btn-danger" id="sign-out-btn">Sign Out</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">Subscription</div>
          <div class="settings-card">
            ${isSubscribed ? `
              <div class="settings-row">
                <div class="scan-counter-display">
                  <div>
                    <div class="settings-row-label">Unlimited Plan</div>
                    <div class="settings-row-desc" style="color:var(--success)">✓ Active — unlimited scans</div>
                  </div>
                  <div class="count" style="font-size:24px">∞</div>
                </div>
              </div>
              <div class="settings-row" style="border-bottom:none">
                <button class="settings-save-btn" id="portal-btn">Manage Subscription →</button>
              </div>
            ` : isPastDue ? `
              <div class="settings-row">
                <div class="settings-row-label" style="color:var(--error)">Payment Failed</div>
                <div class="settings-row-desc">Your last payment didn't go through. Update your payment method to restore unlimited access.</div>
                <button class="settings-save-btn" id="portal-btn" style="margin-top:8px">Update Payment →</button>
              </div>
            ` : `
              <div class="settings-row">
                <div class="scan-counter-display">
                  <div>
                    <div class="settings-row-label">Free Scans Used</div>
                    <div class="settings-row-desc">${remaining > 0 ? `${remaining} free scan${remaining !== 1 ? 's' : ''} remaining` : 'Free limit reached'}</div>
                  </div>
                  <div class="count">${scansUsed}<span style="font-size:18px;color:var(--text-sec)">/${FREE_SCAN_LIMIT}</span></div>
                </div>
              </div>
              <div class="settings-row" style="border-bottom:none">
                <div class="settings-row-label">Unlock Unlimited</div>
                <div class="settings-row-desc">Remove the scan limit for $7.99/mo</div>
                <button class="settings-save-btn" id="upgrade-btn" style="margin-top:8px">Upgrade to Unlimited →</button>
              </div>
            `}
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">Data</div>
          <div class="settings-card">
            <div class="settings-row" style="border-bottom:none">
              <div class="settings-row-label">Collection</div>
              <div class="settings-row-desc">${storage.getCollection().length} saved piece${storage.getCollection().length !== 1 ? 's' : ''} in local storage</div>
              <button class="btn-danger" id="clear-col-btn" style="margin-top:8px">Clear Collection</button>
            </div>
          </div>
        </div>

        <div class="settings-about">
          <p><strong>HallmarkIQ v1.0</strong><br>AI-powered jewelry &amp; hallmark identification.<br>Powered by GPT-4o vision.</p>
        </div>
      </div>
    </div>
    ${renderBottomNav()}`;
}

// ══════════════════════════════════════════════
//  SCREEN: PAYWALL
// ══════════════════════════════════════════════
function screenPaywall() {
  return `
    <div class="screen no-nav">
      <div class="paywall-screen">
        <div>
          <div class="paywall-crown">💎</div>
          <div class="gold-line"></div>
        </div>
        <div>
          <div class="paywall-badge">Free limit reached</div>
          <h2 class="paywall-title">Unlock <em>Unlimited</em><br>Identifications</h2>
          <p class="paywall-desc">You've used your 3 free scans. Upgrade to continue identifying jewelry, hallmarks, and hidden gems in your collection.</p>
          <ul class="paywall-features">
            <li><div class="feature-icon">∞</div> Unlimited scans &amp; identifications</li>
            <li><div class="feature-icon">💾</div> Save &amp; organize your full collection</li>
            <li><div class="feature-icon">📊</div> Detailed valuation history</li>
            <li><div class="feature-icon">⚡</div> Priority AI processing</li>
          </ul>
          <div class="paywall-price">
            <div class="amount">$7.99</div>
            <div class="period">per month · cancel anytime</div>
          </div>
        </div>
        <div class="paywall-actions">
          <button class="stripe-btn" id="stripe-btn">Unlock Unlimited — $7.99/mo</button>
          <button class="btn-ghost" id="paywall-back-btn">Maybe later</button>
        </div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════
function render() {
  const screens = {
    login:       screenLogin,
    home:        screenHome,
    upload:      screenUpload,
    loading:     screenLoading,
    results:     screenResults,
    collection:  screenCollection,
    settings:    screenSettings,
    paywall:     screenPaywall,
  };
  document.getElementById('app').innerHTML = (screens[state.screen] || screenHome)();
  attachEvents();
}

// ══════════════════════════════════════════════
//  EVENTS
// ══════════════════════════════════════════════
function attachEvents() {
  const app = document.getElementById('app');

  app.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });

  on('back-btn', 'click', handleBack);
  on('back-collection-btn', 'click', () => navigate('collection'));

  // Login
  on('google-btn', 'click', handleGoogleSignIn);

  // Home
  on('scan-btn', 'click', () => navigate('upload'));

  // Upload
  on('camera-btn',      'click', openCameraModal);
  on('gallery-btn',     'click', () => document.getElementById('gallery-input').click());
  on('drop-zone',       'click', () => document.getElementById('gallery-input').click());
  on('clear-image-btn', 'click', clearImage);
  on('retake-btn',      'click', clearImage);
  on('identify-btn',    'click', handleIdentify);

  const dz = document.getElementById('drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file?.type.startsWith('image/')) handleImageFile(file);
    });
  }

  // Results
  on('save-btn',       'click', handleSave);
  on('scan-again-btn', 'click', () => {
    state.imageFile = null; state.imagePreviewUrl = null;
    state.imageBase64 = null; state.currentResult = null; state.isSaved = false;
    navigate('upload');
  });

  app.querySelectorAll('[data-view-item]').forEach(el => {
    el.addEventListener('click', () => {
      const item = storage.getCollection().find(i => i.id === el.dataset.viewItem);
      if (item) navigate('results', { currentResult: item.result, viewingItem: item, isSaved: true });
    });
  });

  // Settings
  on('sign-out-btn',  'click', handleSignOut);
  on('upgrade-btn',   'click', handleUpgrade);
  on('portal-btn',    'click', handlePortal);
  on('clear-col-btn', 'click', () => {
    if (confirm('Clear your entire collection? This cannot be undone.')) {
      storage.clearCollection(); render(); toast('Collection cleared');
    }
  });

  // Paywall
  on('stripe-btn',       'click', handleUpgrade);
  on('paywall-back-btn', 'click', () => navigate('home'));

  // File inputs
  document.getElementById('camera-input').onchange  = e => handleImageFile(e.target.files?.[0]);
  document.getElementById('gallery-input').onchange = e => handleImageFile(e.target.files?.[0]);
}

function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// ══════════════════════════════════════════════
//  HANDLERS
// ══════════════════════════════════════════════
function handleBack() {
  if (state.screen === 'results') {
    if (state.viewingItem) {
      state.viewingItem = null; navigate('collection');
    } else {
      state.imageFile = null; state.imagePreviewUrl = null;
      state.imageBase64 = null; state.currentResult = null; state.isSaved = false;
      navigate('home');
    }
    return;
  }
  const prev = { upload: 'home', paywall: 'home' };
  navigate(prev[state.screen] || 'home');
}

async function handleGoogleSignIn() {
  const btn = document.getElementById('google-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to Google…'; }
  try {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  } catch (err) {
    toast(err.message || 'Sign-in failed', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Continue with Google'; }
  }
}

async function handleSignOut() {
  await supabase.auth.signOut();
  state.user = null;
  navigate('login');
}

async function handleUpgrade() {
  try {
    const url = await startCheckout();
    window.location.href = url;
  } catch (err) {
    toast(err.message || 'Could not start checkout', 'error');
  }
}

async function handlePortal() {
  try {
    const url = await openBillingPortal();
    window.location.href = url;
  } catch (err) {
    toast(err.message || 'Could not open billing portal', 'error');
  }
}

function clearImage() {
  state.imageFile = null; state.imagePreviewUrl = null;
  state.imageBase64 = null; state.imageMimeType = null;
  document.getElementById('camera-input').value = '';
  document.getElementById('gallery-input').value = '';
  navigate('upload');
}

async function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  state.imageFile = file;
  state.imagePreviewUrl = URL.createObjectURL(file);
  navigate('upload');
}

async function handleIdentify() {
  if (!state.imageFile) { toast('Please select an image first.', 'error'); return; }

  state.currentResult = null; state.isSaved = false;
  navigate('loading');
  startLoadingMessages();

  try {
    const { base64, mimeType } = await resizeAndEncodeImage(state.imageFile);
    state.imageBase64 = base64; state.imageMimeType = mimeType;

    const result = await identifyJewelry(base64, mimeType);

    // Refresh user scan count from server
    const me = await getMe();
    if (me) state.user = me;

    state.currentResult = result; state.viewingItem = null;
    navigate('results');
  } catch (err) {
    if (err.paymentRequired) {
      navigate('paywall');
    } else if (err.sessionExpired) {
      await supabase.auth.signOut();
      state.user = null;
      toast('Session expired — please sign in again', 'error');
      navigate('login');
    } else {
      navigate('upload');
      toast(err.message || 'Identification failed. Please try again.', 'error');
    }
  }
}

async function handleSave() {
  if (state.isSaved) return;
  const thumbnail = state.imageFile ? await makeThumbnail(state.imageFile) : null;
  storage.saveItem({ id: Date.now().toString(), date: new Date().toISOString(), thumbnail, result: state.currentResult });
  state.isSaved = true;
  const btn = document.getElementById('save-btn');
  if (btn) { btn.classList.add('saved'); btn.innerHTML = `${icon.check} &nbsp;Saved to Collection`; }
  toast('Saved to collection!', 'success');
}

// ══════════════════════════════════════════════
//  CAMERA MODAL
// ══════════════════════════════════════════════
let _cameraStream = null;

async function openCameraModal() {
  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('camera-input').click(); return;
  }
  const modal = document.createElement('div');
  modal.id = 'camera-modal';
  modal.innerHTML = `
    <div class="cam-backdrop"></div>
    <div class="cam-shell">
      <div class="cam-header">
        <span class="cam-title">Take Photo</span>
        <button class="cam-close" id="cam-close-btn">✕</button>
      </div>
      <div class="cam-viewport">
        <video id="cam-video" autoplay playsinline muted></video>
        <div class="cam-overlay-corners"></div>
      </div>
      <div class="cam-controls">
        <button class="cam-flip-btn" id="cam-flip-btn" title="Flip camera">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15"/>
          </svg>
        </button>
        <button class="cam-capture-btn" id="cam-capture-btn"><div class="cam-capture-inner"></div></button>
        <div style="width:44px"></div>
      </div>
      <canvas id="cam-canvas" style="display:none"></canvas>
    </div>`;
  document.body.appendChild(modal);

  let facingMode = 'environment';

  async function startStream() {
    if (_cameraStream) _cameraStream.getTracks().forEach(t => t.stop());
    try {
      _cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      const video = document.getElementById('cam-video');
      if (video) video.srcObject = _cameraStream;
    } catch (err) {
      closeModal();
      if (err.name === 'NotAllowedError') toast('Camera access denied.', 'error');
      else document.getElementById('camera-input').click();
    }
  }

  function closeModal() {
    if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; }
    modal.remove();
  }

  function capturePhoto() {
    const video = document.getElementById('cam-video');
    const canvas = document.getElementById('cam-canvas');
    if (!video || !canvas) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      closeModal();
      handleImageFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }

  document.getElementById('cam-close-btn').addEventListener('click', closeModal);
  document.getElementById('cam-capture-btn').addEventListener('click', capturePhoto);
  document.getElementById('cam-flip-btn').addEventListener('click', () => {
    facingMode = facingMode === 'environment' ? 'user' : 'environment'; startStream();
  });
  modal.querySelector('.cam-backdrop').addEventListener('click', closeModal);
  await startStream();
}

// ══════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════
function startLoadingMessages() {
  let i = 1;
  const id = setInterval(() => {
    const el = document.getElementById('loading-msg');
    if (!el) { clearInterval(id); return; }
    el.style.opacity = '0';
    setTimeout(() => { if (el) { el.textContent = LOADING_MSGS[i % LOADING_MSGS.length]; el.style.opacity = '1'; } }, 300);
    i++;
    if (i > LOADING_MSGS.length + 2) clearInterval(id);
  }, 1800);
}

function toast(msg, type = '') {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3500);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

// ══════════════════════════════════════════════
//  INIT — check Supabase session → login
// ══════════════════════════════════════════════
async function init() {
  // Render immediately so there's never a blank screen
  navigate('login');

  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get('payment');
  if (paymentStatus) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') {
      if (session) {
        try {
          const me = await getMe();
          state.user = me;
          if (paymentStatus === 'success') toast('Subscription activated! Enjoy unlimited scans.', 'success');
          navigate(me ? 'home' : 'login');
        } catch {
          navigate('login');
        }
      } else {
        navigate('login');
      }
    } else if (event === 'SIGNED_IN' && state.screen === 'login') {
      try {
        const me = await getMe();
        state.user = me;
        navigate(me ? 'home' : 'login');
      } catch {
        navigate('login');
      }
    } else if (event === 'SIGNED_OUT') {
      state.user = null;
      navigate('login');
    }
  });
}

init();
