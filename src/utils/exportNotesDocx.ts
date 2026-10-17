import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  VerticalAlignTable
} from 'docx';
import { DrawingStroke, SlideTextAnnotation, Presentation, Message, Poll, WordCloud, OpenEndedQuestion } from '../types';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export const getSlideTextAnnotationsForSlide = (
  annotationsMap?: Record<string | number, SlideTextAnnotation[]>,
  slideKey?: string | number
): SlideTextAnnotation[] => {
  if (!annotationsMap || slideKey === undefined || slideKey === null) return [];
  const strKey = String(slideKey);
  const numKey = Number(slideKey);
  const list =
    annotationsMap[strKey] ||
    (!isNaN(numKey) ? annotationsMap[numKey] : undefined) ||
    [];
  return Array.isArray(list) ? list.filter(a => a && typeof a.text === 'string') : [];
};

export const isNotesEmpty = (
  notesMap?: Record<string, string>,
  drawingsMap?: Record<string, string>,
  pushedSlidesMap?: Record<string, string>,
  studentSlideDrawingsMap?: Record<string, string>,
  studentSlideTextAnnotationsMap?: Record<string | number, SlideTextAnnotation[]>
): boolean => {
  const hasText = notesMap && Object.keys(notesMap).length > 0 && !Object.values(notesMap).every(html => {
    if (!html) return true;
    const cleanText = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return cleanText === '';
  });

  const hasDrawings = drawingsMap && Object.keys(drawingsMap).length > 0 && !Object.values(drawingsMap).every(drawingJson => {
    if (!drawingJson) return true;
    try {
      const strokes = JSON.parse(drawingJson);
      return !Array.isArray(strokes) || strokes.length === 0;
    } catch {
      return true;
    }
  });

  const hasStudentDrawings = studentSlideDrawingsMap && Object.keys(studentSlideDrawingsMap).length > 0 && !Object.values(studentSlideDrawingsMap).every(drawingJson => {
    if (!drawingJson) return true;
    try {
      const strokes = JSON.parse(drawingJson);
      return !Array.isArray(strokes) || strokes.length === 0;
    } catch {
      return true;
    }
  });

  const hasStudentTextAnnotations =
    studentSlideTextAnnotationsMap &&
    Object.keys(studentSlideTextAnnotationsMap).length > 0 &&
    Object.values(studentSlideTextAnnotationsMap).some(
      list => Array.isArray(list) && list.some(a => a && a.text && a.text.trim() !== '')
    );

  const hasSlides = pushedSlidesMap && Object.keys(pushedSlidesMap).length > 0;

  return !hasText && !hasDrawings && !hasStudentDrawings && !hasStudentTextAnnotations && !hasSlides;
};

export const dataUriToUint8Array = (dataUrl: string): Uint8Array | null => {
  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const base64 = parts[1];
    const binaryStr = window.atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Failed to convert data URI to Uint8Array:", e);
    return null;
  }
};

export const detectImageFormat = (bytes: Uint8Array | null | undefined): 'png' | 'jpg' | 'gif' | 'bmp' | null => {
  if (!bytes || bytes.length < 4) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'jpg';
  }
  // GIF: 47 49 46
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'gif';
  }
  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) {
    return 'bmp';
  }
  return null;
};

export const fetchImageAsUint8Array = async (url: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> => {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const bytes = dataUriToUint8Array(url);
    if (!bytes) return null;
    const format = detectImageFormat(bytes);
    return format ? { data: bytes, type: format } : null;
  }
  try {
    const isExternal = url.startsWith('http') && typeof window !== 'undefined' && !url.includes(window.location.host);
    const urlsToTry = isExternal
      ? [url, `/api/proxy-image?url=${encodeURIComponent(url)}`]
      : [url];

    for (const fetchUrl of urlsToTry) {
      try {
        const response = await fetch(fetchUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          const format = detectImageFormat(bytes);
          if (format) {
            return { data: bytes, type: format };
          }
        }
      } catch {
        // try next fallback URL
      }
    }
    return null;
  } catch (e) {
    console.error("Failed to fetch image URL as Uint8Array:", e);
    return null;
  }
};

export const createSlidePlaceholderImage = (slideTitle: string): { data: Uint8Array; type: 'png' } | null => {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Background card
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 1000, 560);

    // Crisp 1pt solid black border outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 996, 556);

    // Primary Text
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 36px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(slideTitle, 500, 240);

    // Secondary Text
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'normal 22px Arial, sans-serif';
    ctx.fillText('Slide preview image not available or archived', 500, 310);

    const dataUrl = canvas.toDataURL('image/png');
    const bytes = dataUriToUint8Array(dataUrl);
    if (bytes) {
      const format = detectImageFormat(bytes);
      if (format === 'png') {
        return { data: bytes, type: 'png' };
      }
    }
  } catch (e) {
    console.warn("createSlidePlaceholderImage failed:", e);
  }
  return null;
};

export const colorToRgba = (color?: string, opacity: number = 0.25): string => {
  if (!color) return `rgba(234, 179, 8, ${opacity})`;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith('rgba')) {
    return trimmed.replace(/,\s*[\d\.]+\)$/, `, ${opacity})`);
  }
  if (trimmed.startsWith('rgb')) {
    return trimmed.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
    }
  }
  const namedColors: Record<string, [number, number, number]> = {
    yellow: [234, 179, 8],
    red: [239, 68, 68],
    green: [34, 197, 94],
    blue: [59, 130, 246],
    orange: [235, 93, 0],
    purple: [168, 85, 247],
    pink: [236, 72, 153],
  };
  if (namedColors[trimmed]) {
    const [r, g, b] = namedColors[trimmed];
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return `rgba(234, 179, 8, ${opacity})`;
};

export const convertStrokesToPng = (drawingJson: string): string => {
  if (!drawingJson) return '';
  try {
    const strokes: DrawingStroke[] = JSON.parse(drawingJson);
    if (!Array.isArray(strokes) || strokes.length === 0) return '';

    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1000, 1000);

    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 2;
    const gridSize = 30;
    for (let x = 0; x < 1000; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1000);
      ctx.stroke();
    }
    for (let y = 0; y < 1000; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1000, y);
      ctx.stroke();
    }

    strokes.forEach(stroke => {
      if (!stroke.points || stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.width;

      if (stroke.isHighlighter) {
        ctx.strokeStyle = colorToRgba(stroke.color, 0.25);
      } else {
        ctx.strokeStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
      }

      if (stroke.isArrow && stroke.points.length >= 2) {
        const p1 = stroke.points[0];
        const p2 = stroke.points[stroke.points.length - 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const angle = Math.atan2(dy, dx);
        const headLength = Math.max(25, stroke.width * 4);
        const arrowAngle = Math.PI / 6;

        const h1x = p2.x - headLength * Math.cos(angle - arrowAngle);
        const h1y = p2.y - headLength * Math.sin(angle - arrowAngle);
        const h2x = p2.x - headLength * Math.cos(angle + arrowAngle);
        const h2y = p2.y - headLength * Math.sin(angle + arrowAngle);

        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(h1x, h1y);
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(h2x, h2y);
      } else {
        stroke.points.forEach((p, i) => {
          if (i === 0) {
            ctx.moveTo(p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
        });
      }
      ctx.stroke();
    });

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error("Failed to rasterize drawing strokes:", e);
    return '';
  }
};

const drawRoundedRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

export const generateCompositeSlideBase64 = async (
  slideImgUrl: string,
  presenterDrawingsJson?: string,
  studentDrawingsJson?: string,
  textAnnotations?: SlideTextAnnotation[],
  presenterTextAnnotationsJson?: string
): Promise<string | null> => {
  if (!slideImgUrl) return null;

  return new Promise(async (resolve) => {
    let localBlobUrl = '';
    try {
      if (slideImgUrl.startsWith('data:')) {
        localBlobUrl = slideImgUrl;
      } else {
        const isExternal = slideImgUrl.startsWith('http') && typeof window !== 'undefined' && !slideImgUrl.includes(window.location.host);
        const urlsToTry = isExternal
          ? [slideImgUrl, `/api/proxy-image?url=${encodeURIComponent(slideImgUrl)}`]
          : [slideImgUrl];

        let blob: Blob | null = null;
        for (const fetchUrl of urlsToTry) {
          try {
            const res = await fetch(fetchUrl);
            if (res.ok) {
              const contentType = res.headers.get('content-type') || '';
              if (contentType.includes('image') || contentType === 'application/octet-stream' || !contentType.includes('json')) {
                blob = await res.blob();
                if (blob.size > 100) break;
              }
            }
          } catch {
            // try next URL
          }
        }

        if (blob) {
          localBlobUrl = URL.createObjectURL(blob);
        } else {
          localBlobUrl = slideImgUrl;
        }
      }
    } catch (e) {
      console.error("generateCompositeSlideBase64: Failed to fetch image", e);
      localBlobUrl = slideImgUrl;
    }

    const cleanup = () => {
      if (localBlobUrl && localBlobUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(localBlobUrl);
        } catch {}
      }
    };

    const img = new Image();
    if (!localBlobUrl.startsWith('data:') && !localBlobUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 1920;
        canvas.height = img.naturalHeight || 1080;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        // (a) Draw the base slide image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // (b) Draw the transparent freehand drawing layers (presenter + student)
        const drawStrokeList = (strokes: DrawingStroke[]) => {
          strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length === 0) return;
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const scaleX = canvas.width / 1000;
            const scaleY = canvas.height / 1000;
            const avgScale = (scaleX + scaleY) / 2;

            ctx.lineWidth = stroke.width * avgScale;

            if (stroke.isHighlighter) {
              ctx.strokeStyle = colorToRgba(stroke.color, 0.25);
            } else {
              ctx.strokeStyle = stroke.color;
              ctx.fillStyle = stroke.color;
            }

            const pts = stroke.points.map(p => ({
              x: p.x * scaleX,
              y: p.y * scaleY
            }));

            if (stroke.text && pts[0]) {
              const fontSize = Math.max(26, stroke.width * 5) * avgScale;
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.fillText(stroke.text, pts[0].x, pts[0].y);
            } else if (stroke.isArrow && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const angle = Math.atan2(dy, dx);
              const headLength = Math.max(25, stroke.width * 4) * avgScale;
              const arrowAngle = Math.PI / 6;

              const h1x = p2.x - headLength * Math.cos(angle - arrowAngle);
              const h1y = p2.y - headLength * Math.sin(angle - arrowAngle);
              const h2x = p2.x - headLength * Math.cos(angle + arrowAngle);
              const h2y = p2.y - headLength * Math.sin(angle + arrowAngle);

              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h1x, h1y);
              ctx.moveTo(p2.x, p2.y);
              ctx.lineTo(h2x, h2y);
              ctx.stroke();
            } else if (stroke.isLine && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            } else if (stroke.isRectangle && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const x = Math.min(p1.x, p2.x);
              const y = Math.min(p1.y, p2.y);
              const w = Math.abs(p2.x - p1.x);
              const h = Math.abs(p2.y - p1.y);
              ctx.beginPath();
              ctx.rect(x, y, w, h);
              ctx.stroke();
            } else if (stroke.isCircle && pts.length >= 2) {
              const p1 = pts[0];
              const p2 = pts[pts.length - 1];
              const cx = (p1.x + p2.x) / 2;
              const cy = (p1.y + p2.y) / 2;
              const rx = Math.abs(p2.x - p1.x) / 2;
              const ry = Math.abs(p2.y - p1.y) / 2;
              ctx.beginPath();
              if (typeof ctx.ellipse === 'function') {
                ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
              } else {
                const r = (rx + ry) / 2;
                ctx.arc(cx, cy, r, 0, 2 * Math.PI);
              }
              ctx.stroke();
            } else {
              ctx.beginPath();
              pts.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              });
              if (pts.length === 1) {
                ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
              }
              ctx.stroke();
            }
            ctx.restore();
          });
        };

        if (presenterDrawingsJson) {
          try {
            const pStrokes = JSON.parse(presenterDrawingsJson);
            if (Array.isArray(pStrokes)) drawStrokeList(pStrokes);
          } catch {}
        }

        if (studentDrawingsJson) {
          try {
            const sStrokes = JSON.parse(studentDrawingsJson);
            if (Array.isArray(sStrokes)) drawStrokeList(sStrokes);
          } catch {}
        }

        // (c) Draw all text annotations for that slide from state (both presenter and student)
        let allTextAnns: SlideTextAnnotation[] = Array.isArray(textAnnotations) ? [...textAnnotations] : [];
        if (presenterTextAnnotationsJson) {
          try {
            const parsed = JSON.parse(presenterTextAnnotationsJson);
            if (Array.isArray(parsed)) {
              allTextAnns = [...parsed, ...allTextAnns];
            }
          } catch {}
        }

        if (allTextAnns.length > 0) {
          const widthScale = canvas.width / 960;
          allTextAnns.forEach(ann => {
            if (!ann || !ann.text || !ann.text.trim()) return;
            ctx.save();

            const lines = ann.text.split(/\r?\n/);
            const fontSize = Math.max(12, Math.round((ann.fontSize || 16) * widthScale));
            const lineHeight = Math.round(fontSize * 1.3);
            const padX = Math.round(10 * widthScale);
            const padY = Math.round(6 * widthScale);
            const borderRadius = Math.round(8 * widthScale);

            ctx.font = `bold ${fontSize}px Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';

            const maxLineWidth = Math.max(
              ...lines.map(line => ctx.measureText(line || ' ').width),
              fontSize
            );
            const boxWidth = maxLineWidth + padX * 2;
            const boxHeight = lines.length * lineHeight + padY * 2;

            const rawX = (ann.xPct / 100) * canvas.width;
            const rawY = (ann.yPct / 100) * canvas.height;
            const x = Math.max(0, Math.min(canvas.width - Math.min(boxWidth, canvas.width), rawX));
            const y = Math.max(0, Math.min(canvas.height - Math.min(boxHeight, canvas.height), rawY));

            const isWhiteInk = (ann.color || '').trim().toUpperCase() === '#FFFFFF';
            ctx.fillStyle = isWhiteInk ? 'rgba(15, 23, 42, 0.90)' : 'rgba(255, 255, 255, 0.95)';
            ctx.strokeStyle = isWhiteInk ? 'rgba(255, 255, 255, 0.35)' : 'rgba(203, 213, 225, 0.9)';
            ctx.lineWidth = Math.max(1, Math.round(1.5 * widthScale));

            drawRoundedRectPath(ctx, x, y, boxWidth, boxHeight, borderRadius);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = ann.color || '#000000';
            const verticalOffset = Math.round((lineHeight - fontSize) / 2);
            lines.forEach((line, idx) => {
              ctx.fillText(line, x + padX, y + padY + idx * lineHeight + verticalOffset);
            });

            ctx.restore();
          });
        }

        // Crisp 1pt solid black outline border
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, Math.round(canvas.width / 480));
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        const dataUrl = canvas.toDataURL('image/png');
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        cleanup();
        resolve(null);
      }
    };

    img.onerror = () => {
      cleanup();
      resolve(null);
    };

    img.src = localBlobUrl;
  });
};

export const compositeSlideWithAnnotations = async (
  slideImgUrl: string,
  presenterDrawingsJson?: string,
  studentDrawingsJson?: string,
  textAnnotations?: SlideTextAnnotation[],
  presenterTextAnnotationsJson?: string
): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> => {
  if (!slideImgUrl) return null;

  const hasStrokes = (json?: string): boolean => {
    if (!json) return false;
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  };

  const hasPresenterText = (json?: string): boolean => {
    if (!json) return false;
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) && parsed.some(a => a && a.text && a.text.trim() !== '');
    } catch {
      return false;
    }
  };

  const hasPresenter = hasStrokes(presenterDrawingsJson);
  const hasStudent = hasStrokes(studentDrawingsJson);
  const hasTextAnns = Array.isArray(textAnnotations) && textAnnotations.some(a => a && a.text && a.text.trim() !== '');
  const hasPText = hasPresenterText(presenterTextAnnotationsJson);

  // If there are NO annotations, directly fetch the original image bytes
  // This avoids canvas re-encoding overhead and eliminates memory/taint issues
  if (!hasPresenter && !hasStudent && !hasTextAnns && !hasPText) {
    return await fetchImageAsUint8Array(slideImgUrl);
  }

  const dataUrl = await generateCompositeSlideBase64(
    slideImgUrl,
    presenterDrawingsJson,
    studentDrawingsJson,
    textAnnotations,
    presenterTextAnnotationsJson
  );

  if (dataUrl) {
    const bytes = dataUriToUint8Array(dataUrl);
    if (bytes) {
      const format = detectImageFormat(bytes);
      if (format) {
        return { data: bytes, type: format };
      }
    }
  }

  return await fetchImageAsUint8Array(slideImgUrl);
};

export const parseHtmlToDocxParagraphs = (htmlString: string): Paragraph[] => {
  if (!htmlString) return [];
  const paragraphs: Paragraph[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${htmlString}</div>`, 'text/html');
  const root = doc.body.firstElementChild || doc.body;

  const processNode = (
    node: Node, 
    currentRuns: TextRun[], 
    inheritedStyle: { bold?: boolean; italics?: boolean; underline?: boolean; color?: string }
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        currentRuns.push(new TextRun({
          text: text,
          bold: inheritedStyle.bold,
          italics: inheritedStyle.italics,
          underline: inheritedStyle.underline ? {} : undefined,
          color: inheritedStyle.color,
          font: "Arial"
        }));
      }
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      const tag = elem.tagName.toLowerCase();

      const newStyle = { ...inheritedStyle };
      if (tag === 'b' || tag === 'strong') newStyle.bold = true;
      if (tag === 'i' || tag === 'em') newStyle.italics = true;
      if (tag === 'u') newStyle.underline = true;
      const rawColor = (elem.style && elem.style.color) || elem.getAttribute('color') || '';
      if (rawColor) {
        const lower = rawColor.trim().toLowerCase();
        if (
          lower === '#f1f5f9' ||
          lower === '#f8fafc' ||
          lower === '#ffffff' ||
          lower === 'rgb(241, 245, 249)' ||
          lower === 'rgb(248, 250, 252)' ||
          lower === 'rgb(255, 255, 255)'
        ) {
          newStyle.color = undefined;
        } else if (lower.startsWith('#')) {
          newStyle.color = lower.replace('#', '');
        }
      }

      if (['p', 'div', 'li', 'h1', 'h2', 'h3'].includes(tag)) {
        const childRuns: TextRun[] = [];
        elem.childNodes.forEach(child => processNode(child, childRuns, newStyle));
        if (childRuns.length > 0) {
          paragraphs.push(new Paragraph({
            children: childRuns,
            bullet: tag === 'li' ? { level: 0 } : undefined,
            heading: tag === 'h1' ? HeadingLevel.HEADING_1 : tag === 'h2' ? HeadingLevel.HEADING_2 : tag === 'h3' ? HeadingLevel.HEADING_3 : undefined,
            spacing: { after: 120 }
          }));
        }
      } else {
        elem.childNodes.forEach(child => processNode(child, currentRuns, newStyle));
      }
    }
  };

  const hasBlocks = root.querySelector('p, div, li, h1, h2, h3');
  if (hasBlocks) {
    root.childNodes.forEach(child => {
      const runs: TextRun[] = [];
      processNode(child, runs, {});
      if (runs.length > 0 && !['p','div','li','h1','h2','h3'].includes((child as HTMLElement).tagName?.toLowerCase() || '')) {
        paragraphs.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
      }
    });
  } else {
    const runs: TextRun[] = [];
    root.childNodes.forEach(child => processNode(child, runs, {}));
    if (runs.length > 0) {
      paragraphs.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
    }
  }

  return paragraphs;
};

export interface ExportNotesOptions {
  presentationId: string;
  pinCode?: string;
  presenterEmail?: string;
  notesTitle?: string;
  notesTextMap?: Record<string, string>;
  notesDrawingsMap?: Record<string, string>;
  studentSlideDrawingsMap?: Record<string, string>;
  studentSlideTextAnnotationsMap?: Record<string | number, SlideTextAnnotation[]>;
  pushedSlidesMap?: Record<string, string>;
  presenterDrawingsMap?: Record<string, string>;
  presenterTextAnnotationsMap?: Record<string, string>;
  customTabs?: Array<{ id: string; label: string; position: number }>;
}

export const exportNotesToDocx = async (options: ExportNotesOptions): Promise<boolean> => {
  const {
    presentationId,
    pinCode = 'N/A',
    presenterEmail = '',
    notesTitle: passedTitle = '',
    notesTextMap: passedNotes,
    notesDrawingsMap: passedDrawings,
    studentSlideDrawingsMap: passedStudentDrawings,
    studentSlideTextAnnotationsMap: passedStudentTextAnnotations,
    pushedSlidesMap: passedPushedSlides,
    presenterDrawingsMap: passedPresenterDrawings,
    presenterTextAnnotationsMap: passedPresenterTextAnnotations,
    customTabs: passedCustomTabs
  } = options;

  let notesTextMap = passedNotes;
  let notesDrawingsMap = passedDrawings;
  let studentSlideDrawingsMap = passedStudentDrawings;
  let studentSlideTextAnnotationsMap = passedStudentTextAnnotations;
  let pushedSlidesMap = passedPushedSlides;
  let presenterDrawingsMap = passedPresenterDrawings;
  let presenterTextAnnotationsMap = passedPresenterTextAnnotations;
  let customTabs = passedCustomTabs;
  let notesTitle = passedTitle;

  if (!notesTextMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckNotes_${presentationId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        notesTextMap = typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { '1': saved };
      } catch {
        notesTextMap = { '1': saved };
      }
    } else {
      notesTextMap = {};
    }
  }
  notesTextMap = notesTextMap || {};

  if (!notesDrawingsMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckDrawings_${presentationId}`);
    if (saved) {
      try {
        notesDrawingsMap = JSON.parse(saved);
      } catch {}
    }
  }
  notesDrawingsMap = notesDrawingsMap || {};

  if (!studentSlideDrawingsMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckStudentSlideDrawings_${presentationId}`);
    if (saved) {
      try {
        studentSlideDrawingsMap = JSON.parse(saved);
      } catch {}
    }
  }
  studentSlideDrawingsMap = studentSlideDrawingsMap || {};

  if (!studentSlideTextAnnotationsMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckStudentSlideTextAnnotations_${presentationId}`);
    if (saved) {
      try {
        studentSlideTextAnnotationsMap = JSON.parse(saved);
      } catch {}
    }
  }
  studentSlideTextAnnotationsMap = studentSlideTextAnnotationsMap || {};

  if (!pushedSlidesMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckPushedSlides_${presentationId}`);
    if (saved) {
      try {
        pushedSlidesMap = JSON.parse(saved);
      } catch {}
    }
  }
  pushedSlidesMap = pushedSlidesMap || {};

  if (!presenterDrawingsMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckPresenterDrawings_${presentationId}`);
    if (saved) {
      try {
        presenterDrawingsMap = JSON.parse(saved);
      } catch {}
    }
  }
  presenterDrawingsMap = presenterDrawingsMap || {};

  if (!presenterTextAnnotationsMap && presentationId) {
    const saved = localStorage.getItem(`activeDeckPresenterTextAnnotations_${presentationId}`);
    if (saved) {
      try {
        presenterTextAnnotationsMap = JSON.parse(saved);
      } catch {}
    }
  }
  presenterTextAnnotationsMap = presenterTextAnnotationsMap || {};

  if (!customTabs && presentationId) {
    const saved = localStorage.getItem(`activeDeckCustomTabs_${presentationId}`);
    if (saved) {
      try {
        customTabs = JSON.parse(saved);
      } catch {}
    }
  }
  customTabs = customTabs || [];

  if (!notesTitle && presentationId) {
    notesTitle = localStorage.getItem(`activeDeckNotesTitle_${presentationId}`) || '';
  }

  if (isNotesEmpty(notesTextMap, notesDrawingsMap, pushedSlidesMap, studentSlideDrawingsMap, studentSlideTextAnnotationsMap)) {
    return false;
  }

  const title = notesTitle.trim() || `Session_${pinCode || 'Notes'}`;
  const filename = `ActiveDeck_Notes_${title.replace(/[^a-z0-9_-]/gi, '_')}.docx`;
  const presenterName = presenterEmail ? presenterEmail.split('@')[0] : 'Presenter';

  const getTabTitle = (tabId: string) => {
    const custom = customTabs?.find(c => c.id === tabId);
    if (custom) return custom.label;
    return `Slide ${tabId}`;
  };

  const getTabPos = (tabId: string) => {
    const custom = customTabs?.find(c => c.id === tabId);
    if (custom) return custom.position;
    const num = Number(tabId);
    return isNaN(num) ? 999999 : num;
  };

  const sortedSlides = Array.from(new Set([
    ...Object.keys(notesTextMap),
    ...Object.keys(notesDrawingsMap),
    ...Object.keys(pushedSlidesMap),
    ...Object.keys(studentSlideDrawingsMap),
    ...Object.keys(studentSlideTextAnnotationsMap),
    ...customTabs.map(c => c.id)
  ]))
    .filter(slide => {
      const html = notesTextMap?.[slide] || '';
      const hasText = html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';

      const drawingJson = notesDrawingsMap?.[slide] || '';
      let hasDrawing = false;
      try {
        if (drawingJson) {
          const strokes = JSON.parse(drawingJson);
          hasDrawing = Array.isArray(strokes) && strokes.length > 0;
        }
      } catch {}

      const hasImg = !!pushedSlidesMap?.[slide];
      const slideTextAnns = getSlideTextAnnotationsForSlide(studentSlideTextAnnotationsMap, slide);
      const hasSlideTextAnns = slideTextAnns.some(a => a.text && a.text.trim() !== '');

      return hasText || hasDrawing || hasImg || hasSlideTextAnns;
    })
    .sort((a, b) => getTabPos(a) - getTabPos(b));

  const slideElements: (Paragraph | Table)[] = [];

  for (let sIdx = 0; sIdx < sortedSlides.length; sIdx++) {
    const slide = sortedSlides[sIdx];
    const slideTitle = getTabTitle(slide);

    // 1. Left Column (Slide Image with 1pt solid black outline and small bold header)
    const leftCellChildren: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: slideTitle,
            bold: true,
            size: 20, // 10pt
            color: "0F172A",
            font: "Arial"
          })
        ],
        spacing: { before: 0, after: 60 }
      })
    ];

    const slideImgUrl = pushedSlidesMap[slide];
    const presenterJson = presenterDrawingsMap[slide];
    const presenterTextJson = presenterTextAnnotationsMap?.[slide];
    const studentJson = studentSlideDrawingsMap[slide];
    const slideTextAnns = getSlideTextAnnotationsForSlide(studentSlideTextAnnotationsMap, slide);

    let imgResult: { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null = null;
    if (slideImgUrl) {
      imgResult = await compositeSlideWithAnnotations(
        slideImgUrl,
        presenterJson,
        studentJson,
        slideTextAnns,
        presenterTextJson
      );
    }
    if (!imgResult) {
      imgResult = createSlidePlaceholderImage(slideTitle);
    }

    if (imgResult) {
      leftCellChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: imgResult.data,
              transformation: { width: 310, height: 174 },
              type: imgResult.type,
              outline: {
                width: 12700, // 1pt solid black outline
                type: "solidFill",
                solidFillType: "rgb",
                value: "000000"
              }
            })
          ],
          spacing: { before: 0, after: 40 }
        })
      );
    }

    const leftCell = new TableCell({
      width: { size: 48, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlignTable.TOP,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      },
      margins: { top: 40, bottom: 40, left: 0, right: 140 },
      children: leftCellChildren
    });

    // 2. Right Column (Typed Notes inside styled callout container)
    const rightCellChildren: Paragraph[] = [];
    const htmlContent = notesTextMap[slide];
    const cleanText = (htmlContent || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

    if (cleanText) {
      const textParagraphs = parseHtmlToDocxParagraphs(htmlContent);
      rightCellChildren.push(...textParagraphs);
    }

    const drawingJson = notesDrawingsMap[slide];
    if (drawingJson) {
      const pngDataUrl = convertStrokesToPng(drawingJson);
      if (pngDataUrl) {
        const drawingBytes = dataUriToUint8Array(pngDataUrl);
        const format = detectImageFormat(drawingBytes);
        if (drawingBytes && format) {
          rightCellChildren.push(
            new Paragraph({
              children: [
                new TextRun({ text: "Handwritten Notes:", bold: true, color: "475569", size: 18, font: "Arial" }),
              ],
              spacing: { before: cleanText ? 120 : 0, after: 60 }
            }),
            new Paragraph({
              children: [
                new ImageRun({
                  data: drawingBytes,
                  transformation: { width: 290, height: 200 },
                  type: format
                })
              ],
              spacing: { after: 60 }
            })
          );
        }
      }
    }

    if (rightCellChildren.length === 0) {
      rightCellChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "No typed notes for this slide",
              italics: true,
              color: "94A3B8",
              size: 20, // 10pt
              font: "Arial"
            })
          ],
          spacing: { before: 80, after: 80 }
        })
      );
    }

    const rightCell = new TableCell({
      width: { size: 52, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlignTable.TOP,
      shading: { fill: "F8FAFC" },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        left: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      },
      margins: { top: 140, bottom: 140, left: 160, right: 160 },
      children: rightCellChildren
    });

    const slideTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [leftCell, rightCell]
        })
      ]
    });

    slideElements.push(slideTable);

    if (sIdx < sortedSlides.length - 1) {
      slideElements.push(
        new Paragraph({
          spacing: { before: 100, after: 180 }
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "ActiveDeck Study Notes",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 160 }
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: "auto" },
            bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
            left: { style: BorderStyle.SINGLE, size: 24, color: "EB5D00" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { fill: "F8FAFC" },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Presenter: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: presenterName, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Session PIN: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: pinCode, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Notes Title: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: title, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Date: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: new Date().toLocaleDateString(), color: "334155", font: "Arial", size: 21 }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        // Clean horizontal divider before slide notes begin
        new Paragraph({
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 10,
              color: "CBD5E1",
              space: 1
            }
          },
          spacing: { before: 180, after: 260 }
        }),
        ...slideElements
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return true;
};

export interface ExportPresentationOptions {
  presentation: Presentation;
  includeChat?: boolean;
  bridgeThumbnails?: Record<number, string>;
}

export const exportPresentationToDocx = async (options: ExportPresentationOptions): Promise<boolean> => {
  const { presentation, includeChat = false, bridgeThumbnails } = options;
  if (!presentation?.id) {
    alert("Presentation session not found!");
    return false;
  }

  // Query slide preview messages
  const previewQuery = query(
    collection(db, 'messages'),
    where('presentationId', '==', presentation.id),
    where('isBackgroundPreview', '==', true)
  );

  const querySnapshot = await getDocs(previewQuery);
  const previewsMap: Record<string, string> = {};
  querySnapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (data.slide !== undefined && data.slide !== null && data.fileUrl) {
      previewsMap[String(data.slide)] = data.fileUrl;
    }
  });

  // Prioritize clean static slide thumbnails from PowerPoint Bridge when available
  if (bridgeThumbnails && Object.keys(bridgeThumbnails).length > 0) {
    Object.entries(bridgeThumbnails).forEach(([slideKey, cleanUrl]) => {
      if (cleanUrl) {
        previewsMap[String(slideKey)] = cleanUrl;
      }
    });
  }

  const sortedSlides = Object.keys(previewsMap).sort((a, b) => {
    const numA = Number(a);
    const numB = Number(b);
    if (isNaN(numA) || isNaN(numB)) return a.localeCompare(b);
    return numA - numB;
  });

  if (sortedSlides.length === 0) {
    alert("No slides have been captured yet for this presentation. Present slides first!");
    return false;
  }

  // Load chat and activities if includeChat is true or for slide questions
  let msgs: Message[] = [];
  let ps: Poll[] = [];
  let wcs: WordCloud[] = [];
  let oeqs: OpenEndedQuestion[] = [];

  const msgsQuery = query(collection(db, 'messages'), where('presentationId', '==', presentation.id));
  const msgsSnap = await getDocs(msgsQuery);
  msgs = msgsSnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter((m: any) => !m.isBackgroundPreview) as Message[];
  msgs.sort((a, b) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));

  if (includeChat) {
    const pollsQuery = query(collection(db, 'polls'), where('presentationId', '==', presentation.id));
    const pollsSnap = await getDocs(pollsQuery);
    ps = pollsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Poll[];
    ps.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

    const wcQuery = query(collection(db, 'wordClouds'), where('presentationId', '==', presentation.id));
    const wcSnap = await getDocs(wcQuery);
    wcs = wcSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as WordCloud[];
    wcs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));

    const oeqQuery = query(collection(db, 'openEndedQuestions'), where('presentationId', '==', presentation.id));
    const oeqSnap = await getDocs(oeqQuery);
    oeqs = oeqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as OpenEndedQuestion[];
    oeqs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
  }

  const slideElements: (Paragraph | Table)[] = [];

  for (let sIdx = 0; sIdx < sortedSlides.length; sIdx++) {
    const slide = sortedSlides[sIdx];
    const slideNum = Number(slide);
    const titleStr = isNaN(slideNum) ? slide : `Slide ${slide}`;

    // 1. Left Column (Slide image with 1pt solid black outline and bold header)
    const leftCellChildren: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: titleStr,
            bold: true,
            size: 20, // 10pt
            color: "0F172A",
            font: "Arial"
          })
        ],
        spacing: { before: 0, after: 60 }
      })
    ];

    const slideImgUrl = previewsMap[slide];
    const presenterJson = presentation?.presenterDrawings?.[slide];
    const presenterTextJson = presentation?.presenterTextAnnotations?.[slide];

    let imgResult: { data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null = null;
    if (slideImgUrl) {
      imgResult = await compositeSlideWithAnnotations(
        slideImgUrl,
        presenterJson,
        undefined,
        undefined,
        presenterTextJson
      );
    }
    if (!imgResult) {
      imgResult = createSlidePlaceholderImage(titleStr);
    }

    if (imgResult) {
      leftCellChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: imgResult.data,
              transformation: { width: 310, height: 174 },
              type: imgResult.type,
              outline: {
                width: 12700, // 1pt solid black outline
                type: "solidFill",
                solidFillType: "rgb",
                value: "000000"
              }
            })
          ],
          spacing: { before: 0, after: 40 }
        })
      );
    }

    const leftCell = new TableCell({
      width: { size: 48, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlignTable.TOP,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      },
      margins: { top: 40, bottom: 40, left: 0, right: 140 },
      children: leftCellChildren
    });

    // 2. Right Column (Audience Questions / Slide Activity inside styled callout container)
    const rightCellChildren: Paragraph[] = [];
    const slideMsgs = msgs.filter(m => m.slide !== undefined && m.slide !== null && String(m.slide) === String(slide));
    const slidePolls = ps.filter(p => p.slide !== undefined && p.slide !== null && String(p.slide) === String(slide));
    const slideWcs = wcs.filter(w => w.slide !== undefined && w.slide !== null && String(w.slide) === String(slide));
    const slideOeqs = oeqs.filter(q => q.slide !== undefined && q.slide !== null && String(q.slide) === String(slide));

    if (slideMsgs.length > 0) {
      rightCellChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Audience Questions & Notes:",
              bold: true,
              color: "0F172A",
              size: 18,
              font: "Arial"
            })
          ],
          spacing: { before: 0, after: 60 }
        })
      );

      slideMsgs.forEach(m => {
        const timeStr = m.timestamp
          ? m.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const likesStr = m.likes ? ` (👍 ${m.likes})` : '';

        rightCellChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${m.userName || 'Student'}${timeStr ? ` [${timeStr}]` : ''}: `,
                bold: true,
                color: "1E293B",
                size: 17,
                font: "Arial"
              }),
              new TextRun({
                text: m.text || '',
                color: "334155",
                size: 17,
                font: "Arial"
              }),
              ...(likesStr ? [
                new TextRun({
                  text: likesStr,
                  bold: true,
                  color: "B45309",
                  size: 16,
                  font: "Arial"
                })
              ] : [])
            ],
            spacing: { before: 30, after: 30 }
          })
        );
      });
    }

    if (slidePolls.length > 0) {
      slidePolls.forEach(p => {
        rightCellChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `📊 Poll: ${p.question || p.prompt || 'MCQ Poll'}`,
                bold: true,
                color: "0F172A",
                size: 17,
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 30 }
          })
        );
      });
    }

    if (slideWcs.length > 0) {
      slideWcs.forEach(w => {
        rightCellChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `☁️ Word Cloud: ${w.prompt || 'Activity'}`,
                bold: true,
                color: "0F172A",
                size: 17,
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 30 }
          })
        );
      });
    }

    if (slideOeqs.length > 0) {
      slideOeqs.forEach(q => {
        rightCellChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `❓ Open Question: ${q.prompt || q.question || 'Prompt'}`,
                bold: true,
                color: "0F172A",
                size: 17,
                font: "Arial"
              })
            ],
            spacing: { before: 60, after: 30 }
          })
        );
      });
    }

    if (rightCellChildren.length === 0) {
      rightCellChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: includeChat ? "No audience questions or notes recorded for this slide" : "Slide presentation overview",
              italics: true,
              color: "94A3B8",
              size: 20, // 10pt
              font: "Arial"
            })
          ],
          spacing: { before: 80, after: 80 }
        })
      );
    }

    const rightCell = new TableCell({
      width: { size: 52, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlignTable.TOP,
      shading: { fill: "F8FAFC" },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        left: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      },
      margins: { top: 140, bottom: 140, left: 160, right: 160 },
      children: rightCellChildren
    });

    const slideTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
      },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [leftCell, rightCell]
        })
      ]
    });

    slideElements.push(slideTable);

    if (sIdx < sortedSlides.length - 1) {
      slideElements.push(
        new Paragraph({
          spacing: { before: 100, after: 180 }
        })
      );
    }
  }

  // Activity section
  const activityElements: any[] = [];
  if (includeChat) {
    const combinedItems = [
      ...msgs.map(m => ({ ...m, type: 'message' as const })),
      ...ps.map(p => ({ ...p, type: 'poll' as const })),
      ...wcs.map(w => ({ ...w, type: 'wordCloud' as const })),
      ...oeqs.map(q => ({ ...q, type: 'openEnded' as const }))
    ].sort((a, b) => {
      const timeA = ((a as any).timestamp || (a as any).createdAt)?.toMillis() || 0;
      const timeB = ((b as any).timestamp || (b as any).createdAt)?.toMillis() || 0;
      return timeA - timeB;
    });

    activityElements.push(
      new Paragraph({
        text: "Session Activity & Chat Log",
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        spacing: { before: 240, after: 200 }
      })
    );

    if (combinedItems.length === 0) {
      activityElements.push(
        new Paragraph({
          text: "No chat messages or session activities recorded.",
          spacing: { before: 120, after: 120 }
        })
      );
    } else {
      let runningMessageRows: TableRow[] = [];

      const flushMessages = () => {
        if (runningMessageRows.length > 0) {
          const headerBorders = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
            left: { style: BorderStyle.NONE, size: 0, color: "auto" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" }
          };
          const tableHeader = new TableRow({
            children: [
              new TableCell({ borders: headerBorders, width: { size: 10, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Date", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
              new TableCell({ borders: headerBorders, width: { size: 12, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Time", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
              new TableCell({ borders: headerBorders, width: { size: 8, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Slide", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
              new TableCell({ borders: headerBorders, width: { size: 15, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
              new TableCell({ borders: headerBorders, width: { size: 20, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Email", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
              new TableCell({ borders: headerBorders, width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "F1F5F9" }, children: [new Paragraph({ children: [new TextRun({ text: "Question / Message", bold: true, font: "Arial", size: 18, color: "0F172A" })] })] }),
            ]
          });
          activityElements.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
              },
              rows: [tableHeader, ...runningMessageRows]
            }),
            new Paragraph({ spacing: { after: 240 } })
          );
          runningMessageRows = [];
        }
      };

      for (const item of combinedItems) {
        if (item.type === 'message') {
          const m = item as Message;
          const dateObj = m.timestamp?.toDate() || new Date();
          const dateStr = dateObj.toLocaleDateString();
          const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const slideStr = m.slide !== undefined && m.slide !== null ? `Slide ${m.slide}` : '-';
          const nameStr = m.userName || '-';
          const emailStr = m.userEmail || '-';
          const textStr = m.text || '';
          const likesStr = m.likes ? ` (👍 ${m.likes})` : '';

          const cellBorders = {
            top: { style: BorderStyle.NONE, size: 0, color: "auto" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
            left: { style: BorderStyle.NONE, size: 0, color: "auto" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" }
          };

          runningMessageRows.push(
            new TableRow({
              children: [
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: dateStr, font: "Arial", size: 18, color: "334155" })] })] }),
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: timeStr, font: "Arial", size: 18, color: "334155" })] })] }),
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: slideStr, font: "Arial", size: 18, color: "334155" })] })] }),
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: nameStr, font: "Arial", size: 18, bold: true, color: "0F172A" })] })] }),
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [new TextRun({ text: emailStr, font: "Arial", size: 18, color: "334155" })] })] }),
                new TableCell({ borders: cellBorders, children: [new Paragraph({ children: [
                  new TextRun({ text: textStr, font: "Arial", size: 18, color: "334155" }),
                  ...(likesStr ? [new TextRun({ text: likesStr, font: "Arial", size: 18, bold: true, color: "854D0E" })] : [])
                ] })] }),
              ]
            })
          );
        } else {
          flushMessages();

          const cellBorders = {
            top: { style: BorderStyle.NONE, size: 0, color: "auto" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
            left: { style: BorderStyle.NONE, size: 0, color: "auto" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" }
          };

          if (item.type === 'poll') {
            const p = item as Poll;
            const dateObj = p.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const slideStr = p.slide !== undefined ? ` [Slide ${p.slide}]` : '';
            const totalVotes = Object.values(p.votes || {}).reduce((sum, val) => sum + val, 0);

            activityElements.push(
              new Paragraph({
                text: "📊 MCQ POLL RESULTS",
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 240, after: 60 }
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true })
                ],
                spacing: { after: 120 }
              })
            );

            const pollRows = p.options.map(opt => {
              const count = p.votes[opt] || 0;
              const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isCorrect = p.correctAnswer === opt;
              return new TableRow({
                children: [
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 30, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: `Option ${opt}`, bold: true, font: "Arial", size: 18 })] })]
                  }),
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 40, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: `${count} votes (${percentage}%)`, font: "Arial", size: 18 })] })]
                  }),
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 30, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [
                      ...(isCorrect ? [new TextRun({ text: "✓ CORRECT ANSWER", bold: true, color: "10B981", font: "Arial", size: 18 })] : [])
                    ] })]
                  })
                ]
              });
            });

            if (pollRows.length > 0) {
              activityElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
                  },
                  rows: pollRows
                })
              );
            } else {
              activityElements.push(
                new Paragraph({
                  children: [new TextRun({ text: "No options recorded for this poll.", italics: true, font: "Arial", size: 18, color: "64748B" })],
                  spacing: { after: 120 }
                })
              );
            }

            activityElements.push(
              new Paragraph({ spacing: { after: 120 } }),
              new Paragraph({
                children: [new TextRun({ text: `Total Votes: ${totalVotes}`, bold: true, font: "Arial", size: 18 })],
                spacing: { after: 240 }
              })
            );

          } else if (item.type === 'wordCloud') {
            const w = item as WordCloud;
            const dateObj = w.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const slideStr = w.slide !== undefined ? ` [Slide ${w.slide}]` : '';
            const totalSubmissions = Object.values(w.words || {}).reduce((sum, val) => sum + val, 0);

            activityElements.push(
              new Paragraph({
                text: "☁️ WORD CLOUD SUBMISSIONS",
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 240, after: 60 }
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true })
                ],
                spacing: { after: 120 }
              })
            );

            const sortedWords = Object.entries(w.words || {}).sort((a, b) => b[1] - a[1]);
            const wordRows = sortedWords.map(([word, count]) => {
              return new TableRow({
                children: [
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 60, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: word, bold: true, font: "Arial", size: 18 })] })]
                  }),
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 40, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: `${count} submission${count > 1 ? 's' : ''}`, font: "Arial", size: 18 })] })]
                  })
                ]
              });
            });

            if (wordRows.length > 0) {
              activityElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
                  },
                  rows: wordRows
                })
              );
            } else {
              activityElements.push(
                new Paragraph({
                  children: [new TextRun({ text: "No words submitted for this word cloud.", italics: true, font: "Arial", size: 18, color: "64748B" })],
                  spacing: { after: 120 }
                })
              );
            }

            activityElements.push(
              new Paragraph({ spacing: { after: 120 } }),
              new Paragraph({
                children: [new TextRun({ text: `Total Submissions: ${totalSubmissions}`, bold: true, font: "Arial", size: 18 })],
                spacing: { after: 240 }
              })
            );

          } else if (item.type === 'openEnded') {
            const q = item as OpenEndedQuestion;
            const dateObj = q.createdAt?.toDate() || new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const slideStr = q.slide !== undefined ? ` [Slide ${q.slide}]` : '';
            const responseList: string[] = Array.isArray(q.responses)
              ? (q.responses as any[]).map((r: any) => typeof r === 'string' ? r : r?.text || '')
              : Object.values(q.responses || {});
            const totalResponses = responseList.length;

            activityElements.push(
              new Paragraph({
                text: "❓ OPEN-ENDED QUESTION RESPONSES",
                heading: HeadingLevel.HEADING_3,
                spacing: { before: 240, after: 60 }
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `Prompt: "${q.prompt || q.question || ''}"`, bold: true, font: "Arial", size: 18, color: "0F172A" }),
                ],
                spacing: { after: 40 }
              }),
              new Paragraph({
                children: [
                  new TextRun({ text: `Triggered on ${dateStr} at ${timeStr}${slideStr}`, size: 16, color: "64748B", italics: true })
                ],
                spacing: { after: 120 }
              })
            );

            const respRows = responseList.map((respText, idx) => {
              return new TableRow({
                children: [
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 10, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: `#${idx + 1}`, bold: true, font: "Arial", size: 18 })] })]
                  }),
                  new TableCell({
                    borders: cellBorders,
                    width: { size: 90, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ children: [new TextRun({ text: String(respText), font: "Arial", size: 18 })] })]
                  })
                ]
              });
            });

            if (respRows.length > 0) {
              activityElements.push(
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
                    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
                  },
                  rows: respRows
                })
              );
            } else {
              activityElements.push(
                new Paragraph({
                  children: [new TextRun({ text: "No responses recorded for this question.", italics: true, font: "Arial", size: 18, color: "64748B" })],
                  spacing: { after: 120 }
                })
              );
            }

            activityElements.push(
              new Paragraph({
                children: [new TextRun({ text: `Total Responses: ${totalResponses}`, bold: true, font: "Arial", size: 18 })],
                spacing: { before: 120, after: 240 }
              })
            );
          }
        }
      }

      flushMessages();
    }
  }

  const presenterName = presentation.presenterEmail ? presentation.presenterEmail.split('@')[0] : 'Presenter';
  const pinCode = presentation.pinCode || 'N/A';
  const deckTitle = presentation.pptxFileName || `Session ${pinCode}`;
  const docFilename = `ActiveDeck_Presentation_${pinCode}.docx`;

  const docxFile = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "ActiveDeck Presentation Export",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 160 }
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: "auto" },
            bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
            left: { style: BorderStyle.SINGLE, size: 24, color: "EB5D00" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" },
            insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
            insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { fill: "F8FAFC" },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Presenter: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: presenterName, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Session PIN: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: pinCode, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Presentation: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: deckTitle, color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Export Mode: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: includeChat ? "Presentation + Session Chat Log" : "Presentation Slides", color: "334155", font: "Arial", size: 21 }),
                      ],
                      spacing: { after: 40 }
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Date: ", bold: true, color: "0F172A", font: "Arial", size: 21 }),
                        new TextRun({ text: new Date().toLocaleDateString(), color: "334155", font: "Arial", size: 21 }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        // Clean horizontal divider before slides begin
        new Paragraph({
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 10,
              color: "CBD5E1",
              space: 1
            }
          },
          spacing: { before: 180, after: 260 }
        }),
        ...slideElements,
        ...activityElements
      ]
    }]
  });

  const docBlob = await Packer.toBlob(docxFile);
  const docUrl = URL.createObjectURL(docBlob);
  const link = document.createElement('a');
  link.href = docUrl;
  link.download = docFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(docUrl);
  return true;
};
