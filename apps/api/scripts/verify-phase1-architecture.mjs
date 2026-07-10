import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");

const inventoryService = read("src/core/inventory/inventory.service.ts");
const workflowService = read("src/core/workflow-engine/workflow-engine.service.ts");
const workflowRoutes = read("src/modules/workflows/workflow-engine.routes.ts");
const server = read("src/server.ts");
const rbac = read("src/security/rbac.ts");

assert.match(inventoryService, /tx\.stageInventory\.update/, "InventoryService must update source inventory");
assert.match(inventoryService, /tx\.stageInventory\.upsert/, "InventoryService must upsert destination inventory");
assert.match(inventoryService, /tx\.materialMovement\.create/, "InventoryService must create MaterialMovement");
assert.match(inventoryService, /TimelineService\(tx\)\.createEvent|tx\.event\.create/, "InventoryService must create timeline Event");
assert.match(inventoryService, /InvalidInventoryQuantityError/, "InventoryService must reject invalid quantities");

assert.match(workflowService, /new InventoryService/, "WorkflowEngineService must depend on InventoryService");
assert.doesNotMatch(workflowService, /stageInventory\.update/, "WorkflowEngineService must not update StageInventory directly");
assert.match(workflowService, /validateTransition/, "WorkflowEngineService must validate transitions");
assert.match(workflowService, /"FORWARD"/, "WorkflowEngineService must validate forward transitions");
assert.match(workflowService, /"ROLLBACK"/, "WorkflowEngineService must validate rollback transitions");

assert.match(workflowRoutes, /requirePermission\("MOVE_INVENTORY"\)/, "Movement routes must require MOVE_INVENTORY");
assert.match(server, /attachDevAuth/, "Server must attach auth context");
assert.match(server, /rejectOversizedJson/, "Server must reject oversized JSON");

assert.match(rbac, /APPROVE_IMPORT/, "RBAC must include import approval permission");
assert.match(rbac, /MANAGE_USERS/, "RBAC must include user management permission");

console.log("Phase 1 architecture verification passed.");
