import { useState } from "react";
import { api, formatApiErrorDetail } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";
import { Plus, Trash } from "@phosphor-icons/react";
import { StatusTag } from "../../lib/status";

const EMPTY = { leave_type: "casual", start_date: "", end_date: "", reason: "" };

export default function LeavePanel({ leaves, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const apply = async (e) => {
    e.preventDefault();
    try {
      await api.post("/leaves", form);
      toast.success("Leave request submitted");
      setForm(EMPTY);
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
          <DialogContent className="rounded-sm max-w-md bg-white text-ink" data-testid="apply-leave-dialog">
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
            {leaves.length === 0 && (
              <tr><td colSpan="7" className="px-4 py-8 text-center text-ink2">No leave requests yet.</td></tr>
            )}
            {leaves.map((l) => (
              <tr key={l.id} className="row-zebra border-b border-line" data-testid={`leave-row-${l.id}`}>
                <td className="px-4 py-3 capitalize">{l.leave_type}</td>
                <td className="px-4 py-3 font-mono">{l.start_date}</td>
                <td className="px-4 py-3 font-mono">{l.end_date}</td>
                <td className="px-4 py-3 text-right font-mono">{l.days}</td>
                <td className="px-4 py-3 max-w-xs truncate" title={l.reason}>{l.reason}</td>
                <td className="px-4 py-3"><StatusTag status={l.status} /></td>
                <td className="px-4 py-3 text-right">
                  {l.status === "pending" && (
                    <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg"
                      onClick={() => cancel(l.id)} data-testid={`cancel-leave-${l.id}`}>
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
