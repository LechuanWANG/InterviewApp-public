import pdfjs from "pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js";

type PdfPage = {
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<{ items: Array<{ str: string; transform: number[] }> }>;
};

type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): void;
};

type PdfJs = {
  version: string;
  disableWorker: boolean;
  getDocument(data: Buffer): Promise<PdfDocument>;
};

const PDFJS = pdfjs as PdfJs;
PDFJS.disableWorker = true;

export async function parsePdfText(data: Buffer): Promise<string> {
  const doc = await PDFJS.getDocument(data);
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      pages.push(await renderPageText(page));
    }
  } finally {
    doc.destroy();
  }

  return pages.join("\n\n").trim();
}

async function renderPageText(page: PdfPage): Promise<string> {
  const textContent = await page.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    const y = item.transform[5];
    text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
    lastY = y;
  }
  return text;
}
