import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { asyncRoute } from "../../http.js";
import { createEvent } from "../events/event.service.js";

export const uploadsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const uploadQuerySchema = z.object({
  factoryId: z.string(),
  sourceType: z.enum(["EXCEL", "CSV", "PDF", "MANUAL"])
});

uploadsRouter.post("/", upload.single("file"), asyncRoute(async (req, res) => {
  const query = uploadQuerySchema.parse(req.query);

  if (!req.file) {
    res.status(400).json({ error: "File is required" });
    return;
  }

  const record = await prisma.upload.create({
    data: {
      factoryId: query.factoryId,
      fileName: req.file.originalname,
      sourceType: query.sourceType,
      status: "UPLOADED"
    }
  });

  await createEvent({
    factoryId: query.factoryId,
    type: "IMPORT_CREATED",
    message: `Upload ${req.file.originalname} received.`,
    metadata: {
      uploadId: record.id,
      mimeType: req.file.mimetype,
      size: req.file.size
    }
  });

  res.status(201).json({
    ...record,
    nextStep: "Add schema validation and preview parsing for this upload type."
  });
}));
