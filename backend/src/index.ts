import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { mintVoiceToken } from "./vocalbridge/token.js";
import { toolsRouter } from "./tools/router.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// Backend token-proxy endpoint the Flutter app calls at connect time — keeps
// VOCAL_BRIDGE_API_KEY server-side, per Vocal Bridge's security guidance.
app.post("/api/voice-token", async (req, res, next) => {
  try {
    const participantName = req.body?.participant_name ?? "Nonstop User";
    const token = await mintVoiceToken(participantName);
    res.json(token);
  } catch (err) {
    next(err);
  }
});

// Photo/document upload so the Flutter app can hand Vocal Bridge's agent a URL it (and
// LandingAI ADE) can fetch — e.g. a passport photo captured mid-call for extract_travel_document.
const upload = multer({ dest: path.join(process.cwd(), "uploads") });
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.post("/uploads", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "multipart field 'file' is required" });
    return;
  }
  res.json({ url: `${config.publicBaseUrl}/uploads/${req.file.filename}` });
});

app.use("/tools", toolsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  const requestId = nanoid(6);
  console.error(`[error ${requestId}]`, err);
  res.status(500).json({ error: message, requestId });
});

app.listen(config.port, () => {
  console.log(`Nonstop backend listening on :${config.port}`);
});
