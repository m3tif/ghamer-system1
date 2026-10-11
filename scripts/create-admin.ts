/* Creates the first Super Admin. Usage:
   ADMIN_EMAIL=you@company.com ADMIN_NAME="اسمك" ADMIN_PASSWORD='...' npm run admin:create */
import { Client } from "pg";
import { hash } from "@node-rs/argon2";

async function main() {
  const url = process.env.DATABASE_URL_ADMIN, email = process.env.ADMIN_EMAIL?.toLowerCase(), name = process.env.ADMIN_NAME, pw = process.env.ADMIN_PASSWORD;
  if (!url || !email || !name || !pw) { console.error("Set DATABASE_URL_ADMIN, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD"); process.exit(1); }
  if (pw.length < 10 || !/\d/.test(pw)) { console.error("Password must be at least 10 characters and contain a digit"); process.exit(1); }
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    await c.query("begin");
    const u = await c.query(
      "insert into users(email, password_hash, role_id, must_change_password) select $1, $2, id, true from roles where code = 'super_admin' returning id",
      [email, await hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 })]);
    await c.query("insert into employees(id, full_name, department_id) select $1, $2, id from departments where code = 'management'", [u.rows[0].id, name]);
    await c.query("commit");
    console.log(`✓ Super Admin created: ${email}\n  Sign in, then you will be asked to change the password and enrol two-factor authentication.`);
  } catch (e) { await c.query("rollback"); console.error((e as Error).message); process.exit(1); } finally { await c.end(); }
}
main();
