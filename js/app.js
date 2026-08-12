/* ================================================================
   APP.JS — Helpers DOM, formatage, utilitaires UI communs
   ================================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'dataset' && typeof v === 'object') {
      Object.assign(node.dataset, v);
    } else if (v === false || v == null) {
      // skip
    } else {
      node.setAttribute(k, v);
    }
  }
  children.flat().forEach((child) => {
    if (child == null || child === false) return;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  });
  return node;
}

export function clear(node) { while (node?.firstChild) node.removeChild(node.firstChild); }

export function teamById(state, id) {
  if (!id) return null;
  return state.teams.find((t) => t.id === id) || null;
}

export function teamLabel(state, id) {
  const t = teamById(state, id);
  return t ? t.name : '—';
}

export function teamColor(state, id) {
  const t = teamById(state, id);
  return t?.color || '#999';
}

export function show(node) { if (node) node.classList.remove('hidden'); }
export function hide(node) { if (node) node.classList.add('hidden'); }

export function toast(message, type = 'info', timeout = 2500) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', style: {
      position: 'fixed', bottom: '20px', right: '20px',
      display: 'flex', flexDirection: 'column', gap: '8px',
      zIndex: 9999, pointerEvents: 'none',
    }});
    document.body.appendChild(host);
  }
  const t = el('div', {
    class: `alert alert-${type}`,
    style: {
      pointerEvents: 'auto',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      minWidth: '240px',
      animation: 'fadeIn 200ms ease',
    }
  }, message);
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 300ms';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, timeout);
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

// Attend que le DOM soit prêt
export function onReady(fn) {
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}

// Téléchargement d'un fichier texte
export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "il y a 5 min" en français
export function timeAgo(date) {
  const now = Date.now();
  const diff = Math.floor((now - date.getTime()) / 1000);
  if (diff < 5) return 'à l\'instant';
  if (diff < 60) return `il y a ${diff}s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d}j`;
  return date.toLocaleDateString('fr-FR');
}
