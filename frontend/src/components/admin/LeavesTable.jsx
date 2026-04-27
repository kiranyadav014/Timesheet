import { api, formatApiErrorDetail } from "../../lib/api";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { CheckCircle, XCircle } from "@phosphor-icons/react";
import { StatusTag } from "../../lib/status";

export default function LeavesTable({ items, onChanged }) {
  const review = async (id, action) => {
    try {
      await api.post(`/admin/leaves/${id}/review`, { action });
      toast.success(`Leave ${action}d`);
      onChanged();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
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
          {items.length === 0 && (
            <tr><td colSpan="8" className="px-4 py-8 text-center text-ink2">No leaves match.</td></tr>
          )}
          {items.map((l) => <LeaveRow key={l.id} l={l} onReview={review} />)}
        </tbody>
      </table>
    </div>
  );
}

function LeaveRow({ l, onReview }) {
  return (
    <tr className="row-zebra border-b border-line" data-testid={`leave-row-${l.id}`}>
      <td className="px-4 py-3">
        <div className="font-medium">{l.employee_name}</div>
        <div className="text-xs text-ink2 font-mono">{l.employee_id}</div>
      </td>
      <td className="px-4 py-3 capitalize">{l.leave_type}</td>
      <td className="px-4 py-3 font-mono">{l.start_date}</td>
      <td className="px-4 py-3 font-mono">{l.end_date}</td>
      <td className="px-4 py-3 text-right font-mono">{l.days}</td>
      <td className="px-4 py-3 max-w-xs truncate" title={l.reason}>{l.reason}</td>
      <td className="px-4 py-3"><StatusTag status={l.status} /></td>
      <td className="px-4 py-3 text-right">
        {l.status === "pending" && (
          <div className="flex gap-1 justify-end">
            <Button size="sm" variant="outline" className="rounded-sm border-warn text-warn hover:bg-warn-bg"
              onClick={() => onReview(l.id, "reject")} data-testid={`reject-leave-${l.id}`}>
              <XCircle size={14} />
            </Button>
            <Button size="sm" className="rounded-sm btn-primary text-white"
              onClick={() => onReview(l.id, "approve")} data-testid={`approve-leave-${l.id}`}>
              <CheckCircle size={14} />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
