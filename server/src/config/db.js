const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        console.log(`\n📦 MongoDB Connected: ${conn.connection.host}`);
    } catch (err) {
        console.error(`❌ MongoDB Connection Error: ${err.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
