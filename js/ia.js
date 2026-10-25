// Ferramentas compartilhadas para ler arquivos: fotos, PDFs, QR de nota e o leitor com IA.
// Usado por Minhas notas, Foto do preço e Importar encarte (admin e portal).
import * as api from './api.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm';

export const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));

// ---------------------------------------------------------------- imagens
/** abre a imagem já girada certo (fotos de celular vêm com a orientação no EXIF) */
async function bitmapOf(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cai no <img> */ }
  }
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`“${file.name || 'arquivo'}” não é uma imagem que eu consiga abrir.`)); };
    img.src = url;
  });
}

/** desenha num canvas com o maior lado em `max` px (sem aumentar) */
export function toCanvas(src, max = 1600) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h));
  const cv = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

export const canvasToB64 = (cv, q = 0.86) => cv.toDataURL('image/jpeg', q).split(',')[1];

/** PDF → uma imagem (canvas) por página */
export async function pdfPages(file, { scale = 2, maxPages = 24, onPage } = {}) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = Math.min(doc.numPages, maxPages); const out = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const vp0 = page.getViewport({ scale: 1 });
    const s = Math.min(scale, 2400 / Math.max(vp0.width, vp0.height)); // páginas enormes: limita a ~2400 px
    const vp = page.getViewport({ scale: s });
    const cv = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(cv); onPage?.(i, n);
  }
  return { pages: out, total: doc.numPages };
}

/** arquivo (foto ou PDF) → lista de canvases em alta (para QR) */
export async function fileCanvases(file, opts = {}) {
  if (isPdf(file)) return (await pdfPages(file, opts)).pages;
  return [toCanvas(await bitmapOf(file), opts.max || 2400)];
}

// ---------------------------------------------------------------- QR da nota
let jsQR = null;
/** procura um QR na imagem: tenta a imagem toda e recortes (o QR fica no fim da nota) */
export async function decodeQR(cv) {
  const crops = [[0, 0, 1, 1], [0, 0.5, 1, 0.5], [0, 0.6, 1, 0.4], [0.15, 0.45, 0.7, 0.55], [0, 0, 1, 0.5]];
  const det = 'BarcodeDetector' in window ? await (async () => {
    try { const f = await window.BarcodeDetector.getSupportedFormats?.(); return f && !f.includes('qr_code') ? null : new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { return null; }
  })() : null;
  for (const [x, y, w, h] of crops) {
    const c = crop(cv, x, y, w, h);
    if (det) { try { const r = await det.detect(c); if (r[0]?.rawValue) return r[0].rawValue; } catch {} }
    try {
      jsQR ||= (await import(JSQR)).default;
      for (const size of [1200, 800, 1800]) {
        const s = toCanvas(c, size); const d = s.getContext('2d').getImageData(0, 0, s.width, s.height);
        const r = jsQR(d.data, s.width, s.height, { inversionAttempts: 'attemptBoth' });
        if (r?.data) return r.data;
      }
    } catch { /* sem biblioteca (offline): segue */ }
  }
  return null;
}
function crop(cv, x, y, w, h) {
  if (x === 0 && y === 0 && w === 1 && h === 1) return cv;
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(cv.width * w), height: Math.round(cv.height * h) });
  c.getContext('2d').drawImage(cv, cv.width * x, cv.height * y, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

// ---------------------------------------------------------------- leitor com IA
const IA_MSG = {
  sem_chave: 'O leitor com IA ainda não foi ligado pela administração.',
  sem_funcao: 'O leitor com IA ainda não foi instalado no servidor.',
  login: 'Entre na sua conta para usar o leitor.',
  offline: 'Sem internet agora. Tente quando o sinal voltar.',
};
/** manda imagens para a função "leitor-ia". images: [canvas | {data, media_type}] */
export async function iaRead(kind, images, extra = {}) {
  if (!navigator.onLine) throw Object.assign(new Error(IA_MSG.offline), { code: 'offline' });
  const payload = images.map((im) => (im instanceof HTMLCanvasElement ? { data: canvasToB64(toCanvas(im, kind === 'encarte' ? 2000 : 1600)), media_type: 'image/jpeg' } : im));
  const c = await api.sbClient();
  const { data, error } = await c.functions.invoke('leitor-ia', { body: { kind, images: payload, ...extra } });
  if (error) {
    let msg = error.message, code = 'erro';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; if (j?.code) code = j.code; } catch {}
    if (error.context?.status === 404) code = 'sem_funcao';
    throw Object.assign(new Error(IA_MSG[code] || msg), { code });
  }
  return data;
}

// ---------------------------------------------------------------- texto
export const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const money = (v) => (v == null || v === '' ? null : Number(String(v).replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
