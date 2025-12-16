import React from "react";

export default function RuleCard({ r }) {
  return (
    <div className="rule-card">
      <div className="rule-left">
        <div className="rule-trigger">{r.trigger}</div>
        <div className="rule-action">{r.action}</div>
      </div>
      <div className="rule-meta">
        <div className="chip">Active</div>
      </div>
    </div>
  );
}
