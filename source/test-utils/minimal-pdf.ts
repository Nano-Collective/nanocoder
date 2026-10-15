/**
 * Builds a real, parseable PDF for tests that need the document-conversion read
 * path to actually run.
 *
 * A hand-written byte string is not enough: the converter rejects it, so the
 * read throws before any provenance can be observed. This produces the smallest
 * structurally valid PDF that still yields text, which lets a test assert what
 * reading a document really returns — a markdown transcript, not the bytes.
 */
export function buildMinimalPdf(text: string): Buffer {
	const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});

	const xrefStart = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

	return Buffer.from(pdf, 'latin1');
}
