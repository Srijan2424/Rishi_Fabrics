import cors from "cors";
import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json());

type StageKind = "MANUAL" | "AUTOMATIC" | "HYBRID";
type OrderStatus = "RUNNING" | "AT_RISK" | "DELAYED" | "DISPATCHED";

type WorkflowStage = {
  id: string;
  name: string;
  code: string;
  kind: StageKind;
  sequence: number;
  isDispatchStage?: boolean;
};

type Workflow = {
  id: string;
  factoryId: string;
  name: string;
  description: string;
  stages: WorkflowStage[];
};

type OrderStage = {
  id: string;
  stageCode: string;
  stageName: string;
  plannedQuantity: number;
  completedQuantity: number;
};

type Order = {
  id: string;
  factoryId: string;
  workflowTemplateId: string;
  orderNumber: string;
  buyerName: string;
  productCategory: string;
  orderQuantity: number;
  currentStageCode: string;
  deliveryDate: string;
  status: OrderStatus;
  stages: OrderStage[];
  materialMovements: Array<Record<string, unknown>>;
  reworkTickets: Array<Record<string, unknown>>;
};

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const factories = [
  {
    id: "factory-rishi",
    name: "Rishi Fabrics",
    code: "RISHI",
    workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    shiftsPerDay: 1,
    workingHoursPerDay: 8
  }
];

const workflows: Workflow[] = [
  {
    id: "workflow-1",
    factoryId: "factory-rishi",
    name: "Garment Manufacturing",
    description: "Default garment workflow",
    stages: [
      { id: "stage-1", name: "Lab Dip Approval", code: "LAB_DIP_APPROVAL", kind: "MANUAL", sequence: 1 },
      { id: "stage-2", name: "Knitting", code: "KNITTING", kind: "AUTOMATIC", sequence: 2 },
      { id: "stage-3", name: "Dyeing", code: "DYEING", kind: "AUTOMATIC", sequence: 3 },
      { id: "stage-4", name: "Stitching", code: "STITCHING", kind: "AUTOMATIC", sequence: 4 },
      { id: "stage-5", name: "Packing", code: "PACKING", kind: "AUTOMATIC", sequence: 5 },
      { id: "stage-6", name: "Dispatch", code: "DISPATCH", kind: "HYBRID", sequence: 6, isDispatchStage: true }
    ]
  }
];

const orders: Order[] = [
  {
    id: "order-1001",
    factoryId: "factory-rishi",
    workflowTemplateId: "workflow-1",
    orderNumber: "ORD-1001",
    buyerName: "Acme Retail",
    productCategory: "T-Shirts",
    orderQuantity: 10000,
    currentStageCode: "STITCHING",
    deliveryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 21).toISOString(),
    status: "RUNNING",
    stages: [
      { id: "os-1", stageCode: "LAB_DIP_APPROVAL", stageName: "Lab Dip Approval", plannedQuantity: 10000, completedQuantity: 10000 },
      { id: "os-2", stageCode: "KNITTING", stageName: "Knitting", plannedQuantity: 10000, completedQuantity: 10000 },
      { id: "os-3", stageCode: "DYEING", stageName: "Dyeing", plannedQuantity: 10000, completedQuantity: 10000 },
      { id: "os-4", stageCode: "STITCHING", stageName: "Stitching", plannedQuantity: 10000, completedQuantity: 8500 },
      { id: "os-5", stageCode: "PACKING", stageName: "Packing", plannedQuantity: 10000, completedQuantity: 6000 },
      { id: "os-6", stageCode: "DISPATCH", stageName: "Dispatch", plannedQuantity: 10000, completedQuantity: 0 }
    ],
    materialMovements: [],
    reworkTickets: [{ id: "rw-1", sourceStageCode: "STITCHING", quantity: 300, reason: "Stitching defects", resolvedQuantity: 0, scrapQuantity: 0 }],
  }
];

const events: Array<{
  id: string;
  factoryId: string;
  orderId?: string;
  type: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}> = [
  {
    id: "event-1",
    factoryId: "factory-rishi",
    orderId: "order-1001",
    type: "ORDER_CREATED",
    message: "Order ORD-1001 created.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString()
  },
  {
    id: "event-2",
    factoryId: "factory-rishi",
    orderId: "order-1001",
    type: "MATERIAL_MOVED",
    message: "8500 units moved to STITCHING.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
  },
  {
    id: "event-3",
    factoryId: "factory-rishi",
    orderId: "order-1001",
    type: "REWORK_CREATED",
    message: "300 units sent to rework from STITCHING.",
    createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString()
  }
];

const uploads: Array<Record<string, unknown>> = [];

function addEvent(input: { factoryId: string; orderId?: string; type: string; message: string; metadata?: Record<string, unknown> }) {
  const event = {
    id: id("event"),
    createdAt: new Date().toISOString(),
    ...input
  };
  events.unshift(event);
  return event;
}

function dashboardPayload() {
  const now = Date.now();
  const sevenDays = now + 1000 * 60 * 60 * 24 * 7;
  const running = orders.filter((order) => order.status === "RUNNING").length;
  const delayed = orders.filter((order) => order.status !== "DISPATCHED" && new Date(order.deliveryDate).getTime() < now).length;
  const atRisk = orders.filter((order) => order.status === "AT_RISK").length;
  const upcoming = orders.filter((order) => {
    const delivery = new Date(order.deliveryDate).getTime();
    return order.status !== "DISPATCHED" && delivery >= now && delivery <= sevenDays;
  });

  return {
    metrics: {
      ordersRunning: running,
      ordersDelayed: delayed,
      ordersAtRisk: atRisk,
      upcomingDeliveries: upcoming.length
    },
    upcomingDeliveries: upcoming,
    orderJourneyStatus: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      buyerName: order.buyerName,
      productCategory: order.productCategory,
      orderQuantity: order.orderQuantity,
      currentStageCode: order.currentStageCode,
      deliveryDate: order.deliveryDate,
      status: order.status,
      completedAcrossStages: order.stages.reduce((sum, stage) => sum + stage.completedQuantity, 0),
      reworkQuantity: order.reworkTickets.reduce((sum, ticket) => sum + Number(ticket.quantity ?? 0), 0)
    })),
    recentEvents: events.slice(0, 20)
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rishi-fabrics-mock-api" });
});

app.get("/factories", (_req, res) => {
  res.json(factories);
});

app.post("/factories", (req, res) => {
  const factory = {
    id: id("factory"),
    name: String(req.body.name ?? "New Factory"),
    code: String(req.body.code ?? `F${factories.length + 1}`),
    workingDays: req.body.workingDays ?? ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    shiftsPerDay: Number(req.body.shiftsPerDay ?? 1),
    workingHoursPerDay: Number(req.body.workingHoursPerDay ?? 8)
  };
  factories.push(factory);
  addEvent({ factoryId: factory.id, type: "FACTORY_CREATED", message: `Factory ${factory.name} created.` });
  res.status(201).json(factory);
});

app.get("/workflows", (_req, res) => {
  res.json(workflows);
});

app.post("/workflows", (req, res) => {
  const stageLines = String(req.body.stagesText ?? "Knitting\nDyeing\nStitching\nPacking\nDispatch")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const workflow: Workflow = {
    id: id("workflow"),
    factoryId: String(req.body.factoryId ?? factories[0].id),
    name: String(req.body.name ?? "New Workflow"),
    description: String(req.body.description ?? ""),
    stages: stageLines.map((stageName, index) => {
      const code = stageName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
      return {
        id: id("stage"),
        name: stageName,
        code,
        kind: index === 0 ? "MANUAL" : code.includes("DISPATCH") ? "HYBRID" : "AUTOMATIC",
        sequence: index + 1,
        isDispatchStage: code.includes("DISPATCH")
      };
    })
  };

  workflows.push(workflow);
  res.status(201).json(workflow);
});

app.get("/orders", (_req, res) => {
  res.json(orders);
});

app.post("/orders", (req, res) => {
  const workflow = workflows.find((item) => item.id === req.body.workflowTemplateId) ?? workflows[0];
  const quantity = Number(req.body.orderQuantity ?? 0);
  const order: Order = {
    id: id("order"),
    factoryId: String(req.body.factoryId ?? factories[0].id),
    workflowTemplateId: workflow.id,
    orderNumber: String(req.body.orderNumber ?? `ORD-${orders.length + 1001}`),
    buyerName: String(req.body.buyerName ?? "New Buyer"),
    productCategory: String(req.body.productCategory ?? "Garments"),
    orderQuantity: quantity,
    currentStageCode: workflow.stages[0]?.code ?? "NOT_STARTED",
    deliveryDate: String(req.body.deliveryDate ?? new Date().toISOString()),
    status: "RUNNING",
    stages: workflow.stages.map((stage) => ({
      id: id("order-stage"),
      stageCode: stage.code,
      stageName: stage.name,
      plannedQuantity: quantity,
      completedQuantity: 0
    })),
    materialMovements: [],
    reworkTickets: []
  };
  orders.unshift(order);
  addEvent({ factoryId: order.factoryId, orderId: order.id, type: "ORDER_CREATED", message: `Order ${order.orderNumber} created.` });
  res.status(201).json(order);
});

app.get("/orders/:id", (req, res) => {
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json({
    ...order,
    workflowTemplate: workflows.find((workflow) => workflow.id === order.workflowTemplateId),
    events: events.filter((event) => event.orderId === order.id)
  });
});

app.post("/orders/:id/movements", (req, res) => {
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const quantity = Number(req.body.quantity ?? 0);
  const toStageCode = String(req.body.toStageCode ?? order.currentStageCode);
  const movementType = String(req.body.movementType ?? "FORWARD");
  const targetStage = order.stages.find((stage) => stage.stageCode === toStageCode);

  if (!targetStage || quantity <= 0) {
    res.status(400).json({ error: "Valid target stage and quantity are required" });
    return;
  }

  targetStage.completedQuantity = Math.min(targetStage.plannedQuantity, targetStage.completedQuantity + quantity);
  order.currentStageCode = toStageCode;
  if (movementType === "DISPATCH" || toStageCode === "DISPATCH") {
    order.status = "DISPATCHED";
  }

  const movement = {
    id: id("movement"),
    fromStageCode: req.body.fromStageCode,
    toStageCode,
    quantity,
    movementType,
    notes: req.body.notes,
    createdAt: new Date().toISOString()
  };
  order.materialMovements.unshift(movement);
  addEvent({
    factoryId: order.factoryId,
    orderId: order.id,
    type: movementType === "DISPATCH" ? "DISPATCH_COMPLETED" : "MATERIAL_MOVED",
    message: `${quantity} units moved to ${toStageCode}.`,
    metadata: movement
  });
  res.status(201).json(movement);
});

app.post("/orders/:id/rework", (req, res) => {
  const order = orders.find((item) => item.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const ticket = {
    id: id("rework"),
    sourceStageCode: String(req.body.sourceStageCode ?? order.currentStageCode),
    quantity: Number(req.body.quantity ?? 0),
    reason: String(req.body.reason ?? "Rework required"),
    resolvedQuantity: 0,
    scrapQuantity: 0,
    createdAt: new Date().toISOString()
  };
  order.reworkTickets.unshift(ticket);
  addEvent({
    factoryId: order.factoryId,
    orderId: order.id,
    type: "REWORK_CREATED",
    message: `${ticket.quantity} units sent to rework from ${ticket.sourceStageCode}.`,
    metadata: ticket
  });
  res.status(201).json(ticket);
});

app.get("/uploads", (_req, res) => {
  res.json(uploads);
});

app.post("/uploads", (req, res) => {
  const upload = {
    id: id("upload"),
    fileName: String(req.body.fileName ?? "manual-import.csv"),
    sourceType: String(req.body.sourceType ?? "CSV"),
    status: "PREVIEW_READY",
    rowsReceived: Number(req.body.rowsReceived ?? 25),
    rowsAccepted: Number(req.body.rowsAccepted ?? 22),
    rowsRejected: Number(req.body.rowsRejected ?? 3),
    createdAt: new Date().toISOString()
  };
  uploads.unshift(upload);
  addEvent({ factoryId: factories[0].id, type: "IMPORT_CREATED", message: `Upload ${upload.fileName} received.` });
  res.status(201).json(upload);
});

app.get("/dashboard/control-tower", (_req, res) => {
  res.json(dashboardPayload());
});

app.listen(port, () => {
  console.log(`Mock API running on http://localhost:${port}`);
});
