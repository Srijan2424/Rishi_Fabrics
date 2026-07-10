"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

type Factory = {
  id: string;
  name: string;
};

type Workflow = {
  id: string;
  name: string;
};

export function OrderForm({ factories, workflows }: { factories: Factory[]; workflows: Workflow[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`${apiUrl}/orders`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factoryId: form.get("factoryId"),
          workflowTemplateId: form.get("workflowTemplateId"),
          orderNumber: form.get("orderNumber"),
          buyerName: form.get("buyerName"),
          productCategory: form.get("productCategory"),
          orderQuantity: Number(form.get("orderQuantity")),
          deliveryDate: new Date(String(form.get("deliveryDate"))).toISOString()
        })
      });

      if (!response.ok) {
        throw new Error(`API responded with ${response.status}`);
      }

      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not create order.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Factory
        <select name="factoryId" required>
          {factories.map((factory) => (
            <option key={factory.id} value={factory.id}>{factory.name}</option>
          ))}
        </select>
      </label>
      <label>
        Workflow
        <select name="workflowTemplateId" required>
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
          ))}
        </select>
      </label>
      <label>
        Order Number
        <input name="orderNumber" placeholder="ORD-1002" required />
      </label>
      <label>
        Buyer
        <input name="buyerName" placeholder="Buyer name" required />
      </label>
      <label>
        Product Category
        <input name="productCategory" placeholder="T-Shirts" required />
      </label>
      <label>
        Quantity
        <input name="orderQuantity" type="number" min="1" placeholder="10000" required />
      </label>
      <label>
        Delivery Date
        <input name="deliveryDate" type="date" required />
      </label>
      <button type="submit" disabled={saving}>{saving ? "Saving..." : "Create Order"}</button>
      {error ? <div className="form-message error wide-message">Error: {error}</div> : null}
    </form>
  );
}
