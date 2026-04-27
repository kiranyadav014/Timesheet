import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Clock, SignOut, CalendarBlank, PaperPlaneTilt } from "@phosphor-icons/react";

import StatusBanners from "../components/employee/StatusBanners";
import DaysGrid from "../components/employee/DaysGrid";
import HistoryTable from "../components/employee/HistoryTable";
import LeavePanel from "../components/employee/LeavePanel";
import { StatusTag } from "../lib/status";
import { useEmployeeTimesheet } from "../hooks/useEmployeeTimesheet";

export default function EmployeeDashboard() {
  const { user, logout } = useAuth();
  const [params] = useSearchParams();
  const missingFromUrl = (params.get("missing") || "").split(",").filter(Boolean);

  const t = useEmployeeTimesheet();
  const { status, week, history, leaves, activeWeekStart, setActiveWeekStart,
          notes, setNotes, submitting, dayRefs,
          updateDay, saveDay, submitWeek, loadAll } = t;

  // Scroll to first missing day mentioned in the email link
  useEffect(() => {
    if (!week || missingFromUrl.length === 0) return;
    const target = missingFromUrl.find((d) => dayRefs.current[d]);
    if (!target) return;
    const el = dayRefs.current[target];
    const id = setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(id);
  }, [week, missingFromUrl, dayRefs]);

  if (!status || !week) return <div className="p-12 text-ink2">Loading…</div>;

  const editable = !["pending", "approved"].includes(week.status);

  return (
    <div className="min-h-screen bg-canvas">
      <Header user={user} onLogout={logout} />

      <main className="max-w-7xl mx-auto px-6 lg:px-12 py-10">
        <div className="overline mb-2">Welcome back, {user.name.split(" ")[0]}</div>
        <h1 className="font-heading font-black text-4xl sm:text-5xl tracking-tighter">Your week.</h1>
        <p className="text-ink2 text-sm mt-3 max-w-xl">Fill each weekday — Monday through Friday. Save as you go. Submit for review when done.</p>

        <StatusBanners status={status} week={week} missingFromUrl={missingFromUrl} />

        <Tabs defaultValue="week" className="mt-10">
          <TabsList className="bg-white border border-line2 rounded-sm p-1">
            <TabsTrigger value="week" className="rounded-sm" data-testid="tab-week">This week</TabsTrigger>
            <TabsTrigger value="leave" className="rounded-sm" data-testid="tab-leave">Leaves</TabsTrigger>
            <TabsTrigger value="history" className="rounded-sm" data-testid="tab-history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="week" className="mt-6 space-y-6">
            <WeekToolbar status={status} week={week} activeWeekStart={activeWeekStart} setActiveWeekStart={setActiveWeekStart} />
            <DaysGrid days={week.days} editable={editable} missingDates={missingFromUrl} onChange={updateDay} onSave={saveDay} dayRefsRef={dayRefs} />
            {editable && <SubmitCard notes={notes} setNotes={setNotes} submitting={submitting} onSubmit={submitWeek} />}
          </TabsContent>

          <TabsContent value="leave" className="mt-6">
            <LeavePanel leaves={leaves} onChanged={loadAll} />
          </TabsContent>

          <TabsContent value="history" className="mt-6">
            <HistoryTable history={history} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Header({ user, onLogout }) {
  return (
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
          <Button variant="ghost" onClick={onLogout} className="rounded-sm" data-testid="logout-button">
            <SignOut size={16} className="mr-2" /> Logout
          </Button>
        </div>
      </div>
    </header>
  );
}

function WeekToolbar({ status, week, activeWeekStart, setActiveWeekStart }) {
  const canSwitchToCurrent = !status.locked;
  return (
    <div className="surface p-4 flex flex-wrap items-center gap-4 justify-between" data-testid="week-toolbar">
      <div className="flex items-center gap-3">
        <CalendarBlank size={20} className="text-ink2" />
        <Select value={activeWeekStart} onValueChange={setActiveWeekStart}>
          <SelectTrigger className="rounded-sm bg-white border-line2 h-10 w-[260px] font-mono text-sm" data-testid="week-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={status.last_week_start}>{status.last_week_start} (last week)</SelectItem>
            <SelectItem value={status.current_week_start} disabled={!canSwitchToCurrent}>
              {status.current_week_start} (current week){!canSwitchToCurrent ? " · locked" : ""}
            </SelectItem>
          </SelectContent>
        </Select>
        <StatusTag status={week.status} />
      </div>
      <div className="flex items-center gap-3 text-sm">
        <div className="text-ink2">Total this week</div>
        <div className="font-heading font-black text-2xl tracking-tighter" data-testid="total-hours">{week.total_hours}h</div>
      </div>
    </div>
  );
}

function SubmitCard({ notes, setNotes, submitting, onSubmit }) {
  return (
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
        <Button onClick={onSubmit} disabled={submitting} className="h-11 rounded-sm btn-primary text-white px-6" data-testid="submit-week-button">
          {submitting ? "Submitting…" : <><PaperPlaneTilt size={16} className="mr-2" /> Submit for review</>}
        </Button>
      </div>
    </div>
  );
}
