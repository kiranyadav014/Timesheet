export default function HistoryTable({ history }) {
  const StatusBadge = ({ status }) => {
    if (!status || status === "draft") return <span className="tag">Draft</span>;
    const cls = status === "approved" ? "tag-approved" : status === "rejected" ? "tag-rejected" : "tag-pending";
    return <span className={`tag ${cls}`}>{status}</span>;
  };
  return (
    <div className="surface overflow-x-auto" data-testid="history-table">
      <table className="w-full text-sm">
        <thead className="bg-canvas border-b border-line2 text-left text-ink2 uppercase tracking-wider text-xs">
          <tr>
            <th className="px-4 py-3">Week</th>
            <th className="px-4 py-3 text-right">Hours</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 && <tr><td colSpan="4" className="px-4 py-8 text-center text-ink2">No submissions yet.</td></tr>}
          {history.map((t) => (
            <tr key={t.id} className="row-zebra border-b border-line" data-testid={`history-row-${t.week_start}`}>
              <td className="px-4 py-3 font-mono">{t.week_start} → {t.week_end}</td>
              <td className="px-4 py-3 text-right font-mono font-semibold">{t.total_hours}h</td>
              <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
              <td className="px-4 py-3 text-xs text-ink2 font-mono">{t.submitted_at?.slice(0, 10) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
