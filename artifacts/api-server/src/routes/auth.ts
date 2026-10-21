import { Router } from "express";
import passport from "passport";

const router = Router();

router.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login.html" }),
  (req, res) => {
    const user = req.user as { accessGranted?: boolean } | undefined;
    if (user && user.accessGranted) {
      res.redirect("/");
    } else {
      res.redirect("/verify.html");
    }
  }
);

router.get("/auth/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect("/login.html");
    });
  });
});

export default router;
