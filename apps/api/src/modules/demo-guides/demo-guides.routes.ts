import { Router } from "express";
import { asyncRoute } from "../../http.js";

export const demoGuidesRouter = Router();

type DemoStep = {
  title: string;
  body: string;
  preview: string;
};

type DemoGuide = {
  en: DemoStep[];
  hi: DemoStep[];
};

const guideCopy: Record<string, DemoGuide> = {
  ADMIN: {
    en: [
      { title: "Check website health", body: "Use Monitoring to see whether any page, upload, API, or workflow is failing.", preview: "Monitoring" },
      { title: "Understand each problem", body: "Read where the issue happened, what failed, and how it should be investigated or fixed.", preview: "Monitoring" },
      { title: "Manage users and access", body: "Use Settings to manage users, roles, login access, and two-factor setup.", preview: "Settings" },
      { title: "Review completed activity", body: "Use Work Logs to see completed system activity when you need an audit trail.", preview: "Work Logs" }
    ],
    hi: [
      { title: "वेबसाइट की स्थिति देखें", body: "Monitoring में देखें कि कोई पेज, अपलोड, एपीआई या काम करने की प्रक्रिया खराब तो नहीं है।", preview: "Monitoring" },
      { title: "समस्या समझें", body: "हर समस्या में देखें कि दिक्कत कहां आई, क्या खराब हुआ, और उसे कैसे जांचना या ठीक करना है।", preview: "Monitoring" },
      { title: "यूजर और एक्सेस संभालें", body: "Settings में यूजर, भूमिका, लॉगिन एक्सेस और दो-स्तरीय सुरक्षा संभालें।", preview: "Settings" },
      { title: "पूरे हुए काम की जांच करें", body: "जरूरत पड़ने पर Work Logs में देखें कि सिस्टम में कौन-सा काम पूरा हुआ था।", preview: "Work Logs" }
    ]
  },
  CEO: {
    en: [
      { title: "Review factory status", body: "Use Control Tower to see running orders, delays, risk, dispatch status, and upcoming deliveries.", preview: "Control Tower" },
      { title: "Read production reports", body: "Use Reports to check production, sampling, fabric, WIP, rejected rows, and dispatch summaries.", preview: "Reports" },
      { title: "Check completed work", body: "Use History to review completed sampling, fabric, and production by month.", preview: "History" }
    ],
    hi: [
      { title: "फैक्टरी की स्थिति देखें", body: "Control Tower में running orders, delay, risk, dispatch status और आने वाली deliveries देखें।", preview: "Control Tower" },
      { title: "Production reports देखें", body: "Reports में production, sampling, fabric, WIP, rejected rows और dispatch summary देखें।", preview: "Reports" },
      { title: "पूरा हुआ काम देखें", body: "History में महीने के हिसाब से पूरा हुआ sampling, fabric और production देखें।", preview: "History" }
    ]
  },
  ERP_MANAGER: {
    en: [
      { title: "Upload daily files", body: "Use Imports to upload Daily Production, WIP Report, Fabric / Dyeing, and Tech Pack files.", preview: "Imports" },
      { title: "Fix rejected rows", body: "After every upload, check rejected rows and correct the source file if anything failed.", preview: "Rejected Rows" },
      { title: "Create missing orders", body: "When Daily Production contains a new order, enter the delivery timeline so production tracking can start.", preview: "New Order" }
    ],
    hi: [
      { title: "रोज की फाइलें अपलोड करें", body: "Imports में Daily Production, WIP Report, Fabric / Dyeing और Tech Pack फाइलें अपलोड करें।", preview: "Imports" },
      { title: "गलत rows ठीक करें", body: "हर upload के बाद rejected rows देखें और गलती हो तो source file ठीक करें।", preview: "Rejected Rows" },
      { title: "नया order बनाएं", body: "Daily Production में नया order आए तो delivery timeline भरें, ताकि production tracking शुरू हो सके।", preview: "New Order" }
    ]
  },
  MERCHANT: {
    en: [
      { title: "Track sampling", body: "Use Sampling to see tech-pack styles, extracted style details, quantities, and approval status.", preview: "Sampling" },
      { title: "Update style details", body: "Open a style to correct the name, quantity, buyer, category, and sampling information.", preview: "Style Detail" },
      { title: "Complete approvals", body: "Update buyer approvals and move a style ahead only after all required checks are complete.", preview: "Approval" }
    ],
    hi: [
      { title: "Sampling देखें", body: "Sampling में tech-pack styles, style details, quantity और approval status देखें।", preview: "Sampling" },
      { title: "Style details ठीक करें", body: "किसी style को खोलकर name, quantity, buyer, category और sampling information ठीक करें।", preview: "Style Detail" },
      { title: "Approvals पूरे करें", body: "Buyer approvals अपडेट करें और सभी checks पूरे होने के बाद ही style को आगे बढ़ाएं।", preview: "Approval" }
    ]
  },
  HEAD_OF_OPERATIONS: {
    en: [
      { title: "Track order progress", body: "Use Orders to review production progress, pending quantities, and current stage for each order.", preview: "Orders" },
      { title: "Review fabric status", body: "Use Fabric to check dyeing status, shortages, in-house fabric, and dyeing party details.", preview: "Fabric" },
      { title: "Act on production risk", body: "Use Control Tower to identify delayed or at-risk orders and follow up with the responsible team.", preview: "Control Tower" }
    ],
    hi: [
      { title: "Order progress देखें", body: "Orders में हर order का production progress, pending quantity और current stage देखें।", preview: "Orders" },
      { title: "Fabric status देखें", body: "Fabric में dyeing status, shortage, in-house fabric और dyeing party details देखें।", preview: "Fabric" },
      { title: "Production risk पर action लें", body: "Control Tower में delayed या at-risk orders पहचानें और जिम्मेदार team से follow-up करें।", preview: "Control Tower" }
    ]
  }
};

demoGuidesRouter.get("/current", asyncRoute(async (req, res) => {
  const role = req.authUser?.role ?? "CEO";
  res.json({ role, languages: guideCopy[role] ?? guideCopy.CEO });
}));
