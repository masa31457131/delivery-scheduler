import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate } from '../components/StatusBadge';

const DELIVERY_LABELS = { remote: '🖥 リモート', onsite: '🚗 現地訪問' };

function getMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}

export default function CalendarPage({ onNavigate }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([api.getProjects(), api.getBlockedDates()])
      .then(([p, b]) => { setProjects(p); setBlockedDates(b); });
  }, []);

  const days = getMonthDays(year, month);
  const toKey = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null;
  const today = toKey(new Date());

  const byDate = {};
  projects.forEach(p => {
    if (p.confirmed_date) {
      const k = p.confirmed_date.split(' ')[0];
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push({ ...p, _type: 'confirmed' });
    }
    (p.candidates || []).forEach(c => {
      const k = c.candidate_date;
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push({ ...p, _type: 'candidate', _time: c.candidate_time });
    });
  });

  const blockedSet = new Set(blockedDates.map(b => b.date));

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y-1); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y+1); } else setMonth(m => m+1); };

  const selectedEntries = selected ? (byDate[selected] || []) : [];
  const selectedBlocked = selected ? blockedDates.filter(b => b.date === selected) : [];

  return (
    <>
      <div className="page-title">カレンダー</div>
      <div className="page-sub">納品日・候補日・予定不可日を確認</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}>‹</button>
        <span style={{ fontWeight: 700 }}>{year}年 {month+1}月</span>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}>›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {['日','月','火','水','木','金','土'].map((d, i) => (
          <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, padding: '4px 0',
            color: i === 0 ? '#ef4444' : i === 6 ? 'var(--accent-lt)' : 'var(--text-sub)' }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {days.map((d, i) => {
          const k = toKey(d);
          const entries = k ? byDate[k] : null;
          const isBlocked = k ? blockedSet.has(k) : false;
          const isToday = k === today;
          const isSelected = k === selected;

          return (
            <div key={i} onClick={() => d && setSelected(k === selected ? null : k)}
              style={{
                minHeight: 44, padding: '6px 4px', borderRadius: 8, cursor: d ? 'pointer' : 'default',
                background: isSelected ? 'var(--accent)' : isBlocked ? 'rgba(239,68,68,0.1)' : isToday ? 'rgba(59,130,246,0.12)' : entries ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: isToday && !isSelected ? '1px solid var(--accent)' : isBlocked && !isSelected ? '1px solid rgba(239,68,68,0.3)' : '1px solid transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}>
              {d && (
                <>
                  <span style={{ fontSize: '0.82rem', fontWeight: isToday ? 700 : 400,
                    color: new Date(d).getDay() === 0 ? '#ef4444' : new Date(d).getDay() === 6 ? 'var(--accent-lt)' : 'var(--text)',
                  }}>{d.getDate()}</span>
                  <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {isBlocked && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--danger)' }} />}
                    {(entries || []).slice(0, 2).map((e, ei) => (
                      <div key={ei} style={{ width: 5, height: 5, borderRadius: '50%',
                        background: e._type === 'confirmed' ? 'var(--success)' : 'var(--warning)' }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: '0.72rem', color: 'var(--text-sub)', flexWrap: 'wrap' }}>
        <span><span style={{ color: 'var(--success)' }}>●</span> 確定日</span>
        <span><span style={{ color: 'var(--warning)' }}>●</span> 候補日</span>
        <span><span style={{ color: 'var(--danger)' }}>●</span> 予定不可</span>
      </div>

      {selected && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">{formatDate(selected)} の情報</div>

          {selectedBlocked.length > 0 && (
            <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, marginBottom: 10, fontSize: '0.85rem', color: 'var(--danger)' }}>
              🚫 予定不可日
              {selectedBlocked[0].time_from && ` ${selectedBlocked[0].time_from}〜${selectedBlocked[0].time_to}`}
              {selectedBlocked[0].reason && `：${selectedBlocked[0].reason}`}
            </div>
          )}

          {selectedEntries.length === 0 && selectedBlocked.length === 0 && (
            <div className="text-sub">案件はありません</div>
          )}

          {selectedEntries.map((p, i) => (
            <div key={`${p.id}-${i}`} onClick={() => onNavigate('detail', p.id)}
              style={{ padding: '10px 0', cursor: 'pointer', borderBottom: i < selectedEntries.length-1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.project_name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)', marginTop: 2 }}>
                    {p.client_name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>👤 {p.sales_rep}</span>
                    <span>{DELIVERY_LABELS[p.delivery_method] || ''}</span>
                    {p._type === 'candidate' && p._time && <span>🕐 {p._time}</span>}
                    <span style={{ color: p._type === 'confirmed' ? 'var(--success)' : 'var(--warning)' }}>
                      {p._type === 'confirmed' ? '✅ 確定' : '🗓 候補'}
                    </span>
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
