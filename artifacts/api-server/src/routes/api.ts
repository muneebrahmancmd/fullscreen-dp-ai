import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Server as SocketIOServer } from "socket.io";
import { getDb, User } from "../lib/db.js";
import { isAdminUser } from "../lib/admin.js";
import { sendAccessStatusNotification } from "../lib/email.js";
import { processWhatsApp } from "../lib/whatsapp.js";

const router = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `upload_${Date.now()}${ext}`);
  },
});

const upload = multer({ storage });

let io: SocketIOServer | null = null;

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!isAdminUser(req.user as User)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

function requireActiveAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as User;
  if (!user.accessGranted || user.revoked) {
    res.status(403).json({ error: "Access has not been granted for this account" });
    return;
  }
  next();
}

export function setSocketIO(socketIO: SocketIOServer) {
  io = socketIO;
}

router.get("/me", (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.user);
});

router.get("/admin/me", requireAdmin, (_req: Request, res: Response) => {
  res.json({ isAdmin: true });
});

router.get("/admin/users", requireAdmin, (_req: Request, res: Response) => {
  const db = getDb();
  db.read();
  const users = db.get("users").value() as User[];

  res.json({
    users: users
      .map(({ id, name, email, picture, createdAt, accessGranted, revoked }) => ({
        id,
        name,
        email,
        picture,
        createdAt,
        accessGranted: Boolean(accessGranted) && !revoked,
        revoked: Boolean(revoked),
        isAdmin: isAdminUser({ email }),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
});

router.post("/admin/users/:id/access", requireAdmin, (req: Request, res: Response) => {
  const action = req.body?.action;
  if (action !== "grant" && action !== "revoke") {
    res.status(400).json({ error: "Action must be grant or revoke" });
    return;
  }

  const db = getDb();
  db.read();
  const target = db.get("users").find({ id: req.params.id }).value() as User | undefined;
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (isAdminUser(target)) {
    res.status(400).json({ error: "Admin access cannot be changed here" });
    return;
  }

  const currentlyActive = Boolean(target.accessGranted) && !target.revoked;
  const currentlyRevoked = Boolean(target.revoked);
  const shouldNotify = action === "grant" ? !currentlyActive : !currentlyRevoked;
  const access = action === "grant"
    ? { approved: true, accessGranted: true, revoked: false }
    : { approved: false, accessGranted: false, revoked: true };
  db.get("users").find({ id: target.id }).assign(access).write();

  if (shouldNotify) {
    void sendAccessStatusNotification({
      name: target.name,
      email: target.email,
      action,
    });
  }

  res.json({ success: true, action });
});

router.post("/verify-code", (req: Request, res: Response) => {
  const { code } = req.body;
  const masterCode = process.env["MASTER_ACCESS_CODE"];

  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (code !== masterCode) {
    res.status(400).json({ error: "Invalid access code" });
    return;
  }

  const db = getDb();
  const user = req.user as { id: string };
  const dbUser = db.get("users").find({ id: user.id }).value();
  if (!dbUser) {
    res.status(404).json({ error: "User account not found" });
    return;
  }
  if (dbUser.revoked) {
    res.status(403).json({ error: "Access has been revoked. Contact the admin for help." });
    return;
  }
  if (dbUser) {
    db.get("users").find({ id: user.id }).assign({ approved: true, accessGranted: true }).write();
    (req.user as Record<string, unknown>).accessGranted = true;
    (req.user as Record<string, unknown>).approved = true;
  }

  res.json({ success: true });
});

router.post("/start", requireActiveAccess, upload.single("image"), async (req: Request, res: Response) => {
  const { phone, socketId } = req.body as { phone: string; socketId: string };
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "No image uploaded" });
    return;
  }

  if (!phone || !socketId) {
    res.status(400).json({ error: "Missing phone or socketId" });
    return;
  }

  res.json({ success: true });

  if (!io) return;

  const cleanPhone = phone.replace(/\D/g, "");
  processWhatsApp({ phone: cleanPhone, filePath: file.path, socketId, io });
});

export default router;
