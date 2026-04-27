import { useEffect, useState, useCallback } from "react";
import { api, formatApiErrorDetail, API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { Clock, SignOut, Plus, Download, EnvelopeSimple, Trash, CheckCircle, XCircle, UsersThree, FileText, ChartBar, Calendar } from "@phosphor-icons/react";

const Tag = ({ status }) => {
  const cls = status === "approved" ? "tag-approved" : status === "rejected" ? "tag-rejected" : "tag-pending";
  return <span className={`tag ${cls}`}>{status}</span>;
};

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("timesheets");
  const [summary, setSummary] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [filterStatus, setFilterStatus] = useState("pending");
  const [filterEmp, setFilterEmp] = useState("");
  const [leaveStatus, setLeaveStatus] = useState("pending");

  const loadSummary = useCallback(async () => { try { const { data } = await api.get("/admin/reports/summary"); setSummary(data); } catch {} }, []);
  const loadEmployees = useCallback(async () => { try { const { data } = await api.get("/employees"); setEmployees(data); } catch {} }, []);
  const loadTimesheets = useCallback(async () => {
    try {
      const params = {};
      if (filterStatus) params.status_filter = filterStatus;
      if (filterEmp) params.employee_id = filterEmp;
      const { data } = await api.get("/admin/timesheets", { params });
      setTimesheets(data);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  }, [filterStatus, filterEmp]);
  const loadLeaves = useCallback(async () => {
    try {
      const params = {};
      if (leaveStatus) params.status_filter = leaveStatus;
      const { data } = await api.get("/admin/leaves", { params });
      setLeaves(data);
    } catch {}
  }, [leaveStatus]);

  useEffect(() => { loadSummary(); loadEmployees(); }, [loadSummary, loadEmployees]);
  useEffect(() => { loadTimesheets(); }, [loadTimesheets]);
  useEffect(() => { loadLeaves(); }, [loadLeaves]);

  const downloadCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status_filter", filterStatus);
      if (filterEmp) params.set("employee_id", filterEmp);
      const t = localStorage.getItem("ts_token");
      const res = await fetch(`${API}/admin/reports/csv?${params}`, { headers: { Authorization: `Bearer ${t}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `timesheets_${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch { toast.error("Download failed"); }
  };

  const sendDaily = async () => {
    try {
      const { data } = await api.post("/admin/send-daily-reminders");
      toast.success(`Daily reminders: targeted=${data.missing_employees}, sent=${data.sent}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const sendFriday = async () => {
    try {
      const { data } = await api.post("/admin/send-friday-reminders");
      toast.success(`Friday reminders: targeted=${data.missing_employees}, sent=${data.sent}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-line2">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-ink text-white grid place-items-center"><Clock size={18} weight="bold" /></div>
            <div className="font-heading font-black tracking-tight">TIMESHEET<span className="text-brand">.</span></div>
            <span className="ml-3 tag" data-testid="admin-tag">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-ink2 hidden sm:block" data-testid="admin-email">{user.email}</div>
            <Button variant="ghost" onClick={logout} className="rounded-sm" data-testid="logout-button">
              <SignOut size={16} className="mr-2" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 lg:px-12 py-10">
        <div className="overline mb-2">Control room</div>
        <h1 className="font-heading font-black text-4xl sm:text-5xl tracking-tighter">Admin dashboard.</h1>

        {summary && (
          <div className="mt-8 grid grid-cols-2 md:grid-cols-6 gap-4" data-testid="summary-stats">
            {[
              { label: "Employees", value: summary.total_employees, testid: "stat-employees" },
              { label: "Pending TS", value: summary.pending, testid: "stat-pending" },
              { label: "Approved", value: summary.approved, testid: "stat-approved" },
              { label: "Submitted wk", value: summary.submitted_this_week, testid: "stat-submitted" },
              { label: "Missing wk", value: summary.missing_this_week, testid: "stat-missing", warn: summary.missing_this_week > 0 },
              { label: "Pending leaves", value: summary.pending_leaves, testid: "stat-pending-leaves" },
            ].map((s) => (
              <div key={s.label} className={`surface p-5 ${s.warn ? "border-warn" : ""}`} data-testid={s.testid}>
                <div className="overline">{s.label}</div>
                <div className={`mt-2 font-heading font-black text-3xl tracking-tight ${s.warn ? "text-warn" : "text-ink"}`}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-10">
          <TabsList className="bg-white border border-line2 rounded-sm p-1">
            <TabsTrigger value="timesheets" className="rounded-sm" data-testid="tab-timesheets"><FileText size={16} className="mr-2" />Timesheets</TabsTrigger>
            <TabsTrigger value="leaves" className="rounded-sm" data-testid="tab-leaves"><Calendar size={16} className="mr-2" />Leaves</TabsTrigger>
            <TabsTrigger value="employees" className="rounded-sm" data-testid="tab-employees"><UsersThree size={16} className="mr-2" />Employees</TabsTrigger>
            <TabsTrigger value="reports" className="rounded-sm" data-testid="tab-reports"><ChartBar size={16} className="mr-2" />Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="timesheets" className="mt-6">
            <div className="surface p-4 flex flex-wrap items-end gap-4" data-testid="filters-row">
              <div className="flex-1 min-w-[160px]">
                <Label className="overline">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="mt-2 rounded-sm bg-white border-line2 h-10" data-testid="filter-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <Label className="overline">Employee ID</Label>
                <Input value={filterEmp} onChange={(e) => setFilterEmp(e.target.value.toUpperCase())} placeholder="EMP001" className="mt-2 rounded-sm h-10 font-mono" data-testid="filter-employee" />
              </div>
              <Button onClick={downloadCsv} variant="outline" className="rounded-sm h-10 border-line2" data-testid="export-csv-button">
                <Download size={16} className="mr-2" /> Export CSV
              </Button>
              <Button onClick={sendDaily} variant="outline" className="rounded-sm h-10 border-line2" data-testid="send-daily-button">
                <EnvelopeSimple size={16} className="mr-2" /> Daily reminders
              </Button>
              <Button onClick={sendFriday} variant="outline" className="rounded-sm h-10 border-line2" data-testid="send-friday-button">
                <EnvelopeSimple size={16} className="mr-2" /> Friday reminders
              </Button>
            </div>
            <TimesheetTable items={timesheets} onChanged={() => { loadTimesheets(); loadSummary(); }} />
          </TabsContent>

          <TabsContent value="leaves" className="mt-6">
            <div className="surface p-4" data-testid="leaves-toolbar">
              <Label className="overline">Status</Label>
              <Select value={leaveStatus} onValueChange={setLeaveStatus}>
                <SelectTrigger className="mt-2 rounded-sm bg-white border-line2 h-10 w-[200px]" data-testid="leave-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LeavesTable items={leaves} onChanged={() => { loadLeaves(); loadSummary(); }} />
          </TabsContent>

          <TabsContent value="employees" className="mt-6">
            <EmployeesPanel employees={employees} onChanged={() => { loadEmployees(); loadSummary(); }} />
          </TabsContent>

          <TabsContent value="reports" className="mt-6">
            <div className="surface p-8">
              <div className="overline mb-2">Weekly compliance</div>
              <h2 className="font-heading font-bold text-2xl tracking-tight">Reports & exports</h2>
              <p className="text-ink2 text-sm mt-2 max-w-xl">Use Timesheets tab filters to slice data, then click <b>Export CSV</b>. Trigger reminders manually anytime.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={downloadCsv} className="rounded-sm btn-primary text-white h-10" data-testid="reports-export-csv">
                  <Download size={16} className="mr-2" /> Export current view
                </Button>
                <Button onClick={sendDaily} variant="outline" className="rounded-sm h-10 border-line2" data-testid="reports-send-daily">
                  <EnvelopeSimple size={16} className="mr-2" /> Daily reminders
                </Button>
                <Button onClick={sendFriday} variant="outline" className="rounded-sm h-10 border-line2" data-testid="reports-send-friday">
                  <EnvelopeSimple size={16} className="mr-2" /> Friday reminders
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function TimesheetTable({ items, onChanged }) {
  const [reviewing, setReviewing] = useState(null);
  const [note, setNote] = useState("");

  const review = async (action) => {
    try {
      await api.post(`/admin/timesheets/${reviewing.id}/review`, { action, review_note: note });
      toast.success(`Timesheet ${action}d`);
      setReviewing(null); setNote("");
      onChanged();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  return (
    <div className="surface mt-4 overflow-x-auto" data-testid="timesheets-table">
      <table className="w-full text-sm">
        <thead className="text-left text-ink2 uppercase tracking-wider text-xs border-b border-line2 bg-canvas">
          <tr>
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Week</th>
            <th className="px-4 py-3 text-right">Hours</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Submitted</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-ink2">No timesheets match.</td></tr>}
          {items.map((t) => (
            <tr key={t.id} className="row-zebra border-b border-line" data-testid={`ts-row-${t.id}`}>
              <td className="px-4 py-3">
                <div className="font-medium">{t.employee_name}</div>
                <div className="text-xs text-ink2 font-mono">{t.employee_id}</div>
              </td>
              <td className="px-4 py-3 font-mono">{t.week_start}</td>
              <td className="px-4 py-3 text-right font-mono font-semibold">{t.total_hours}h</td>
              <td className="px-4 py-3"><Tag status={t.status} /></td>
              <td className="px-4 py-3 font-mono text-xs text-ink2">{t.submitted_at?.slice(0, 10) || "—"}</td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="outline" className="rounded-sm border-line2" onClick={() => { setReviewing(t); setNote(t.review_note || ""); }} data-testid={`review-button-${t.id}`}>
                  Review
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)}>
        <DialogContent className="rounded-sm max-w-3xl" data-testid="review-dialog">
          <DialogHeader><DialogTitle className="font-heading">Review timesheet</DialogTitle></DialogHeader>
          {reviewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-4">
                <div><div className="overline">Employee</div><div className="mt-1 font-medium">{reviewing.employee_name}<div className="text-ink2 font-mono text-xs">{reviewing.employee_id}</div></div></div>
                <div><div className="overline">Week</div><div className="mt-1 font-mono">{reviewing.week_start} → {reviewing.week_end}</div></div>
                <div><div className="overline">Total</div><div className="mt-1 font-mono font-semibold text-lg">{reviewing.total_hours}h</div></div>
              </div>

              <div>
                <div className="overline mb-2">Daily breakdown</div>
                <table className="w-full border border-line2 text-sm">
                  <thead className="bg-canvas border-b border-line2">
                    <tr className="text-left text-ink2 uppercase tracking-wider text-xs">
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Hours</th>
                      <th className="px-3 py-2">Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reviewing.daily_entries || []).map((e, i) => (
                      <tr key={i} className="border-b border-line">
                        <td className="px-3 py-2 font-mono">{e.date}</td>
                        <td className="px-3 py-2 capitalize">{e.type}</td>
                        <td className="px-3 py-2 text-right font-mono">{e.hours}h</td>
                        <td className="px-3 py-2 whitespace-pre-wrap">{e.tasks || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {reviewing.notes && (
                <div>
                  <div className="overline">Employee notes</div>
                  <div className="mt-1 p-3 bg-canvas border border-line text-ink whitespace-pre-wrap text-sm">{reviewing.notes}</div>
                </div>
              )}

              {reviewing.status === "pending" && (
                <div>
                  <Label className="overline">Review note (optional)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 rounded-sm" rows={3} data-testid="review-note-input" />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {reviewing?.status === "pending" ? (
              <>
                <Button variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg" onClick={() => review("reject")} data-testid="reject-button">
                  <XCircle size={16} className="mr-2" /> Reject
                </Button>
                <Button className="rounded-sm btn-primary text-white" onClick={() => review("approve")} data-testid="approve-button">
                  <CheckCircle size={16} className="mr-2" /> Approve
                </Button>
              </>
            ) : (
              <Button variant="outline" className="rounded-sm" onClick={() => setReviewing(null)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeavesTable({ items, onChanged }) {
  const review = async (id, action) => {
    try {
      await api.post(`/admin/leaves/${id}/review`, { action });
      toast.success(`Leave ${action}d`);
      onChanged();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  return (
    <div className="surface mt-4 overflow-x-auto" data-testid="leaves-table">
      <table className="w-full text-sm">
        <thead className="text-left text-ink2 uppercase tracking-wider text-xs border-b border-line2 bg-canvas">
          <tr>
            <th className="px-4 py-3">Employee</th>
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
          {items.length === 0 && <tr><td colSpan="8" className="px-4 py-8 text-center text-ink2">No leaves match.</td></tr>}
          {items.map((l) => (
            <tr key={l.id} className="row-zebra border-b border-line" data-testid={`leave-row-${l.id}`}>
              <td className="px-4 py-3"><div className="font-medium">{l.employee_name}</div><div className="text-xs text-ink2 font-mono">{l.employee_id}</div></td>
              <td className="px-4 py-3 capitalize">{l.leave_type}</td>
              <td className="px-4 py-3 font-mono">{l.start_date}</td>
              <td className="px-4 py-3 font-mono">{l.end_date}</td>
              <td className="px-4 py-3 text-right font-mono">{l.days}</td>
              <td className="px-4 py-3 max-w-xs truncate" title={l.reason}>{l.reason}</td>
              <td className="px-4 py-3"><Tag status={l.status} /></td>
              <td className="px-4 py-3 text-right">
                {l.status === "pending" && (
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg" onClick={() => review(l.id, "reject")} data-testid={`reject-leave-${l.id}`}>
                      <XCircle size={14} />
                    </Button>
                    <Button size="sm" className="rounded-sm btn-primary text-white" onClick={() => review(l.id, "approve")} data-testid={`approve-leave-${l.id}`}>
                      <CheckCircle size={14} />
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmployeesPanel({ employees, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employee_id: "", name: "", email: "", password: "", department: "", position: "" });

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post("/employees", form);
      toast.success(`Created ${form.employee_id}`);
      setOpen(false);
      setForm({ employee_id: "", name: "", email: "", password: "", department: "", position: "" });
      onChanged();
    } catch (err) { toast.error(formatApiErrorDetail(err.response?.data?.detail)); }
  };

  const remove = async (emp_id) => {
    if (!window.confirm(`Delete ${emp_id}? This also deletes all their timesheets and leaves.`)) return;
    try {
      await api.delete(`/employees/${emp_id}`);
      toast.success("Employee deleted");
      onChanged();
    } catch (err) { toast.error(formatApiErrorDetail(err.response?.data?.detail)); }
  };

  return (
    <div className="surface" data-testid="employees-panel">
      <div className="p-4 flex items-center justify-between border-b border-line2">
        <div><div className="overline">Roster</div><div className="font-heading font-bold text-xl tracking-tight">{employees.length} employees</div></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-sm btn-primary text-white" data-testid="add-employee-button"><Plus size={16} className="mr-2" /> Add employee</Button>
          </DialogTrigger>
          <DialogContent className="rounded-sm max-w-lg" data-testid="add-employee-dialog">
            <DialogHeader><DialogTitle className="font-heading">New employee</DialogTitle></DialogHeader>
            <form onSubmit={create} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="overline">Employee ID</Label><Input required value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value.toUpperCase() })} placeholder="EMP001" className="mt-2 rounded-sm font-mono" data-testid="emp-id-input" /></div>
                <div><Label className="overline">Full name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-2 rounded-sm" data-testid="emp-name-input" /></div>
                <div><Label className="overline">Email</Label><Input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-2 rounded-sm" data-testid="emp-email-input" /></div>
                <div><Label className="overline">Initial password</Label><Input required type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-2 rounded-sm font-mono" data-testid="emp-password-input" /></div>
                <div><Label className="overline">Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="mt-2 rounded-sm" data-testid="emp-department-input" /></div>
                <div><Label className="overline">Position</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="mt-2 rounded-sm" data-testid="emp-position-input" /></div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="rounded-sm btn-primary text-white" data-testid="create-employee-submit">Create</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-ink2 uppercase tracking-wider text-xs border-b border-line2 bg-canvas">
            <tr>
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-ink2">No employees yet. Add one to get started.</td></tr>}
            {employees.map((e) => (
              <tr key={e.id} className="row-zebra border-b border-line" data-testid={`emp-row-${e.employee_id}`}>
                <td className="px-4 py-3 font-mono font-semibold">{e.employee_id}</td>
                <td className="px-4 py-3">{e.name}</td>
                <td className="px-4 py-3 text-ink2">{e.email}</td>
                <td className="px-4 py-3">{e.department || "—"}</td>
                <td className="px-4 py-3">{e.position || "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg" onClick={() => remove(e.employee_id)} data-testid={`delete-emp-${e.employee_id}`}>
                    <Trash size={14} className="mr-1" /> Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
