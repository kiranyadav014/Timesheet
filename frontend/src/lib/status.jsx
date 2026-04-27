// Centralized status-to-class mapping (eliminates nested ternaries everywhere)
const STATUS_CLASS = {
  approved: "tag-approved",
  rejected: "tag-rejected",
  pending: "tag-pending",
  draft: "",
};

export function getStatusClass(status) {
  return STATUS_CLASS[status] ?? "tag-pending";
}

export function StatusTag({ status }) {
  if (!status || status === "draft") {
    return <span className="tag" data-testid={`status-tag-${status || "none"}`}>Draft</span>;
  }
  return <span className={`tag ${getStatusClass(status)}`} data-testid={`status-tag-${status}`}>{status}</span>;
}
