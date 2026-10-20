import {
	createXtermModifiedEnterRewriter,
	splitControlKeypresses,
} from './terminal-keypress';
import {
	createUtf8InputDecoder,
	stripMouseSequences,
	type WheelDirection,
} from './terminal-mouse';
import {createPasteExtractor, type InputSegment} from './terminal-paste';

/** Filter stdin into ordered work for the CLI's key/paste FIFO. */
export function createTerminalInputFilter(
	onInput: (segment: InputSegment) => void,
	onWheel: (direction: WheelDirection) => void,
) {
	const decode = createUtf8InputDecoder();
	const extractPastes = createPasteExtractor();
	const rewriteEnter = createXtermModifiedEnterRewriter(text => {
		for (const piece of splitControlKeypresses(text)) {
			onInput({kind: 'key', text: piece});
		}
	});
	let mouseCarry = '';

	return {
		push(chunk: Buffer | string): void {
			for (const segment of extractPastes(decode(chunk))) {
				if (segment.kind === 'paste') {
					// A paste interrupts any incomplete control sequence: emit
					// held-back keys before it, not when the 20ms timer fires.
					if (mouseCarry) {
						rewriteEnter.push(mouseCarry);
						mouseCarry = '';
					}
					rewriteEnter.flush();
					onInput(segment);
					continue;
				}
				const result = stripMouseSequences(segment.text, mouseCarry);
				mouseCarry = result.carry;
				for (const direction of result.wheel) onWheel(direction);
				rewriteEnter.push(result.clean);
			}
		},
		dispose(): void {
			rewriteEnter.dispose();
			mouseCarry = '';
		},
	};
}
