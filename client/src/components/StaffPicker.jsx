import { useState, useMemo } from 'react';

/**
 * 担当者選択モーダル（検索 + エリア別グループ表示）
 *
 * props:
 *  - title: string                          見出し（例: "CS担当を選択"）
 *  - members: [{ id, display_name, area }]  選択候補一覧
 *  - value: string[]                        選択中の display_name 配列
 *  - onChange: (names: string[]) => void    確定時に呼ばれる
 *  - onClose: () => void
 *  - multi: boolean                         true=複数選択 / false=単一選択（デフォルト true）
 *  - max: number                            multi=true のときの最大選択数（省略時は無制限）
 */
export default function StaffPicker({ title, members, value, onChange, onClose, multi = true, max, addToast }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(value || []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter(m => !q || m.display_name.toLowerCase().includes(q));
  }, [members, query]);

  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(m => {
      const area = m.area || 'その他';
      (groups[area] = groups[area] || []).push(m);
    });
    return groups;
  }, [filtered]);

  const toggle = (name) => {
    if (!multi) {
      setSelected([name]);
      return;
    }
    setSelected(prev => {
      if (prev.includes(name)) return prev.filter(n => n !== name);
      if (max && prev.length >= max) {
        addToast?.(`最大${max}名まで選択できます`, 'error');
        return prev;
      }
      return [...prev, name];
    });
  };

  const confirm = () => {
    onChange(selected);
    onClose();
  };

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <button type="button" className="picker-icon-btn" onClick={onClose} aria-label="閉じる">✕</button>
          <span className="picker-title">{title}</span>
          <span style={{ width: 20 }} />
        </div>

        <div className="picker-search-wrap">
          <input
            type="text"
            placeholder="名前で検索"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="picker-search"
            autoFocus
          />
        </div>

        <div className="picker-list">
          {Object.keys(grouped).length === 0 && (
            <div className="picker-empty">該当する担当者がいません</div>
          )}
          {Object.entries(grouped).map(([area, list]) => (
            <div key={area}>
              <div className="picker-group-label">{area}（{list.length}名）</div>
              {list.map(m => {
                const checked = selected.includes(m.display_name);
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`picker-row${checked ? ' checked' : ''}`}
                    onClick={() => toggle(m.display_name)}
                  >
                    <span className="picker-avatar">{m.display_name.slice(0, 1)}</span>
                    <span className="picker-row-name">{m.display_name}</span>
                    {checked && <span className="picker-check">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="picker-footer">
          <span className="picker-count">
            {selected.length > 0 ? `${selected.length}名選択中` : '未選択'}
          </span>
          <button type="button" className="btn btn-primary" onClick={confirm}>決定</button>
        </div>
      </div>
    </div>
  );
}
