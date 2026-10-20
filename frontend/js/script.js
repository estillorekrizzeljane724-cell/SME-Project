/* ============================================================
   JANETH MEAT SHOP - script.js
   Every script in one file, loaded in dependency order.
   Nothing was removed or changed - only joined into one file.

   PART  1 utils      PART  7 router     PART 13 suppliers
   PART  2 api        PART  8 pos        PART 14 sales
   PART  3 ui         PART  9 dashboard  PART 15 analytics
   PART  4 charts     PART 10 products   PART 16 reports
   PART  5 pdf        PART 11 inventory  PART 17 boot
   PART  6 store      PART 12 customers
   ============================================================ */


/* ############################################################
   PART 1 - originally js/core/utils.js
   helpers: formatting, escaping, dates
   ############################################################ */

/* ============================================================
   utils.js — formatting and small DOM helpers.
   Every module reads from here so pesos and kilos look the same
   everywhere in the app.
   ============================================================ */

window.App = window.App || {};

App.utils = (function () {
  'use strict';

  const pesoFmt = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function num(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return digits === 0 ? '0' : '0.00';
    return n.toLocaleString('en-PH', {
      minimumFractionDigits: digits === undefined ? 2 : digits,
      maximumFractionDigits: digits === undefined ? 2 : digits,
    });
  }

  function peso(value) {
    const n = Number(value);
    return '₱' + pesoFmt.format(Number.isFinite(n) ? n : 0);
  }

  function kg(value) {
    return num(value) + ' kg';
  }

  function pct(value) {
    const n = Number(value);
    return (Number.isFinite(n) ? n.toFixed(1) : '0.0') + '%';
  }

  function int(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('en-PH') : '0';
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
  }

  /* ---------------------------------------------------------- dates */

  function parseDate(value) {
    if (!value) return null;
    // MySQL ISO strings parse fine; guard against anything odd.
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
  }

  function formatDateTime(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return d.toLocaleString('en-PH', {
      month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatTime(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  }

  function toISODate(date) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function today() { return toISODate(new Date()); }

  function monthStart() {
    const d = new Date();
    return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return toISODate(d);
  }

  /* ---------------------------------------------------------- DOM */

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function setText(selector, value) {
    const node = typeof selector === 'string' ? $(selector) : selector;
    if (node) node.textContent = value;
  }

  function setHtml(selector, html) {
    const node = typeof selector === 'string' ? $(selector) : selector;
    if (node) node.innerHTML = html;
  }

  function on(root, event, selector, handler) {
    const node = typeof root === 'string' ? $(root) : root;
    if (!node) return;
    node.addEventListener(event, (e) => {
      const match = e.target.closest(selector);
      if (match && node.contains(match)) handler(e, match);
    });
  }

  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait || 280);
    };
  }

  function sum(rows, key) {
    return (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
  }

  /* ---------------------------------------------------------- status maps */

  function statusPill(status) {
    const map = {
      Paid: 'mint', Partial: 'amber', Unpaid: 'rose',
      'In Stock': 'mint', Normal: 'mint', Clear: 'mint',
      'Low Stock': 'amber', Reorder: 'amber', 'With Balance': 'amber',
      'Out of Stock': 'rose', Review: 'rose',
      Restock: 'flame', 'Initial Stock': 'flame',
      Spoilage: 'rose', Adjustment: 'wine',
      Cash: 'mint', GCash: 'flame', Credit: 'amber',
      Retail: 'flame', Wholesale: 'wine',
    };
    const tone = map[status] || 'muted';
    return `<span class="pill ${tone}">${escapeHtml(status)}</span>`;
  }

  return {
    peso, kg, pct, num, int, escapeHtml,
    formatDate, formatDateTime, formatTime, toISODate, today, monthStart, daysAgo,
    $, $$, setText, setHtml, on, debounce, sum, statusPill,
  };
})();

/* ############################################################
   PART 2 - originally js/core/api.js
   fetch wrapper, envelope unwrapping, error surfacing
   ############################################################ */

/* ============================================================
   api.js — the only place that talks to Flask.

   Every call returns the `data` field of the API envelope, or throws an
   Error carrying the server's message. No data is ever cached in
   localStorage: MySQL is the single source of truth.
   ============================================================ */

window.App = window.App || {};

App.api = (function () {
  'use strict';

  // Flask serves the API from the same origin as the page, so same-origin
  // is correct whenever this file is loaded over http(s) — regardless of
  // port, filename or path. The only time it is NOT correct is when the
  // page was opened straight from disk (file://), which has no origin to
  // talk to, so that one case falls back to the default Flask address.
  //
  // If the guess turns out wrong — the page was opened through some other
  // local server instead of "python app.py" — the very first request below
  // detects the failure and retries once against 127.0.0.1:5001 before
  // giving up, so a stray dev server on another port doesn't leave every
  // page looking empty for no visible reason.
  let BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:5001' : '';
  let baseConfirmed = false;
  const FALLBACK = 'http://127.0.0.1:5001';

  let online = null;
  const listeners = [];

  function onStatusChange(fn) { listeners.push(fn); }

  function setOnline(next) {
    if (online === next) return;
    online = next;
    listeners.forEach((fn) => fn(next));
  }

  function qs(params) {
    if (!params) return '';
    const usable = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== '' && v !== 'All'
    );
    if (!usable.length) return '';
    return '?' + usable.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }

  async function attempt(base, path, options) {
    const response = await fetch(base + path, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload = {};
    try { payload = await response.json(); } catch (e) { payload = {}; }
    return { response, payload };
  }

  async function request(path, options = {}) {
    let result;
    try {
      result = await attempt(BASE, path, options);
    } catch (networkError) {
      result = null; // a hard network failure — handled in the fallback block below
    }

    // A response with no `status` field at all did not come from this
    // Flask app (it came from whatever a wrong port or a plain static
    // server sent back — usually an HTML page, which fails the JSON
    // parse in attempt() and leaves payload as {}). That is the same
    // "wrong address" situation as a network error, so it gets the same
    // one-time retry against the Flask default before giving up.
    const looksLikeOurApi = result && result.payload && typeof result.payload.status === 'string';

    if ((!result || !looksLikeOurApi) && !baseConfirmed && BASE !== FALLBACK) {
      try {
        const retry = await attempt(FALLBACK, path, options);
        if (retry.payload && typeof retry.payload.status === 'string') {
          result = retry;
          BASE = FALLBACK;
        }
      } catch (secondError) {
        // fall through — result stays as whatever the first attempt produced
      }
    }

    if (!result || !result.payload || typeof result.payload.status !== 'string') {
      setOnline(false);
      throw new Error(
        'Cannot reach the server. Start the API with "python app.py" in the backend folder, ' +
        'make sure MySQL is running, then reload this page.'
      );
    }

    baseConfirmed = true;
    const { response, payload } = result;

    if (!response.ok || payload.status === 'error') {
      // A 4xx is a rule the server enforced, not a connection problem.
      if (response.status >= 500) setOnline(false); else setOnline(true);
      throw new Error(payload.message || `Request failed (${response.status}).`);
    }

    setOnline(true);
    return payload.data !== undefined ? payload.data : payload;
  }

  const get = (path, params) => request(path + qs(params));
  const post = (path, body) => request(path, { method: 'POST', body });
  const put = (path, body) => request(path, { method: 'PUT', body });
  const del = (path) => request(path, { method: 'DELETE' });

  return {
    get, post, put, del, onStatusChange,
    get BASE() { return BASE; },
    isOnline: () => online,

    health: () => get('/api/health'),

    products: {
      list: (params) => get('/api/products', params),
      one: (id) => get(`/api/products/${id}`),
      create: (body) => post('/api/products', body),
      update: (id, body) => put(`/api/products/${id}`, body),
      archive: (id) => del(`/api/products/${id}`),
    },

    customers: {
      list: (params) => get('/api/customers', params),
      one: (id) => get(`/api/customers/${id}`),
      create: (body) => post('/api/customers', body),
      update: (id, body) => put(`/api/customers/${id}`, body),
      remove: (id) => del(`/api/customers/${id}`),
      payments: () => get('/api/credit-payments'),
      pay: (body) => post('/api/credit-payments', body),
    },

    suppliers: {
      list: (params) => get('/api/suppliers', params),
      one: (id) => get(`/api/suppliers/${id}`),
      create: (body) => post('/api/suppliers', body),
      update: (id, body) => put(`/api/suppliers/${id}`, body),
      remove: (id) => del(`/api/suppliers/${id}`),
    },

    sales: {
      checkout: (body) => post('/api/sales/checkout', body),
      list: (params) => get('/api/sales', params),
      one: (id) => get(`/api/sales/${id}`),
    },

    inventory: {
      summary: () => get('/api/inventory/summary'),
      stock: () => get('/api/inventory/stock'),
      logs: (params) => get('/api/inventory/logs', params),
      purchase: (body) => post('/api/inventory/purchase', body),
      adjust: (body) => post('/api/inventory/adjustment', body),
    },

    analytics: {
      summary: (params) => get('/api/analytics/summary', params),
      daily: (params) => get('/api/analytics/daily', params),
      products: (params) => get('/api/analytics/products', params),
      categories: (params) => get('/api/analytics/categories', params),
      customers: (params) => get('/api/analytics/customers', params),
      paymentMix: (params) => get('/api/analytics/payment-mix', params),
    },

    reports: {
      catalog: () => get('/api/reports/catalog'),
      build: (key, params) => get(`/api/reports/${key}`, params),
    },
  };
})();

/* ############################################################
   PART 3 - originally js/core/ui.js
   toasts, modals, tables, form builder
   ############################################################ */

/* ============================================================
   ui.js — toasts, modals, generated forms and the small renderers
   that every page shares (metric tiles, empty rows, bar lists).
   ============================================================ */

window.App = window.App || {};

App.ui = (function () {
  'use strict';

  const U = App.utils;

  /* ---------------------------------------------------------- toasts */

  const ICONS = {
    ok: 'fa-circle-check',
    warn: 'fa-triangle-exclamation',
    err: 'fa-circle-exclamation',
  };

  function toast(message, tone = 'ok', ms = 4200) {
    const stack = U.$('#toastStack');
    if (!stack) return;

    const node = document.createElement('div');
    node.className = `toast ${tone}`;
    node.innerHTML = `<i class="fa-solid ${ICONS[tone] || ICONS.ok}"></i><div>${U.escapeHtml(message)}</div>`;
    stack.appendChild(node);

    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 200);
    }, ms);
  }

  /* ---------------------------------------------------------- modals */

  function openModal(id) {
    const modal = U.$(id);
    if (modal) modal.classList.add('is-open');
  }

  function closeModal(id) {
    const modal = U.$(id);
    if (modal) modal.classList.remove('is-open');
  }

  function closeAllModals() {
    U.$$('.modal').forEach((m) => m.classList.remove('is-open'));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-modal]')) closeAllModals();
    if (e.target.classList && e.target.classList.contains('modal')) closeAllModals();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  /* ---------------------------------------------------------- forms */

  let activeSubmit = null;

  /**
   * Build and show a form in the shared modal.
   * fields: [{ name, label, type, value, options, required, step, min, span, placeholder, hint }]
   * onSubmit receives a plain object of values and may return a promise.
   */
  function openForm({ title, hint, fields, submitLabel = 'Save', onSubmit }) {
    U.setText('#formModalTitle', title);
    U.setText('#formModalHint', hint || '');

    U.setHtml('#formModalFields', fields.map(fieldHtml).join(''));
    U.setHtml('#formModalSubmit', `<i class="fa-solid fa-floppy-disk"></i>${U.escapeHtml(submitLabel)}`);

    activeSubmit = { fields, onSubmit };
    openModal('#formModal');

    const first = U.$('#formModalFields .input, #formModalFields .select');
    if (first) setTimeout(() => first.focus(), 60);
  }

  function fieldHtml(f) {
    const id = `f_${f.name}`;
    const span = f.span === 'full' ? ' full' : '';
    const required = f.required ? ' required' : '';
    let control;

    if (f.type === 'select') {
      const options = (f.options || []).map((o) => {
        const value = typeof o === 'object' ? o.value : o;
        const label = typeof o === 'object' ? o.label : o;
        const selected = String(value) === String(f.value ?? '') ? ' selected' : '';
        return `<option value="${U.escapeHtml(value)}"${selected}>${U.escapeHtml(label)}</option>`;
      }).join('');
      control = `<select class="select" id="${id}" name="${f.name}"${required}>${options}</select>`;
    } else {
      const attrs = [
        `type="${f.type || 'text'}"`,
        `class="input"`,
        `id="${id}"`,
        `name="${f.name}"`,
        f.value !== undefined && f.value !== null ? `value="${U.escapeHtml(f.value)}"` : '',
        f.placeholder ? `placeholder="${U.escapeHtml(f.placeholder)}"` : '',
        f.step ? `step="${f.step}"` : '',
        f.min !== undefined ? `min="${f.min}"` : '',
        required,
      ].filter(Boolean).join(' ');
      control = `<input ${attrs}>`;
    }

    return `<div class="field${span}">
      <label for="${id}">${U.escapeHtml(f.label)}</label>
      ${control}
      ${f.hint ? `<span class="small-muted">${U.escapeHtml(f.hint)}</span>` : ''}
    </div>`;
  }

  async function submitActiveForm() {
    if (!activeSubmit) return;

    const form = U.$('#modalForm');
    if (!form.reportValidity()) return;

    const values = {};
    activeSubmit.fields.forEach((f) => {
      const node = U.$(`#f_${f.name}`);
      if (!node) return;
      values[f.name] = f.type === 'number'
        ? (node.value === '' ? null : Number(node.value))
        : node.value;
    });

    const button = U.$('#formModalSubmit');
    await withBusy(button, async () => {
      await activeSubmit.onSubmit(values);
      closeAllModals();
    });
  }

  function bindFormControls() {
    U.$('#formModalSubmit')?.addEventListener('click', submitActiveForm);
    U.$('#modalForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitActiveForm();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFormControls);
  } else {
    bindFormControls();
  }

  /**
   * Run an async action while a button shows a spinner. Errors surface as a
   * toast and never leave the button stuck.
   */
  async function withBusy(button, action) {
    const original = button ? button.innerHTML : null;
    if (button) {
      button.classList.add('is-busy');
      button.innerHTML = '<i class="fa-solid fa-circle-notch"></i>Working…';
    }
    try {
      return await action();
    } catch (error) {
      toast(error.message || 'Something went wrong.', 'err', 6500);
      return null;
    } finally {
      if (button) {
        button.classList.remove('is-busy');
        button.innerHTML = original;
      }
    }
  }

  function confirmAction(message, onYes) {
    U.setText('#detailTitle', 'Please confirm');
    U.setText('#detailHint', '');
    U.setHtml('#detailBody', `
      <p style="font-size:.88rem">${U.escapeHtml(message)}</p>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close-modal>Cancel</button>
        <button class="btn btn-danger" id="confirmYes"><i class="fa-solid fa-check"></i>Yes, continue</button>
      </div>`);
    openModal('#detailModal');
    U.$('#confirmYes')?.addEventListener('click', async () => {
      closeAllModals();
      await onYes();
    });
  }

  function openDetail(title, hint, html) {
    U.setText('#detailTitle', title);
    U.setText('#detailHint', hint || '');
    U.setHtml('#detailBody', html);
    openModal('#detailModal');
  }

  /* ---------------------------------------------------------- renderers */

  /** metrics: [{ label, value, note, icon, accent }] */
  function renderMetrics(target, metrics) {
    U.setHtml(target, metrics.map((m) => `
      <div class="card metric ${m.accent ? 'accent-' + m.accent : ''}">
        <div class="metric-top">
          <div class="metric-icon"><i class="fa-solid ${m.icon || 'fa-chart-simple'}"></i></div>
          <div class="metric-label">${U.escapeHtml(m.label)}</div>
        </div>
        <div class="metric-value">${U.escapeHtml(m.value)}</div>
        ${m.note ? `<div class="metric-note">${U.escapeHtml(m.note)}</div>` : ''}
      </div>`).join(''));
  }

  function emptyRow(colspan, message, icon = 'fa-inbox') {
    return `<tr><td colspan="${colspan}">
      <div class="table-empty"><i class="fa-solid ${icon}"></i>${U.escapeHtml(message)}</div>
    </td></tr>`;
  }

  function emptyState(target, message, icon = 'fa-inbox') {
    U.setHtml(target, `<div class="empty-state">
      <i class="fa-solid ${icon}"></i><strong>${U.escapeHtml(message)}</strong>
    </div>`);
  }

  function loadingRow(colspan) {
    return `<tr><td colspan="${colspan}"><div class="table-empty">Loading…</div></td></tr>`;
  }

  /** bars: [{ label, value, amount }] — value drives the fill width. */
  function renderBars(target, bars, formatter) {
    if (!bars.length) return emptyState(target, 'Nothing recorded yet.', 'fa-chart-simple');
    const max = Math.max(...bars.map((b) => Number(b.value) || 0), 1);
    U.setHtml(target, bars.map((b) => `
      <div class="bar-row">
        <div class="bar-top">
          <span>${U.escapeHtml(b.label)}</span>
          <b>${U.escapeHtml(formatter ? formatter(b.value, b) : b.value)}</b>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(3, (Number(b.value) / max) * 100).toFixed(1)}%"></div>
        </div>
      </div>`).join(''));
  }

  return {
    toast, openModal, closeModal, closeAllModals,
    openForm, withBusy, confirmAction, openDetail,
    renderMetrics, renderBars, emptyRow, emptyState, loadingRow,
  };
})();

/* ############################################################
   PART 4 - originally js/core/charts.js
   dependency-free SVG charts
   ############################################################ */

/* ============================================================
   charts.js — hand-drawn SVG charts.

   No chart library: the shapes are simple, the styling lives in CSS, and
   nothing has to download before the dashboard can paint.
   ============================================================ */

window.App = window.App || {};

App.charts = (function () {
  'use strict';

  const U = App.utils;
  const PAD = { top: 14, right: 12, bottom: 22, left: 52 };

  function defs() {
    return `<defs>
      <linearGradient id="revenueFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3D7BFF" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="#3D7BFF" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="barFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6098FF"/>
        <stop offset="100%" stop-color="#1D4ED8" stop-opacity="0.55"/>
      </linearGradient>
    </defs>`;
  }

  function shortPeso(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1000000) return '₱' + (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return '₱' + (n / 1000).toFixed(0) + 'k';
    return '₱' + n.toFixed(0);
  }

  function frame(width, height, max, rows, labelKey) {
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    let svg = '';

    for (let i = 0; i <= 4; i += 1) {
      const y = PAD.top + (innerH / 4) * i;
      const value = max - (max / 4) * i;
      svg += `<line class="chart-grid-line" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${width - PAD.right}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="chart-axis-text" x="${PAD.left - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${shortPeso(value)}</text>`;
    }

    const step = rows.length > 1 ? innerW / (rows.length - 1) : innerW;
    const skip = Math.ceil(rows.length / 8);
    rows.forEach((row, i) => {
      if (i % skip !== 0 && i !== rows.length - 1) return;
      const x = rows.length > 1 ? PAD.left + step * i : PAD.left + innerW / 2;
      svg += `<text class="chart-axis-text" x="${x.toFixed(1)}" y="${height - 5}" text-anchor="middle">${U.escapeHtml(row[labelKey])}</text>`;
    });

    return { svg, innerW, innerH, step };
  }

  /** Revenue area + profit line over time. rows: [{sale_date, revenue, gross_profit}] */
  function revenueTrend(target, rows) {
    const node = typeof target === 'string' ? U.$(target) : target;
    if (!node) return;

    if (!rows || !rows.length) {
      node.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-area"></i><strong>No sales in this period yet.</strong></div>';
      return;
    }

    const width = 700;
    const height = 188;
    const data = rows.map((r) => ({
      label: U.formatDate(r.sale_date).replace(/,.*$/, ''),
      revenue: Number(r.revenue) || 0,
      profit: Number(r.gross_profit) || 0,
    }));

    const max = Math.max(...data.map((d) => d.revenue), 1) * 1.15;
    const base = frame(width, height, max, data, 'label');
    const y = (v) => PAD.top + base.innerH - (v / max) * base.innerH;
    const x = (i) => (data.length > 1 ? PAD.left + base.step * i : PAD.left + base.innerW / 2);

    const linePoints = data.map((d, i) => `${x(i).toFixed(1)},${y(d.revenue).toFixed(1)}`);
    const areaPath = `M${PAD.left},${PAD.top + base.innerH} L${linePoints.join(' L')} L${x(data.length - 1).toFixed(1)},${PAD.top + base.innerH} Z`;
    const profitPoints = data.map((d, i) => `${x(i).toFixed(1)},${y(d.profit).toFixed(1)}`);

    const dots = data.map((d, i) =>
      `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(d.revenue).toFixed(1)}" r="3">
        <title>${U.escapeHtml(d.label)} · revenue ${App.utils.peso(d.revenue)} · profit ${App.utils.peso(d.profit)}</title>
      </circle>`).join('');

    node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${defs()}${base.svg}
      <path class="chart-area" d="${areaPath}"/>
      <polyline class="chart-line" points="${linePoints.join(' ')}"/>
      <polyline class="chart-line" points="${profitPoints.join(' ')}" style="stroke:#34D399;stroke-dasharray:4 4;stroke-width:1.6"/>
      ${dots}
    </svg>`;
  }

  /** Revenue bars with a profit line on the same scale. */
  function revenueBars(target, rows) {
    const node = typeof target === 'string' ? U.$(target) : target;
    if (!node) return;

    if (!rows || !rows.length) {
      node.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-column"></i><strong>No sales in this period yet.</strong></div>';
      return;
    }

    const width = 700;
    const height = 188;
    const data = rows.slice(-14).map((r) => ({
      label: U.formatDate(r.sale_date).replace(/,.*$/, ''),
      revenue: Number(r.revenue) || 0,
      profit: Number(r.gross_profit) || 0,
    }));

    const max = Math.max(...data.map((d) => d.revenue), 1) * 1.15;
    const base = frame(width, height, max, data, 'label');
    const y = (v) => PAD.top + base.innerH - (v / max) * base.innerH;
    const slot = base.innerW / data.length;
    const barW = Math.min(34, slot * 0.58);

    const bars = data.map((d, i) => {
      const cx = PAD.left + slot * i + slot / 2;
      const top = y(d.revenue);
      return `<rect class="chart-bar" x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}"
        width="${barW.toFixed(1)}" height="${Math.max(2, PAD.top + base.innerH - top).toFixed(1)}">
        <title>${U.escapeHtml(d.label)} · ${App.utils.peso(d.revenue)}</title></rect>`;
    }).join('');

    const profitLine = data.map((d, i) =>
      `${(PAD.left + slot * i + slot / 2).toFixed(1)},${y(d.profit).toFixed(1)}`).join(' ');

    node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${defs()}${base.svg}${bars}
      <polyline class="chart-line" points="${profitLine}" style="stroke:#34D399;stroke-width:1.8"/>
    </svg>`;
  }

  return { revenueTrend, revenueBars };
})();

/* ############################################################
   PART 5 - originally js/core/pdf.js
   PDF / CSV / print generation
   ############################################################ */

/* ============================================================
   pdf.js — turns a report payload into a PDF, a CSV or a print sheet.

   A report payload looks like:
     { title, period, generated_at, figures:[{label,value}],
       columns:[...], rows:[[...]], totals:[...], note }

   Any module can build that shape, so new reports need no changes here.
   ============================================================ */

window.App = window.App || {};

App.pdf = (function () {
  'use strict';

  const U = App.utils;
  const SHOP = "Janeth's Meat Shop";
  const ADDRESS = 'Cebu City, Philippines';

  // The built-in PDF fonts have no peso glyph, so it is written as "P".
  function ascii(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/₱/g, 'P ')
      .replace(/[—–]/g, '-')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"');
  }

  function fileName(report) {
    const slug = (report.title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `janeth-${slug}-${U.today()}.pdf`;
  }

  function download(report) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      App.ui.toast('The PDF engine did not load. Check your internet connection and reload.', 'err');
      return;
    }

    const { jsPDF } = window.jspdf;
    const landscape = (report.columns || []).length > 6;
    const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 36;

    /* ---- masthead ---- */
    doc.setFillColor(11, 15, 23);
    doc.rect(0, 0, pageW, 78, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(SHOP, margin, 34);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150, 165, 190);
    doc.text(ADDRESS, margin, 48);

    doc.setTextColor(96, 152, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(ascii(report.title || 'Report'), pageW - margin, 34, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(150, 165, 190);
    doc.text(ascii(report.period || ''), pageW - margin, 47, { align: 'right' });
    doc.text('Generated ' + U.formatDate(report.generated_at || new Date()),
      pageW - margin, 59, { align: 'right' });

    /* ---- headline figures ---- */
    let cursor = 100;
    const figures = report.figures || [];
    if (figures.length) {
      const boxW = (pageW - margin * 2 - (figures.length - 1) * 8) / figures.length;
      figures.forEach((f, i) => {
        const x = margin + i * (boxW + 8);
        doc.setFillColor(243, 246, 251);
        doc.setDrawColor(224, 230, 240);
        doc.roundedRect(x, cursor - 26, boxW, 42, 4, 4, 'FD');
        doc.setFontSize(7.5);
        doc.setTextColor(110, 123, 146);
        doc.text(ascii(f.label), x + 9, cursor - 12);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(17, 25, 38);
        doc.text(ascii(f.value), x + 9, cursor + 4);
        doc.setFont('helvetica', 'normal');
      });
      cursor += 30;
    }

    /* ---- table ---- */
    const body = (report.rows || []).map((row) => row.map(ascii));
    if (report.totals && report.totals.length) body.push(report.totals.map(ascii));
    const totalsIndex = report.totals && report.totals.length ? body.length - 1 : -1;

    doc.autoTable({
      startY: cursor,
      margin: { left: margin, right: margin, bottom: 46 },
      head: [(report.columns || []).map(ascii)],
      body: body.length ? body : [['No records for this period.']],
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 5, textColor: [45, 55, 72] },
      headStyles: { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalsIndex) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [231, 238, 250];
          data.cell.styles.textColor = [17, 25, 38];
        }
      },
    });

    /* ---- footer on every page ---- */
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
      doc.setPage(p);
      const h = doc.internal.pageSize.getHeight();
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, h - 32, pageW - margin, h - 32);
      doc.setFontSize(7.5);
      doc.setTextColor(130, 142, 163);
      doc.text(ascii(report.note || `${SHOP} - system generated report`), margin, h - 19);
      doc.text(`Page ${p} of ${pages}`, pageW - margin, h - 19, { align: 'right' });
    }

    doc.save(fileName(report));
    App.ui.toast('PDF downloaded.', 'ok');
  }

  /* ---------------------------------------------------------- csv */

  function csv(report) {
    const escape = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const lines = [];
    lines.push(escape(report.title));
    lines.push(escape(report.period));
    lines.push('');
    lines.push((report.columns || []).map(escape).join(','));
    (report.rows || []).forEach((row) => lines.push(row.map(escape).join(',')));
    if (report.totals && report.totals.length) lines.push(report.totals.map(escape).join(','));

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(report).replace(/\.pdf$/, '.csv');
    link.click();
    URL.revokeObjectURL(url);
    App.ui.toast('CSV downloaded.', 'ok');
  }

  /* ---------------------------------------------------------- print */

  function print(report) {
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) {
      App.ui.toast('Allow pop-ups for this page to print.', 'warn');
      return;
    }

    const head = (report.columns || []).map((c) => `<th>${U.escapeHtml(c)}</th>`).join('');
    const body = (report.rows || []).map(
      (row) => `<tr>${row.map((c) => `<td>${U.escapeHtml(c)}</td>`).join('')}</tr>`
    ).join('');
    const foot = report.totals && report.totals.length
      ? `<tfoot><tr>${report.totals.map((c) => `<th>${U.escapeHtml(c)}</th>`).join('')}</tr></tfoot>`
      : '';
    const figures = (report.figures || []).map(
      (f) => `<div class="fig"><span>${U.escapeHtml(f.label)}</span><b>${U.escapeHtml(f.value)}</b></div>`
    ).join('');

    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${U.escapeHtml(report.title)}</title>
      <style>
        body{font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;}
        h1{font-size:18px;margin:0;} .sub{color:#667;font-size:11px;margin:4px 0 16px;}
        .figs{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
        .fig{border:1px solid #dde3ec;border-radius:6px;padding:8px 12px;min-width:130px;}
        .fig span{display:block;color:#667;font-size:10px;} .fig b{font-size:14px;}
        table{width:100%;border-collapse:collapse;font-size:11px;}
        th,td{border-bottom:1px solid #e3e8f0;padding:6px 8px;text-align:left;}
        thead th{background:#1D4ED8;color:#fff;} tfoot th{background:#eef3fb;}
        @media print{@page{margin:14mm;}}
      </style></head><body>
      <h1>${U.escapeHtml(report.title)} — Janeth's Meat Shop</h1>
      <div class="sub">${U.escapeHtml(report.period)} · generated ${U.formatDate(report.generated_at || new Date())}</div>
      <div class="figs">${figures}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
      </body></html>`);

    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  }

  /** Build a report payload from rows already on screen. */
  function fromRows({ title, period, columns, rows, figures, totals, note }) {
    return {
      title, period: period || 'All recorded activity',
      generated_at: new Date().toISOString(),
      columns, rows, figures: figures || [], totals: totals || [], note,
    };
  }

  return { download, csv, print, fromRows, ascii };
})();

/* ############################################################
   PART 6 - originally js/core/store.js
   in-memory cache, refilled from MySQL after every write
   ############################################################ */

/* ============================================================
   store.js — one in-memory copy of the reference data.

   The copy is a render cache only. It is refilled from MySQL after every
   write, so the screen can never drift from the database. Nothing is
   persisted in the browser.
   ============================================================ */

window.App = window.App || {};

App.store = (function () {
  'use strict';

  const U = App.utils;

  const state = {
    products: [],
    customers: [],
    suppliers: [],
    summary: null,
    loaded: false,
  };

  const subscribers = [];

  function subscribe(fn) { subscribers.push(fn); }

  function notify(reason) {
    subscribers.forEach((fn) => {
      try { fn(state, reason); } catch (e) { console.error(e); }
    });
    paintNavCounts();
  }

  function paintNavCounts() {
    const lowStock = state.products.filter(
      (p) => Number(p.stock_kilos) <= Number(p.reorder_level_kilos)
    ).length;

    const counts = {
      products: state.products.length ? String(state.products.length) : '',
      suppliers: state.suppliers.length ? String(state.suppliers.length) : '',
      customers: state.customers.length ? String(state.customers.length) : '',
      lowStock: lowStock ? String(lowStock) : '',
    };

    U.$$('[data-count]').forEach((node) => {
      node.textContent = counts[node.dataset.count] || '';
    });
  }

  /** Reload products, customers and suppliers together. */
  async function refresh(reason = 'refresh') {
    const [products, customers, suppliers] = await Promise.all([
      App.api.products.list({ category: 'All' }),
      App.api.customers.list(),
      App.api.suppliers.list(),
    ]);

    state.products = products || [];
    state.customers = customers || [];
    state.suppliers = suppliers || [];
    state.loaded = true;

    notify(reason);
    return state;
  }

  async function refreshSummary(params) {
    state.summary = await App.api.analytics.summary(params || {});
    return state.summary;
  }

  /* ---------------------------------------------------------- lookups */

  const productById = (id) => state.products.find((p) => String(p.id) === String(id));
  const customerById = (id) => state.customers.find((c) => String(c.id) === String(id));
  const supplierById = (id) => state.suppliers.find((s) => String(s.id) === String(id));

  function productOptions() {
    return state.products.map((p) => ({
      value: p.id,
      label: `${p.meat_cut} — ${U.num(p.stock_kilos)} kg on hand`,
    }));
  }

  function supplierOptions(includeBlank = true) {
    const options = state.suppliers.map((s) => ({ value: s.id, label: s.supplier_name }));
    return includeBlank ? [{ value: '', label: 'No supplier linked' }].concat(options) : options;
  }

  function customerOptions(includeWalkIn = true) {
    const options = state.customers.map((c) => ({
      value: c.id,
      label: `${c.full_name} (${c.customer_type})`,
    }));
    return includeWalkIn ? [{ value: '', label: 'Walk-in customer' }].concat(options) : options;
  }

  /* ---------------------------------------------------------- status */

  function paintConnection(isOnline) {
    const label = isOnline ? 'Database connected' : 'Database offline';
    ['#connectionText', '#connectionText2'].forEach((sel) => U.setText(sel, label));
    ['#connectionBadge', '#connectionBadge2'].forEach((sel) => {
      const node = U.$(sel);
      if (node) node.classList.toggle('is-offline', !isOnline);
    });
  }

  App.api.onStatusChange(paintConnection);

  return {
    state, subscribe, notify, refresh, refreshSummary,
    productById, customerById, supplierById,
    productOptions, supplierOptions, customerOptions,
    paintNavCounts,
  };
})();

/* ############################################################
   PART 7 - originally js/core/router.js
   page lifecycle across the separate HTML files
   ############################################################ */

/* ============================================================
   router.js — wakes the module that belongs to the open HTML file.

   Each page is now its own file (pos.html, products.html, …).
   <body data-page="products"> tells the router which module to run,
   so only that one page's code touches the DOM.

   A module registers itself with `App.router.register(name, module)`.
   `mount()` runs once when the page opens;
   `refresh()` runs when the data is reloaded on the same page.

   `App.router.go('reports')` still works from anywhere — if that page
   is a different file the browser simply navigates to it.
   ============================================================ */

window.App = window.App || {};

App.router = (function () {
  'use strict';

  const U = App.utils;
  const modules = {};
  const mounted = {};
  let current = null;

  const TITLES = {
    pos: ['POS Terminal', 'Weigh, price and check out'],
    dashboard: ['Dashboard', 'Today at a glance'],
    products: ['Products', 'Catalogue, pricing and margin'],
    inventory: ['Inventory', 'Stock, deliveries and losses'],
    customers: ['Customers & credit', 'Balances and collections'],
    suppliers: ['Suppliers', 'Vendors and purchasing'],
    sales: ['Sales history', 'Completed transactions'],
    analytics: ['Sales & profit', 'Revenue against cost of goods'],
    reports: ['Reports', 'Printable records and PDF exports'],
  };

  function register(name, module) { modules[name] = module; }

  /** The page this HTML file represents. */
  function pageOf(doc) {
    return (doc || document).body.dataset.page || 'pos';
  }

  async function go(name) {
    if (!TITLES[name]) name = 'pos';

    // Different file? Let the browser open it. The script boots again there.
    if (name !== pageOf()) {
      window.location.href = name + '.html';
      return;
    }

    current = name;

    const isPos = name === 'pos';
    document.body.classList.toggle('is-pos', isPos);
    document.body.classList.toggle('is-page', !isPos);

    U.$$('.nav-item').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.page === name);
    });

    if (!isPos) {
      U.setText('#pageTitle', TITLES[name][0]);
      U.setText('#pageSubtitle', TITLES[name][1]);
      U.$$('.page-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === `page-${name}`);
      });
      const scroll = U.$('#pageScroll');
      if (scroll) scroll.scrollTop = 0;
    }

    const module = modules[name];
    if (!module) return;

    try {
      if (!mounted[name] && typeof module.mount === 'function') {
        await module.mount();
        mounted[name] = true;
      } else if (typeof module.refresh === 'function') {
        await module.refresh();
      }
    } catch (error) {
      App.ui.toast(error.message || 'This page could not load.', 'err', 6000);
    }
  }

  function init(defaultPage) {
    // Nav items are ordinary <a href="page.html"> links now, so the browser
    // handles them. We only mount the module for the file that is open.
    go(defaultPage || pageOf());
  }

  /**
   * Let any module ask another page to reload next time it is shown.
   * The page that is currently open is never un-mounted, otherwise its
   * mount() would run a second time and bind its buttons twice.
   */
  function invalidate(name) {
    const open = pageOf();
    if (name) {
      if (name !== open) mounted[name] = false;
      return;
    }
    Object.keys(mounted).forEach((k) => { if (k !== open) mounted[k] = false; });
  }

  return { register, go, init, invalidate, pageOf, currentPage: () => current || pageOf() };
})();

/* ############################################################
   PART 8 - originally js/modules/pos.js
   POS terminal
   ############################################################ */

/* ============================================================
   pos.js — the counter.

   Prices shown here come from MySQL, and the server re-reads them at
   checkout, so an edited price can never reach the till.
   ============================================================ */

window.App = window.App || {};

App.pos = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  let cart = [];
  let method = 'Cash';
  let category = 'All';
  let search = '';

  /* ---------------------------------------------------------- catalogue */

  function visibleProducts() {
    const q = search.trim().toLowerCase();
    return App.store.state.products.filter((p) => {
      if (category !== 'All' && p.category !== category) return false;
      if (!q) return true;
      return p.meat_cut.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    });
  }

  function renderCatalog() {
    const grid = U.$('#productGrid');
    if (!grid) return;

    const items = visibleProducts();

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <i class="fa-solid fa-magnifying-glass"></i>
        <strong>Nothing matches that search</strong>
        <span>Try another cut name or pick a different category.</span>
      </div>`;
      return;
    }

    grid.innerHTML = items.map((p) => {
      const stock = Number(p.stock_kilos);
      const low = stock <= Number(p.reorder_level_kilos);
      const out = stock <= 0;
      const stockClass = out ? 'is-out' : (low ? 'is-low' : '');

      return `<article class="product-card ${out ? 'is-out' : ''}" data-id="${p.id}">
        <div class="product-meta">
          <span class="tag cat-${U.escapeHtml(p.category)}">${U.escapeHtml(p.category)}</span>
          <span class="stock-tag ${stockClass}">${U.num(stock)} kg</span>
        </div>
        <div class="product-name">${U.escapeHtml(p.meat_cut)}</div>
        <div class="product-price">${U.peso(p.price_per_kilo)} <small>/ kg</small></div>
        <button class="add-btn" data-add="${p.id}" ${out ? 'disabled' : ''}>
          <i class="fa-solid ${out ? 'fa-ban' : 'fa-cart-plus'}"></i>
          ${out ? 'Out of stock' : 'Add to order'}
        </button>
      </article>`;
    }).join('');
  }

  /* ---------------------------------------------------------- cart */

  function cartTotal() {
    return cart.reduce((t, i) => t + i.price * i.weight, 0);
  }

  function cartWeight() {
    return cart.reduce((t, i) => t + i.weight, 0);
  }

  function addToCart(id) {
    const product = App.store.productById(id);
    if (!product) return;

    const stock = Number(product.stock_kilos);
    if (stock <= 0) {
      UI.toast(`${product.meat_cut} is out of stock.`, 'warn');
      return;
    }

    const existing = cart.find((i) => String(i.id) === String(id));
    if (existing) {
      const next = Number((existing.weight + 0.5).toFixed(2));
      if (next > stock) {
        UI.toast(`Only ${U.num(stock)} kg of ${product.meat_cut} is left.`, 'warn');
        return;
      }
      existing.weight = next;
    } else {
      cart.push({
        id: product.id,
        name: product.meat_cut,
        price: Number(product.price_per_kilo),
        stock,
        weight: Math.min(1, stock),
      });
    }
    renderCart();
  }

  function setWeight(id, value) {
    const item = cart.find((i) => String(i.id) === String(id));
    if (!item) return;

    const weight = Number(value);
    if (!Number.isFinite(weight) || weight <= 0) { removeItem(id); return; }

    if (weight > item.stock) {
      UI.toast(`Only ${U.num(item.stock)} kg of ${item.name} is on hand.`, 'warn');
      item.weight = item.stock;
    } else {
      item.weight = Number(weight.toFixed(2));
    }
    renderCart();
  }

  function removeItem(id) {
    cart = cart.filter((i) => String(i.id) !== String(id));
    renderCart();
  }

  function clearCart() {
    cart = [];
    const paid = U.$('#amountPaid');
    if (paid) paid.value = '';
    renderCart();
  }

  function renderCart() {
    const list = U.$('#cartList');
    if (!list) return;

    if (!cart.length) {
      list.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-basket-shopping"></i>
        <strong>No items yet</strong>
        <span>Pick a cut on the left, then set the weight.</span>
      </div>`;
    } else {
      list.innerHTML = cart.map((i) => `
        <div class="cart-item">
          <div class="cart-item-top">
            <div>
              <div class="cart-item-name">${U.escapeHtml(i.name)}</div>
              <div class="cart-item-sub">${U.peso(i.price)} / kg</div>
            </div>
            <div class="cart-item-price num">${U.peso(i.price * i.weight)}</div>
          </div>
          <div class="cart-item-bottom">
            <div class="weight-control">
              <label for="w_${i.id}">Weight</label>
              <input class="weight-input" id="w_${i.id}" type="number" min="0.1"
                     step="0.05" max="${i.stock}" value="${i.weight}" data-weight="${i.id}">
              <span class="small-muted">kg</span>
            </div>
            <button class="remove-btn" data-remove="${i.id}" title="Remove">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>`).join('');
    }

    const total = cartTotal();
    U.setText('#cartCount', String(cart.length));
    U.setText('#cartWeight', U.kg(cartWeight()));
    U.setText('#cartTotal', U.peso(total));
    U.setText('#cartMeta', cart.length
      ? `${cart.length} item${cart.length > 1 ? 's' : ''} · ${U.kg(cartWeight())}`
      : 'No items yet');

    updateChange();
  }

  /* ---------------------------------------------------------- payment */

  function setMethod(next) {
    method = next;
    U.$$('#payGrid .pay-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.method === next));
    U.setText('#amountPaidLabel', next === 'Credit' ? 'Down payment (optional)' : 'Amount received');
    updateChange();
  }

  function updateChange() {
    const total = cartTotal();
    const paid = Number(U.$('#amountPaid')?.value || 0);
    const line = U.$('#changeLine');
    if (!line) return;

    if (method === 'Credit') {
      const due = Math.max(0, total - paid);
      line.innerHTML = `<span>On credit</span><b class="text-amber">${U.peso(due)}</b>`;
    } else {
      const change = paid - total;
      line.innerHTML = change < 0
        ? `<span>Short by</span><b class="text-rose">${U.peso(Math.abs(change))}</b>`
        : `<span>Change</span><b>${U.peso(change)}</b>`;
    }
  }

  function fillCustomers() {
    const select = U.$('#cartCustomer');
    if (!select) return;
    const keep = select.value;
    select.innerHTML = App.store.customerOptions().map(
      (o) => `<option value="${o.value}">${U.escapeHtml(o.label)}</option>`
    ).join('');
    select.value = keep;
  }

  /* ---------------------------------------------------------- checkout */

  async function checkout() {
    if (!cart.length) { UI.toast('Add at least one item first.', 'warn'); return; }

    const total = cartTotal();
    const customerId = U.$('#cartCustomer').value || null;
    const paidField = U.$('#amountPaid');
    let paid = Number(paidField.value || 0);

    if (method !== 'Credit') {
      if (!paidField.value) paid = total;           // exact money handed over
      if (paid < total - 0.0001) {
        UI.toast(`Amount received is short by ${U.peso(total - paid)}.`, 'warn');
        paidField.focus();
        return;
      }
    } else if (!customerId) {
      UI.toast('Pick a customer before selling on credit.', 'warn');
      return;
    }

    const payload = {
      customer_id: customerId ? Number(customerId) : null,
      payment_method: method,
      amount_paid: Number(paid.toFixed(2)),
      items: cart.map((i) => ({ product_id: i.id, weight_kilos: i.weight })),
    };

    const button = U.$('#checkoutBtn');
    const result = await UI.withBusy(button, () => App.api.sales.checkout(payload));
    if (!result) return;

    showReceipt(result);
    clearCart();
    setMethod('Cash');

    await App.store.refresh('sale');
    App.router.invalidate();              // other pages reload their figures
    renderCatalog();
    UI.toast(`Sale #${result.sale_id} saved to the database.`, 'ok');
  }

  function showReceipt(sale) {
    U.setText('#receiptId', `Sale #${sale.sale_id}`);
    U.setText('#receiptHint', `${sale.payment_method} · ${sale.payment_status}`);

    U.setHtml('#receiptItems', sale.items.map((i) => `
      <div class="receipt-line">
        <span>${U.escapeHtml(i.meat_cut)} · ${U.num(i.weight_kilos)} kg</span>
        <span>${U.peso(i.subtotal)}</span>
      </div>`).join(''));

    const customer = U.$('#cartCustomer');
    const name = customer && customer.value
      ? customer.options[customer.selectedIndex].text
      : 'Walk-in customer';

    const rows = [
      ['Customer', name],
      ['Payment', sale.payment_method],
      ['Amount paid', U.peso(sale.amount_paid)],
    ];
    if (sale.payment_method === 'Credit') rows.push(['Balance on credit', U.peso(sale.outstanding)]);
    else rows.push(['Change', U.peso(sale.change)]);
    rows.push(['Date', U.formatDateTime(new Date())]);

    U.setHtml('#receiptMeta', rows.map(
      ([k, v]) => `<div class="receipt-line"><span>${k}</span><span>${U.escapeHtml(v)}</span></div>`
    ).join(''));

    U.setText('#receiptTotal', U.peso(sale.total));
    UI.openModal('#receiptModal');
  }

  function printReceipt() {
    const receipt = U.$('#receiptModal .receipt');
    if (!receipt) return;
    const win = window.open('', '_blank', 'width=420,height=640');
    if (!win) { UI.toast('Allow pop-ups to print the receipt.', 'warn'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
      <style>
        body{font:12px/1.6 -apple-system,Segoe UI,Roboto,monospace;margin:18px;color:#000;}
        .receipt-head{text-align:center;border-bottom:1px dashed #999;padding-bottom:10px;}
        .receipt-line{display:flex;justify-content:space-between;padding:3px 0;}
        .receipt-body{padding:10px 0;border-bottom:1px dashed #999;}
        .receipt-total{display:flex;justify-content:space-between;padding-top:10px;font-weight:700;font-size:15px;}
      </style></head><body>${receipt.innerHTML}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 250);
  }

  /* ---------------------------------------------------------- wiring */

  function mount() {
    U.on('#productGrid', 'click', '[data-add]', (e, node) => addToCart(node.dataset.add));

    U.on('#cartList', 'change', '[data-weight]', (e, node) => setWeight(node.dataset.weight, node.value));
    U.on('#cartList', 'click', '[data-remove]', (e, node) => removeItem(node.dataset.remove));

    U.on('#categoryBar', 'click', '.chip', (e, node) => {
      category = node.dataset.category;
      U.$$('#categoryBar .chip').forEach((c) => c.classList.toggle('is-active', c === node));
      renderCatalog();
    });

    U.$('#posSearch')?.addEventListener('input', U.debounce((e) => {
      search = e.target.value;
      renderCatalog();
    }, 180));

    U.on('#payGrid', 'click', '.pay-btn', (e, node) => setMethod(node.dataset.method));
    U.$('#amountPaid')?.addEventListener('input', updateChange);
    U.$('#clearCart')?.addEventListener('click', clearCart);
    U.$('#checkoutBtn')?.addEventListener('click', checkout);
    U.$('#receiptPrint')?.addEventListener('click', printReceipt);

    App.store.subscribe(() => { renderCatalog(); fillCustomers(); });

    renderCatalog();
    fillCustomers();
    renderCart();
  }

  function refresh() { renderCatalog(); fillCustomers(); }

  return { mount, refresh };
})();

App.router.register('pos', App.pos);

/* ############################################################
   PART 9 - originally js/modules/dashboard.js
   dashboard
   ############################################################ */

/* ============================================================
   dashboard.js — the shop in one screen: revenue, cost of goods,
   gross profit, capital tied up in stock and money still owed.
   ============================================================ */

window.App = window.App || {};

App.dashboard = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  async function load() {
    const [summary, daily, sales, products] = await Promise.all([
      App.api.analytics.summary(),
      App.api.analytics.daily({ start_date: U.daysAgo(29) }),
      App.api.sales.list({ limit: 8 }),
      App.api.analytics.products(),
    ]);

    paintHero(summary);
    paintMetrics(summary);
    App.charts.revenueTrend('#dashChart', daily);
    paintRecentSales(sales);
    paintTopProducts(products);
    paintAlerts(summary);
  }

  function paintHero(s) {
    U.setText('#heroRevenue', U.peso(s.revenue));
    U.setText('#heroProfit', U.peso(s.gross_profit));
    U.setText('#heroMargin', U.pct(s.gross_margin_percent));
    U.setText('#heroKilos', U.num(s.kilos_sold));
    U.setText('#heroTxn', U.int(s.transaction_count));
    U.setText('#heroSub',
      `${U.int(s.active_products)} products on sale · average sale ${U.peso(s.average_sale_value)}`);
  }

  function paintMetrics(s) {
    UI.renderMetrics('#dashMetrics', [
      { label: 'Revenue', value: U.peso(s.revenue), note: 'All completed sales', icon: 'fa-peso-sign' },
      { label: 'Cost of goods sold', value: U.peso(s.cogs), note: 'What the meat sold cost you', icon: 'fa-coins', accent: 'amber' },
      { label: 'Gross profit', value: U.peso(s.gross_profit), note: `${U.pct(s.gross_margin_percent)} margin`, icon: 'fa-arrow-trend-up', accent: 'mint' },
      { label: 'Inventory capital', value: U.peso(s.inventory_purchases), note: 'Spent on stock to date', icon: 'fa-truck-ramp-box', accent: 'violet' },
      { label: 'Current inventory value', value: U.peso(s.inventory_value), note: `${U.kg(s.stock_kilos)} on hand at cost`, icon: 'fa-warehouse', accent: 'cyan' },
      { label: 'Credit outstanding', value: U.peso(s.credit_outstanding), note: `${U.int(s.accounts_with_balance)} accounts with a balance`, icon: 'fa-hand-holding-dollar', accent: 'rose' },
    ]);
  }

  function paintRecentSales(sales) {
    const body = U.$('#dashRecentSales');
    if (!body) return;
    if (!sales.length) { body.innerHTML = UI.emptyRow(5, 'No sales recorded yet.', 'fa-receipt'); return; }

    body.innerHTML = sales.map((s) => `
      <tr>
        <td><strong>#${s.id}</strong></td>
        <td>${U.formatTime(s.created_at)}</td>
        <td>${U.escapeHtml(s.customer_name)}</td>
        <td>${U.statusPill(s.payment_method)}</td>
        <td class="num">${U.peso(s.total_amount)}</td>
      </tr>`).join('');
  }

  function paintTopProducts(products) {
    const top = products.filter((p) => Number(p.revenue) > 0).slice(0, 6);
    UI.renderBars('#dashTopProducts',
      top.map((p) => ({ label: p.meat_cut, value: Number(p.gross_profit) })),
      (v) => U.peso(v));
  }

  function paintAlerts(s) {
    const alerts = [];

    if (Number(s.low_stock_count) > 0) {
      alerts.push({
        tone: '',
        icon: 'fa-triangle-exclamation',
        text: `${U.int(s.low_stock_count)} product${Number(s.low_stock_count) > 1 ? 's are' : ' is'} at or below the reorder level. Open Inventory to receive a delivery.`,
      });
    }

    if (Number(s.credit_outstanding) > 0) {
      alerts.push({
        tone: '',
        icon: 'fa-hand-holding-dollar',
        text: `${U.peso(s.credit_outstanding)} in utang is still owed across ${U.int(s.accounts_with_balance)} account(s).`,
      });
    }

    if (!alerts.length) {
      alerts.push({ tone: 'is-clear', icon: 'fa-circle-check', text: 'Stock levels are healthy and no customer owes money.' });
    }

    U.setHtml('#dashAlerts', alerts.map((a) => `
      <div class="alert ${a.tone}"><i class="fa-solid ${a.icon}"></i><div>${U.escapeHtml(a.text)}</div></div>`).join(''));
  }

  return { mount: load, refresh: load };
})();

App.router.register('dashboard', App.dashboard);

/* ############################################################
   PART 10 - originally js/modules/products.js
   products
   ############################################################ */

/* ============================================================
   products.js — catalogue with cost, price, profit per kilo and margin.
   Saving writes to MySQL and the POS picks it up immediately.
   ============================================================ */

window.App = window.App || {};

App.products = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  const CATEGORIES = ['Pork', 'Beef', 'Chicken', 'Processed', 'Offal'];
  let lowStockOnly = false;
  let rows = [];

  async function load() {
    const body = U.$('#productTable');
    if (body) body.innerHTML = UI.loadingRow(10);

    rows = await App.api.products.list({
      search: U.$('#productSearch')?.value || '',
      category: U.$('#productCategoryFilter')?.value || 'All',
      low_stock: lowStockOnly ? '1' : '',
    });

    paintMetrics();
    paintTable();
  }

  function paintMetrics() {
    const all = App.store.state.products;
    const avgPrice = all.length ? U.sum(all, 'price_per_kilo') / all.length : 0;
    const avgMargin = all.length ? U.sum(all, 'margin_percent') / all.length : 0;
    const stockValue = all.reduce((t, p) => t + Number(p.stock_kilos) * Number(p.cost_per_kilo), 0);
    const low = all.filter((p) => Number(p.stock_kilos) <= Number(p.reorder_level_kilos)).length;

    UI.renderMetrics('#productMetrics', [
      { label: 'Active products', value: U.int(all.length), note: 'Listed in the POS', icon: 'fa-drumstick-bite' },
      { label: 'Average selling price', value: U.peso(avgPrice) + ' / kg', note: 'Across the catalogue', icon: 'fa-tag', accent: 'cyan' },
      { label: 'Average margin', value: U.pct(avgMargin), note: 'Selling price against cost', icon: 'fa-percent', accent: 'mint' },
      { label: 'Stock value at cost', value: U.peso(stockValue), note: `${low} item(s) need reordering`, icon: 'fa-warehouse', accent: low ? 'amber' : 'violet' },
    ]);
  }

  function paintTable() {
    const body = U.$('#productTable');
    if (!body) return;

    if (!rows.length) {
      body.innerHTML = UI.emptyRow(10, 'No products match these filters.', 'fa-drumstick-bite');
      return;
    }

    body.innerHTML = rows.map((p) => `
      <tr>
        <td><strong>${U.escapeHtml(p.meat_cut)}</strong></td>
        <td><span class="tag cat-${U.escapeHtml(p.category)}">${U.escapeHtml(p.category)}</span></td>
        <td class="num">${U.peso(p.cost_per_kilo)}</td>
        <td class="num">${U.peso(p.price_per_kilo)}</td>
        <td class="num text-mint">${U.peso(p.profit_per_kilo)}</td>
        <td class="num">${U.pct(p.margin_percent)}</td>
        <td class="num">${U.num(p.stock_kilos)} kg</td>
        <td>${U.escapeHtml(p.supplier_name || '—')}</td>
        <td>${U.statusPill(p.stock_status)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm" data-edit="${p.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-archive="${p.id}"><i class="fa-solid fa-box-archive"></i></button>
          </div>
        </td>
      </tr>`).join('');
  }

  /* ---------------------------------------------------------- forms */

  function fields(product) {
    const base = [
      { name: 'meat_cut', label: 'Product name', value: product?.meat_cut, required: true, span: 'full', placeholder: 'e.g. Pork Liempo' },
      { name: 'category', label: 'Category', type: 'select', options: CATEGORIES, value: product?.category },
      { name: 'supplier_id', label: 'Supplier', type: 'select', options: App.store.supplierOptions(), value: product?.supplier_id ?? '' },
      { name: 'reorder_level_kilos', label: 'Reorder level (kg)', type: 'number', step: '0.01', min: 0, value: product?.reorder_level_kilos ?? 5 },
      { name: 'cost_per_kilo', label: 'Supplier cost / kg', type: 'number', step: '0.01', min: 0, value: product?.cost_per_kilo ?? '', required: true },
      { name: 'price_per_kilo', label: 'Selling price / kg', type: 'number', step: '0.01', min: 0, value: product?.price_per_kilo ?? '', required: true },
    ];

    if (!product) {
      base.push({
        name: 'stock_kilos', label: 'Opening stock (kg)', type: 'number',
        step: '0.01', min: 0, value: 0,
        hint: 'Logged as opening stock in the inventory history.',
      });
    }
    return base;
  }

  function openCreate() {
    UI.openForm({
      title: 'New product',
      hint: 'Saved to MySQL and available at the till straight away.',
      fields: fields(null),
      submitLabel: 'Save product',
      onSubmit: async (values) => {
        const result = await App.api.products.create(values);
        UI.toast(`${values.meat_cut} saved.`, 'ok');
        await App.store.refresh('product');
        await load();
        return result;
      },
    });
  }

  function openEdit(id) {
    const product = rows.find((p) => String(p.id) === String(id)) || App.store.productById(id);
    if (!product) return;

    UI.openForm({
      title: `Edit ${product.meat_cut}`,
      hint: 'Stock is changed through Inventory, not here, so the history stays accurate.',
      fields: fields(product),
      submitLabel: 'Save changes',
      onSubmit: async (values) => {
        await App.api.products.update(id, values);
        UI.toast(`${values.meat_cut} updated.`, 'ok');
        await App.store.refresh('product');
        await load();
      },
    });
  }

  function archive(id) {
    const product = rows.find((p) => String(p.id) === String(id));
    UI.confirmAction(
      `Archive ${product ? product.meat_cut : 'this product'}? It disappears from the POS but past sales keep their records.`,
      async () => {
        try {
          await App.api.products.archive(id);
          UI.toast('Product archived.', 'ok');
          await App.store.refresh('product');
          await load();
        } catch (e) { UI.toast(e.message, 'err'); }
      }
    );
  }

  /* ---------------------------------------------------------- wiring */

  function mount() {
    U.$('#openProductForm')?.addEventListener('click', openCreate);
    U.$('#productSearch')?.addEventListener('input', U.debounce(load, 260));
    U.$('#productCategoryFilter')?.addEventListener('change', load);

    U.$('#productLowStockToggle')?.addEventListener('click', (e) => {
      lowStockOnly = !lowStockOnly;
      e.currentTarget.classList.toggle('btn-primary', lowStockOnly);
      load();
    });

    U.on('#productTable', 'click', '[data-edit]', (e, node) => openEdit(node.dataset.edit));
    U.on('#productTable', 'click', '[data-archive]', (e, node) => archive(node.dataset.archive));

    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('products', App.products);

/* ############################################################
   PART 11 - originally js/modules/inventory.js
   inventory
   ############################################################ */

/* ============================================================
   inventory.js — stock on hand, deliveries, write-offs and the full
   movement history. Receiving a delivery also updates the cost basis
   used for margin, so profit figures stay honest.
   ============================================================ */

window.App = window.App || {};

App.inventory = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  async function load() {
    const [summary, stock, logs] = await Promise.all([
      App.api.inventory.summary(),
      App.api.inventory.stock(),
      App.api.inventory.logs({ log_type: U.$('#logTypeFilter')?.value || 'All', limit: 150 }),
    ]);

    paintMetrics(summary);
    paintStock(stock);
    paintLowStock(summary.low_stock || []);
    paintLogs(logs);
  }

  function paintMetrics(s) {
    UI.renderMetrics('#inventoryMetrics', [
      { label: 'Stock on hand', value: U.kg(s.stock_kilos), note: `${U.int(s.product_count)} active products`, icon: 'fa-box-open' },
      { label: 'Inventory value at cost', value: U.peso(s.inventory_value), note: `Worth ${U.peso(s.retail_value)} at retail`, icon: 'fa-warehouse', accent: 'cyan' },
      { label: 'Capital spent on stock', value: U.peso(s.inventory_purchases), note: `${U.kg(s.restocked_kilos)} received to date`, icon: 'fa-truck-ramp-box', accent: 'violet' },
      { label: 'Waste and shrinkage', value: U.kg(s.loss_kilos), note: `${U.peso(s.loss_value)} written off`, icon: 'fa-scale-unbalanced-flip', accent: Number(s.loss_kilos) > 0 ? 'amber' : 'mint' },
    ]);
  }

  function paintStock(rows) {
    const body = U.$('#stockTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(7, 'No active products yet.', 'fa-box-open'); return; }

    body.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${U.escapeHtml(r.meat_cut)}</strong></td>
        <td><span class="tag cat-${U.escapeHtml(r.category)}">${U.escapeHtml(r.category)}</span></td>
        <td class="num">${U.num(r.stock_kilos)} kg</td>
        <td class="num">${U.num(r.reorder_level_kilos)} kg</td>
        <td class="num">${U.peso(r.stock_value)}</td>
        <td>${U.escapeHtml(r.supplier_name || '—')}</td>
        <td>${U.statusPill(r.stock_status)}</td>
      </tr>`).join('');
  }

  function paintLowStock(rows) {
    if (!rows.length) {
      U.setHtml('#lowStockList', `<div class="alert is-clear">
        <i class="fa-solid fa-circle-check"></i>
        <div>Every product is above its reorder level.</div></div>`);
      return;
    }

    U.setHtml('#lowStockList', rows.map((r) => `
      <div class="alert">
        <i class="fa-solid fa-circle-exclamation"></i>
        <div><b>${U.escapeHtml(r.meat_cut)}</b> — ${U.num(r.stock_kilos)} kg left,
        reorder at ${U.num(r.reorder_level_kilos)} kg.</div>
      </div>`).join('') + `
      <button class="btn btn-primary btn-block mt-14" id="lowStockRestock">
        <i class="fa-solid fa-truck-ramp-box"></i>Receive a delivery
      </button>`);

    U.$('#lowStockRestock')?.addEventListener('click', openRestock);
  }

  function paintLogs(rows) {
    const body = U.$('#logTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(8, 'No stock movements recorded yet.', 'fa-clock-rotate-left'); return; }

    body.innerHTML = rows.map((r) => {
      const kilos = Number(r.added_kilos);
      const sign = kilos >= 0 ? '+' : '';
      const tone = kilos >= 0 ? 'text-mint' : 'text-rose';
      return `<tr>
        <td>${U.formatDateTime(r.logged_at)}</td>
        <td><strong>${U.escapeHtml(r.meat_cut)}</strong></td>
        <td>${U.statusPill(r.log_type)}</td>
        <td class="num ${tone}">${sign}${U.num(kilos)} kg</td>
        <td class="num">${U.peso(r.cost_per_kilo)}</td>
        <td class="num">${U.peso(Math.abs(Number(r.total_cost)))}</td>
        <td>${U.escapeHtml(r.supplier_name || '—')}</td>
        <td>${U.escapeHtml(r.notes || '—')}</td>
      </tr>`;
    }).join('');
  }

  /* ---------------------------------------------------------- actions */

  function openRestock() {
    if (!App.store.state.products.length) {
      UI.toast('Add a product before recording a delivery.', 'warn');
      return;
    }

    UI.openForm({
      title: 'Receive a delivery',
      hint: 'Adds kilos to stock and updates the cost used for margin.',
      fields: [
        { name: 'product_id', label: 'Product', type: 'select', options: App.store.productOptions(), span: 'full' },
        { name: 'supplier_id', label: 'Supplier', type: 'select', options: App.store.supplierOptions() },
        { name: 'added_kilos', label: 'Weight received (kg)', type: 'number', step: '0.01', min: 0.01, required: true },
        { name: 'cost_per_kilo', label: 'Cost / kg', type: 'number', step: '0.01', min: 0.01, required: true },
        { name: 'notes', label: 'Reference', span: 'full', placeholder: 'Delivery receipt number or note' },
      ],
      submitLabel: 'Record delivery',
      onSubmit: async (values) => {
        await App.api.inventory.purchase(values);
        UI.toast('Delivery recorded and stock updated.', 'ok');
        await App.store.refresh('inventory');
        App.router.invalidate();
        await load();
      },
    });
  }

  function openAdjust() {
    UI.openForm({
      title: 'Record a loss',
      hint: 'Use this for spoilage, trim loss or a stock-count correction.',
      fields: [
        { name: 'product_id', label: 'Product', type: 'select', options: App.store.productOptions(), span: 'full' },
        { name: 'log_type', label: 'Type', type: 'select', options: ['Spoilage', 'Adjustment'] },
        { name: 'removed_kilos', label: 'Weight removed (kg)', type: 'number', step: '0.01', min: 0.01, required: true },
        { name: 'notes', label: 'Reason', span: 'full', placeholder: 'e.g. Chiller failure overnight' },
      ],
      submitLabel: 'Record loss',
      onSubmit: async (values) => {
        await App.api.inventory.adjust(values);
        UI.toast('Stock written off.', 'ok');
        await App.store.refresh('inventory');
        App.router.invalidate();
        await load();
      },
    });
  }

  function mount() {
    U.$('#openRestockForm')?.addEventListener('click', openRestock);
    U.$('#openAdjustForm')?.addEventListener('click', openAdjust);
    U.$('#logTypeFilter')?.addEventListener('change', load);
    return load();
  }

  return { mount, refresh: load, openRestock };
})();

App.router.register('inventory', App.inventory);

/* ############################################################
   PART 12 - originally js/modules/customers.js
   customers and credit
   ############################################################ */

/* ============================================================
   customers.js — retail and wholesale accounts, utang balances and
   the payments that settle them.
   ============================================================ */

window.App = window.App || {};

App.customers = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  let rows = [];

  async function load() {
    const body = U.$('#customerTable');
    if (body) body.innerHTML = UI.loadingRow(7);

    const [list, payments] = await Promise.all([
      App.api.customers.list({
        search: U.$('#customerSearch')?.value || '',
        type: U.$('#customerTypeFilter')?.value || 'All',
      }),
      App.api.customers.payments(),
    ]);

    rows = list;
    paintMetrics();
    paintTable();
    paintPayments(payments);
  }

  function paintMetrics() {
    const all = App.store.state.customers;
    const wholesale = all.filter((c) => c.customer_type === 'Wholesale').length;
    const outstanding = U.sum(all, 'credit_balance');
    const withBalance = all.filter((c) => Number(c.credit_balance) > 0).length;
    const lifetime = U.sum(all, 'lifetime_value');

    UI.renderMetrics('#customerMetrics', [
      { label: 'Customer accounts', value: U.int(all.length), note: `${wholesale} wholesale, ${all.length - wholesale} retail`, icon: 'fa-user-group' },
      { label: 'Outstanding utang', value: U.peso(outstanding), note: `${withBalance} account(s) owing`, icon: 'fa-hand-holding-dollar', accent: outstanding > 0 ? 'amber' : 'mint' },
      { label: 'Lifetime sales', value: U.peso(lifetime), note: 'Across all named customers', icon: 'fa-receipt', accent: 'cyan' },
      { label: 'Largest balance', value: U.peso(Math.max(0, ...all.map((c) => Number(c.credit_balance)))), note: 'Single account', icon: 'fa-triangle-exclamation', accent: 'rose' },
    ]);
  }

  function paintTable() {
    const body = U.$('#customerTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(7, 'No customers match these filters.', 'fa-users'); return; }

    body.innerHTML = rows.map((c) => `
      <tr>
        <td><strong>${U.escapeHtml(c.full_name)}</strong></td>
        <td>${U.statusPill(c.customer_type)}</td>
        <td>${U.escapeHtml(c.phone_number || '—')}</td>
        <td class="num">${U.peso(c.credit_balance)}</td>
        <td class="num">${U.peso(c.lifetime_value)}</td>
        <td>${U.statusPill(c.credit_status)}</td>
        <td>
          <div class="row-actions">
            ${Number(c.credit_balance) > 0
              ? `<button class="btn btn-sm btn-primary" data-pay="${c.id}"><i class="fa-solid fa-peso-sign"></i>Collect</button>`
              : ''}
            <button class="btn btn-sm" data-view="${c.id}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn btn-sm" data-edit="${c.id}"><i class="fa-solid fa-pen"></i></button>
          </div>
        </td>
      </tr>`).join('');
  }

  function paintPayments(payments) {
    const body = U.$('#paymentTable');
    if (!body) return;
    if (!payments.length) { body.innerHTML = UI.emptyRow(4, 'No credit payments yet.', 'fa-money-bill-transfer'); return; }

    body.innerHTML = payments.slice(0, 25).map((p) => `
      <tr>
        <td>${U.formatDate(p.paid_at)}</td>
        <td>${U.escapeHtml(p.customer_name)}</td>
        <td>${U.statusPill(p.payment_method)}</td>
        <td class="num text-mint">${U.peso(p.amount_paid)}</td>
      </tr>`).join('');
  }

  /* ---------------------------------------------------------- forms */

  function formFields(customer) {
    return [
      { name: 'full_name', label: 'Customer or business name', value: customer?.full_name, required: true, span: 'full' },
      { name: 'customer_type', label: 'Type', type: 'select', options: ['Retail', 'Wholesale'], value: customer?.customer_type },
      { name: 'phone_number', label: 'Contact number', value: customer?.phone_number || '' },
      { name: 'address', label: 'Address or note', value: customer?.address || '', span: 'full', placeholder: 'e.g. Eatery along Colon Street' },
    ];
  }

  function openCreate() {
    const fields = formFields(null);
    fields.push({
      name: 'credit_balance', label: 'Opening utang balance', type: 'number',
      step: '0.01', min: 0, value: 0,
      hint: 'Only if this customer already owes money from before.',
    });

    UI.openForm({
      title: 'New customer',
      hint: 'Saved to MySQL and selectable at the till.',
      fields,
      submitLabel: 'Save customer',
      onSubmit: async (values) => {
        await App.api.customers.create(values);
        UI.toast(`${values.full_name} saved.`, 'ok');
        await App.store.refresh('customer');
        await load();
      },
    });
  }

  function openEdit(id) {
    const customer = rows.find((c) => String(c.id) === String(id));
    if (!customer) return;

    UI.openForm({
      title: `Edit ${customer.full_name}`,
      hint: 'The credit balance changes only through sales and payments.',
      fields: formFields(customer),
      submitLabel: 'Save changes',
      onSubmit: async (values) => {
        await App.api.customers.update(id, values);
        UI.toast('Customer updated.', 'ok');
        await App.store.refresh('customer');
        await load();
      },
    });
  }

  async function openPayment(id) {
    const customer = rows.find((c) => String(c.id) === String(id));
    if (!customer) return;

    const detail = await App.api.customers.one(id);
    const openSales = detail.sales.filter((s) => Number(s.total_amount) - Number(s.amount_paid) > 0);

    const saleOptions = [{ value: '', label: 'Against the overall balance' }].concat(
      openSales.map((s) => ({
        value: s.id,
        label: `Sale #${s.id} — ${U.peso(Number(s.total_amount) - Number(s.amount_paid))} still due`,
      }))
    );

    UI.openForm({
      title: `Collect from ${customer.full_name}`,
      hint: `Outstanding balance ${U.peso(customer.credit_balance)}.`,
      fields: [
        { name: 'amount_paid', label: 'Amount received', type: 'number', step: '0.01', min: 0.01, value: customer.credit_balance, required: true },
        { name: 'payment_method', label: 'Method', type: 'select', options: ['Cash', 'GCash'] },
        { name: 'sale_id', label: 'Apply to', type: 'select', options: saleOptions, span: 'full' },
      ],
      submitLabel: 'Record payment',
      onSubmit: async (values) => {
        await App.api.customers.pay({ ...values, customer_id: Number(id) });
        UI.toast('Payment recorded.', 'ok');
        await App.store.refresh('payment');
        App.router.invalidate();
        await load();
      },
    });
  }

  async function openDetail(id) {
    const detail = await App.api.customers.one(id);
    const c = detail.customer;

    const sales = detail.sales.length
      ? detail.sales.map((s) => `<tr>
          <td>#${s.id}</td><td>${U.formatDate(s.created_at)}</td>
          <td>${U.statusPill(s.payment_method)}</td>
          <td class="num">${U.peso(s.total_amount)}</td>
          <td>${U.statusPill(s.payment_status)}</td></tr>`).join('')
      : UI.emptyRow(5, 'No purchases yet.');

    const payments = detail.payments.length
      ? detail.payments.map((p) => `<tr>
          <td>${U.formatDate(p.paid_at)}</td><td>${U.statusPill(p.payment_method)}</td>
          <td class="num text-mint">${U.peso(p.amount_paid)}</td></tr>`).join('')
      : UI.emptyRow(3, 'No payments yet.');

    UI.openDetail(c.full_name, `${c.customer_type} · ${c.phone_number || 'no contact number'}`, `
      <div class="grid-3" style="margin-bottom:14px">
        <div class="report-figure"><div class="k">Outstanding</div><div class="v">${U.peso(c.credit_balance)}</div></div>
        <div class="report-figure"><div class="k">Lifetime spend</div><div class="v">${U.peso(c.lifetime_value)}</div></div>
        <div class="report-figure"><div class="k">Purchases</div><div class="v">${U.int(c.sale_count)}</div></div>
      </div>
      <h4 style="margin-bottom:8px">Recent purchases</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Sale</th><th>Date</th><th>Payment</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${sales}</tbody></table></div>
      <h4 style="margin:14px 0 8px">Payments</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
        <tbody>${payments}</tbody></table></div>`);
  }

  function mount() {
    U.$('#openCustomerForm')?.addEventListener('click', openCreate);
    U.$('#customerSearch')?.addEventListener('input', U.debounce(load, 260));
    U.$('#customerTypeFilter')?.addEventListener('change', load);

    U.on('#customerTable', 'click', '[data-edit]', (e, n) => openEdit(n.dataset.edit));
    U.on('#customerTable', 'click', '[data-pay]', (e, n) => openPayment(n.dataset.pay));
    U.on('#customerTable', 'click', '[data-view]', (e, n) => openDetail(n.dataset.view));

    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('customers', App.customers);

/* ############################################################
   PART 13 - originally js/modules/suppliers.js
   suppliers
   ############################################################ */

/* ============================================================
   suppliers.js — vendor directory and what has been bought from each.
   ============================================================ */

window.App = window.App || {};

App.suppliers = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  let rows = [];

  async function load() {
    const body = U.$('#supplierTable');
    if (body) body.innerHTML = UI.loadingRow(8);

    const [list, purchases] = await Promise.all([
      App.api.suppliers.list(),
      App.api.inventory.logs({ log_type: 'Restock', limit: 40 }),
    ]);

    rows = list;
    paintMetrics(purchases);
    paintTable();
    paintPurchases(purchases);
  }

  function paintMetrics(purchases) {
    const spend = U.sum(rows, 'total_purchased');
    const products = App.store.state.products;
    const avgMargin = products.length ? U.sum(products, 'margin_percent') / products.length : 0;

    UI.renderMetrics('#supplierMetrics', [
      { label: 'Suppliers', value: U.int(rows.length), note: 'In the directory', icon: 'fa-building' },
      { label: 'Deliveries recorded', value: U.int(purchases.length), note: 'Most recent restocks', icon: 'fa-truck-fast', accent: 'cyan' },
      { label: 'Purchasing spend', value: U.peso(spend), note: 'Paid to suppliers to date', icon: 'fa-cart-shopping', accent: 'violet' },
      { label: 'Average selling margin', value: U.pct(avgMargin), note: 'Selling price against supplier cost', icon: 'fa-percent', accent: 'mint' },
    ]);
  }

  function paintTable() {
    const body = U.$('#supplierTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(8, 'No suppliers yet. Add your first vendor.', 'fa-truck'); return; }

    body.innerHTML = rows.map((s) => `
      <tr>
        <td><strong>${U.escapeHtml(s.supplier_name)}</strong></td>
        <td>${U.escapeHtml(s.contact_person || '—')}</td>
        <td>${U.escapeHtml(s.phone_number || '—')}</td>
        <td>${U.escapeHtml(s.address || '—')}</td>
        <td class="num">${U.int(s.product_count)}</td>
        <td class="num">${U.peso(s.total_purchased)}</td>
        <td>${s.last_delivery_at ? U.formatDate(s.last_delivery_at) : 'None yet'}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm" data-view="${s.id}"><i class="fa-solid fa-eye"></i></button>
            <button class="btn btn-sm" data-edit="${s.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-sm btn-danger" data-remove="${s.id}"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </td>
      </tr>`).join('');
  }

  function paintPurchases(purchases) {
    const body = U.$('#purchaseTable');
    if (!body) return;
    if (!purchases.length) { body.innerHTML = UI.emptyRow(6, 'No deliveries recorded yet.', 'fa-truck-ramp-box'); return; }

    body.innerHTML = purchases.map((p) => `
      <tr>
        <td>${U.formatDate(p.logged_at)}</td>
        <td><strong>${U.escapeHtml(p.supplier_name || 'Unassigned')}</strong></td>
        <td>${U.escapeHtml(p.meat_cut)}</td>
        <td class="num">${U.num(p.added_kilos)} kg</td>
        <td class="num">${U.peso(p.cost_per_kilo)}</td>
        <td class="num">${U.peso(p.total_cost)}</td>
      </tr>`).join('');
  }

  /* ---------------------------------------------------------- forms */

  function formFields(supplier) {
    return [
      { name: 'supplier_name', label: 'Supplier name', value: supplier?.supplier_name, required: true, span: 'full' },
      { name: 'contact_person', label: 'Contact person', value: supplier?.contact_person || '' },
      { name: 'phone_number', label: 'Phone number', value: supplier?.phone_number || '' },
      { name: 'address', label: 'Address', value: supplier?.address || '', span: 'full' },
    ];
  }

  function openCreate() {
    UI.openForm({
      title: 'New supplier',
      hint: 'Link products to a supplier so cost and margin can be traced.',
      fields: formFields(null),
      submitLabel: 'Save supplier',
      onSubmit: async (values) => {
        await App.api.suppliers.create(values);
        UI.toast(`${values.supplier_name} saved.`, 'ok');
        await App.store.refresh('supplier');
        await load();
      },
    });
  }

  function openEdit(id) {
    const supplier = rows.find((s) => String(s.id) === String(id));
    if (!supplier) return;

    UI.openForm({
      title: `Edit ${supplier.supplier_name}`,
      fields: formFields(supplier),
      submitLabel: 'Save changes',
      onSubmit: async (values) => {
        await App.api.suppliers.update(id, values);
        UI.toast('Supplier updated.', 'ok');
        await App.store.refresh('supplier');
        await load();
      },
    });
  }

  function remove(id) {
    const supplier = rows.find((s) => String(s.id) === String(id));
    UI.confirmAction(
      `Remove ${supplier ? supplier.supplier_name : 'this supplier'}? Products keep their prices and simply lose the link.`,
      async () => {
        try {
          await App.api.suppliers.remove(id);
          UI.toast('Supplier removed.', 'ok');
          await App.store.refresh('supplier');
          await load();
        } catch (e) { UI.toast(e.message, 'err'); }
      }
    );
  }

  async function openDetail(id) {
    const detail = await App.api.suppliers.one(id);
    const s = detail.supplier;

    const products = detail.products.length
      ? detail.products.map((p) => `<tr>
          <td>${U.escapeHtml(p.meat_cut)}</td><td>${U.escapeHtml(p.category)}</td>
          <td class="num">${U.peso(p.cost_per_kilo)}</td>
          <td class="num">${U.peso(p.price_per_kilo)}</td>
          <td class="num">${U.num(p.stock_kilos)} kg</td></tr>`).join('')
      : UI.emptyRow(5, 'No products linked yet.');

    const deliveries = detail.deliveries.length
      ? detail.deliveries.map((d) => `<tr>
          <td>${U.formatDate(d.logged_at)}</td><td>${U.escapeHtml(d.meat_cut)}</td>
          <td class="num">${U.num(d.added_kilos)} kg</td>
          <td class="num">${U.peso(d.total_cost)}</td></tr>`).join('')
      : UI.emptyRow(4, 'No deliveries recorded yet.');

    UI.openDetail(s.supplier_name, `${s.contact_person || 'No contact person'} · ${s.phone_number || 'no phone'}`, `
      <div class="grid-3" style="margin-bottom:14px">
        <div class="report-figure"><div class="k">Products supplied</div><div class="v">${U.int(s.product_count)}</div></div>
        <div class="report-figure"><div class="k">Purchased to date</div><div class="v">${U.peso(s.total_purchased)}</div></div>
        <div class="report-figure"><div class="k">Last delivery</div><div class="v">${s.last_delivery_at ? U.formatDate(s.last_delivery_at) : '—'}</div></div>
      </div>
      <h4 style="margin-bottom:8px">Products supplied</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Product</th><th>Category</th><th class="num">Cost/kg</th><th class="num">Price/kg</th><th class="num">Stock</th></tr></thead>
        <tbody>${products}</tbody></table></div>
      <h4 style="margin:14px 0 8px">Delivery history</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Product</th><th class="num">Quantity</th><th class="num">Total cost</th></tr></thead>
        <tbody>${deliveries}</tbody></table></div>`);
  }

  function mount() {
    U.$('#openSupplierForm')?.addEventListener('click', openCreate);
    U.on('#supplierTable', 'click', '[data-edit]', (e, n) => openEdit(n.dataset.edit));
    U.on('#supplierTable', 'click', '[data-remove]', (e, n) => remove(n.dataset.remove));
    U.on('#supplierTable', 'click', '[data-view]', (e, n) => openDetail(n.dataset.view));
    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('suppliers', App.suppliers);

/* ############################################################
   PART 14 - originally js/modules/sales.js
   sales history
   ############################################################ */

/* ============================================================
   sales.js — every completed transaction, filterable, with the
   itemised receipt behind each row.
   ============================================================ */

window.App = window.App || {};

App.sales = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  let rows = [];

  function filters() {
    return {
      start_date: U.$('#salesStart')?.value || '',
      end_date: U.$('#salesEnd')?.value || '',
      status: U.$('#salesStatus')?.value || 'All',
      payment_method: U.$('#salesMethod')?.value || 'All',
      search: U.$('#salesSearch')?.value || '',
      limit: 300,
    };
  }

  async function load() {
    const body = U.$('#salesTable');
    if (body) body.innerHTML = UI.loadingRow(9);

    rows = await App.api.sales.list(filters());
    paintMetrics();
    paintTable();
  }

  function paintMetrics() {
    const total = U.sum(rows, 'total_amount');
    const paid = U.sum(rows, 'amount_paid');
    const due = U.sum(rows, 'balance_due');
    const kilos = U.sum(rows, 'total_kilos');

    UI.renderMetrics('#salesMetrics', [
      { label: 'Transactions', value: U.int(rows.length), note: 'Matching the filters', icon: 'fa-receipt' },
      { label: 'Gross sales', value: U.peso(total), note: `${U.kg(kilos)} of meat sold`, icon: 'fa-peso-sign', accent: 'cyan' },
      { label: 'Collected', value: U.peso(paid), note: 'Cash, GCash and down payments', icon: 'fa-money-bill-wave', accent: 'mint' },
      { label: 'Still owed', value: U.peso(due), note: 'Unpaid balances on credit sales', icon: 'fa-hand-holding-dollar', accent: due > 0 ? 'amber' : 'mint' },
    ]);
  }

  function paintTable() {
    const body = U.$('#salesTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(9, 'No sales match these filters.', 'fa-receipt'); return; }

    body.innerHTML = rows.map((s) => `
      <tr>
        <td><strong>#${s.id}</strong></td>
        <td>${U.formatDateTime(s.created_at)}</td>
        <td>${U.escapeHtml(s.customer_name)}</td>
        <td>${U.statusPill(s.payment_method)}</td>
        <td class="num">${U.int(s.item_count)}</td>
        <td class="num">${U.peso(s.total_amount)}</td>
        <td class="num ${Number(s.balance_due) > 0 ? 'text-amber' : ''}">${U.peso(s.balance_due)}</td>
        <td>${U.statusPill(s.payment_status)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-view="${s.id}"><i class="fa-solid fa-eye"></i>Open</button>
        </div></td>
      </tr>`).join('');
  }

  async function openSale(id) {
    const detail = await App.api.sales.one(id);
    const s = detail.sale;

    const items = detail.items.map((i) => `<tr>
      <td>${U.escapeHtml(i.meat_cut)}</td>
      <td class="num">${U.num(i.weight_kilos)} kg</td>
      <td class="num">${U.peso(i.unit_price)}</td>
      <td class="num">${U.peso(i.subtotal)}</td>
      <td class="num text-mint">${U.peso(i.gross_profit)}</td></tr>`).join('');

    const payments = detail.payments.length
      ? `<h4 style="margin:14px 0 8px">Payments against this sale</h4>
         <div class="table-wrap"><table class="data-table">
         <thead><tr><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
         <tbody>${detail.payments.map((p) => `<tr>
           <td>${U.formatDateTime(p.paid_at)}</td><td>${U.statusPill(p.payment_method)}</td>
           <td class="num">${U.peso(p.amount_paid)}</td></tr>`).join('')}</tbody></table></div>`
      : '';

    UI.openDetail(`Sale #${s.id}`, `${U.formatDateTime(s.created_at)} · ${s.customer_name}`, `
      <div class="grid-3" style="margin-bottom:14px">
        <div class="report-figure"><div class="k">Total</div><div class="v">${U.peso(s.total_amount)}</div></div>
        <div class="report-figure"><div class="k">Paid</div><div class="v">${U.peso(s.amount_paid)}</div></div>
        <div class="report-figure"><div class="k">Status</div><div class="v">${s.payment_status}</div></div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Product</th><th class="num">Weight</th><th class="num">Price/kg</th><th class="num">Subtotal</th><th class="num">Profit</th></tr></thead>
        <tbody>${items}</tbody></table></div>
      ${payments}`);
  }

  function exportPdf() {
    if (!rows.length) { UI.toast('There is nothing to export yet.', 'warn'); return; }

    const f = filters();
    const period = f.start_date || f.end_date
      ? `${f.start_date || 'start'} to ${f.end_date || 'today'}`
      : 'All recorded sales';

    App.pdf.download(App.pdf.fromRows({
      title: 'Sales history',
      period,
      columns: ['Sale', 'Date', 'Customer', 'Method', 'Status', 'Total', 'Paid', 'Balance'],
      rows: rows.map((s) => [
        `#${s.id}`, U.formatDateTime(s.created_at), s.customer_name,
        s.payment_method, s.payment_status,
        U.peso(s.total_amount), U.peso(s.amount_paid), U.peso(s.balance_due),
      ]),
      figures: [
        { label: 'Transactions', value: U.int(rows.length) },
        { label: 'Gross sales', value: U.peso(U.sum(rows, 'total_amount')) },
        { label: 'Collected', value: U.peso(U.sum(rows, 'amount_paid')) },
        { label: 'Outstanding', value: U.peso(U.sum(rows, 'balance_due')) },
      ],
      totals: ['', '', '', '', 'Total',
        U.peso(U.sum(rows, 'total_amount')),
        U.peso(U.sum(rows, 'amount_paid')),
        U.peso(U.sum(rows, 'balance_due'))],
    }));
  }

  function mount() {
    U.$('#applySalesFilter')?.addEventListener('click', load);
    U.$('#salesSearch')?.addEventListener('input', U.debounce(load, 320));
    U.$('#resetSalesFilter')?.addEventListener('click', () => {
      ['#salesStart', '#salesEnd', '#salesSearch'].forEach((s) => { const n = U.$(s); if (n) n.value = ''; });
      U.$('#salesStatus').value = 'All';
      U.$('#salesMethod').value = 'All';
      load();
    });
    U.$('#exportSalesPdf')?.addEventListener('click', exportPdf);
    U.on('#salesTable', 'click', '[data-view]', (e, n) => openSale(n.dataset.view));
    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('sales', App.sales);

/* ############################################################
   PART 15 - originally js/modules/analytics.js
   sales and profit
   ############################################################ */

/* ============================================================
   analytics.js — revenue against the cost of the meat actually sold.
   ============================================================ */

window.App = window.App || {};

App.analytics = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  let products = [];

  function range() {
    return {
      start_date: U.$('#analyticsStart')?.value || '',
      end_date: U.$('#analyticsEnd')?.value || '',
    };
  }

  async function load() {
    const params = range();

    const [summary, daily, byProduct, byCategory, topCustomers, mix] = await Promise.all([
      App.api.analytics.summary(params),
      App.api.analytics.daily(params),
      App.api.analytics.products(params),
      App.api.analytics.categories(params),
      App.api.analytics.customers(params),
      App.api.analytics.paymentMix(params),
    ]);

    products = byProduct;

    UI.renderMetrics('#analyticsMetrics', [
      { label: 'Revenue', value: U.peso(summary.revenue), note: `${U.int(summary.transaction_count)} transactions`, icon: 'fa-peso-sign' },
      { label: 'Cost of goods sold', value: U.peso(summary.cogs), note: `${U.kg(summary.kilos_sold)} sold`, icon: 'fa-coins', accent: 'amber' },
      { label: 'Gross profit', value: U.peso(summary.gross_profit), note: 'Revenue less cost of goods', icon: 'fa-arrow-trend-up', accent: 'mint' },
      { label: 'Gross margin', value: U.pct(summary.gross_margin_percent), note: `Average sale ${U.peso(summary.average_sale_value)}`, icon: 'fa-percent', accent: 'cyan' },
    ]);

    App.charts.revenueBars('#analyticsChart', daily);

    UI.renderBars('#categoryBars',
      byCategory.map((c) => ({ label: `${c.category} · ${U.pct(c.margin_percent)} margin`, value: Number(c.revenue) })),
      (v) => U.peso(v));

    UI.renderBars('#paymentMixBars',
      mix.map((m) => ({ label: `${m.payment_method} · ${U.int(m.transaction_count)} sales`, value: Number(m.total_amount) })),
      (v) => U.peso(v));

    paintProfitability(byProduct);
    paintTopCustomers(topCustomers);
  }

  function paintProfitability(rows) {
    const body = U.$('#profitabilityTable');
    if (!body) return;

    const sold = rows.filter((r) => Number(r.kilos_sold) > 0);
    if (!sold.length) { body.innerHTML = UI.emptyRow(7, 'No sales in this period yet.', 'fa-chart-simple'); return; }

    body.innerHTML = sold.map((r) => `
      <tr>
        <td><strong>${U.escapeHtml(r.meat_cut)}</strong></td>
        <td><span class="tag cat-${U.escapeHtml(r.category)}">${U.escapeHtml(r.category)}</span></td>
        <td class="num">${U.num(r.kilos_sold)} kg</td>
        <td class="num">${U.peso(r.revenue)}</td>
        <td class="num">${U.peso(r.cogs)}</td>
        <td class="num text-mint">${U.peso(r.gross_profit)}</td>
        <td class="num">${U.pct(r.margin_percent)}</td>
      </tr>`).join('');
  }

  function paintTopCustomers(rows) {
    const body = U.$('#topCustomersTable');
    if (!body) return;
    if (!rows.length) { body.innerHTML = UI.emptyRow(4, 'No customer activity yet.', 'fa-users'); return; }

    body.innerHTML = rows.slice(0, 10).map((c) => `
      <tr>
        <td><strong>${U.escapeHtml(c.customer_name)}</strong></td>
        <td>${U.statusPill(c.customer_type)}</td>
        <td class="num">${U.int(c.transaction_count)}</td>
        <td class="num">${U.peso(c.total_spent)}</td>
      </tr>`).join('');
  }

  function exportProducts() {
    const sold = products.filter((r) => Number(r.kilos_sold) > 0);
    if (!sold.length) { UI.toast('No sales to export in this period.', 'warn'); return; }

    const p = range();
    App.pdf.download(App.pdf.fromRows({
      title: 'Product profitability',
      period: p.start_date || p.end_date ? `${p.start_date || 'start'} to ${p.end_date || 'today'}` : 'All recorded activity',
      columns: ['Product', 'Category', 'Kilos sold', 'Revenue', 'Cost of goods', 'Gross profit', 'Margin'],
      rows: sold.map((r) => [
        r.meat_cut, r.category, U.num(r.kilos_sold) + ' kg',
        U.peso(r.revenue), U.peso(r.cogs), U.peso(r.gross_profit), U.pct(r.margin_percent),
      ]),
      figures: [
        { label: 'Products sold', value: U.int(sold.length) },
        { label: 'Revenue', value: U.peso(U.sum(sold, 'revenue')) },
        { label: 'Cost of goods', value: U.peso(U.sum(sold, 'cogs')) },
        { label: 'Gross profit', value: U.peso(U.sum(sold, 'gross_profit')) },
      ],
      totals: ['Total', '', '', U.peso(U.sum(sold, 'revenue')), U.peso(U.sum(sold, 'cogs')), U.peso(U.sum(sold, 'gross_profit')), ''],
    }));
  }

  function mount() {
    U.$('#applyAnalytics')?.addEventListener('click', load);
    U.$('#resetAnalytics')?.addEventListener('click', () => {
      U.$('#analyticsStart').value = '';
      U.$('#analyticsEnd').value = '';
      load();
    });
    U.$('#exportProductsPdf')?.addEventListener('click', exportProducts);
    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('analytics', App.analytics);

/* ############################################################
   PART 16 - originally js/modules/reports.js
   reports and PDF download
   ############################################################ */

/* ============================================================
   reports.js — pick a report, set the period, preview it, download it.

   The server builds the whole report (figures, columns, rows, totals);
   this module only renders and exports it. Adding a report on the
   backend makes it appear here automatically.
   ============================================================ */

window.App = window.App || {};

App.reports = (function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  const META = {
    sales: { icon: 'fa-receipt', blurb: 'Every transaction with its customer, payment method and balance.' },
    profit: { icon: 'fa-chart-line', blurb: 'Revenue, cost of goods and gross margin, day by day.' },
    products: { icon: 'fa-drumstick-bite', blurb: 'Which cuts earn, which ones sit, and the margin on each.' },
    inventory: { icon: 'fa-warehouse', blurb: 'Stock on hand and the capital tied up in it right now.' },
    purchases: { icon: 'fa-truck-ramp-box', blurb: 'Deliveries received and what was paid to each supplier.' },
    credit: { icon: 'fa-hand-holding-dollar', blurb: 'Who owes money, how much, and when they last paid.' },
  };

  let catalog = [];
  let current = null;
  let selectedKey = null;

  async function load() {
    catalog = await App.api.reports.catalog();
    paintCatalog();
    if (selectedKey) await open(selectedKey);
  }

  function paintCatalog() {
    U.setHtml('#reportGrid', catalog.map((r) => {
      const meta = META[r.key] || { icon: 'fa-file-lines', blurb: '' };
      return `<button class="report-card ${selectedKey === r.key ? 'is-selected' : ''}" data-report="${r.key}">
        <div class="ico"><i class="fa-solid ${meta.icon}"></i></div>
        <h4>${U.escapeHtml(r.title)}</h4>
        <p>${U.escapeHtml(meta.blurb)}</p>
      </button>`;
    }).join(''));
  }

  async function open(key) {
    selectedKey = key;
    paintCatalog();

    const params = {
      start_date: U.$('#reportStart')?.value || '',
      end_date: U.$('#reportEnd')?.value || '',
    };

    try {
      current = await App.api.reports.build(key, params);
    } catch (error) {
      UI.toast(error.message, 'err');
      return;
    }

    const viewer = U.$('#reportViewer');
    if (viewer) viewer.style.display = '';

    U.setText('#reportTitle', current.title);
    U.setText('#reportPeriod', `${current.period} · generated ${U.formatDate(current.generated_at)}`);
    U.setText('#reportNote', current.note || '');

    U.setHtml('#reportFigures', (current.figures || []).map((f) => `
      <div class="report-figure"><div class="k">${U.escapeHtml(f.label)}</div>
      <div class="v">${U.escapeHtml(f.value)}</div></div>`).join(''));

    U.setHtml('#reportHead', `<tr>${current.columns.map((c) => `<th>${U.escapeHtml(c)}</th>`).join('')}</tr>`);

    U.setHtml('#reportBody', current.rows.length
      ? current.rows.map((row) => `<tr>${row.map((c) => `<td>${U.escapeHtml(c)}</td>`).join('')}</tr>`).join('')
      : UI.emptyRow(current.columns.length, 'No records for this period.', 'fa-file-lines'));

    U.setHtml('#reportFoot', current.totals && current.totals.length && current.rows.length
      ? `<tr>${current.totals.map((c) => `<td>${U.escapeHtml(c)}</td>`).join('')}</tr>`
      : '');

    U.$('#reportViewer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function guard(action) {
    return () => {
      if (!current) { UI.toast('Choose a report first.', 'warn'); return; }
      action();
    };
  }

  function mount() {
    U.on('#reportGrid', 'click', '[data-report]', (e, node) => open(node.dataset.report));

    U.$('#reportPdf')?.addEventListener('click', guard(() => App.pdf.download(current)));
    U.$('#reportCsv')?.addEventListener('click', guard(() => App.pdf.csv(current)));
    U.$('#reportPrint')?.addEventListener('click', guard(() => App.pdf.print(current)));

    U.$('#reportThisMonth')?.addEventListener('click', () => {
      U.$('#reportStart').value = U.monthStart();
      U.$('#reportEnd').value = U.today();
      if (selectedKey) open(selectedKey);
    });

    U.$('#reportAllTime')?.addEventListener('click', () => {
      U.$('#reportStart').value = '';
      U.$('#reportEnd').value = '';
      if (selectedKey) open(selectedKey);
    });

    ['#reportStart', '#reportEnd'].forEach((sel) => {
      U.$(sel)?.addEventListener('change', () => { if (selectedKey) open(selectedKey); });
    });

    return load();
  }

  return { mount, refresh: load };
})();

App.router.register('reports', App.reports);

/* ############################################################
   PART 17 - originally js/app.js
   boot sequence
   ############################################################ */

/* ============================================================
   app.js — boot sequence.

   1. Check the database is reachable.
   2. Load products, customers and suppliers once.
   3. Hand control to the router, which runs the module belonging to
      the HTML file that is open (<body data-page="…">).

   This same file boots every page, so there is one place to look
   when something does not start.
   ============================================================ */

(function () {
  'use strict';

  const U = App.utils;
  const UI = App.ui;

  async function boot() {
    // The health check is only used for the little "connected" toast and a
    // product count — it must never be allowed to block the app. If the
    // shape of its response ever surprises this code, that is a bug in
    // this file, not proof the database is unreachable, so it is swallowed
    // here and logged, never shown to the shop as a connectivity error.
    try {
      const health = await App.api.health();
      const productCount = health && health.counts ? U.int(health.counts.products) : null;
      UI.toast(
        productCount === null
          ? `Connected to ${health && health.database ? health.database : 'the database'}.`
          : `Connected to ${health.database} · ${productCount} products loaded.`,
        'ok', 3200
      );
    } catch (error) {
      console.error('Health check did not complete cleanly:', error);
    }

    // This is the step that actually matters: pull products, customers and
    // suppliers from MySQL. Only a failure HERE means the shop is truly
    // offline, so only this failure shows the "can't reach the database"
    // banner — a hiccup in the toast above must never hide real data.
    try {
      await App.store.refresh('boot');
    } catch (error) {
      showOfflineNotice(error.message);
      return;
    }

    App.router.init(currentPage());
  }

  /**
   * Shown on WHICHEVER page is open when the API cannot be reached — not
   * only the POS grid — so a page never just sits there quietly empty.
   * Explains the two real causes in plain terms instead of one generic
   * toast: the server isn't running, or this file was opened a way that
   * cannot reach it (double-clicked from disk, or served by something
   * other than "python app.py"). It can always be dismissed — closing it
   * does not fix the connection, but it never traps the page.
   */
  function showOfflineNotice(message) {
    if (document.querySelector('.offline-banner')) return; // never stack two

    // A raw JS error (a bug in this code) is not useful to read on a shop
    // floor — only a message that actually came from App.api (a real
    // connection or server problem) is shown verbatim.
    const friendly = /^(cannot reach the server|request failed|the server responded)/i.test(message || '')
      ? message
      : 'The database did not respond in time.';

    const openedFromDisk = window.location.protocol === 'file:';
    const banner = document.createElement('div');
    banner.className = 'offline-banner';
    banner.innerHTML = `
      <i class="fa-solid fa-plug-circle-xmark"></i>
      <div>
        <strong>Can't reach the shop's database</strong>
        <p>${U.escapeHtml(friendly)}</p>
        <ul>
          <li>Run <code>python app.py</code> inside the <code>backend</code> folder</li>
          <li>Make sure MySQL is running and <code>backend/config.py</code> has the right password</li>
          ${openedFromDisk
            ? '<li>Open the shop at <code>http://127.0.0.1:5001</code> — double-clicking this file from disk cannot reach the server</li>'
            : '<li>Open the shop through that same address, not a different local server or port</li>'}
        </ul>
      </div>
      <div class="offline-banner-actions">
        <button class="btn btn-sm" id="offlineRetry"><i class="fa-solid fa-rotate"></i>Try again</button>
        <button class="offline-close" id="offlineDismiss" title="Dismiss" aria-label="Dismiss">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    document.body.prepend(banner);
    banner.querySelector('#offlineRetry')?.addEventListener('click', () => window.location.reload());
    banner.querySelector('#offlineDismiss')?.addEventListener('click', () => banner.remove());

    U.setHtml('#productGrid', `<div class="empty-state" style="grid-column:1/-1">
      <i class="fa-solid fa-plug-circle-xmark"></i>
      <strong>The database is not connected</strong>
      <span>No sale can be recorded while the shop is offline. See the notice above.</span>
    </div>`);
    App.router.init(currentPage());
  }

  function currentPage() {
    return document.body.dataset.page || 'pos';
  }

  U.$('#refreshAll')?.addEventListener('click', async (e) => {
    await UI.withBusy(null, async () => {
      await App.store.refresh('manual');
      App.router.invalidate();
      await App.router.go(currentPage());
      UI.toast('Reloaded from the database.', 'ok', 2400);
    });
  });

  // Quick keys for the counter: / focuses search, Enter completes the sale.
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      U.$('#posSearch')?.focus();
    }
    if (e.key === 'Enter' && e.ctrlKey && document.body.classList.contains('is-pos')) {
      U.$('#checkoutBtn')?.click();
    }
  });

  let started = false;
  function start() {
    if (started) return;
    started = true;
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();