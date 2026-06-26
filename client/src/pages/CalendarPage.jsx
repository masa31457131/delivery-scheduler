import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { StatusBadge, formatDate } from '../components/StatusBadge';

function getMonthDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days = [];
  // Leading empty cells
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}

export default function CalendarPage({ onNavigate }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [now] = useState(new Date());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  useEffect(() => {
    const params = user.role === 'sales' ? { role: 'sales', sales_rep: user.name } : {};
    api.getProjects(params).then(setProjects);
  }, []);

  const days = getMonthDays(year, month);
  const toKey = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null;
  const today = toKey(new Date());

  // Map date -> projects
  const byDate = {};
  projects.forEach(p => {
    // Confirmed dates
    if (p.confirmed_date) {
      const k = p.confirmed_date.split(' ')[0];
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push({ ...p, _type: 'confirmed' });
    }
    // Candidate dates
    (p.candidates || []).forEach(c => {
      const k = c.candidate_date;
      if (!byDate[k]) byDate[k] = [];
      byDate[k].push({ ...p, _type: 'candidate', _time: c.candidate_time });
    });
  });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const [selected, setSelected] = useState(null);

  return (
    <>
      <div className="page-title">カレンダー</div>
      <div className="page-sub">納品日・候補日を確認</div>

      {/* Month navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}>‹</button>
        <span style={{ fontWeight: 700 }}>{year}年 {month + 1}月</span>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}>›</button>
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {['日','月','火','水','木','金','土'].map((d, i) => (
          <div key={d} style={{
            textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, padding: '4px 0',
            color: i === 0 ? '#ef4444' : i === 6 ? 'var(--accent-lt)' : 'var(--text-sub)'
          }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {days.map((d, i) => {
          const k = toKey(d);
          const entries = k ? byDate[k] : null;
          const isToday = k === today;
          const isSelected = k === selected;
          const hasDot = entries && entries.length > 0;

          return (
            <div
              key={i}
              onClick={() => d && setSelected(k === selected ? null : k)}
              style={{
                minHeight: 44, padding: '6px 4px', borderRadius: 8, cursor: d ? 'pointer' : 'default',
                background: isSelected ? 'var(--accent)' : isToday ? 'rgba(59,130,246,0.12)' : hasDot ? 'rgba(255,255,255,0.04)' : 'transparent',
                border: isToday && !isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}
            >
              {d && (
                <>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: isToday ? 700 : 400,
                    color: !d ? '' : (new Date(d).getDay() === 0) ? '#ef4444' : (new Date(d).getDay() === 6) ? 'var(--accent-lt)' : 'var(--text)',
                  }}>{d.getDate()}</span>
                  {hasDot && (
                    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {entries.slice(0, 3).map((e, ei) => (
                        <div key={ei} style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: e._type === 'confirmed' ? 'var(--success)' : 'var(--warning)',
                        }} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: '0.72rem', color: 'var(--text-sub)' }}>
        <span><span style={{ color: 'var(--success)' }}>●</span> 確定日</span>
        <span><span style={{ color: 'var(--warning)' }}>●</span> 候補日</span>
      </div>

      {/* Selected day detail */}
      {selected && byDate[selected] && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title">{formatDate(selected)} の案件</div>
          {byDate[selected].map((p, i) => (
            <div
              key={`${p.id}-${i}`}
              onClick={() => onNavigate('detail', p.id)}
              style={{
                padding: '10px 0', cursor: 'pointer',
                borderBottom: i < byDate[selected].length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.project_name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-sub)' }}>
                    {p.client_name}
                    {p._type === 'candidate' && ` · ${p._time || ''} [候補]`}
                    {p._type === 'confirmed' && ' · 確定'}
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
