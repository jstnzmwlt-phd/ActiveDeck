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
  WidthType
} from 'docx';
import { DrawingStroke } from '../types';

export const isNotesEmpty = (
  notesMap?: Record<string, string>,
  drawingsMap?: Record<string, string>,
  pushedSlidesMap?: Record<string, string>
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

  const hasSlides = pushedSlidesMap && Object.keys(pushedSlidesMap).length > 0;

  return !hasText && !hasDrawings && !hasSlides;
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

export const fetchImageAsUint8Array = async (url: string): Promise<Uint8Array | null> => {
  if (url.startsWith('data:')) {
    return dataUriToUint8Array(url);
  }
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (e) {
    console.error("Failed to fetch image URL as Uint8Array:", e);
    return null;
  }
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
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.35)';
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

export const compositeSlideWithAnnotations = (
  slideImgUrl: string,
  presenterDrawingsJson?: string,
  studentDrawingsJson?: string
): Promise<Uint8Array | null> => {
  return new Promise(async (resolve) => {
    let localUrl = '';
    try {
      if (slideImgUrl.startsWith('data:')) {
        localUrl = slideImgUrl;
      } else {
        const isExternal = slideImgUrl.startsWith('http') && !slideImgUrl.includes(window.location.host);
        const fetchUrl = isExternal 
          ? `/api/proxy-image?url=${encodeURIComponent(slideImgUrl)}`
          : slideImgUrl;
          
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.statusText}`);
        }
        const blob = await response.blob();
        localUrl = URL.createObjectURL(blob);
      }
    } catch (e) {
      console.error("compositeSlideWithAnnotations: Failed to fetch image", e);
      localUrl = slideImgUrl;
    }

    const img = new Image();
    if (!localUrl.startsWith('data:') && !localUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1920;
      canvas.height = img.naturalHeight || 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

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
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
          } else {
            ctx.strokeStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
            ctx.fillStyle = stroke.color === '#FFFFFF' ? '#cbd5e1' : stroke.color;
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

      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
        resolve(dataUriToUint8Array(dataUrl));
      } catch (e) {
        if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
        resolve(null);
      }
    };

    img.onerror = () => {
      if (localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
      fetchImageAsUint8Array(slideImgUrl).then(resolve);
    };

    img.src = localUrl;
  });
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
      if (elem.style && elem.style.color) newStyle.color = elem.style.color.replace('#', '');

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
        elem.childNodes.forEach(child => processNode(child, childRuns, newStyle));
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
  pushedSlidesMap?: Record<string, string>;
  presenterDrawingsMap?: Record<string, string>;
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
    pushedSlidesMap: passedPushedSlides,
    presenterDrawingsMap: passedPresenterDrawings,
    customTabs: passedCustomTabs
  } = options;

  let notesTextMap = passedNotes;
  let notesDrawingsMap = passedDrawings;
  let studentSlideDrawingsMap = passedStudentDrawings;
  let pushedSlidesMap = passedPushedSlides;
  let presenterDrawingsMap = passedPresenterDrawings;
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

  if (isNotesEmpty(notesTextMap, notesDrawingsMap, pushedSlidesMap)) {
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

      return hasText || hasDrawing || hasImg;
    })
    .sort((a, b) => getTabPos(a) - getTabPos(b));

  const slideElements: (Paragraph | Table)[] = [];

  for (const slide of sortedSlides) {
    slideElements.push(
      new Paragraph({
        text: getTabTitle(slide),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 }
      })
    );

    const slideImgUrl = pushedSlidesMap[slide];
    if (slideImgUrl) {
      const presenterJson = presenterDrawingsMap[slide];
      const studentJson = studentSlideDrawingsMap[slide];

      const imgBytes = await compositeSlideWithAnnotations(
        slideImgUrl,
        presenterJson,
        studentJson
      );
      if (imgBytes) {
        slideElements.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Slide Image:", bold: true, color: "475569", size: 20, font: "Arial" }),
            ],
            spacing: { before: 80, after: 60 }
          })
        );
        slideElements.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imgBytes,
                transformation: { width: 500, height: 280 },
                type: 'png'
              })
            ],
            spacing: { after: 180 }
          })
        );
      }
    }

    const htmlContent = notesTextMap[slide];
    if (htmlContent) {
      const textParagraphs = parseHtmlToDocxParagraphs(htmlContent);
      slideElements.push(...textParagraphs);
    }

    const drawingJson = notesDrawingsMap[slide];
    if (drawingJson) {
      const pngDataUrl = convertStrokesToPng(drawingJson);
      if (pngDataUrl) {
        const drawingBytes = dataUriToUint8Array(pngDataUrl);
        if (drawingBytes) {
          slideElements.push(
            new Paragraph({
              children: [
                new TextRun({ text: "Handwritten Drawing:", bold: true, color: "475569", size: 20, font: "Arial" }),
              ],
              spacing: { before: 120, after: 60 }
            })
          );
          slideElements.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: drawingBytes,
                  transformation: { width: 500, height: 350 },
                  type: 'png'
                })
              ],
              spacing: { after: 180 }
            })
          );
        }
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: "ActiveDeck Study Notes",
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 }
        }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: "auto" },
            bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
            left: { style: BorderStyle.SINGLE, size: 24, color: "EB5D00" },
            right: { style: BorderStyle.NONE, size: 0, color: "auto" },
          },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { fill: "F8F9FA" },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Presenter: ", bold: true, color: "111111", font: "Arial" }),
                        new TextRun({ text: presenterName, font: "Arial" }),
                      ],
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Session PIN: ", bold: true, color: "111111", font: "Arial" }),
                        new TextRun({ text: pinCode, font: "Arial" }),
                      ],
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Notes Title: ", bold: true, color: "111111", font: "Arial" }),
                        new TextRun({ text: title, font: "Arial" }),
                      ],
                    }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "Date: ", bold: true, color: "111111", font: "Arial" }),
                        new TextRun({ text: new Date().toLocaleDateString(), font: "Arial" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { after: 240 } }),
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
