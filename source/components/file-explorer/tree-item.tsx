import {Box, Text} from 'ink';
import type {TreeItemProps} from '@/types/file-explorer';
import {getAllFilesInDirectory} from './utils';

export function TreeItem({
	item,
	isHighlighted,
	isSelected,
	selectedFiles,
	colors,
}: TreeItemProps) {
	const {node, depth, isExpanded, hasChildren} = item;
	const indent = '  '.repeat(depth);

	// Add trailing slash for directories
	const displayName = node.isDirectory ? `${node.name}/` : node.name;

	if (node.isDirectory) {
		// Check if directory has any/all files selected
		const filesInDir = getAllFilesInDirectory(node);
		const selectedCount = filesInDir.filter(f => selectedFiles.has(f)).length;
		const hasSelection = selectedCount > 0;
		const allSelected =
			filesInDir.length > 0 && selectedCount === filesInDir.length;

		// Selection icon replaces expand icon when there's a selection
		let prefix: string;
		if (allSelected) {
			prefix = '✓ ';
		} else if (hasSelection) {
			prefix = '◐ ';
		} else if (hasChildren) {
			prefix = isExpanded ? 'v ' : '> ';
		} else {
			prefix = '  ';
		}

		return (
			<Box>
				<Text color={hasSelection ? colors.success : colors.text}>
					{indent}
					{prefix}
				</Text>
				<Text
					color={
						isHighlighted
							? colors.primary
							: hasSelection
								? colors.success
								: colors.text
					}
					bold={isHighlighted || hasSelection}
					inverse={isHighlighted}
				>
					{displayName}
				</Text>
			</Box>
		);
	}

	// File - show green checkmark if selected
	return (
		<Box>
			<Text color={isSelected ? colors.success : colors.text}>
				{indent}
				{isSelected ? '✓ ' : '  '}
			</Text>
			<Text
				color={
					isHighlighted
						? colors.primary
						: isSelected
							? colors.success
							: colors.text
				}
				bold={isHighlighted || isSelected}
				inverse={isHighlighted}
			>
				{displayName}
			</Text>
		</Box>
	);
}
