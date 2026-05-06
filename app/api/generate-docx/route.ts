import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

type DocxChild = Paragraph | Table;

function parseMarkdownToDocx(text: string): DocxChild[] {
  const lines = text.split("\n");
  const children: DocxChild[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect markdown table block
    if (line.trim().startsWith("|") && i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseMarkdownTable(tableLines);
      if (table) children.push(table);
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) {
      children.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 } }));
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      children.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 160 } }));
      i++;
      continue;
    }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) {
      children.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1, spacing: { before: 480, after: 200 } }));
      i++;
      continue;
    }

    // Horizontal rule — skip
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      i++;
      continue;
    }

    // Empty line — add spacing paragraph
    if (line.trim() === "") {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      i++;
      continue;
    }

    // Regular paragraph (with inline formatting)
    const runs = parseInlineFormatting(line.trim());
    children.push(
      new Paragraph({
        children: runs,
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160, line: 276 },
        indent: { firstLine: 720 },
      })
    );
    i++;
  }

  return children;
}

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match bold+italic, bold, italic, code, plain
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+))/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true }));
    } else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true }));
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }));
    } else if (match[5]) {
      runs.push(new TextRun({ text: match[5], font: "Courier New", size: 18 }));
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6] }));
    }
  }
  if (runs.length === 0) {
    runs.push(new TextRun({ text }));
  }
  return runs;
}

function parseMarkdownTable(tableLines: string[]): Table | null {
  const rows = tableLines.filter((l) => !l.replace(/\|/g, "").replace(/-/g, "").replace(/:/g, "").trim().match(/^[-:| ]+$/));

  if (rows.length === 0) return null;

  const parsedRows = rows.map((row) =>
    row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
  );

  const tableRows = parsedRows.map((cells, rowIdx) =>
    new TableRow({
      children: cells.map(
        (cellText) =>
          new TableCell({
            children: [
              new Paragraph({
                children: parseInlineFormatting(cellText),
                spacing: { before: 60, after: 60 },
              }),
            ],
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            shading: rowIdx === 0 ? { fill: "E8EAF6" } : undefined,
          })
      ),
    })
  );

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    },
  });
}

export async function POST(req: NextRequest) {
  let text: string;
  try {
    const body = await req.json();
    text = body.text;
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Brak tekstu" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe żądanie" }, { status: 400 });
  }

  const children = parseMarkdownToDocx(text);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 24,
            color: "000000",
          },
          paragraph: {
            spacing: { line: 276 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1800,
            },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="praca_magisterska_humanizowana.docx"',
      "Content-Length": buffer.length.toString(),
    },
  });
}
