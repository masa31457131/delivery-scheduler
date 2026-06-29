export const STATUS_MAP = {
  pending:   { label: '候補日待ち',  cls: 'badge-pending' },
  scheduled: { label: '仮スケ設定済', cls: 'badge-confirmed' },
  confirmed: { label: '日程確定',    cls: 'badge-confirmed' },
  delivered: { label: '納品済み',    cls: 'badge-delivered' },
  cancelled: { label: 'キャンセル',  cls: 'badge-cancelled' },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const date = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const hasTime = dateStr.includes(' ') || dateStr.includes('T');
  if (hasTime) {
    const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  }
  return date;
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}
