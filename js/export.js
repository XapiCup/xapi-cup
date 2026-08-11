/* ================================================================
   EXPORT.JS — Export PNG/JPG d'un élément DOM (l'arbre final)
   Utilise la technique canvas + svg-foreignObject pour un rendu parfait
   (inclut les polices, sans dépendances externes)
   ================================================================ */

const CDN_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

let html2canvasPromise = null;
function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CDN_HTML2CANVAS;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error("Impossible de charger html2canvas (vérifiez votre connexion)"));
    document.head.appendChild(s);
  });
  return html2canvasPromise;
}

export async function exportElementAsImage(element, filename = 'xapi-cup-arbre', format = 'png', scale = 2) {
  if (!element) throw new Error('Élément introuvable');
  let html2canvas;
  try {
    html2canvas = await loadHtml2Canvas();
  } catch (e) {
    throw e;
  }
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale,
    useCORS: true,
    logging: false,
  });
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = format === 'jpg' || format === 'jpeg' ? 'jpg' : 'png';
  const dataUrl = canvas.toDataURL(mime, 0.95);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${filename}.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}
