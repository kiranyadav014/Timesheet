import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { Clock, SignOut, Warning, CheckCircle, LockKey, CalendarBlank, Plus, FloppyDisk, PaperPlaneTilt, Trash, Info } from "@phosphor-icons/react";

const StatusBadge = ({ status }) => {
  if (!status || status === "draft") return <span className="tag" data-testid={`status-tag-${status || "none"}`}>Draft</span>;
  const cls = status === "approved" ? "tag-approved" : status === "rejected" ? "tag-rejected" : "tag-pending";
  return <span className={`tag ${cls}`} data-testid={`status-tag-${status}`}>{status}</span>;
};

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const [params] = useSearchParams();
  const missingFromUrl = (params.get("missing") || "").split(",").filter(Boolean);

  const [status, setStatus] = useState(null);
  const [week, setWeek] = useState(null);
  const [history, setHistory] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [activeWeekStart, setActiveWeekStart] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dayRefs = useRef({});

  const loadAll = useCallback(async () => {
    try {
      const [s, h, l] = await Promise.all([
        api.get("/timesheets/status"),
        api.get("/timesheets/me"),
        api.get("/leaves/me"),
      ]);
      setStatus(s.data);
      setHistory(h.data);
      setLeaves(l.data);
      const initial = s.data.locked ? s.data.last_week_start : s.data.current_week_start;
      setActiveWeekStart((prev) => prev || initial);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  }, []);

  const loadWeek = useCallback(async (ws) => {
    if (!ws) return;
    try {
      const { data } = await api.get("/timesheets/week", { params: { week_start: ws } });
      setWeek(data);
      setNotes(data.notes || "");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadWeek(activeWeekStart); }, [activeWeekStart, loadWeek]);

  // Scroll to first missing day from URL
  useEffect(() => {
    if (week && missingFromUrl.length > 0) {
      const target = missingFromUrl.find((d) => dayRefs.current[d]);
      if (target && dayRefs.current[target]) {
        setTimeout(() => dayRefs.current[target].scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  if (!status || !week) return <div className="p-12 text-ink2">Loading…</div>;

  const editable = !["pending", "approved"].includes(week.status);
  const canSwitchToCurrent = !status.locked;

  const updateDay = (date, patch) => {
    setWeek((w) => ({
      ...w,
      days: w.days.map((d) => (d.date === date ? { ...d, ...patch } : d)),
      total_hours: w.days.reduce((s, d) => s + (d.date === date ? (patch.type === "work" ? Number(patch.hours ?? d.hours ?? 0) : 0) : (d.type === "work" ? Number(d.hours || 0) : 0)), 0),
    }));
  };

  const saveDay = async (d) => {
    if (!editable) return;
    if (d.from_leave) return;
    try {
      await api.post("/timesheets/save-day", {
        week_start: week.week_start,
        entry: { date: d.date, type: d.type, hours: Number(d.hours || 0), tasks: d.tasks || "" },
      });
      toast.success(`${d.day} saved`);
      loadWeek(week.week_start);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  const submitWeek = async () => {
    setSubmitting(true);
    try {
      await api.post("/timesheets/submit-week", { week_start: week.week_start, notes });
      toast.success("Submitted for review");
      loadWeek(week.week_start);
      loadAll();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-line2">
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
        <div className="overline mb-2">Welcome back, {user.name.split(" ")[0]}</div>
        <h1 className="font-heading font-black text-4xl sm:text-5xl tracking-tighter">Your week.</h1>
        <p className="text-ink2 text-sm mt-3 max-w-xl">Fill each weekday — Monday through Friday. Save as you go. Submit for review when done.</p>

        {/* Banners */}
        {status.locked && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4 flex items-start gap-3" data-testid="lock-banner">
            <LockKey size={20} className="text-warn mt-0.5" weight="bold" />
            <div>
              <div className="font-semibold text-warn">Last week pending</div>
              <div className="text-sm text-ink mt-1">Submit week <b>{status.last_week_start}</b> first to unlock the current week.</div>
            </div>
          </div>
        )}
        {missingFromUrl.length > 0 && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4 flex items-start gap-3" data-testid="missing-link-banner">
            <Info size={20} className="text-warn mt-0.5" weight="fill" />
            <div>
              <div className="font-semibold text-warn">From your reminder email</div>
              <div className="text-sm text-ink mt-1">You're missing entries for: <b>{missingFromUrl.join(", ")}</b>. They are highlighted below.</div>
            </div>
          </div>
        )}
        {!status.locked && status.weekday >= 4 && week.status === "draft" && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4 flex items-start gap-3" data-testid="friday-banner">
            <Warning size={20} className="text-warn mt-0.5" weight="bold" />
            <div>
              <div className="font-semibold text-warn">It's Friday — wrap up your timesheet</div>
              <div className="text-sm text-ink mt-1">Fill remaining days and click <b>Submit for review</b>.</div>
            </div>
          </div>
        )}
        {week.status === "pending" && (
          <div className="mt-8 bg-ok-bg border-l-4 border-ok p-4 flex items-start gap-3" data-testid="pending-banner">
            <CheckCircle size={20} className="text-ok mt-0.5" weight="fill" />
            <div>
              <div className="font-semibold text-ok">Submitted</div>
              <div className="text-sm text-ink mt-1">Awaiting admin approval.</div>
            </div>
          </div>
        )}
        {week.status === "approved" && (
          <div className="mt-8 bg-ok-bg border-l-4 border-ok p-4 flex items-start gap-3" data-testid="approved-banner">
            <CheckCircle size={20} className="text-ok mt-0.5" weight="fill" />
            <div className="font-semibold text-ok">Week approved ✓</div>
          </div>
        )}
        {week.status === "rejected" && (
          <div className="mt-8 bg-warn-bg border-l-4 border-warn p-4" data-testid="rejected-banner">
            <div className="font-semibold text-warn">Rejected — please revise and resubmit</div>
            {week.review_note && <div className="text-sm text-ink mt-1"><b>Reviewer note:</b> {week.review_note}</div>}
          </div>
        )}

        <Tabs defaultValue="week" className="mt-10">
          <TabsList className="bg-white border border-line2 rounded-sm p-1">
            <TabsTrigger value="week" className="rounded-sm" data-testid="tab-week">This week</TabsTrigger>
            <TabsTrigger value="leave" className="rounded-sm" data-testid="tab-leave">Leaves</TabsTrigger>
            <TabsTrigger value="history" className="rounded-sm" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          {/* Week tab */}
          <TabsContent value="week" className="mt-6 space-y-6">
            <div className="surface p-4 flex flex-wrap items-center gap-4 justify-between" data-testid="week-toolbar">
              <div className="flex items-center gap-3">
                <CalendarBlank size={20} className="text-ink2" />
                <Select value={activeWeekStart} onValueChange={setActiveWeekStart}>
                  <SelectTrigger className="rounded-sm bg-white border-line2 h-10 w-[260px] font-mono text-sm" data-testid="week-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={status.last_week_start}>{status.last_week_start} (last week)</SelectItem>
                    <SelectItem value={status.current_week_start} disabled={!canSwitchToCurrent}>{status.current_week_start} (current week){!canSwitchToCurrent ? " · locked" : ""}</SelectItem>
                  </SelectContent>
                </Select>
                <StatusBadge status={week.status} />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <div className="text-ink2">Total this week</div>
                <div className="font-heading font-black text-2xl tracking-tighter" data-testid="total-hours">{week.total_hours}h</div>
              </div>
            </div>

            <div className="surface overflow-hidden" data-testid="days-grid">
              <table className="w-full text-sm">
                <thead className="bg-canvas border-b border-line2">
                  <tr className="text-left text-ink2 uppercase tracking-wider text-xs">
                    <th className="px-4 py-3 w-[110px]">Day</th>
                    <th className="px-4 py-3 w-[120px]">Type</th>
                    <th className="px-4 py-3 w-[110px]">Hours</th>
                    <th className="px-4 py-3">Tasks / Notes</th>
                    <th className="px-4 py-3 w-[120px] text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {week.days.map((d) => {
                    const isMissing = missingFromUrl.includes(d.date);
                    const rowCls = `border-b border-line ${isMissing ? "bg-warn-bg/50" : ""}`;
                    return (
                      <tr key={d.date} className={rowCls} ref={(el) => (dayRefs.current[d.date] = el)} data-testid={`day-row-${d.date}`}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-heading font-bold">{d.day}</div>
                          <div className="text-xs text-ink2 font-mono">{d.date}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {d.from_leave ? (
                            <span className="tag tag-approved" data-testid={`leave-tag-${d.date}`}>Leave</span>
                          ) : (
                            <select
                              disabled={!editable}
                              value={d.type}
                              onChange={(e) => updateDay(d.date, { type: e.target.value, hours: e.target.value === "work" ? d.hours : 0 })}
                              className="h-9 px-2 bg-white border border-line2 rounded-sm text-sm focus:ring-1 focus:ring-brand"
                              data-testid={`day-type-${d.date}`}
                            >
                              <option value="work">Work</option>
                              <option value="leave">Leave</option>
                              <option value="holiday">Holiday</option>
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Input
                            type="number"
                            step="0.5"
                            min="0"
                            max="24"
                            disabled={!editable || d.from_leave || d.type !== "work"}
                            value={d.hours}
                            onChange={(e) => updateDay(d.date, { hours: e.target.value })}
                            className="h-9 rounded-sm font-mono w-20"
                            data-testid={`day-hours-${d.date}`}
                          />
                        </td>
                        <td className="px-4 py-3 align-top">
                          <Textarea
                            rows={2}
                            disabled={!editable || d.from_leave}
                            value={d.tasks}
                            onChange={(e) => updateDay(d.date, { tasks: e.target.value })}
                            placeholder={d.from_leave ? "" : "What did you work on?"}
                            className="rounded-sm text-sm"
                            data-testid={`day-tasks-${d.date}`}
                          />
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          {!d.from_leave && editable && (
                            <Button size="sm" variant="outline" className="rounded-sm border-line2" onClick={() => saveDay(d)} data-testid={`save-day-${d.date}`}>
                              <FloppyDisk size={14} className="mr-1" /> Save
                            </Button>
                          )}
                          {d.from_leave && <span className="text-xs text-ink2">Auto</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {editable && (
              <div className="surface p-6">
                <Label className="overline">Notes for reviewer (optional)</Label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the admin should know about this week…"
                  className="mt-2 rounded-sm"
                  data-testid="week-notes"
                />
                <div className="mt-4 flex justify-end">
                  <Button onClick={submitWeek} disabled={submitting} className="h-11 rounded-sm btn-primary text-white px-6" data-testid="submit-week-button">
                    {submitting ? "Submitting…" : <><PaperPlaneTilt size={16} className="mr-2" /> Submit for review</>}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Leave tab */}
          <TabsContent value="leave" className="mt-6">
            <LeavePanel leaves={leaves} onChanged={loadAll} />
          </TabsContent>

          {/* History */}
          <TabsContent value="history" className="mt-6">
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
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function LeavePanel({ leaves, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ leave_type: "casual", start_date: "", end_date: "", reason: "" });

  const apply = async (e) => {
    e.preventDefault();
    try {
      await api.post("/leaves", form);
      toast.success("Leave request submitted");
      setForm({ leave_type: "casual", start_date: "", end_date: "", reason: "" });
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this leave request?")) return;
    try {
      await api.delete(`/leaves/${id}`);
      toast.success("Leave cancelled");
      onChanged();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  return (
    <div className="surface" data-testid="leave-panel">
      <div className="p-4 flex items-center justify-between border-b border-line2">
        <div>
          <div className="overline">Time off</div>
          <div className="font-heading font-bold text-xl tracking-tight">{leaves.length} requests</div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-sm btn-primary text-white" data-testid="apply-leave-button">
              <Plus size={16} className="mr-2" /> Apply for leave
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm max-w-md" data-testid="apply-leave-dialog">
            <DialogHeader><DialogTitle className="font-heading">New leave request</DialogTitle></DialogHeader>
            <form onSubmit={apply} className="space-y-4">
              <div>
                <Label className="overline">Type</Label>
                <Select value={form.leave_type} onValueChange={(v) => setForm({ ...form, leave_type: v })}>
                  <SelectTrigger className="mt-2 rounded-sm bg-white border-line2 h-10" data-testid="leave-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sick">Sick</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="earned">Earned</SelectItem>
                    <SelectItem value="wfh">Work from home</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="overline">From</Label>
                  <Input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="mt-2 rounded-sm font-mono" data-testid="leave-start" />
                </div>
                <div>
                  <Label className="overline">To</Label>
                  <Input type="date" required value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="mt-2 rounded-sm font-mono" data-testid="leave-end" />
                </div>
              </div>
              <div>
                <Label className="overline">Reason</Label>
                <Textarea required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="mt-2 rounded-sm" data-testid="leave-reason" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-sm btn-primary text-white" data-testid="submit-leave-button">Submit request</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-canvas border-b border-line2 text-left text-ink2 uppercase tracking-wider text-xs">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3 text-right">Days</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {leaves.length === 0 && <tr><td colSpan="7" className="px-4 py-8 text-center text-ink2">No leave requests yet.</td></tr>}
            {leaves.map((l) => (
              <tr key={l.id} className="row-zebra border-b border-line" data-testid={`leave-row-${l.id}`}>
                <td className="px-4 py-3 capitalize">{l.leave_type}</td>
                <td className="px-4 py-3 font-mono">{l.start_date}</td>
                <td className="px-4 py-3 font-mono">{l.end_date}</td>
                <td className="px-4 py-3 text-right font-mono">{l.days}</td>
                <td className="px-4 py-3 max-w-xs truncate" title={l.reason}>{l.reason}</td>
                <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                <td className="px-4 py-3 text-right">
                  {l.status === "pending" && (
                    <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg" onClick={() => cancel(l.id)} data-testid={`cancel-leave-${l.id}`}>
                      <Trash size={14} className="mr-1" /> Cancel
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
