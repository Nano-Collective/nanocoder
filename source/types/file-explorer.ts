import type {Colors} from '@/types/ui';
import type {FlatNode} from '@/utils/fs/file-tree';

export interface FileExplorerProps {
	onClose: () => void;
}

export type ViewMode = 'tree' | 'preview';

export interface TreeItemProps {
	item: FlatNode;
	isHighlighted: boolean;
	isSelected: boolean;
	selectedFiles: Set<string>;
	colors: Colors;
}
