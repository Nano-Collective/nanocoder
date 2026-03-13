import type {useTheme} from '@/hooks/useTheme';
import type {FlatNode} from '@/utils/file-tree';

export interface FileExplorerProps {
	onClose: () => void;
}

export type ViewMode = 'tree' | 'preview';

export interface TreeItemProps {
	item: FlatNode;
	isHighlighted: boolean;
	isSelected: boolean;
	selectedFiles: Set<string>;
	colors: ReturnType<typeof useTheme>['colors'];
}
