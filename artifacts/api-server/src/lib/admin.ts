import type { User } from "./db.js";

export const ADMIN_EMAIL = "muneebrahma.n500@gmail.com";

export function isAdminUser(user: Pick<User, "email"> | undefined): boolean {
  return user?.email.trim().toLowerCase() === ADMIN_EMAIL;
}