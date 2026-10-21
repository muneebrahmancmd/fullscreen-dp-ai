import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { Server as SocketIOServer } from "socket.io";

function getChromiumPath(): string {
  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execSync(`which ${cmd}`, { encoding: "utf8" }).trim();
      if (p) return p;
    } catch {
      // not found, try next
    }
  }
  throw new Error("No Chromium/Chrome browser found. Install chromium system package.");
}

const STEP_PERCENTAGES = [12, 30, 48, 65, 85, 100];

let activeClient: Client | null = null;
const AUTH_DATA_PATH = ".wwebjs_auth";

function emitStep(
  io: SocketIOServer,
  socketId: string,
  index: number,
  status: "active" | "done"
) {
  io.to(socketId).emit("step", { index, status });
}

function forceCleanup(): void {
  // Kill any lingering browser processes
  try { execSync("pkill -9 -f chromium", { stdio: "ignore" }); } catch { /* none running */ }
  try { execSync("pkill -9 -f chrome", { stdio: "ignore" }); } catch { /* none running */ }

  // Wipe the entire auth directory so we always start with a fresh pairing-code
  // flow. Without this, LocalAuth reloads the previous (now-invalidated) session
  // and WhatsApp immediately sends LOGOUT before any QR/pairing event.
  const authDir = path.join(process.cwd(), AUTH_DATA_PATH);
  try {
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
}

// Process image to 9:16 format — runs early (in parallel while user enters code)
async function processImage(filePath: string): Promise<{ thumbB64: string; fullB64: string }> {
  const [thumbBuf, fullBuf] = await Promise.all([
    // Small square for chat-list circle (ratio irrelevant there)
    sharp(filePath)
      .resize(96, 96, { fit: "cover", position: "centre" })
      .jpeg({ quality: 80 })
      .toBuffer(),
    // Full 9:16 shown when DP is tapped — NO square crop
    sharp(filePath)
      .resize(360, 640, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
        withoutEnlargement: false,
      })
      .jpeg({ quality: 95 })
      .toBuffer(),
  ]);
  return {
    thumbB64: thumbBuf.toString("base64"),
    fullB64: fullBuf.toString("base64"),
  };
}

interface WhatsAppOptions {
  phone: string;
  filePath: string;
  socketId: string;
  io: SocketIOServer;
}

export async function processWhatsApp({
  phone,
  filePath,
  socketId,
  io,
}: WhatsAppOptions): Promise<void> {
  let client: Client | null = null;

  try {
    // Cleanup previous session
    if (activeClient) {
      try { await activeClient.destroy(); } catch { /* ignore */ }
      activeClient = null;
    }
    forceCleanup();

    emitStep(io, socketId, 0, "active");

    // ── Start image processing NOW — runs while user enters pairing code ──────
    // By the time WhatsApp connects, the image is already ready.
    const imagePromise = processImage(filePath);

    client = new Client({
      authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
      puppeteer: {
        executablePath: getChromiumPath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--metrics-recording-only",
          "--mute-audio",
        ],
        headless: true,
      },
    });

    activeClient = client;

    // Pairing-code flow:
    // qr event → requestPairingCode → emit code to frontend → user enters on phone → ready
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      const timeout = setTimeout(() => {
        done(() => reject(new Error("Timed out — make sure the number is correct and try again")));
      }, 90000);

      let pairingRequested = false;

      client!.on("qr", async () => {
        if (pairingRequested) return;
        pairingRequested = true;
        try {
          const code = await client!.requestPairingCode(phone);
          io.to(socketId).emit("paircode", { code });
        } catch (err) {
          done(() => reject(new Error("Failed to get pairing code — check the phone number format")));
        }
      });

      client!.once("ready", () => {
        done(() => resolve());
      });

      client!.once("auth_failure", (msg: string) => {
        done(() => reject(new Error(`Auth failed: ${msg}`)));
      });

      // whatsapp-web.js fires "disconnected" with reason "auth timeout" when the
      // pairing code session expires — catch it here so it doesn't leak globally
      client!.once("disconnected", (reason: string) => {
        done(() => reject(new Error(`WhatsApp disconnected: ${reason}. Please try again.`)));
      });

      client!.initialize().catch((err: Error) => {
        done(() => reject(err));
      });
    });

    // Connection done — steps 1 & 2 complete
    emitStep(io, socketId, 1, "done");
    emitStep(io, socketId, 2, "done");

    // WhatsApp Web does an internal navigation/reload right after authentication
    // which destroys the Puppeteer execution context. Wait for it to settle.
    await new Promise((r) => setTimeout(r, 2000));

    // Image was processed in parallel — should already be done by now
    const { thumbB64, fullB64 } = await imagePromise;
    emitStep(io, socketId, 3, "done");

    // ── Set profile picture ───────────────────────────────────────────────────
    // Monkey-patch WWebJS.cropAndResizeImage so the normal setProfilePicture
    // flow (canSet, permissions, sendSetPicture) runs but uses our 9:16 images
    // instead of square-cropping them.
    //
    // Retry up to 3 times — if a stray navigation destroys the context we
    // wait 1 s and try again on the fresh page.
    let lastSetErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page = (client as any).pupPage;

        await page.evaluate((tb: string, fb: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const W = (globalThis as any).WWebJS;
          W._origCrop = W.cropAndResizeImage;
          W._customThumb = `data:image/jpeg;base64,${tb}`;
          W._customFull  = `data:image/jpeg;base64,${fb}`;
          W.cropAndResizeImage = (_media: unknown, opts: { size?: number }) =>
            Promise.resolve(opts?.size === 96 ? W._customThumb : W._customFull);
        }, thumbB64, fullB64);

        try {
          const media = MessageMedia.fromFilePath(filePath);
          await client.setProfilePicture(media);
        } finally {
          // Always restore — even if setProfilePicture throws
          await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const W = (globalThis as any).WWebJS;
            if (W._origCrop) { W.cropAndResizeImage = W._origCrop; delete W._origCrop; }
            delete W._customThumb; delete W._customFull;
          }).catch(() => { /* ignore cleanup errors */ });
        }

        lastSetErr = null;
        break; // success — exit retry loop
      } catch (err) {
        lastSetErr = err instanceof Error ? err : new Error(String(err));
        const isContextError = lastSetErr.message.includes("context") ||
                               lastSetErr.message.includes("navigation") ||
                               lastSetErr.message.includes("destroyed");
        if (isContextError && attempt < 3) {
          // Page navigated — wait for it to settle then retry
          await new Promise((r) => setTimeout(r, 1200));
        } else {
          break;
        }
      }
    }
    if (lastSetErr) throw lastSetErr;

    emitStep(io, socketId, 4, "done");
    emitStep(io, socketId, 5, "done");

    // ── Send confirmation message BEFORE logout (client must still be connected)
    try {
      await client.sendMessage(
        `${phone}@c.us`,
        `✅ *Fullscreen DP AI*\n\nBot aapke number se connect hua aur profile picture successfully set ho gayi hai!\n\nBot ab is device se unlink ho raha hai. 🔒`
      );
    } catch { /* ignore — message is bonus, not critical */ }

    io.to(socketId).emit("success");

    // ── Logout — unlinks bot from phone's Linked Devices ─────────────────────
    // Small wait so the logout signal reaches WhatsApp servers cleanly
    await new Promise((r) => setTimeout(r, 1500));
    try { await client.logout(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
    try { await client.destroy(); } catch { /* ignore */ }
    activeClient = null;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.to(socketId).emit("error", { message });

    if (client) {
      try { await client.logout(); } catch { /* ignore */ }
      try { await client.destroy(); } catch { /* ignore */ }
      if (activeClient === client) activeClient = null;
    }
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  void STEP_PERCENTAGES;
}
