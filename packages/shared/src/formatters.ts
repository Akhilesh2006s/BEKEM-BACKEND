const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '₹0';
  const [intPart, decPart] = Math.abs(amount).toFixed(2).split('.');
  const lastThree = intPart.slice(-3);
  const other = intPart.slice(0, -3);
  const formatted =
    other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + (other ? ',' : '') + lastThree;
  const sign = amount < 0 ? '-' : '';
  return `${sign}₹${formatted}${decPart !== '00' ? '.' + decPart : ''}`;
}

export function formatQuantity(qty: number, unit?: string): string {
  const rounded = Math.round((qty + Number.EPSILON) * 100) / 100;
  const formatted = Number.isInteger(rounded)
    ? rounded.toLocaleString('en-IN')
    : rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Whole-unit counts for inventory dashboards (no float artifacts). */
export function formatUnitCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '0';
  return Math.round(value).toLocaleString('en-IN');
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function getFirstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName;
}
