import { closeDatabase, connectDatabase } from "./db.js";
import { config } from "./config.js";

async function main() {
  if (!config.seedAdmin) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running seed:admin");
  }

  const db = await connectDatabase();
  const admin = await db.collection("users").findOne(
    { role: "admin", companyId: { $exists: false } },
    { projection: { email: 1 } },
  );

  if (!admin) throw new Error("Admin seed did not create a system admin account");
  console.info(`System admin seed applied: ${admin.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
