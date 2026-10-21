import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger.js";
import { setupPassport } from "./lib/passport.js";
import { initDb } from "./lib/db.js";
import apiRouter, { setSocketIO } from "./routes/api.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb();
setupPassport();

// whatsapp-web.js internally rejects promises with raw strings (e.g. "auth timeout")
// that are not catchable via try/catch in our code. Without this handler Node crashes.
process.on("unhandledRejection", (reason) => {
  logger.warn({ reason }, "Unhandled promise rejection (caught globally — server kept alive)");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception (caught globally — server kept alive)");
});

const app: Express = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
  path: "/api/socket.io",
});

setSocketIO(io);

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket connected");
  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket disconnected");
  });
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env["SESSION_SECRET"] || "fallback-secret-change-me";
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Static files (public folder)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.redirect("/login.html");
    return;
  }
  const user = req.user as { accessGranted?: boolean; revoked?: boolean };
  if (!user.accessGranted || user.revoked) {
    res.redirect("/verify.html");
    return;
  }
  next();
}

// API routes (under /api prefix)
app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", apiRouter);

// Protected root — serve index.html
app.get("/", requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Explicit routes for auth pages (no auth needed)
app.get("/login.html", (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.get("/verify.html", (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "verify.html"));
});

export { app, httpServer, io };
export default app;
