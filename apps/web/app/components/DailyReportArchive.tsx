"use client";

import { useEffect, useState } from "react";
import { authFetch, clientApiUrl } from "../lib/client-api";

type DailyReportInputStatus = {
  reportDate: string;
  ready: boolean;
  missingInputs: string[];
  inputs: Array<{
    key: string;
    label: string;
    ready: boolean;
    upload: null | {
      id: string;
      fileName: string;
      sourceType: string;
      rowsAccepted: number;
      rowsRejected: number;
      createdAt: string;
    };
  }>;
};

type DailyReportRow = {
  id: string;
  reportDate: string;
  status: string;
  generatedAt: string;
  requiredUploadIds: string[];
};

type DailyReportArchiveResponse = {
  inputStatus: DailyReportInputStatus;
  reports: DailyReportRow[];
};

function formatDate(value: string | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DailyReportArchive() {
  const [data, setData] = useState<DailyReportArchiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");

  async function loadReports() {
    setLoading(true);
    setMessage("");
    try {
      const response = await authFetch(`${clientApiUrl}/reports/daily`);
      if (!response.ok) throw new Error(`Reports API responded with ${response.status}`);
      setData(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reports archive could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  async function generateReport() {
    setGenerating(true);
    setMessage("");
    try {
      const response = await authFetch(`${clientApiUrl}/reports/daily/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: data?.inputStatus.reportDate })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Reports API responded with ${response.status}`);
      setMessage("Daily report generated and saved.");
      await loadReports();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Daily report could not be generated.");
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, []);

  const inputStatus = data?.inputStatus;

  return (
    <section className="panel section-panel daily-report-archive">
      <div className="panel-head">
        <div>
          <h2>Daily Report Archive</h2>
          <p>Generate and download daily reports after Daily Production, WIP, and Fabric sheets are applied.</p>
        </div>
        <button type="button" onClick={loadReports} disabled={loading}>Refresh</button>
      </div>

      {loading ? <div className="empty">Checking daily report readiness...</div> : null}
      {message ? <div className="form-message">{message}</div> : null}

      {inputStatus ? (
        <div className="report-readiness">
          <div>
            <span>Today&apos;s report</span>
            <strong>{inputStatus.ready ? "Ready to generate" : "Waiting for uploads"}</strong>
            <p>{formatDate(inputStatus.reportDate)}</p>
          </div>
          <div className="input-checks">
            {inputStatus.inputs.map((input) => (
              <div key={input.key} className={input.ready ? "input-check ready" : "input-check missing"}>
                <strong>{input.label}</strong>
                <span>{input.ready ? "Applied" : "Missing"}</span>
                <p>{input.upload?.fileName ?? "Upload and apply this sheet first."}</p>
              </div>
            ))}
          </div>
          <button type="button" onClick={generateReport} disabled={!inputStatus.ready || generating}>
            {generating ? "Generating..." : "Generate Daily Report"}
          </button>
        </div>
      ) : null}

      <div className="report-history">
        <h3>Previous Reports</h3>
        {!data?.reports?.length ? (
          <div className="empty">No saved daily reports yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Generated</th>
                <th>Inputs</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((report) => (
                <tr key={report.id}>
                  <td>{formatDate(report.reportDate)}</td>
                  <td><span className="status-pill status-neutral">{report.status}</span></td>
                  <td>{formatDateTime(report.generatedAt)}</td>
                  <td>{report.requiredUploadIds.length} files</td>
                  <td><a className="button-link" href={`${clientApiUrl}/reports/daily/${report.id}/download.csv`}>Download CSV</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
