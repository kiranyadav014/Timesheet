import { useState } from "react";
import { api, formatApiErrorDetail } from "../../lib/api";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { toast } from "sonner";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

const Tag = ({ status }) => {
  const cls = status === "approved" ? "tag-approved" : status === "rejected" ? "tag-rejected" : "tag-pending";
  return <span className={`tag ${cls}`}>{status}</span>;
};

export default function TimesheetTable({ items, onChanged }) {
  const [reviewing, setReviewing] = useState(null);
  const [note, setNote] = useState("");

  const review = async (action) => {
    try {
      await api.post(`/admin/timesheets/${reviewing.id}/review`, { action, review_note: note });
      toast.success(`Timesheet ${action}d`);
      setReviewing(null);
      setNote("");
      onChanged();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
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
          {items.length === 0 && (
            <tr><td colSpan="6" className="px-4 py-8 text-center text-ink2">No timesheets match.</td></tr>
          )}
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
                <Button size="sm" variant="outline" className="rounded-sm border-line2"
                  onClick={() => { setReviewing(t); setNote(t.review_note || ""); }}
                  data-testid={`review-button-${t.id}`}>
                  Review
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ReviewDialog reviewing={reviewing} note={note} setNote={setNote} onClose={() => setReviewing(null)} onAction={review} />
    </div>
  );
}

function ReviewDialog({ reviewing, note, setNote, onClose, onAction }) {
  if (!reviewing) return (
    <Dialog open={false} onOpenChange={onClose}><DialogContent className="hidden" /></Dialog>
  );
  return (
    <Dialog open={!!reviewing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-sm max-w-3xl max-h-[90vh] overflow-y-auto bg-white text-ink" data-testid="review-dialog">
        <DialogHeader><DialogTitle className="font-heading text-ink">Review timesheet</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="overline">Employee</div>
              <div className="mt-1 font-medium">{reviewing.employee_name}<div className="text-ink2 font-mono text-xs">{reviewing.employee_id}</div></div>
            </div>
            <div>
              <div className="overline">Week</div>
              <div className="mt-1 font-mono">{reviewing.week_start} → {reviewing.week_end}</div>
            </div>
            <div>
              <div className="overline">Total</div>
              <div className="mt-1 font-mono font-semibold text-lg">{reviewing.total_hours}h</div>
            </div>
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
                {(reviewing.daily_entries || []).map((e) => (
                  <tr key={e.date} className="border-b border-line">
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
        <DialogFooter>
          {reviewing.status === "pending" ? (
            <>
              <Button variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg" onClick={() => onAction("reject")} data-testid="reject-button">
                <XCircle size={16} className="mr-2" /> Reject
              </Button>
              <Button className="rounded-sm btn-primary text-white" onClick={() => onAction("approve")} data-testid="approve-button">
                <CheckCircle size={16} className="mr-2" /> Approve
              </Button>
            </>
          ) : (
            <Button variant="outline" className="rounded-sm" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
