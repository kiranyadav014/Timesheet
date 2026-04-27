import { useEffect, useState, useCallback } from "react";
import { api, formatApiErrorDetail, API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { Clock, SignOut, Download, EnvelopeSimple, UsersThree, FileText, ChartBar, Calendar } from "@phosphor-icons/react";

import TimesheetTable from "../components/admin/TimesheetTable";
import LeavesTable from "../components/admin/LeavesTable";
import EmployeesPanel from "../components/admin/EmployeesPanel";

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

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/reports/summary");
      setSummary(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("summary failed:", err.message);
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    try {
      const { data } = await api.get("/employees");
      setEmployees(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("employees failed:", err.message);
    }
  }, []);

  const loadTimesheets = useCallback(async () => {
    try {
      const params = {};
      if (filterStatus) params.status_filter = filterStatus;
      if (filterEmp) params.employee_id = filterEmp;
      const { data } = await api.get("/admin/timesheets", { params });
      setTimesheets(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  }, [filterStatus, filterEmp]);

  const loadLeaves = useCallback(async () => {
    try {
      const params = {};
      if (leaveStatus) params.status_filter = leaveStatus;
      const { data } = await api.get("/admin/leaves", { params });
      setLeaves(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  }, [leaveStatus]);

  useEffect(() => { loadSummary(); loadEmployees(); }, [loadSummary, loadEmployees]);
  useEffect(() => { loadTimesheets(); }, [loadTimesheets]);
  useEffect(() => { loadLeaves(); }, [loadLeaves]);

  const downloadCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status_filter", filterStatus);
      if (filterEmp) params.set("employee_id", filterEmp);
      const res = await fetch(`${API}/admin/reports/csv?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timesheets_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch (err) {
      toast.error(`Download failed: ${err.message}`);
    }
  };

  const sendDaily = async () => {
    try {
      const { data } = await api.post("/admin/send-daily-reminders");
      toast.success(`Daily reminders: targeted=${data.missing_employees ?? 0}, sent=${data.sent ?? 0}`);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  const sendFriday = async () => {
    try {
      const { data } = await api.post("/admin/send-friday-reminders");
      toast.success(`Friday reminders: targeted=${data.missing_employees ?? 0}, sent=${data.sent ?? 0}`);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  };

  const refreshTs = () => { loadTimesheets(); loadSummary(); };
  const refreshLeaves = () => { loadLeaves(); loadSummary(); };
  const refreshEmployees = () => { loadEmployees(); loadSummary(); };

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

        {summary && <SummaryStats summary={summary} />}

        <Tabs value={tab} onValueChange={setTab} className="mt-10">
          <TabsList className="bg-white border border-line2 rounded-sm p-1">
            <TabsTrigger value="timesheets" className="rounded-sm" data-testid="tab-timesheets"><FileText size={16} className="mr-2" />Timesheets</TabsTrigger>
            <TabsTrigger value="leaves" className="rounded-sm" data-testid="tab-leaves"><Calendar size={16} className="mr-2" />Leaves</TabsTrigger>
            <TabsTrigger value="employees" className="rounded-sm" data-testid="tab-employees"><UsersThree size={16} className="mr-2" />Employees</TabsTrigger>
            <TabsTrigger value="reports" className="rounded-sm" data-testid="tab-reports"><ChartBar size={16} className="mr-2" />Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="timesheets" className="mt-6">
            <TimesheetFilters
              filterStatus={filterStatus} setFilterStatus={setFilterStatus}
              filterEmp={filterEmp} setFilterEmp={setFilterEmp}
              downloadCsv={downloadCsv} sendDaily={sendDaily} sendFriday={sendFriday}
            />
            <TimesheetTable items={timesheets} onChanged={refreshTs} />
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
            <LeavesTable items={leaves} onChanged={refreshLeaves} />
          </TabsContent>

          <TabsContent value="employees" className="mt-6">
            <EmployeesPanel employees={employees} onChanged={refreshEmployees} />
          </TabsContent>

          <TabsContent value="reports" className="mt-6">
            <ReportsPanel downloadCsv={downloadCsv} sendDaily={sendDaily} sendFriday={sendFriday} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function SummaryStats({ summary }) {
  const cards = [
    { key: "employees", label: "Employees", value: summary.total_employees },
    { key: "pending", label: "Pending TS", value: summary.pending },
    { key: "approved", label: "Approved", value: summary.approved },
    { key: "submitted", label: "Submitted wk", value: summary.submitted_this_week },
    { key: "missing", label: "Missing wk", value: summary.missing_this_week, warn: summary.missing_this_week > 0 },
    { key: "pending-leaves", label: "Pending leaves", value: summary.pending_leaves },
  ];
  return (
    <div className="mt-8 grid grid-cols-2 md:grid-cols-6 gap-4" data-testid="summary-stats">
      {cards.map((s) => (
        <div key={s.key} className={`surface p-5 ${s.warn ? "border-warn" : ""}`} data-testid={`stat-${s.key}`}>
          <div className="overline">{s.label}</div>
          <div className={`mt-2 font-heading font-black text-3xl tracking-tight ${s.warn ? "text-warn" : "text-ink"}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function TimesheetFilters({ filterStatus, setFilterStatus, filterEmp, setFilterEmp, downloadCsv, sendDaily, sendFriday }) {
  return (
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
  );
}

function ReportsPanel({ downloadCsv, sendDaily, sendFriday }) {
  return (
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
  );
}
