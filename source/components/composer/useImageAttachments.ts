import {useCallback, useRef, useState} from 'react';
import {
	type ClipboardImageResult,
	extractImageReferences,
	readClipboardImage,
	readImageFile,
} from '@/input/clipboard-image';
import type {ImageAttachment} from '@/types/core';

/**
 * Turn image file paths the user typed, pasted or dragged into the prompt
 * (often quoted, mixed in with prose) into attachments. Each path that reads
 * as an image is replaced in both the sent text and the displayed text by an
 * `[Image #N]` placeholder, numbered after the attachments already added.
 * Paths that don't read as images leave the text untouched.
 */
export function collectDroppedImages(
	attachments: ImageAttachment[],
	assembled: string,
	display: string,
): {images: ImageAttachment[]; assembled: string; display: string} {
	const {text: cleanedAssembled, paths} = extractImageReferences(
		assembled,
		attachments.length,
	);
	if (paths.length > 0) {
		const dropped = paths
			.map(readImageFile)
			.filter((img): img is ImageAttachment => img !== null);
		if (dropped.length > 0) {
			return {
				images: [...attachments, ...dropped],
				assembled: cleanedAssembled,
				display: extractImageReferences(display, attachments.length).text,
			};
		}
	}
	return {images: attachments, assembled, display};
}

/**
 * Images waiting to go out with the next message. We never gate on a
 * model-capability heuristic: if the model can't see images it will say so
 * or error, which is clearer than an over-cautious warning on every attach.
 */
export function useImageAttachments(
	readClipboard: () => Promise<ClipboardImageResult> = readClipboardImage,
) {
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
	// A cold Windows PowerShell can take seconds. Ignore repeat Ctrl+V presses
	// while a read is in flight instead of stacking helpers and duplicating the
	// attachment once each one finishes.
	const clipboardReadInFlightRef = useRef(false);

	/**
	 * Ctrl+V: attach the image on the system clipboard, if there is one. Text
	 * pasted into the terminal arrives as a bracketed paste on stdin (cli.tsx
	 * enables DECSET 2004 and routes payloads to pasteEvents), never as a
	 * Ctrl+V keypress, so the key is free to mean "paste image".
	 *
	 * The read runs off the event loop; a failure (missing helper, timeout,
	 * oversized image) lands in `clipboardNotice` instead of vanishing.
	 */
	const attachFromClipboard = useCallback(async () => {
		if (clipboardReadInFlightRef.current) return;
		clipboardReadInFlightRef.current = true;
		setClipboardNotice(null);
		try {
			const {image, error} = await readClipboard();
			if (image) {
				setAttachments(prev => [...prev, image]);
			} else if (error) {
				setClipboardNotice(error);
			}
		} catch {
			// The reader is contracted to resolve, but never let a thrown error
			// turn a Ctrl+V into an unhandled rejection or a silent no-op.
			setClipboardNotice('Could not read the clipboard image');
		} finally {
			clipboardReadInFlightRef.current = false;
		}
	}, [readClipboard]);

	/** Ctrl+X: drop the most recently added image. */
	const removeLast = useCallback(() => {
		setAttachments(prev => prev.slice(0, -1));
	}, []);

	/** Replace the whole list (restoring a draft or a queued message). */
	const replace = useCallback((images: ImageAttachment[]) => {
		setAttachments(images);
	}, []);

	const clear = useCallback(() => {
		setAttachments([]);
		setClipboardNotice(null);
	}, []);

	return {
		attachments,
		clipboardNotice,
		attachFromClipboard,
		removeLast,
		replace,
		clear,
	};
}
