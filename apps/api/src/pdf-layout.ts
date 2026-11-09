export interface PdfTextPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/** Supply actual PDF coordinates so the model does not have to guess from a preview. */
export async function pdfTextPositions(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  try {
    const document = await task.promise;
    const pages: Array<{ page: number; texts: PdfTextPosition[] }> = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const texts: PdfTextPosition[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [a,b,c,d,x,y] = item.transform as number[];
        const fontSize = Math.max(item.height, Math.hypot(c!,d!), 1);
        const scale = Math.hypot(a!,b!) || 1;
        const horizontal = [a! / scale * item.width, b! / scale * item.width];
        const upScale = Math.hypot(c!,d!) || 1;
        const up = [c! / upScale * fontSize, d! / upScale * fontSize];
        const corners = [[x!,y!], [x!+horizontal[0]!,y!+horizontal[1]!]]
          .flatMap(([left,bottom]) => [[left!-up[0]!*.25,bottom!-up[1]!*.25],[left!+up[0]!,bottom!+up[1]!]]);
        const left = Math.min(...corners.map(([value]) => value!)) - 1;
        const bottom = Math.min(...corners.map(([,value]) => value!)) - 1;
        const right = Math.max(...corners.map(([value]) => value!)) + 1;
        const top = Math.max(...corners.map(([,value]) => value!)) + 1;
        const round = (value: number) => Math.round(value * 100) / 100;
        texts.push({ text: item.str, x:round(Math.max(0,left)), y:round(Math.max(0,bottom)), width:round(right-Math.max(0,left)), height:round(top-Math.max(0,bottom)),fontSize:round(fontSize) });
      }
      pages.push({page:index-1,texts});page.cleanup();
    }
    if (JSON.stringify(pages).length > 600_000) throw new Error("Mẫu PDF có quá nhiều nội dung. Hãy chia mẫu thành các phần nhỏ hơn rồi tải lại.");
    return pages;
  } finally { await task.destroy(); }
}
