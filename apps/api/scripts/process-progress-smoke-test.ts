import assert from "node:assert/strict";
import { calculateFullOrderProcessProgress, productionProcessWeights } from "../src/core/progress/process-progress.service.js";

const report = calculateFullOrderProcessProgress({
  orderQuantity: 100000,
  quantities: {
    KNITTING: 100000,
    DYEING: 80000,
    CUTTING: 60000,
    STITCHING: 30000,
    FINISHING: 20000,
    PACKING: 10000
  }
});

assert.equal(Object.values(productionProcessWeights).reduce((sum, value) => sum + value, 0), 100);
assert.equal(report.overallProgressPercent, 64.8);
assert.equal(report.components.find((component) => component.process === "KNITTING")?.contributionPercent, 36);
assert.equal(report.components.find((component) => component.process === "PACKING")?.contributionPercent, 0.4);

const capped = calculateFullOrderProcessProgress({
  orderQuantity: 1000,
  quantities: {
    KNITTING: 1500,
    DYEING: 1000,
    CUTTING: 1000,
    STITCHING: 1000,
    FINISHING: 1000,
    PACKING: 1000
  }
});

assert.equal(capped.overallProgressPercent, 100);
assert.equal(capped.components[0].quantity, 1500);
assert.equal(capped.components[0].cappedQuantity, 1000);

const empty = calculateFullOrderProcessProgress({
  orderQuantity: 0,
  quantities: {
    KNITTING: 100
  }
});

assert.equal(empty.overallProgressPercent, 0);

console.log("Process progress smoke test passed.");
console.table(report.components.map((component) => ({
  process: component.process,
  qty: component.quantity,
  completion: component.completionPercent,
  weight: component.weightPercent,
  contribution: component.contributionPercent
})));
