import { MongoClient, ObjectId, type Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
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

async function seedAdmin(db: Db, defaultCompany: Company) {
  const users = db.collection<UserAccount>("users");
  const user = config.seedAdmin;
  if (user) {
    const company = normalizeCompanyName(user.companyName) === defaultCompany.normalizedName
      ? defaultCompany
      : await ensureCompany(db, user.companyName);
    if (!company._id) throw new Error(`Company record has no id: ${company.name}`);
    const now = new Date();
    const email = user.email.trim().toLowerCase();
    const existingUser = await users.findOne({ email });
    await users.updateOne(
      { email },
      {
        $set: {
          id: existingUser?.id ?? user.id,
          email,
          name: user.name,
          role: user.role,
          platformAdmin: user.platformAdmin === true,
          passwordHash: user.passwordHash,
          companyId: company._id.toHexString(),
          active: true,
          authVersion: existingUser?.authVersion ?? 0,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
  }
  if (config.nodeEnv === "production" && await users.countDocuments() === 0) {
    throw new Error("Seed an admin with SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before production startup");
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
      const migrationCompanyName = config.seedAdmin?.companyName
        ?? config.defaultCompanyName;
      const defaultCompany = await ensureCompany(db, migrationCompanyName);
      if (!defaultCompany._id) throw new Error("Default company record has no id");
      await migrateLegacyTenantData(db, defaultCompany);
      await dropLegacyTenantIndexes(db);
      await removeLegacyTenantFields(db);
      await Promise.all([
        db.collection("catalogItems").createIndex({ companyId: 1, sku: 1 }, { unique: true }),
        db.collection("catalogItems").createIndex({ companyId: 1, active: 1, name: 1 }),
        db.collection("quoteRequests").createIndex({ companyId: 1, createdAt: -1 }),
        db.collection("quoteRequests").createIndex({ companyId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }),
        db.collection("quotes").createIndex({ companyId: 1, quoteNumber: 1 }, { unique: true }),
        db.collection("quotes").createIndex({ companyId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }),
        db.collection("quotes").createIndex({ companyId: 1, status: 1, createdAt: -1 }),
        db.collection("auditLogs").createIndex({ companyId: 1, createdAt: -1 }),
      ]);
      await db.collection("users").updateMany(
        { role: "approver" },
        { $set: { role: "sales", updatedAt: new Date() } },
      );
      await seedAdmin(db, defaultCompany);
    });
  }
  await connection;
  return client.db(config.mongoDatabase);
}

export async function closeDatabase() {
  await client.close();
}
