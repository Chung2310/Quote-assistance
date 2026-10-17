import { MongoClient, ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { Company, UserAccount } from "./types.js";

const client = new MongoClient(config.mongoUri, {
  appName: "bao-gia-ai-pilot",
  authSource: config.mongoAuthSource,
  ...(config.mongoUser && config.mongoPassword
    ? { auth: { username: config.mongoUser, password: config.mongoPassword } }
    : {}),
});
let connection: Promise<void> | undefined;

function normalizeCompanyName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

async function ensureCompany(db: Db, name: string): Promise<Company> {
  const companies = db.collection<Company>("companies");
  const normalizedName = normalizeCompanyName(name);
  const now = new Date();
  await companies.updateOne(
    { normalizedName },
    { $setOnInsert: { code: randomUUID(), name, normalizedName, createdAt: now, updatedAt: now } },
    { upsert: true },
  );
  const company = await companies.findOne({ normalizedName });
  if (!company) throw new Error(`Unable to create company record: ${name}`);
  return company;
}

async function migrateLegacyTenantData(db: Db, defaultCompany: Company) {
  const defaultCompanyId = defaultCompany._id;
  if (!defaultCompanyId) throw new Error("Default company record has no id");
  const defaultCompanyWithId = { ...defaultCompany, _id: defaultCompanyId };
  const dataCollections = ["catalogItems", "quoteRequests", "quotes", "auditLogs"];
  const legacyIds = new Set<string>();
  const existingCollections = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );
  for (const collectionName of dataCollections) {
    if (!existingCollections.has(collectionName)) continue;
    const ids = await db.collection(collectionName).distinct("tenantId");
    for (const id of ids) {
      if (typeof id !== "string") continue;
      legacyIds.add(id);
    }
  }

  for (const legacyId of legacyIds) {
    const companies = db.collection<Company>("companies");
    const isCompanyObjectId = /^[a-f\d]{24}$/i.test(legacyId);
    let company = isCompanyObjectId
      ? await companies.findOne({ _id: new ObjectId(legacyId) })
      : null;
    company ??= await companies.findOne({ legacyPartitionId: legacyId });
    if (!company && (legacyId === "pilot-company" || legacyIds.size === 1)) {
      company = defaultCompanyWithId;
      await companies.updateOne({ _id: defaultCompanyId }, { $set: { legacyPartitionId: legacyId } });
    }
    if (!company) {
      const name = `Doanh nghiệp đã chuyển đổi (${legacyId})`;
      const now = new Date();
      await companies.updateOne(
        { legacyPartitionId: legacyId },
        { $setOnInsert: { name, normalizedName: normalizeCompanyName(name), legacyPartitionId: legacyId, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
      company = await companies.findOne({ legacyPartitionId: legacyId });
    }
    if (!company?._id) throw new Error(`Unable to migrate legacy tenant data: ${legacyId}`);
    for (const collectionName of dataCollections) {
      await db.collection(collectionName).updateMany(
        { tenantId: legacyId },
        { $set: { companyId: company._id.toHexString() } },
      );
    }
  }
}

async function dropLegacyTenantIndexes(db: Db) {
  for (const collectionName of ["catalogItems", "quoteRequests", "quotes", "auditLogs"]) {
    const collection = db.collection(collectionName);
    let indexes;
    try {
      indexes = await collection.listIndexes().toArray();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 26) continue;
      throw error;
    }
    for (const index of indexes) {
      if (index.name !== "_id_" && Object.hasOwn(index.key, "tenantId")) {
        await collection.dropIndex(index.name);
      }
    }
  }
}

async function removeLegacyTenantFields(db: Db) {
  const existingCollections = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );
  for (const collectionName of ["catalogItems", "quoteRequests", "quotes", "auditLogs"]) {
    if (!existingCollections.has(collectionName)) continue;
    await db.collection(collectionName).updateMany(
      { companyId: { $exists: true }, tenantId: { $exists: true } },
      { $unset: { tenantId: "" } },
    );
  }
}

async function seedAdmin(db: Db) {
  const users = db.collection<UserAccount>("users");
  const user = config.seedAdmin;
  if (user) {
    let email = user.email.trim().toLowerCase();
    const admin = await users.findOne({ role: "admin", companyId: { $exists: false } });
    const existingEmail = await users.findOne({ email });
    if (!admin && existingEmail) {
      const at = email.lastIndexOf("@");
      const localPart = at > 0 ? email.slice(0, at) : "system-admin";
      const domain = at > 0 ? email.slice(at) : "@localhost.invalid";
      let suffix = 1;
      do {
        email = `${localPart}+system-admin${suffix === 1 ? "" : `-${suffix}`}${domain}`;
        suffix += 1;
      } while (await users.findOne({ email }));
      logger.warn("admin.seed_email_conflict", { resolution: "generated_fallback_email" });
    } else if (admin && existingEmail && String(admin._id) !== String(existingEmail._id)) {
      logger.warn("admin.seed_email_conflict", { resolution: "retained_existing_admin_email" });
    }
    if (admin) {
      await users.updateMany(
        { role: "admin", _id: { $ne: admin._id } },
        { $set: { role: "user", updatedAt: new Date() }, $unset: { platformAdmin: "" } },
      );
    }
    const target = admin;
    const targetEmail = admin && existingEmail && String(admin._id) !== String(existingEmail._id)
      ? admin.email
      : email;
    const now = new Date();
    const fields = {
      id: target?.id ?? user.id,
      email: targetEmail,
      name: user.name,
      role: user.role,
      passwordHash: user.passwordHash,
      active: true,
      authVersion: target?.authVersion ?? 0,
      updatedAt: now,
    };
    if (target) {
      await users.updateOne(
        { _id: target._id },
        { $set: fields, $unset: { companyId: "", platformAdmin: "" } },
      );
    } else {
      await users.updateMany(
        { role: "admin" },
        { $set: { role: "user", updatedAt: now }, $unset: { platformAdmin: "" } },
      );
      await users.insertOne({ ...fields, createdAt: now });
    }
  }
}

async function migrateUserRoles(db: Db) {
  const users = db.collection("users");
  const now = new Date();
  const configuredAdminEmail = config.seedAdmin?.email.trim().toLowerCase();
  const configuredAccount = configuredAdminEmail ? await users.findOne({ email: configuredAdminEmail }) : null;
  const legacyPlatformAdmin = await users.findOne({ platformAdmin: true });
  const stableSeedAdmin = await users.findOne({ id: "seed-admin" });
  const detachedAdmin = await users.findOne({ role: "admin", companyId: { $exists: false } });
  const configuredAccountIsBusiness = Boolean(configuredAccount)
    && configuredAccount?.platformAdmin !== true
    && configuredAccount?.id !== "seed-admin"
    && (configuredAccount?.role !== "admin" || typeof configuredAccount.companyId === "string");
  const systemAdmin = configuredAccount && !configuredAccountIsBusiness
    ? configuredAccount
    : legacyPlatformAdmin ?? stableSeedAdmin ?? detachedAdmin;

  await users.updateMany(
    { role: { $in: ["sales", "approver"] } },
    { $set: { role: "user", updatedAt: now }, $unset: { platformAdmin: "" } },
  );
  await users.updateMany(
    { role: "admin", ...(systemAdmin ? { _id: { $ne: systemAdmin._id } } : {}) },
    { $set: { role: "user", updatedAt: now }, $unset: { platformAdmin: "" } },
  );
  await users.updateMany(
    { platformAdmin: true, ...(systemAdmin ? { _id: { $ne: systemAdmin._id } } : {}) },
    { $set: { role: "user", updatedAt: now }, $unset: { platformAdmin: "" } },
  );
  if (systemAdmin) {
    await users.updateOne(
      { _id: systemAdmin._id },
      { $set: { role: "admin", updatedAt: now }, $unset: { companyId: "", platformAdmin: "" } },
    );
  }

}

export async function connectDatabase() {
  if (!connection) {
    connection = client.connect().then(async () => {
      const db = client.db(config.mongoDatabase);
      await Promise.all([
        db.collection<Company>("companies").createIndex({ normalizedName: 1 }, { unique: true }),
        db.collection<Company>("companies").createIndex({ legacyPartitionId: 1 }, { unique: true, sparse: true }),
        db.collection<UserAccount>("users").createIndex({ email: 1 }, { unique: true }),
        db.collection("companyFiles").createIndex({ companyId: 1, createdAt: -1 }),
      ]);
      const defaultCompany = await ensureCompany(db, config.defaultCompanyName);
      if (!defaultCompany._id) throw new Error("Default company record has no id");
      await migrateLegacyTenantData(db, defaultCompany);
      await dropLegacyTenantIndexes(db);
      await removeLegacyTenantFields(db);
      await Promise.all([
        db.collection("catalogItems").createIndex({ companyId: 1, sku: 1 }, { unique: true }),
        db.collection("catalogItems").createIndex({ companyId: 1, active: 1, name: 1 }),
        db.collection("catalogImportMappings").createIndex({ companyId: 1 }, { unique: true }),
        db.collection("quoteRequests").createIndex({ companyId: 1, createdAt: -1 }),
        db.collection("quoteRequests").createIndex({ companyId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }),
        db.collection("quotes").createIndex({ companyId: 1, quoteNumber: 1 }, { unique: true }),
        db.collection("quotes").createIndex({ companyId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }),
        db.collection("quotes").createIndex({ companyId: 1, status: 1, createdAt: -1 }),
        db.collection("auditLogs").createIndex({ companyId: 1, createdAt: -1 }),
      ]);
      const platformSettings = db.collection<{ _id: string; createdAt?: Date }>("platformSettings");
      const roleModel = await platformSettings.findOne({ _id: "user-role-model-v2" });
      if (!roleModel) {
        await migrateUserRoles(db);
        await seedAdmin(db);
        await platformSettings.updateOne(
          { _id: "user-role-model-v2" },
          { $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
      } else {
        await seedAdmin(db);
      }
      if (config.nodeEnv === "production" && await db.collection<UserAccount>("users").countDocuments({ role: "admin" }) !== 1) {
        throw new Error("Configure exactly one system admin with SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD");
      }
    });
  }
  await connection;
  return client.db(config.mongoDatabase);
}

export async function closeDatabase() {
  await client.close();
}
