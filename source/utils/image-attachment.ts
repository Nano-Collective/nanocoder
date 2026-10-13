export interface ImageAttachment {
	data: string;
	mediaType: string;
}

/** Validate before persisting or handing image data to the provider SDK. */
export function normalizeImageAttachment(
	image: ImageAttachment,
): ImageAttachment {
	if (
		!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
			image.mediaType,
		)
	)
		throw new Error('Unsupported image type. Use PNG, JPEG, GIF or WebP.');
	let data = image.data;
	if (data.startsWith('data:')) {
		const prefix = `data:${image.mediaType};base64,`;
		if (!data.startsWith(prefix)) throw new Error('Invalid image data URL.');
		data = data.slice(prefix.length);
	}
	// Node's decoder tolerates invalid characters, so require a canonical
	// round-trip. This also avoids a large repeated regexp on image payloads.
	if (!data || Buffer.from(data, 'base64').toString('base64') !== data)
		throw new Error('Invalid image attachment: expected valid base64 data.');
	return {data, mediaType: image.mediaType};
}
