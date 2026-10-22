import { config as loadEnvironment } from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

loadEnvironment({ path: ".env" });
const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/bao_gia_pilot";
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  authSource: process.env.MONGODB_AUTH_SOURCE ?? "admin",
  ...(process.env.MONGODB_USER && process.env.MONGODB_PASSWORD
    ? { auth: { username: process.env.MONGODB_USER, password: process.env.MONGODB_PASSWORD } }
    : {}),
});
try {
  await client.connect();
  const database = client.db(process.env.MONGODB_DATABASE || new URL(uri).pathname.slice(1) || "bao_gia_pilot");
  const rows = await database.collection("catalogItems").aggregate([
    { $match: { active: true } },
    { $group: { _id: "$companyId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]).toArray();
  const companies = await database.collection("companies").find({ _id: { $in: rows.filter((row) => ObjectId.isValid(row._id)).map((row) => new ObjectId(row._id)) } }).toArray();
  for (const row of rows) {
    const company = companies.find((item) => String(item._id) === row._id);
    process.stdout.write(`${row._id} | ${company?.name ?? "(unknown)"} | ${row.count} active catalog items\n`);
  }
  if (process.argv.includes("--catalog") && rows[0]) {
    const sample = await database.collection("catalogItems").find({ companyId: rows[0]._id, active: true }, { projection: { sku: 1, name: 1, unit: 1, price: 1, currency: 1 } }).sort({ sku: 1 }).limit(100).toArray();
    for (const item of sample) process.stdout.write(`${item.sku} | ${item.name} | ${item.price} ${item.currency}/${item.unit}\n`);
  }
  process.stdout.write(`AI configured: ${Boolean(process.env.OPENROUTER_API_KEY)}\n`);
} finally {
  await client.close();
}
