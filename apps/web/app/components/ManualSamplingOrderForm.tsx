"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { ReportIssueButton } from "./ReportIssueButton";
import { authFetch, clientApiUrl } from "../lib/client-api";

const maxImageBytes = 100 * 1024 * 1024;

function formatFileSize(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export function ManualSamplingOrderForm({ onCreated }: { onCreated?: () => void | Promise<void> }) {
  const [styleNumber, setStyleNumber] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [colorways, setColorways] = useState("");
  const [mainMaterials, setMainMaterials] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setMessage("");

    if (file && file.size > maxImageBytes) {
      setImage(null);
      setError(`${file.name} is ${formatFileSize(file.size)}. Sampling images can be up to 100 MB.`);
      event.target.value = "";
      return;
    }

    setImage(file);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const quantity = Number(orderQuantity);
    if (styleNumber.trim().length < 2) {
      setError("Enter the style / order code.");
      return;
    }
    if (buyerName.trim().length < 2 || productCategory.trim().length < 2) {
      setError("Enter the buyer/brand and style description.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }

    const formData = new FormData();
    formData.append("styleNumber", styleNumber.trim());
    formData.append("buyerName", buyerName.trim());
    formData.append("productCategory", productCategory.trim());
    formData.append("orderQuantity", String(quantity));
    if (colorways.trim()) formData.append("colorways", colorways.trim());
    if (mainMaterials.trim()) formData.append("mainMaterials", mainMaterials.trim());
    if (image) formData.append("image", image);

    setSaving(true);
    try {
      const response = await authFetch(`${clientApiUrl}/sampling/tech-packs/manual`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(body.error ?? `API responded with ${response.status}`);
      }

      setStyleNumber("");
      setBuyerName("");
      setProductCategory("");
      setOrderQuantity("1");
      setColorways("");
      setMainMaterials("");
      setImage(null);
      setMessage(body.message ?? "Sampling order created.");
      await onCreated?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create sampling order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="sampling-card" onSubmit={submit}>
      <strong>Create Sampling Order</strong>
      <span>Add a sampling style manually when there is an image/reference but no readable tech pack PDF.</span>
      <label>
        Style / Order Code
        <input value={styleNumber} onChange={(event) => setStyleNumber(event.target.value)} placeholder="AW26-RISHI-01" />
      </label>
      <label>
        Buyer / Brand
        <input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} placeholder="Buyer or brand" />
      </label>
      <label>
        Style Description
        <input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} placeholder="T-shirt, sweatshirt, track pant..." />
      </label>
      <label>
        Quantity
        <input type="number" min={1} value={orderQuantity} onChange={(event) => setOrderQuantity(event.target.value)} />
      </label>
      <label>
        Colour / Colorways
        <input value={colorways} onChange={(event) => setColorways(event.target.value)} placeholder="Optional" />
      </label>
      <label>
        Fabric / Materials
        <input value={mainMaterials} onChange={(event) => setMainMaterials(event.target.value)} placeholder="Optional" />
      </label>
      <label>
        Style Image
        <input type="file" accept="image/*" onChange={onImageSelected} />
      </label>
      {image ? <span>{image.name} selected</span> : null}
      <button type="submit" disabled={saving}>
        {saving ? "Creating..." : "Create Sampling Order"}
      </button>
      {error ? (
        <div className="form-error upload-error-detail">
          <strong>{error}</strong>
          <span>What to change: Check the style code, image size, and required fields, then try again.</span>
          <ReportIssueButton title="Manual sampling order failed" module="SAMPLING" linkedType="manual-sampling-order" context={{ error, styleNumber }} />
        </div>
      ) : null}
      {message ? <div className="form-success">{message}</div> : null}
    </form>
  );
}
