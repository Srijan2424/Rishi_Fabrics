import { Router } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { requirePermission } from "../../security/rbac.js";
import { getObject, uploadObject } from "../../services/storage.js";
import { recordWorkLog } from "../work-logs/work-log.service.js";

export const techPackRouter = Router();
const maxTechPackFileSizeMb = Number(process.env.TECH_PACK_MAX_FILE_MB ?? 100);
const maxTechPackFiles = Number(process.env.TECH_PACK_MAX_FILES ?? 20);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxTechPackFileSizeMb * 1024 * 1024,
    files: maxTechPackFiles
  }
});
const execFileAsync = promisify(execFile);
const previewRoot = path.resolve(process.cwd(), ".generated", "tech-pack-previews");

const samplingCheckpoints = [
  {
    checkpointCode: "LAB_DIP_APPROVAL",
    label: "Lab Dip Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval comment or shade confirmation"
  },
  {
    checkpointCode: "FOB_APPROVAL",
    label: "FOB Approval by Buyer",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer approval or revised costing confirmation"
  },
  {
    checkpointCode: "PO",
    label: "P.O",
    owner: "Merchant",
    timeframe: "Required before production lock",
    evidence: "Purchase order reference"
  },
  {
    checkpointCode: "FABRIC_CUTTING_SWATCH",
    label: "Fabric Cutting Swatch",
    owner: "Sampling / Fabric",
    timeframe: "Internal",
    evidence: "Swatch cutting status"
  },
  {
    checkpointCode: "SIZE_RATIO",
    label: "Size Ratio",
    owner: "Merchant",
    timeframe: "Qty in pcs",
    evidence: "Ratio quantity confirmation"
  },
  {
    checkpointCode: "TRIMS_CARD",
    label: "Trims Card with Trims",
    owner: "Merchant / Store",
    timeframe: "Internal",
    evidence: "Trim card image or checklist"
  },
  {
    checkpointCode: "PP_COMMENTS",
    label: "P.P Comments from Buyer Side",
    owner: "Merchant",
    timeframe: "Variable",
    evidence: "Buyer comments and revision notes"
  },
  {
    checkpointCode: "PP_SEALER_GARMENT",
    label: "PP Sealer Garment",
    owner: "Sampling",
    timeframe: "Before bulk approval",
    evidence: "Sealer garment approval"
  },
  {
    checkpointCode: "FPT",
    label: "FPT",
    owner: "Merchant / Quality",
    timeframe: "Before bulk production",
    evidence: "FPT approval status or report reference"
  },
  {
    checkpointCode: "GPT",
    label: "GPT",
    owner: "Merchant / Quality",
    timeframe: "Before shipment approval",
    evidence: "GPT approval status or report reference"
  },
  {
    checkpointCode: "SIZE_SET_APPROVAL",
    label: "Size Set Approval",
    owner: "Merchant / Buyer",
    timeframe: "Variable, domestic only",
    evidence: "Domestic size set approval"
  }
];

function normalizeText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\r/g, "\n");
}

function field(text: string, label: string, nextLabels: string[]) {
  const alternatives = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`${label}\\s+([\\s\\S]*?)(?=\\n?(?:${alternatives})\\s+|$)`, "i");
  return text.match(regex)?.[1]?.replace(/\n+/g, " ").trim() || "";
}

const STYLE_LABEL_PATTERN = [
  "style\\s*(?:no\\.?|number|code|#)?",
  "article\\s*(?:no\\.?|number|code|#)?",
  "item\\s*(?:no\\.?|number|code|#)?",
  "product\\s*(?:no\\.?|number|code|#)?",
  "design\\s*(?:no\\.?|number|code|#)?"
].join("|");

function cleanStyleNumber(input: string) {
  return input
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^A-Z0-9-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function looksLikeStyleNumber(value: string) {
  const cleaned = cleanStyleNumber(value);
  if (cleaned.length < 6 || cleaned.length > 80) return false;
  if (!/[A-Z]/.test(cleaned) || !/\d/.test(cleaned)) return false;
  if (!cleaned.includes("-")) return false;
  if (/^(SEASON|DATE|BRAND|CATEGORY|DESIGNER|FABRIC|TRIMS)$/i.test(cleaned)) return false;
  return true;
}

function extractStyleNumber(text: string, fileName: string) {
  return extractStyleMatches(text)[0]?.styleNumber ||
    cleanStyleNumber(fileName.match(/[A-Z0-9]+(?:[-_\s]+[A-Z0-9]+){2,}/i)?.[0] ?? "") ||
    "";
}

function extractStyleMatches(text: string) {
  const normalized = normalizeText(text).replace(/[\u2010-\u2015]/g, "-");
  const labelRegex = new RegExp("\\b(?:" + STYLE_LABEL_PATTERN + ")\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9\\s\\-_/]{4,90})", "gi");
  const looseRegex = /\b([A-Z]{1,6}\d{2,4}(?:\s*-\s*[A-Z0-9]{1,20}){2,8})\b/gi;
  const candidates = [
    ...Array.from(normalized.matchAll(labelRegex)),
    ...Array.from(normalized.matchAll(looseRegex))
  ].map((match) => {
    const raw = match[1].split(/\s+(?:DESIGNER|POINT|FABRIC|TRIMS|SEASON|DATE|BRAND|CATEGORY|COL(?:OU)?R|COLOR)\b/i)[0] ?? match[1];
    return {
      styleNumber: cleanStyleNumber(raw),
      index: match.index ?? 0
    };
  }).filter((match) => looksLikeStyleNumber(match.styleNumber));
  const seen = new Set<string>();

  return candidates.filter((match) => {
    if (seen.has(match.styleNumber)) return false;
    seen.add(match.styleNumber);
    return true;
  });
}

function parseTechPack(text: string, fileName: string) {
  const clean = normalizeText(text);
  const labels = [
    "Style Code", "Description 1", "Description 2", "Style Type", "Trend", "Story", "Fashion Pyramid",
    "Colorways", "Department", "Brand/Division", "Season", "Size Range", "Sizes", "Base Size",
    "Default Color", "Product Description\\(Key\\s*Attributes\\)", "Designers", "Garment Finish",
    "Assortment Group", "Collection Name", "Sourcing Champion", "Main Materials List", "Fabric Material Sub Type"
  ];

  const colorMatches = Array.from(clean.matchAll(/\\bCOL(?:OU)?R?\\s*[\\u2010-\\u2015-]?\\s*([A-Z][A-Z\\s/&-]{1,40})/gi))
    .map((match) => match[1].replace(/\\s+/g, " ").trim())
    .filter(Boolean);

  return {
    styleNumber: extractStyleNumber(clean, fileName),
    styleCode: field(clean, "Style Code", labels) || field(clean, "Style No", labels) || field(clean, "Style Number", labels),
    descriptionOne: field(clean, "Description 1", labels) || field(clean, "Product Description", labels) || field(clean, "Category", labels),
    descriptionTwo: field(clean, "Description 2", labels),
    styleType: field(clean, "Style Type", labels) || field(clean, "Category", labels),
    colorways: field(clean, "Colorways", labels) || Array.from(new Set(colorMatches)).join(", "),
    department: field(clean, "Department", labels) || field(clean, "Category", labels),
    brandDivision: field(clean, "Brand/Division", labels) || field(clean, "Brand", labels),
    season: field(clean, "Season", labels),
    sizeRange: field(clean, "Size Range", labels),
    sizes: field(clean, "Sizes", labels),
    baseSize: field(clean, "Base Size", labels),
    productDescription: field(clean, "Product Description\\(Key\\s*Attributes\\)", labels) || field(clean, "Product Description", labels),
    mainMaterials: field(clean, "Main Materials List", labels) || field(clean, "Fabric", labels),
    sourcingChampion: field(clean, "Sourcing Champion", labels) || field(clean, "Designer", labels),
    supplier: field(clean, "Designated Supplier", labels),
    extractedText: clean.slice(0, 8000)
  };
}

function parseTechPackStyles(text: string, fileName: string) {
  const clean = normalizeText(text);
  const matches = extractStyleMatches(clean);

  if (matches.length === 0) {
    return [parseTechPack(clean, fileName)];
  }

  return matches.map((match, index) => {
    const nextMatch = matches[index + 1];
    const section = clean.slice(match.index, nextMatch?.index ?? clean.length);
    const parsed = parseTechPack(section, fileName);

    return {
      ...parsed,
      styleNumber: match.styleNumber,
      brandDivision: parsed.brandDivision || field(clean, "Brand/Division", [
        "Season", "Size Range", "Sizes", "Base Size", "Default Color", "Product Description\\(Key\\s*Attributes\\)"
      ]),
      season: parsed.season || field(clean, "Season", [
        "Size Range", "Sizes", "Base Size", "Default Color", "Product Description\\(Key\\s*Attributes\\)"
      ])
    };
  });
}

async function getStylePageMap(parser: any, pageCount: number) {
  const pageMap = new Map<string, number>();
  const safePageCount = Math.max(1, Math.min(pageCount || 1, 200));

  for (let pageNumber = 1; pageNumber <= safePageCount; pageNumber += 1) {
    try {
      const pageText = await parser.getText({ first: pageNumber, last: pageNumber });
      for (const match of extractStyleMatches(pageText.text ?? "")) {
        if (!pageMap.has(match.styleNumber)) {
          pageMap.set(match.styleNumber, pageNumber);
        }
      }
    } catch {
      break;
    }
  }

  return pageMap;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "style";
}

async function renderStylePreview(input: {
  buffer: Buffer;
  factoryId: string;
  uploadId: string;
  styleNumber: string;
  pageNumber: number;
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mct-tech-pack-"));
  const pdfPath = path.join(tempDir, "source.pdf");
  const fileName = `${input.uploadId}-${safeFilePart(input.styleNumber)}-p${input.pageNumber}`;
  const outputBase = path.join(previewRoot, fileName);
  const pdftoppmPaths = [
    process.env.PDFTOPPM_PATH,
    "pdftoppm",
    "/Users/srijanchopra/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm"
  ].filter(Boolean) as string[];

  try {
    await fs.mkdir(previewRoot, { recursive: true });
    await fs.writeFile(pdfPath, input.buffer);
    for (const pdftoppmPath of pdftoppmPaths) {
      try {
        await execFileAsync(pdftoppmPath, [
          "-f",
          String(input.pageNumber),
          "-l",
          String(input.pageNumber),
          "-png",
          "-singlefile",
          "-scale-to",
          "900",
          pdfPath,
          outputBase
        ]);
        const localUrl = `/tech-pack-previews/${fileName}.png`;
        const imagePath = `${outputBase}.png`;
        const imageBuffer = await fs.readFile(imagePath);
        const storageKey = `tech-pack-previews/${safeFilePart(input.factoryId)}/${input.uploadId}/${fileName}.png`;
        const stored = await uploadObject({
          key: storageKey,
          body: imageBuffer,
          contentType: "image/png"
        });
        return stored ?? { key: undefined, url: localUrl };
      } catch {
        continue;
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function storeSourcePdf(input: {
  factoryId: string;
  uploadId: string;
  index: number;
  originalName: string;
  buffer: Buffer;
}) {
  const key = `tech-pack-pdfs/${safeFilePart(input.factoryId)}/${input.uploadId}/${input.index + 1}-${safeFilePart(input.originalName)}.pdf`;
  return uploadObject({
    key,
    body: input.buffer,
    contentType: "application/pdf"
  });
}

async function ensureSamplingApprovals(orderId: string) {
  for (const checkpoint of samplingCheckpoints) {
    await prisma.samplingApproval.upsert({
      where: {
        orderId_checkpointCode: {
          orderId,
          checkpointCode: checkpoint.checkpointCode
        }
      },
      update: {},
      create: {
        orderId,
        ...checkpoint
      }
    });
  }
}

async function upsertSamplingOrderFromTechPack(input: {
  factoryId: string;
  styleNumber: string;
  productCategory: string;
  buyerName: string;
  colorways?: string;
}) {
  const workflow = await prisma.workflowTemplate.findFirst({
    where: {
      factoryId: input.factoryId,
      isActive: true
    },
    include: {
      stages: {
        orderBy: {
          sequence: "asc"
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (!workflow || workflow.stages.length === 0) {
    throw new Error("No active workflow is configured for sampling intake.");
  }

  const startStage = workflow.stages.find((stage) => stage.code === "LAB_DIP_APPROVAL") ?? workflow.stages[0];
  const deliveryDate = new Date();
  deliveryDate.setDate(deliveryDate.getDate() + 90);

  const existing = await prisma.order.findFirst({
    where: {
      factoryId: input.factoryId,
      orderNumber: input.styleNumber
    }
  });

  const order = existing
    ? await prisma.order.update({
      where: {
        id: existing.id
      },
      data: {
        buyerName: input.buyerName,
        productCategory: input.productCategory,
        currentStageCode: existing.currentStageCode ?? startStage.code,
        status: existing.status === "CANCELLED" ? "RUNNING" : existing.status
      }
    })
    : await prisma.order.create({
      data: {
        factoryId: input.factoryId,
        workflowTemplateId: workflow.id,
        orderNumber: input.styleNumber,
        buyerName: input.buyerName,
        productCategory: input.productCategory,
        orderQuantity: 1,
        deliveryDate,
        currentStageCode: startStage.code,
        stages: {
          create: workflow.stages.map((stage) => ({
            workflowStageId: stage.id,
            stageCode: stage.code,
            stageName: stage.name,
            plannedQuantity: 1
          }))
        },
        orderLines: input.colorways ? {
          create: {
            buyerName: input.buyerName,
            styleName: input.styleNumber,
            colorName: input.colorways.slice(0, 120),
            description: input.productCategory,
            orderQuantity: 1,
            lastUpdatedAt: new Date()
          }
        } : undefined
      }
    });

  await ensureSamplingApprovals(order.id);
  return order;
}

techPackRouter.get(
  "/styles",
  requirePermission("VIEW_SAMPLING"),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.query.factoryId ?? req.authUser?.factoryId ?? "");
    const styles = await prisma.techPackStyle.findMany({
      where: factoryId ? { factoryId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200
    });

    res.json(styles);
  })
);

techPackRouter.get(
  "/assets/*",
  requirePermission("VIEW_SAMPLING"),
  asyncRoute(async (req, res) => {
    const key = String(req.params[0] ?? "");
    if (!key) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const object = await getObject(key);
    if (!object) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    res.type(object.contentType).send(object.body);
  })
);

techPackRouter.post(
  "/upload",
  requirePermission("MANAGE_SAMPLING"),
  upload.array("files", 20),
  asyncRoute(async (req, res) => {
    const factoryId = String(req.body.factoryId ?? req.authUser?.factoryId ?? "");
    const files = (req.files ?? []) as Express.Multer.File[];

    if (!factoryId) {
      res.status(400).json({ error: "factoryId is required." });
      return;
    }

    if (files.length === 0) {
      res.status(400).json({ error: "At least one tech-pack PDF is required." });
      return;
    }

    const uploadRecord = await prisma.upload.create({
      data: {
        factoryId,
        fileName: files.map((file) => file.originalname).join(", ").slice(0, 250),
        sourceType: "TECH_PACK:PDF",
        status: "APPLIED",
        rowsReceived: files.length,
        rowsAccepted: 0,
        rowsRejected: 0,
        errors: []
      }
    });

    const accepted = [];
    const alreadyUploaded = [];
    const rejected = [];

    for (const [index, file] of files.entries()) {
      try {
        if (!file.originalname.toLowerCase().endsWith(".pdf")) {
          throw new Error("Only PDF tech packs are supported.");
        }

        const sourceFile = await storeSourcePdf({
          factoryId,
          uploadId: uploadRecord.id,
          index,
          originalName: file.originalname,
          buffer: file.buffer
        });

        const parser = new PDFParse({ data: file.buffer });
        const parsedPdf = await parser.getText();
        const pageCount = Number((parsedPdf as any).total ?? (parsedPdf as any).pages ?? 1) || 1;
        const stylePageMap = await getStylePageMap(parser, pageCount);
        await parser.destroy();
        const parsedStyles = parseTechPackStyles(parsedPdf.text, file.originalname);

        if (parsedStyles.length === 0 || parsedStyles.every((style) => !style.styleNumber)) {
          throw new Error("Could not extract style number.");
        }

        for (const parsed of parsedStyles) {
          if (!parsed.styleNumber) {
            continue;
          }

          const existingStyle = await prisma.techPackStyle.findFirst({
            where: {
              factoryId,
              styleNumber: parsed.styleNumber
            },
            orderBy: {
              createdAt: "desc"
            }
          });
          const existingOrder = await prisma.order.findFirst({
            where: {
              factoryId,
              orderNumber: parsed.styleNumber
            }
          });

          if (existingStyle || existingOrder) {
            if (existingStyle && !existingStyle.previewImageUrl) {
              const previewPageNumber = stylePageMap.get(parsed.styleNumber) ?? 1;
              const previewImageUrl = await renderStylePreview({
                buffer: file.buffer,
                factoryId,
                uploadId: uploadRecord.id,
                styleNumber: parsed.styleNumber,
                pageNumber: previewPageNumber
              });

              if (previewImageUrl) {
                await prisma.techPackStyle.update({
                  where: {
                    id: existingStyle.id
                  },
                  data: {
                    previewImageUrl: previewImageUrl.url,
                    previewImageStorageKey: previewImageUrl?.key,
                    previewPageNumber
                  }
                });
              }
            }

            alreadyUploaded.push({
              styleNumber: parsed.styleNumber,
              sourceFileName: existingStyle?.sourceFileName ?? file.originalname,
              samplingOrderId: existingOrder?.id,
              message: `${parsed.styleNumber} is already uploaded.`
            });
            if (existingOrder) {
              await ensureSamplingApprovals(existingOrder.id);
            }
            continue;
          }

          const previewPageNumber = stylePageMap.get(parsed.styleNumber) ?? 1;
          const previewImageUrl = await renderStylePreview({
            buffer: file.buffer,
            factoryId,
            uploadId: uploadRecord.id,
            styleNumber: parsed.styleNumber,
            pageNumber: previewPageNumber
          });

          const saved = await prisma.techPackStyle.create({
            data: {
              factoryId,
              uploadId: uploadRecord.id,
              sourceFileName: file.originalname,
              sourceFileUrl: sourceFile?.url ?? null,
              sourceFileStorageKey: sourceFile?.key ?? null,
              uploadedBy: req.authUser?.id,
              previewImageUrl: previewImageUrl?.url,
              previewImageStorageKey: previewImageUrl?.key,
              previewPageNumber,
              ...parsed
            }
          });
          const order = await upsertSamplingOrderFromTechPack({
            factoryId,
            styleNumber: parsed.styleNumber,
            buyerName: parsed.brandDivision || parsed.department || "Tech Pack",
            productCategory: parsed.descriptionOne || parsed.descriptionTwo || parsed.styleType || "Tech Pack Sampling",
            colorways: parsed.colorways
          });
          accepted.push({
            ...saved,
            samplingOrderId: order.id,
            orderNumber: order.orderNumber
          });
        }
      } catch (error) {
        rejected.push({
          rowNumber: index + 1,
          fileName: file.originalname,
          errors: [error instanceof Error ? error.message : "Could not parse tech pack."]
        });
      }
    }

    await prisma.upload.update({
      where: { id: uploadRecord.id },
      data: {
        status: rejected.length ? "PREVIEW_HAS_ERRORS" : "APPLIED",
        rowsAccepted: accepted.length,
        rowsRejected: rejected.length,
        errors: JSON.parse(JSON.stringify({
          rejected,
          alreadyUploaded
        }))
      }
    });

    await recordWorkLog({
      factoryId,
      userId: req.authUser?.id,
      module: "SAMPLING",
      action: "Tech pack uploaded",
      itemType: "upload",
      itemId: uploadRecord.id,
      itemLabel: uploadRecord.fileName,
      metadata: { accepted: accepted.length, rejected: rejected.length, alreadyUploaded: alreadyUploaded.length }
    });

    res.status(201).json({
      uploadId: uploadRecord.id,
      status: rejected.length ? "PARTIAL" : "APPLIED",
      acceptedRows: accepted,
      alreadyUploadedRows: alreadyUploaded,
      rejectedRows: rejected
    });
  })
);
