"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { ReportIssueButton } from "./ReportIssueButton";
import { authFetch, clientApiUrl } from "../lib/client-api";

const maxTechPackFileBytes = 100 * 1024 * 1024;
const maxTechPackBatchBytes = 200 * 1024 * 1024;

function formatFileSize(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

type TechPackStyle = {
  id: string;
  sourceFileName: string;
  styleNumber: string;
  descriptionOne: string | null;
  descriptionTwo: string | null;
  styleType: string | null;
  colorways: string | null;
  brandDivision: string | null;
  season: string | null;
  sizeRange: string | null;
  mainMaterials: string | null;
};

export function TechPackUpload({ onUploaded }: { onUploaded?: () => void | Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [styles, setStyles] = useState<TechPackStyle[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadStyles() {
    try {
      const response = await authFetch(clientApiUrl + "/sampling/tech-packs/styles", {
        credentials: "include"
      });
      if (response.ok) {
        setStyles(await response.json());
        return;
      }
      setError("Could not load uploaded tech-pack styles. Check that the API server is running.");
    } catch {
      setError("Could not reach the API server. Start npm run dev:api and refresh this page.");
    }
  }

  useEffect(() => {
    void loadStyles();
  }, []);

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    setMessage("");

    const oversizedFile = selectedFiles.find((file) => file.size > maxTechPackFileBytes);
    if (oversizedFile) {
      setFiles([]);
      setError(
        oversizedFile.name +
          " is " +
          formatFileSize(oversizedFile.size) +
          ". Tech pack PDFs can be up to 100 MB each. Compress this PDF or upload a smaller version."
      );
      event.target.value = "";
      return;
    }

    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxTechPackBatchBytes) {
      setFiles([]);
      setError(
        "The selected tech packs are " +
          formatFileSize(totalSize) +
          " together. Upload them in smaller batches of about 200 MB or less."
      );
      event.target.value = "";
      return;
    }

    setFiles(selectedFiles);
    setError("");
  }

  async function upload() {
    if (files.length === 0) {
      setError("Select one or more PDF tech packs.");
      return;
    }

    const oversizedFile = files.find((file) => file.size > maxTechPackFileBytes);
    if (oversizedFile) {
      setError(
        oversizedFile.name +
          " is " +
          formatFileSize(oversizedFile.size) +
          ". Tech pack PDFs can be up to 100 MB each. Compress this PDF or upload a smaller version."
      );
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxTechPackBatchBytes) {
      setError("Upload these tech packs in smaller batches of about 200 MB or less.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    const formData = new FormData();
    for (const file of files) formData.append("files", file);

    let response: Response;
    try {
      response = await authFetch(clientApiUrl + "/sampling/tech-packs/upload", {
        method: "POST",
        credentials: "include",
        body: formData
      });
    } catch {
      setSaving(false);
      setError("Could not reach the API server. Start npm run dev:api and try again.");
      return;
    }

    const body = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok) {
      setError(body.error ?? "Tech pack upload failed. If the PDF is large, compress it or upload files one by one.");
      return;
    }

    const savedCount = body.acceptedRows?.length ?? 0;
    const rejectedRows = body.rejectedRows ?? [];
    const duplicateRows = body.alreadyUploadedRows ?? [];
    const duplicateStyles = duplicateRows.map((row: { styleNumber?: string }) => row.styleNumber).filter(Boolean);

    if (savedCount === 0 && duplicateRows.length === 0 && rejectedRows.length > 0) {
      const firstReason = rejectedRows[0]?.errors?.[0] ?? "No style number could be extracted from this PDF.";
      setError(firstReason + " Upload a PDF with visible style number text, or report this file if the style is visible but the software missed it.");
      await loadStyles();
      return;
    }

    setFiles([]);
    setMessage([
      "Saved " + savedCount + " new tech pack style(s) into sampling orders.",
      duplicateStyles.length > 0 ? duplicateStyles.length + " already uploaded: " + duplicateStyles.join(", ") + "." : ""
    ].filter(Boolean).join(" "));
    await loadStyles();
    await onUploaded?.();
  }

  const selected = styles.find((style) => style.id === selectedId) ?? styles[0];

  return (
    <div className="tech-pack-grid">
      <div className="sampling-card">
        <strong>Upload Tech Packs</strong>
        <span>Upload multiple vendor PDF tech packs. Only stable style information is extracted into Sampling.</span>
        <input type="file" accept=".pdf" multiple onChange={onFilesSelected} />
        {files.length > 0 ? <span>{files.length} file(s) selected</span> : null}
        <button type="button" onClick={upload} disabled={saving}>
          {saving ? "Uploading..." : "Upload PDFs"}
        </button>
        {error ? (
          <div className="form-error upload-error-detail">
            <strong>{error}</strong>
            <span>Why: The PDF could not be accepted or parsed with the current tech-pack rules.</span>
            <span>What to change: Upload PDF tech packs with visible style numbers. If the file is valid, report it to Admin.</span>
            <ReportIssueButton title="Tech Pack upload rejected" module="SAMPLING" linkedType="tech-pack-upload" context={{ error, files: files.map((file) => file.name) }} />
          </div>
        ) : null}
        {message ? <div className="form-success">{message}</div> : null}
      </div>

      <div className="sampling-card">
        <strong>Extracted Styles</strong>
        {styles.length === 0 ? (
          <span>No tech packs uploaded yet.</span>
        ) : (
          <>
            <select className="table-select" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
              {styles.map((style) => (
                <option key={style.id} value={style.id}>{style.styleNumber}</option>
              ))}
            </select>
            {selected ? (
              <div className="tech-pack-detail">
                <h3>{selected.styleNumber}</h3>
                <p>{selected.descriptionOne ?? selected.descriptionTwo ?? "No description extracted."}</p>
                <dl>
                  <dt>Colorways</dt><dd>{selected.colorways ?? "-"}</dd>
                  <dt>Brand</dt><dd>{selected.brandDivision ?? "-"}</dd>
                  <dt>Season</dt><dd>{selected.season ?? "-"}</dd>
                  <dt>Size Range</dt><dd>{selected.sizeRange ?? "-"}</dd>
                  <dt>Style Type</dt><dd>{selected.styleType ?? "-"}</dd>
                  <dt>Materials</dt><dd>{selected.mainMaterials ?? "-"}</dd>
                  <dt>Source</dt><dd>{selected.sourceFileName}</dd>
                </dl>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
