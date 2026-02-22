const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
            minlength: 2,
            maxlength: 100,
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: 6,
            select: false, // Never return password in queries by default
        },
        role: {
            type: String,
            enum: ["student", "admin"],
            default: "student",
        },
        employeeId: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        department: {
            type: String,
            default: "General",
            trim: true,
        },

        // Face data — embeddings ONLY, never raw images
        faceEmbedding: {
            vector: {
                type: [Number],
                default: [],
            },
            model: {
                type: String,
                default: "custom-histogram-v2",
            },
            registeredAt: Date,
            confidence: Number,
            thumbnail: String, // Small base64 thumbnail for display
        },

        status: {
            type: String,
            enum: ["active", "inactive", "suspended"],
            default: "active",
        },

        // Security fields
        loginAttempts: { type: Number, default: 0 },
        lockUntil: Date,
        refreshToken: { type: String, select: false },
        lastLogin: Date,
    },
    {
        timestamps: true,
    }
);

// Index for fast lookups
userSchema.index({ email: 1 });
userSchema.index({ employeeId: 1 });
userSchema.index({ role: 1, status: 1 });

// Hash password before saving
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function () {
    return this.lockUntil && this.lockUntil > Date.now();
};

// Increment login attempts
userSchema.methods.incrementLoginAttempts = async function () {
    this.loginAttempts += 1;
    if (this.loginAttempts >= 5) {
        this.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
    }
    await this.save();
};

// Reset login attempts
userSchema.methods.resetLoginAttempts = async function () {
    this.loginAttempts = 0;
    this.lockUntil = undefined;
    this.lastLogin = new Date();
    await this.save();
};

module.exports = mongoose.model("User", userSchema);
