/**
 * Format a date as "time ago" string (e.g., "2 hours ago", "3 days ago")
 */
export function formatDistanceToNow(date: Date): string {
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();
	const diffInSeconds = Math.floor(diffInMs / 1000);
	
	// Less than a minute
	if (diffInSeconds < 60) {
		return 'just now';
	}
	
	// Less than an hour
	if (diffInSeconds < 3600) {
		const minutes = Math.floor(diffInSeconds / 60);
		return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
	}
	
	// Less than a day
	if (diffInSeconds < 8640) {
		const hours = Math.floor(diffInSeconds / 3600);
		return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
	}
	
	// Less than a week
	if (diffInSeconds < 604800) {
		const days = Math.floor(diffInSeconds / 86400);
		if (days === 1) return 'yesterday';
		return `${days} days ago`;
	}
	
	// Less than a month
	if (diffInSeconds < 2592000) {
		const weeks = Math.floor(diffInSeconds / 604800);
		return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
	}
	
	// Less than a year
	if (diffInSeconds < 31536000) {
		const months = Math.floor(diffInSeconds / 2592000);
		return `${months} month${months !== 1 ? 's' : ''} ago`;
	}
	
	// More than a year
	const years = Math.floor(diffInSeconds / 31536000);
	return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Format a date in a more detailed way for session details
 */
export function formatDateTime(date: Date): string {
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();
	const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
	
	if (diffInDays === 0) {
		// Today - show time only
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	} else if (diffInDays === 1) {
	// Yesterday
		return `Yesterday at ${date.toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
		})}`;
	} else if (diffInDays < 7) {
		// This week - show day and time
		return date.toLocaleDateString([], {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
		});
	} else {
		// Older - show full date
		return date.toLocaleDateString([], {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
	});
	}
}

/**
 * Get relative date descriptor (Today, Yesterday, This Week, etc.)
 */
export function getRelativeDateDescriptor(date: Date): string {
	const now = new Date();
	const diffInMs = now.getTime() - date.getTime();
	const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
	
	if (diffInDays === 0) return 'Today';
	if (diffInDays === 1) return 'Yesterday';
	if (diffInDays < 7) return 'This Week';
	if (diffInDays < 14) return 'Last Week';
	if (diffInDays < 30) return 'This Month';
	if (diffInDays < 60) return 'Last Month';
	return 'Older';
}