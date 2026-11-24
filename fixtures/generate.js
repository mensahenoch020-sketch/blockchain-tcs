import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function samplePdf(qualification = 'B.Sc. Telecommunication Science', holder = 'Sample Graduate') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([720, 480]);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 680, height: 440, borderWidth: 2, borderColor: rgb(.05,.39,.36) });
  page.drawText('DEMONSTRATION ONLY', { x: 64, y: 390, size: 18, font: sans });
  page.drawText('Academic Certificate', { x: 64, y: 310, size: 40, font: serif });
  page.drawText('Certificate ID: TCS-DEMO-001', { x: 64, y: 255, size: 18, font: sans });
  page.drawText(holder, { x: 64, y: 202, size: 27, font: serif });
  page.drawText(qualification, { x: 64, y: 151, size: 20, font: sans });
  page.drawText('Fictional record for software testing and project defence.', { x: 64, y: 75, size: 14, font: sans });
  return doc.save();
}

if (process.argv[1]?.endsWith('/generate.js')) {
  const original = await samplePdf();
  const copy = await PDFDocument.load(original);
  copy.getPage(0).drawText('CHANGED AFTER ISSUANCE', { x: 64, y: 105, size: 13 });
  await Promise.all([
    writeFile(new URL('./original.pdf', import.meta.url), original),
    writeFile(new URL('./exact-copy.pdf', import.meta.url), original),
    writeFile(new URL('./modified.pdf', import.meta.url), await copy.save())
  ]);
  console.log('Generated original.pdf, exact-copy.pdf and modified.pdf in fixtures/.');
}
