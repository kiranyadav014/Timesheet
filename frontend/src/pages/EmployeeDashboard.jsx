import { useEffect, useState, useCallback } from "react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { Clock, SignOut, Warning, CheckCircle, ClockClockwise, LockKey } from "@phosphor-icons/react";

const StatusTag = ({ status }) => {
  if (!status) return <span className="tag" data-testid="status-tag">Not submitted</span>;
  const cls = status === "approved" ? "tag-approved" : status === "rejected" ? "tag-rejected" : "tag-pending";
  return <span className={`tag ${cls}`} data-testid={`status-tag-${status}`}>{status}</span>;
};

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [hours, setHours] = useState("");
  const [tasks, setTasks] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [weekStart, setWeekStart] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api.get("/timesheets/status"), api.get("/timesheets/me")]);
      setStatus(s.data);
      setHistory(h.data);
      // Default to last week if locked, else current
      setWeekStart(s.data.locked ? s.data.last_week_start : s.data.current_week_start);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/timesheets/submit", {
        week_start: weekStart,
        total_hours: parseFloat(hours),
        tasks,
        notes,
      });
      toast.success("Timesheet submitted");
      setHours(""); setTasks(""); setNotes("");
      load();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  if (!status) return <div className="p-12 text-ink2">Loading…</div>;

  const todayDate = new Date(status.today + "T00:00:00Z");
  const isFridayLater = status.is_friday_or_later;
  const canSubmitCurrent = !status.locked && !status.current_week_submitted;
  const canSubmitLast = !status.last_week_submitted;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/70 border-b border-line2">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-ink text-white grid place-items-center"><Clock size={18} weight="bold" /></div>
            <div className="font-heading font-black tracking-tight">TIMESHEET<span className="text-brand">.</span></div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium" data-testid="user-name">{user.name}</div>
              <div className="text-xs text-ink2 font-mono">{user.employee_id} · {user.email}</div>
            </div>
            <Button variant="ghost" onClick={logout} className="rounded-sm" data-testid="logout-button">
              <SignOut size={16} className="mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 lg:px-12 py-10">
        <div className="overline mb-2">Week of {status.current_week_start}</div>
        <h1 className="font-heading font-black text-4xl sm:text-5xl tracking-tighter">Your timesheet.</h1>
        <p className="text-ink2 text-sm mt-3 max-w-xl">Submit a weekly summary. Admins review every entry.</p>

        {/* Banners */}
        {status.locked && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4 flex items-start gap-3" data-testid="lock-banner">
            <LockKey size={20} className="text-warn mt-0.5" weight="bold" />
            <div>
              <div className="font-semibold text-warn">System locked</div>
              <div className="text-sm text-ink mt-1">
                Your last week's timesheet ({status.last_week_start}) is missing. Submit it below to unlock the current week.
              </div>
            </div>
          </div>
        )}

        {!status.locked && isFridayLater && !status.current_week_submitted && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4 flex items-start gap-3" data-testid="friday-banner">
            <Warning size={20} className="text-warn mt-0.5" weight="bold" />
            <div>
              <div className="font-semibold text-warn">Friday reminder</div>
              <div className="text-sm text-ink mt-1">It's {todayDate.toLocaleDateString(undefined, { weekday: "long" })}. Submit your timesheet today.</div>
            </div>
          </div>
        )}

        {!status.locked && status.current_week_submitted && (
          <div className="mt-8 bg-ok-bg border-l-4 border-ok p-4 flex items-start gap-3" data-testid="submitted-banner">
            <CheckCircle size={20} className="text-ok mt-0.5" weight="fill" />
            <div>
              <div className="font-semibold text-ok">This week submitted</div>
              <div className="text-sm text-ink mt-1">Status: <b>{status.current_week_status}</b>. You can resubmit only if rejected.</div>
            </div>
          </div>
        )}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Form */}
          <section className="surface lg:col-span-7 p-6 lg:p-8" data-testid="timesheet-form-card">
            <div className="overline mb-2">New entry</div>
            <h2 className="font-heading font-bold text-2xl tracking-tight">Weekly submission</h2>

            <form onSubmit={onSubmit} className="mt-6 space-y-5" data-testid="timesheet-form">
              <div>
                <Label className="overline" htmlFor="week">Week start (Monday)</Label>
                <select
                  id="week"
                  value={weekStart}
                  onChange={(e) => setWeekStart(e.target.value)}
                  className="mt-2 w-full h-11 px-3 bg-white border border-line2 rounded-sm font-mono text-sm focus:outline-none focus:ring-1 focus:ring-brand"
                  data-testid="week-select"
                >
                  {canSubmitLast && (
                    <option value={status.last_week_start}>{status.last_week_start} (last week — required)</option>
                  )}
                  {canSubmitCurrent && (
                    <option value={status.current_week_start}>{status.current_week_start} (current week)</option>
                  )}
                  {!canSubmitLast && !canSubmitCurrent && (
                    <option value="">Nothing to submit</option>
                  )}
                </select>
              </div>

              <div>
                <Label className="overline" htmlFor="hours">Total hours worked</Label>
                <Input
                  id="hours"
                  type="number"
                  step="0.5"
                  min="0"
                  max="168"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="40"
                  required
                  className="mt-2 rounded-sm h-11 font-mono"
                  data-testid="hours-input"
                />
              </div>

              <div>
                <Label className="overline" htmlFor="tasks">Tasks completed</Label>
                <Textarea
                  id="tasks"
                  value={tasks}
                  onChange={(e) => setTasks(e.target.value)}
                  rows={5}
                  placeholder="Bullet your accomplishments for the week…"
                  required
                  className="mt-2 rounded-sm font-sans"
                  data-testid="tasks-input"
                />
              </div>

              <div>
                <Label className="overline" htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Blockers, leave, overtime context…"
                  className="mt-2 rounded-sm"
                  data-testid="notes-input"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting || (!canSubmitLast && !canSubmitCurrent)}
                className="h-11 rounded-sm btn-primary px-6 text-white"
                data-testid="submit-timesheet-button"
              >
                {submitting ? "Submitting…" : "Submit timesheet"}
              </Button>
            </form>
          </section>

          {/* History */}
          <section className="surface lg:col-span-5 p-6 lg:p-8 flex flex-col" data-testid="history-card">
            <div className="overline mb-2">History</div>
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold text-2xl tracking-tight">Your submissions</h2>
              <ClockClockwise size={20} className="text-ink2" />
            </div>

            <div className="mt-6 -mx-2 overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="text-left text-ink2 uppercase tracking-wider text-xs border-b border-line2">
                  <tr>
                    <th className="px-2 py-2">Week</th>
                    <th className="px-2 py-2 text-right">Hours</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan="3" className="px-2 py-6 text-ink2 text-center">No submissions yet.</td></tr>
                  )}
                  {history.map((t) => (
                    <tr key={t.id} className="row-zebra border-b border-line" data-testid={`history-row-${t.week_start}`}>
                      <td className="px-2 py-3 font-mono">{t.week_start}</td>
                      <td className="px-2 py-3 text-right font-mono font-semibold">{t.total_hours}h</td>
                      <td className="px-2 py-3"><StatusTag status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
