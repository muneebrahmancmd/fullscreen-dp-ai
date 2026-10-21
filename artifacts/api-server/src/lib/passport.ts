import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { getDb, User } from "./db.js";
import { sendNewUserNotification } from "./email.js";
import { isAdminUser } from "./admin.js";

export function setupPassport(): void {
  const clientID = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const appUrl = process.env["APP_URL"];

  if (!clientID || !clientSecret || !appUrl) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL are required");
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: `${appUrl}/api/auth/google/callback`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const db = getDb();
          db.read();

          const email = profile.emails?.[0]?.value || "";
          const picture = profile.photos?.[0]?.value || "";

          let user = db.get("users").find({ id: profile.id }).value() as User | undefined;
          const isAdmin = isAdminUser({ email });

          if (!user) {
            const newUser: User = {
              id: profile.id,
              email,
              name: profile.displayName || "",
              picture,
              approved: isAdmin,
              accessGranted: isAdmin,
              revoked: false,
              createdAt: new Date().toISOString(),
            };
            db.get("users").push(newUser).write();
            user = newUser;

            // Notify admin of new registration (fire-and-forget, non-blocking)
            if (!isAdmin) {
              sendNewUserNotification({
                name: newUser.name,
                email: newUser.email,
                createdAt: newUser.createdAt,
              }).catch(() => { /* ignore email errors */ });
            }
          } else if (isAdmin) {
            const adminAccess = { approved: true, accessGranted: true, revoked: false };
            db.get("users").find({ id: profile.id }).assign(adminAccess).write();
            user = { ...user, ...adminAccess };
          }

          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      }
    )
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser((id: string, done) => {
    try {
      const db = getDb();
      db.read();
      const user = db.get("users").find({ id }).value() as User | undefined;
      done(null, user || false);
    } catch (err) {
      done(err as Error);
    }
  });
}
