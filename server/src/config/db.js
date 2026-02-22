/**
 * Database setup using NeDB (embedded, file-based, MongoDB-compatible).
 * Zero-config: no external database server needed.
 */
const Datastore = require("nedb-promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

const db = {
    users: Datastore.create({ filename: path.join(DATA_DIR, "users.db"), autoload: true }),
    attendance: Datastore.create({ filename: path.join(DATA_DIR, "attendance.db"), autoload: true }),
    settings: Datastore.create({ filename: path.join(DATA_DIR, "settings.db"), autoload: true }),
};

// Create indexes
async function setupIndexes() {
    await db.users.ensureIndex({ fieldName: "email", unique: true });
    await db.users.ensureIndex({ fieldName: "employeeId", unique: true, sparse: true });
    await db.attendance.ensureIndex({ fieldName: "date" });
    // Compound unique on userId+date is enforced in code
}

setupIndexes().catch(console.error);

module.exports = db;
