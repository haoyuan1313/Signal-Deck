import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || isNaN(value)) return '0.00';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatR(value: number | null | undefined) {
  if (value === null || value === undefined || isNaN(value)) return '0.00R';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

export function formatDate(date: string | null | undefined) {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return format(d, 'MMM dd, HH:mm');
}

export function timeAgo(date: string | null | undefined) {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return formatDistanceToNow(d, { addSuffix: true });
}
