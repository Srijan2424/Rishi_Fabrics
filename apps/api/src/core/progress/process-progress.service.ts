import {
  ProcessProgressComponent,
  ProcessProgressInput,
  ProcessProgressReport,
  ProductionProcessKey
} from "./process-progress.types.js";

export const productionProcessWeights: Record<ProductionProcessKey, number> = {
  KNITTING: 36,
  DYEING: 18,
  CUTTING: 7,
  STITCHING: 28,
  FINISHING: 7,
  PACKING: 4
};

const processOrder: ProductionProcessKey[] = [
  "KNITTING",
  "DYEING",
  "CUTTING",
  "STITCHING",
  "FINISHING",
  "PACKING"
];

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function normalizeQuantity(value: number | undefined) {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.max(0, Math.round(value ?? 0));
}

export function calculateFullOrderProcessProgress(input: ProcessProgressInput): ProcessProgressReport {
  const orderQuantity = normalizeQuantity(input.orderQuantity);

  if (orderQuantity <= 0) {
    return {
      orderQuantity,
      overallProgressPercent: 0,
      components: processOrder.map((process) => ({
        process,
        quantity: 0,
        cappedQuantity: 0,
        completionPercent: 0,
        weightPercent: productionProcessWeights[process],
        contributionPercent: 0
      }))
    };
  }

  const components: ProcessProgressComponent[] = processOrder.map((process) => {
    const quantity = normalizeQuantity(input.quantities[process]);
    const cappedQuantity = Math.min(quantity, orderQuantity);
    const completionPercent = clampPercent((cappedQuantity / orderQuantity) * 100);
    const weightPercent = productionProcessWeights[process];
    const contributionPercent = clampPercent((cappedQuantity / orderQuantity) * weightPercent);

    return {
      process,
      quantity,
      cappedQuantity,
      completionPercent,
      weightPercent,
      contributionPercent
    };
  });

  return {
    orderQuantity,
    overallProgressPercent: clampPercent(
      components.reduce((sum, component) => sum + component.contributionPercent, 0)
    ),
    components
  };
}
