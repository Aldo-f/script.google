// Gleaner UI — pinned Material Web Components from esm.sh.
// Plain HTML controls remain usable if the CDN is unavailable.
const MW_BASE = 'https://esm.sh/@material/web@2.5.0';

// Only import components the pages actually use — one bad import would break
// the whole module, and unused components just add weight.
const COMPONENTS = [
  'button/filled-button.js',
  'button/outlined-button.js',
  'button/text-button.js',
  'textfield/outlined-text-field.js',
  'dialog/dialog.js',
];

let materialReady = false;

async function loadMaterial() {
  await Promise.all(COMPONENTS.map((path) => import(`${MW_BASE}/${path}`)));
  materialReady = true;
  document.body.classList.add('mw-ready');
  return true;
}

loadMaterial().catch((err) => {
  console.warn('Gleaner: Material Web Components unavailable, using HTML fallbacks.', err);
});

// Keep the visible Material field and the real (hidden) form input in sync in
// both directions — only the native input is actually submitted.
document.querySelectorAll('[data-sync-to]').forEach((visual) => {
  const native = document.getElementById(visual.dataset.syncTo);
  if (!native) return;
  const toVisual = () => { visual.value = native.value; };
  const toNative = () => { native.value = visual.value; };
  native.addEventListener('input', toVisual);
  native.addEventListener('change', toVisual);
  visual.addEventListener('input', toNative);
  visual.addEventListener('change', toNative);
  toVisual();
});

// Show / hide token fields.
document.querySelectorAll('[data-reveal]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.reveal);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const visual = document.querySelector(`[data-sync-to="${button.dataset.reveal}"]`);
    if (visual) visual.type = input.type;
    const icon = button.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = show ? 'visibility_off' : 'visibility';
    button.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
    button.setAttribute('title', show ? 'Hide token' : 'Show token');
  });
});

// Client-side archive search.
const search = document.getElementById('archive-search');
if (search) {
  const cards = Array.from(document.querySelectorAll('.item-card'));
  const empty = document.getElementById('no-results');
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const match = !query || (card.dataset.search || '').includes(query);
      card.hidden = !match;
      if (match) visible += 1;
    });
    if (empty) empty.hidden = visible !== 0;
  });
}

// Confirm destructive actions.
let pendingForm = null;
let confirmDialog = null;
let confirmHeading = null;
let confirmMessage = null;

function buildDialog() {
  confirmDialog = document.createElement('md-dialog');
  confirmDialog.innerHTML = `
    <div class="dialog-body">
      <h2 id="confirm-title">Please confirm</h2>
      <p id="confirm-message"></p>
      <div class="dialog-actions">
        <md-text-button id="confirm-cancel">Cancel</md-text-button>
        <md-filled-button id="confirm-accept">Confirm</md-filled-button>
      </div>
    </div>`;
  document.body.appendChild(confirmDialog);
  confirmHeading = confirmDialog.querySelector('#confirm-title');
  confirmMessage = confirmDialog.querySelector('#confirm-message');
  confirmDialog.querySelector('#confirm-cancel').addEventListener('click', () => {
    pendingForm = null;
    confirmDialog.close();
  });
  confirmDialog.querySelector('#confirm-accept').addEventListener('click', () => {
    const form = pendingForm;
    pendingForm = null;
    confirmDialog.close();
    if (form) form.submit();
  });
  confirmDialog.addEventListener('close', () => { pendingForm = null; });
}

document.querySelectorAll('[data-confirm]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    const form = button.closest('form');
    if (!form) return;
    const message = button.getAttribute('data-confirm') || 'Are you sure?';
    if (!materialReady || !window.customElements.get('md-dialog')) {
      if (window.confirm(message)) form.submit();
      return;
    }
    if (!confirmDialog) buildDialog();
    pendingForm = form;
    if (confirmHeading) confirmHeading.textContent = 'Please confirm';
    if (confirmMessage) confirmMessage.textContent = message;
    confirmDialog.show();
  });
});
