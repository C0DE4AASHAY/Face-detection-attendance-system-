const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "teacher", "student"], default: "student" },
    employeeId: { type: String, unique: true, sparse: true },
    department: { type: String, default: "General" },
    status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },

    faceEmbedding: {
        vector: [Number],
        model: String,
        registeredAt: Date,
        confidence: Number,
        thumbnail: String
    },

    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    lastLogin: { type: Date },
    refreshToken: { type: String }
}, { timestamps: true });

userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
