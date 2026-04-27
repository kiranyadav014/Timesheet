import { useState, useEffect, useCallback, useRef } from "react";
import { api, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";

/**
 * Loads timesheet status, week details, history, and leaves for the logged-in employee.
 * Encapsulates all data fetching and mutation calls.
 */
export function useEmployeeTimesheet() {
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
      setActiveWeekStart((prev) => {
        if (prev) return prev;
        return s.data.locked ? s.data.last_week_start : s.data.current_week_start;
      });
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  }, []);

  const loadWeek = useCallback(async (ws) => {
    if (!ws) return;
    try {
      const { data } = await api.get("/timesheets/week", { params: { week_start: ws } });
      setWeek(data);
      setNotes(data.notes || "");
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail));
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadWeek(activeWeekStart); }, [activeWeekStart, loadWeek]);

  const updateDay = useCallback((date, patch) => {
    setWeek((w) => {
      if (!w) return w;
      const nextDays = w.days.map((d) => (d.date === date ? { ...d, ...patch } : d));
      const total = nextDays.reduce((s, d) => s + (d.type === "work" ? Number(d.hours || 0) : 0), 0);
      return { ...w, days: nextDays, total_hours: total };
    });
  }, []);

  const saveDay = useCallback(async (d) => {
    if (!week) return;
    if (["pending", "approved"].includes(week.status)) return;
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
  }, [week, loadWeek, loadAll]);

  const submitWeek = useCallback(async () => {
    if (!week) return;
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
  }, [week, notes, loadWeek, loadAll]);

  return {
    status, week, history, leaves,
    activeWeekStart, setActiveWeekStart,
    notes, setNotes,
    submitting,
    dayRefs,
    updateDay, saveDay, submitWeek, loadAll,
  };
}
